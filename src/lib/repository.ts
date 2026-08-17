import type {
  AttachmentMeta,
  CommandHistory,
  EntityId,
  Folder,
  LegacyV1Backup,
  LinkRecord,
  Note,
  RecoveryBackup,
  Settings,
  WorkspaceSnapshot,
} from '../types';
import { emptyDoc, extractWikiLinks, jsonToText } from './content';
import { migrateLegacyV1 } from './import';
import { uid } from './ids';

const DB_NAME = 'notebook_v2_db';
const DB_VERSION = 3;
const LEGACY_DB_NAME = 'notebook_app_db';
const DRAFT_JOURNAL_KEY = 'notebook_v2_pending_drafts';

const stores = {
  folders: 'folders',
  notes: 'notes',
  settings: 'settings',
  links: 'links',
  attachments: 'attachments',
  commandHistory: 'commandHistory',
  recoveryBackups: 'recoveryBackups',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;
const noteSaveQueues = new Map<EntityId, Promise<Note>>();

type DraftJournalEntry = {
  note: Note;
  capturedAt: number;
};

function readDraftJournal(): DraftJournalEntry[] {
  try {
    const raw = localStorage.getItem(DRAFT_JOURNAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((entry): entry is DraftJournalEntry => {
      const candidate = entry as DraftJournalEntry;
      return Boolean(candidate?.note?.id) && Number.isFinite(candidate.capturedAt);
    });
  } catch {
    // Storage can be disabled or unavailable in private browsing contexts.
    return [];
  }
}

function writeDraftJournal(entries: DraftJournalEntry[]): void {
  try {
    if (entries.length === 0) {
      localStorage.removeItem(DRAFT_JOURNAL_KEY);
      return;
    }
    localStorage.setItem(DRAFT_JOURNAL_KEY, JSON.stringify(entries));
  } catch {
    // IndexedDB remains the primary store; the journal is only a crash/reload safety net.
  }
}

/**
 * Write the latest editor state synchronously before the debounced IndexedDB
 * write. This closes the small but important window where a reload could
 * destroy text that was still waiting on the editor timer.
 */
export function saveDraft(note: Note): void {
  const entries = readDraftJournal().filter((entry) => entry.note.id !== note.id);
  entries.push({
    note: { ...note, updatedAt: Date.now() },
    capturedAt: Date.now(),
  });
  writeDraftJournal(entries.slice(-50));
}

function sameNotePayload(left: Note, right: Note): boolean {
  const { updatedAt: _leftUpdatedAt, ...leftPayload } = left;
  const { updatedAt: _rightUpdatedAt, ...rightPayload } = right;
  return JSON.stringify(leftPayload) === JSON.stringify(rightPayload);
}

function clearDraftIfMatches(note: Note): void {
  const entries = readDraftJournal();
  const remaining = entries.filter((entry) => entry.note.id !== note.id || !sameNotePayload(entry.note, note));
  if (remaining.length !== entries.length) writeDraftJournal(remaining);
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB is unavailable in this browser context.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const upgradeTransaction = request.transaction;
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion;

      if (!db.objectStoreNames.contains(stores.folders)) {
        const folders = db.createObjectStore(stores.folders, { keyPath: 'id' });
        folders.createIndex('position', 'position');
      }

      if (!db.objectStoreNames.contains(stores.notes)) {
        const notes = db.createObjectStore(stores.notes, { keyPath: 'id' });
        notes.createIndex('folderId', 'folderId');
        notes.createIndex('updatedAt', 'updatedAt');
        notes.createIndex('favorite', 'favorite');
        notes.createIndex('pinned', 'pinned');
      }

      if (!db.objectStoreNames.contains(stores.settings)) {
        db.createObjectStore(stores.settings, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(stores.links)) {
        const links = db.createObjectStore(stores.links, { keyPath: 'id' });
        links.createIndex('sourceNoteId', 'sourceNoteId');
        links.createIndex('targetNoteId', 'targetNoteId');
        links.createIndex('targetTitle', 'targetTitle');
      }

      if (!db.objectStoreNames.contains(stores.attachments)) {
        const attachments = db.createObjectStore(stores.attachments, { keyPath: 'id' });
        attachments.createIndex('noteId', 'noteId');
      }

      if (!db.objectStoreNames.contains(stores.commandHistory)) {
        const commandHistory = db.createObjectStore(stores.commandHistory, { keyPath: 'id' });
        commandHistory.createIndex('createdAt', 'createdAt');
      }

      if (!db.objectStoreNames.contains(stores.recoveryBackups)) {
        const recoveryBackups = db.createObjectStore(stores.recoveryBackups, { keyPath: 'id' });
        recoveryBackups.createIndex('createdAt', 'createdAt');
      }

      if (!upgradeTransaction || oldVersion === 0) return;
      const migrationTransaction = upgradeTransaction;

      // Keep a copy inside IndexedDB before changing old records. This gives the
      // app a recovery point if a future schema migration needs to be undone.
      const foldersRequest = migrationTransaction.objectStore(stores.folders).getAll();
      const notesRequest = migrationTransaction.objectStore(stores.notes).getAll();
      const settingsRequest = migrationTransaction.objectStore(stores.settings).get('settings');
      let folders: Folder[] | undefined;
      let notes: Note[] | undefined;
      let settings: Settings | undefined;
      let backupWritten = false;

      function writeRecoveryBackup() {
        if (backupWritten || !folders || !notes || !settings) return;
        backupWritten = true;
        const backup: RecoveryBackup = {
          id: uid('recovery'),
          sourceVersion: oldVersion,
          createdAt: Date.now(),
          folders,
          notes,
          settings,
        };
        migrationTransaction.objectStore(stores.recoveryBackups).put(backup);
      }

      foldersRequest.onsuccess = () => {
        folders = foldersRequest.result as Folder[];
        writeRecoveryBackup();
      };
      notesRequest.onsuccess = () => {
        notes = notesRequest.result as Note[];
        writeRecoveryBackup();
      };
      settingsRequest.onsuccess = () => {
        settings = (settingsRequest.result as Settings | undefined) ?? {
          id: 'settings',
          schemaVersion: oldVersion,
          lastOpenedNoteId: null,
          updatedAt: Date.now(),
        };
        writeRecoveryBackup();
      };

      if (oldVersion < 3) {
        const noteCursor = migrationTransaction.objectStore(stores.notes).openCursor();
        noteCursor.onsuccess = () => {
          const cursor = noteCursor.result;
          if (!cursor) return;
          const note = cursor.value as Note;
          if (!note.status) cursor.update({ ...note, status: 'active' });
          cursor.continue();
        };

        const settingsCursor = migrationTransaction.objectStore(stores.settings).openCursor();
        settingsCursor.onsuccess = () => {
          const cursor = settingsCursor.result;
          if (!cursor) return;
          const current = cursor.value as Settings;
          cursor.update({ ...current, schemaVersion: DB_VERSION });
          cursor.continue();
        };
      }
    };

    request.onsuccess = () => {
      if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
        void navigator.storage.persist().catch(() => undefined);
      }
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
    request.onblocked = () => reject(new Error('Notebook is open in another tab and blocked the database upgrade.'));
  });

  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

async function getStore(storeName: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(storeName, mode).objectStore(storeName);
}

async function getAll<T>(storeName: string): Promise<T[]> {
  const store = await getStore(storeName, 'readonly');
  return requestToPromise<T[]>(store.getAll());
}

async function get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const store = await getStore(storeName, 'readonly');
  return requestToPromise<T | undefined>(store.get(key));
}

async function put<T>(storeName: string, value: T): Promise<T> {
  const store = await getStore(storeName, 'readwrite');
  await requestToPromise(store.put(value));
  return value;
}

async function del(storeName: string, key: IDBValidKey): Promise<void> {
  const store = await getStore(storeName, 'readwrite');
  await requestToPromise(store.delete(key));
}

async function clear(storeName: string): Promise<void> {
  const store = await getStore(storeName, 'readwrite');
  await requestToPromise(store.clear());
}

function defaultSettings(): Settings {
  return {
    id: 'settings',
    schemaVersion: DB_VERSION,
    lastOpenedNoteId: null,
    updatedAt: Date.now(),
  };
}

function starterFolder(position = 0): Folder {
  const now = Date.now();
  return {
    id: uid('folder'),
    name: 'Inbox',
    color: 'teal',
    position,
    createdAt: now,
    updatedAt: now,
  };
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot & { recoveryBackup?: RecoveryBackup }> {
  await openDb();
  let settings = (await get<Settings>(stores.settings, 'settings')) ?? defaultSettings();
  let folders = await getAll<Folder>(stores.folders);
  let notes = await getAll<Note>(stores.notes);

  notes = await recoverPendingDrafts(notes, folders);

  if (folders.length === 0 && notes.length === 0) {
    const legacyWorkspace = await readLegacyWorkspace();
    if (legacyWorkspace) {
      await replaceWorkspace(legacyWorkspace);
      folders = legacyWorkspace.folders;
      notes = legacyWorkspace.notes;
      settings = legacyWorkspace.settings;
    }
  }

  if (folders.length === 0 && notes.length === 0) {
    const folder = starterFolder();
    const note = createNote(folder.id, {
      title: 'Getting started',
      text: 'Use the command palette to create notes and folders. Add [[links]] to connect ideas, and export a backup whenever you need a portable copy.',
      tags: ['getting-started'],
    });

    await put(stores.folders, folder);
    await put(stores.notes, note);
    settings = { ...settings, lastOpenedNoteId: note.id, updatedAt: Date.now() };
    await put(stores.settings, settings);
    await rebuildLinks([note]);

    folders = [folder];
    notes = [note];
  }

  const recoveryBackups = await getAll<RecoveryBackup>(stores.recoveryBackups);

  return {
    folders: folders.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    notes: notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
    settings,
    recoveryBackup: recoveryBackups.sort((a, b) => b.createdAt - a.createdAt)[0],
  };
}

async function readLegacyWorkspace(): Promise<WorkspaceSnapshot | undefined> {
  if (!('indexedDB' in globalThis)) return undefined;

  try {
    // Avoid opening/creating the legacy database when it never existed. This
    // API is supported by current Chromium, Firefox, and Safari releases.
    if (indexedDB.databases) {
      const databases = await indexedDB.databases();
      if (!databases.some((database) => database.name === LEGACY_DB_NAME)) return undefined;
    }

    const legacy = await readLegacyStores();
    if (legacy.folders.length === 0 && legacy.notes.length === 0) return undefined;

    return migrateLegacyV1({
      appName: 'Notebook',
      version: 1,
      folders: legacy.folders,
      notes: legacy.notes,
    } as LegacyV1Backup);
  } catch {
    // Legacy recovery is best effort; a normal empty workspace can still open.
    return undefined;
  }
}

function readLegacyStores(): Promise<{ folders: Array<Record<string, unknown>>; notes: Array<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      // If databases() was unavailable, do not leave a newly created empty DB
      // behind. The caller will simply continue with a fresh workspace.
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('folders') || !db.objectStoreNames.contains('notes')) {
        db.close();
        resolve({ folders: [], notes: [] });
        return;
      }

      const transaction = db.transaction(['folders', 'notes'], 'readonly');
      const foldersRequest = transaction.objectStore('folders').getAll();
      const notesRequest = transaction.objectStore('notes').getAll();
      let folders: Array<Record<string, unknown>> = [];
      let notes: Array<Record<string, unknown>> = [];

      foldersRequest.onsuccess = () => { folders = foldersRequest.result as Array<Record<string, unknown>>; };
      notesRequest.onsuccess = () => { notes = notesRequest.result as Array<Record<string, unknown>>; };
      transaction.oncomplete = () => {
        db.close();
        resolve({ folders, notes });
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error ?? new Error('Could not read the legacy Notebook database.'));
      };
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open the legacy Notebook database.'));
  });
}

export function createFolder(name = 'Untitled folder', position = 0): Folder {
  const now = Date.now();
  return {
    id: uid('folder'),
    name: name.trim() || 'Untitled folder',
    color: 'slate',
    position,
    createdAt: now,
    updatedAt: now,
  };
}

export function createNote(folderId: EntityId | null, overrides: Partial<Note> = {}): Note {
  const now = Date.now();
  const content =
    overrides.content ??
    (overrides.text
      ? {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: overrides.text }],
            },
          ],
        }
      : emptyDoc);

  return {
    id: uid('note'),
    folderId,
    title: '',
    content,
    text: jsonToText(content),
    tags: [],
    favorite: false,
    pinned: false,
    status: 'active',
    color: 'slate',
    position: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export async function saveFolder(folder: Folder): Promise<Folder> {
  const updated = { ...folder, updatedAt: Date.now() };
  return put(stores.folders, updated);
}

export async function trashNote(note: Note): Promise<Note> {
  return saveNote({
    ...note,
    status: 'trashed',
    trashedAt: Date.now(),
    trashedReason: 'note',
  });
}

export async function restoreNote(note: Note, folders: Folder[]): Promise<Note> {
  const folder = note.folderId ? folders.find((item) => item.id === note.folderId) : undefined;
  return saveNote({
    ...note,
    folderId: folder && !folder.deletedAt ? folder.id : null,
    status: 'active',
    trashedAt: undefined,
    trashedReason: undefined,
  });
}

export async function trashFolder(folder: Folder, notes: Note[]): Promise<{ folder: Folder; notes: Note[] }> {
  const deletedAt = Date.now();
  const updatedFolder = await saveFolder({ ...folder, deletedAt });
  const updatedNotes = await Promise.all(
    notes
      .filter((note) => note.folderId === folder.id && note.status !== 'trashed')
      .map((note) => saveNote({
        ...note,
        status: 'trashed',
        trashedAt: deletedAt,
        trashedReason: 'folder',
      })),
  );

  return { folder: updatedFolder, notes: updatedNotes };
}

export async function restoreFolder(folder: Folder, notes: Note[]): Promise<{ folder: Folder; notes: Note[] }> {
  const updatedFolder = await saveFolder({ ...folder, deletedAt: undefined });
  const updatedNotes = await Promise.all(
    notes
      .filter((note) => note.folderId === folder.id && note.trashedReason === 'folder')
      .map((note) => saveNote({
        ...note,
        status: 'active',
        trashedAt: undefined,
        trashedReason: undefined,
      })),
  );

  return { folder: updatedFolder, notes: updatedNotes };
}

export async function deleteFolderPermanently(folderId: EntityId, notes: Note[]): Promise<void> {
  await del(stores.folders, folderId);
  await Promise.all(notes.filter((note) => note.folderId === folderId).map((note) => deleteNote(note.id)));
}

export async function saveNote(note: Note): Promise<Note> {
  const previous = noteSaveQueues.get(note.id) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => saveNoteNow(note));
  noteSaveQueues.set(note.id, current);

  try {
    return await current;
  } finally {
    if (noteSaveQueues.get(note.id) === current) noteSaveQueues.delete(note.id);
  }
}

async function saveNoteNow(note: Note): Promise<Note> {
  const content = note.content ?? emptyDoc;
  const updated = {
    ...note,
    content,
    text: jsonToText(content) || note.text,
    updatedAt: Date.now(),
  };

  await put(stores.notes, updated);
  clearDraftIfMatches(note);
  await rebuildLinksForNote(updated);
  return updated;
}

async function recoverPendingDrafts(notes: Note[], folders: Folder[]): Promise<Note[]> {
  const entries = readDraftJournal();
  if (entries.length === 0) return notes;

  const recovered = [...notes];
  for (const entry of entries) {
    const persisted = recovered.find((note) => note.id === entry.note.id);
    if (persisted && entry.capturedAt <= persisted.updatedAt) {
      clearDraftIfMatches(entry.note);
      continue;
    }

    const folderId = entry.note.folderId && folders.some((folder) => folder.id === entry.note.folderId)
      ? entry.note.folderId
      : null;
    const draft = { ...entry.note, folderId, updatedAt: entry.capturedAt };
    const saved = await saveNote(draft);
    const index = recovered.findIndex((note) => note.id === saved.id);
    if (index === -1) recovered.push(saved);
    else recovered[index] = saved;
  }

  return recovered;
}

export async function deleteNote(noteId: EntityId): Promise<void> {
  await del(stores.notes, noteId);
  await deleteLinksForNote(noteId);
}

export async function getLatestRecoveryBackup(): Promise<RecoveryBackup | undefined> {
  const backups = await getAll<RecoveryBackup>(stores.recoveryBackups);
  return backups.sort((a, b) => b.createdAt - a.createdAt)[0];
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  return put(stores.settings, { ...settings, updatedAt: Date.now() });
}

export async function replaceWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
  await Promise.all(Object.values(stores).map(clear));
  await Promise.all(snapshot.folders.map((folder) => put(stores.folders, folder)));
  await Promise.all(snapshot.notes.map((note) => put(stores.notes, note)));
  await put(stores.settings, snapshot.settings);
  await rebuildLinks(snapshot.notes);
}

export async function clearLocalWorkspace(): Promise<void> {
  await Promise.all(Object.values(stores).map(clear));
  writeDraftJournal([]);
}

export async function recordCommand(command: string): Promise<void> {
  const row: CommandHistory = {
    id: uid('command'),
    command,
    createdAt: Date.now(),
  };
  await put(stores.commandHistory, row);
}

export async function listCommandHistory(): Promise<CommandHistory[]> {
  return (await getAll<CommandHistory>(stores.commandHistory)).sort((a, b) => b.createdAt - a.createdAt);
}

export async function listAttachments(): Promise<AttachmentMeta[]> {
  return getAll<AttachmentMeta>(stores.attachments);
}

export async function listLinks(): Promise<LinkRecord[]> {
  return getAll<LinkRecord>(stores.links);
}

async function rebuildLinks(notes: Note[]): Promise<void> {
  await clear(stores.links);
  await Promise.all(notes.map(rebuildLinksForNote));
}

async function rebuildLinksForNote(note: Note): Promise<void> {
  await deleteLinksForNote(note.id);
  const links = extractWikiLinks(note.text).map<LinkRecord>((targetTitle) => ({
    id: uid('link'),
    sourceNoteId: note.id,
    targetNoteId: null,
    targetTitle,
    kind: 'wiki',
    createdAt: Date.now(),
  }));

  await Promise.all(links.map((link) => put(stores.links, link)));
}

async function deleteLinksForNote(noteId: EntityId): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(stores.links, 'readwrite');
  const index = tx.objectStore(stores.links).index('sourceNoteId');
  const request = index.openCursor(IDBKeyRange.only(noteId));

  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('Could not delete note links.'));
  });
}

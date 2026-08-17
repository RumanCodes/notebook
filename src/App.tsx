import {
  Archive,
  ArchiveRestore,
  Cloud,
  CloudOff,
  Command,
  Download,
  FileDown,
  FilePlus2,
  FolderPlus,
  Import,
  LogOut,
  Menu,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Tags,
  Trash2,
  UserRoundX,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { EditorPane } from './components/EditorPane';
import { Inspector } from './components/Inspector';
import {
  CloudApiError,
  GOOGLE_CLIENT_ID,
  deleteCloudAccount,
  getSession,
  isCloudConfigured,
  loadCloudWorkspace,
  loginWithGoogle,
  logoutFromCloud,
  saveCloudWorkspace,
  type CloudUser,
} from './lib/cloud';
import { createBackup, downloadText, exportNoteMarkdown, exportWorkspaceMarkdown, safeFilename } from './lib/export';
import { parseBackup } from './lib/import';
import {
  clearLocalWorkspace,
  createFolder,
  createNote,
  deleteFolderPermanently,
  deleteNote,
  restoreFolder,
  restoreNote,
  loadWorkspace,
  recordCommand,
  replaceWorkspace,
  saveFolder,
  saveNote,
  saveSettings,
  trashFolder,
  trashNote,
} from './lib/repository';
import { rankNotes } from './lib/search';
import type { EntityId, Folder, Note, RecoveryBackup, Settings, WorkspaceSnapshot } from './types';

type ViewId = EntityId | 'all' | 'favorites' | 'unfiled' | 'trash';
type ToastState = { id: string; tone: 'info' | 'danger'; message: string; action?: { label: string; run: () => Promise<void> } };
type AuthState = { status: 'checking' | 'signed-out' | 'signed-in' | 'offline'; user: CloudUser | null };
type SyncState = 'idle' | 'syncing' | 'synced' | 'error' | 'conflict' | 'offline';
type PendingCloudWorkspace = { workspace: WorkspaceSnapshot; revision: number | null; updatedAt: number | null };

let googleScriptPromise: Promise<void> | null = null;

function loadGoogleIdentityScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google sign-in is unavailable. Check your connection and try again.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google sign-in is unavailable. Check your connection and try again.'));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

function GoogleSignInButton({ onCredential, disabled }: { onCredential: (credential: string) => void; disabled?: boolean }) {
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!buttonRef.current || disabled || !GOOGLE_CLIENT_ID) return;
    buttonRef.current.innerHTML = '';

    loadGoogleIdentityScript()
      .then(() => {
        if (!buttonRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => onCredential(response.credential),
          auto_select: false,
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: 'outline',
          size: 'large',
          type: 'standard',
          shape: 'rectangular',
          text: 'signin_with',
          width: 280,
        });
      })
      .catch(() => undefined);
  }, [disabled, onCredential]);

  return <div ref={buttonRef} className="google-signin-slot" />;
}

function syncText(state: SyncState): string {
  if (state === 'syncing') return 'Saving';
  if (state === 'synced') return 'Saved';
  if (state === 'conflict') return 'Sync conflict';
  if (state === 'offline') return 'Offline';
  if (state === 'error') return 'Sync unavailable';
  return 'Ready';
}

function AuthScreen({ busy, error, onCredential }: { busy: boolean; error: string | null; onCredential: (credential: string) => void }) {
  return (
    <div className="auth-shell">
      <section className="auth-panel" aria-labelledby="auth-title">
        <span className="brand-mark">N</span>
        <h1 id="auth-title">Notebook</h1>
        <p>Notebook is a private, local-first notes app for writing, organizing, searching, and connecting ideas. Sign in to keep your workspace synced and available on every device.</p>
        {isCloudConfigured() ? (
          <GoogleSignInButton onCredential={onCredential} disabled={busy} />
        ) : (
          <div className="auth-error">Google sign-in is not configured. Add VITE_GOOGLE_CLIENT_ID before building.</div>
        )}
        {busy && <span className="auth-status">Opening your workspace</span>}
        {error && <div className="auth-error">{error}</div>}
      </section>
    </div>
  );
}

function WorkspaceLoadingScreen() {
  return (
    <div className="auth-shell">
      <section className="auth-panel" aria-labelledby="workspace-loading-title" aria-busy="true">
        <span className="brand-mark">N</span>
        <h1 id="workspace-loading-title">Notebook</h1>
        <p>Loading your workspace</p>
        <span className="auth-status" role="status">Checking your sign-in</span>
      </section>
    </div>
  );
}

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 20_000) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function folderName(folders: Folder[], id: EntityId | null): string {
  return folders.find((folder) => folder.id === id)?.name ?? 'Unfiled';
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function workspaceFromLocal(local: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    folders: local.folders,
    notes: local.notes,
    settings: local.settings,
  };
}

function isFreshWorkspace(snapshot: WorkspaceSnapshot): boolean {
  return snapshot.folders.length === 1
    && snapshot.folders[0]?.name === 'Inbox'
    && snapshot.notes.length === 1
    && snapshot.notes[0]?.title === 'Getting started'
    && snapshot.notes[0]?.tags.includes('getting-started');
}

function sameWorkspace(left: WorkspaceSnapshot, right: WorkspaceSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueTags(notes: Note[]): string[] {
  return [...new Set(notes.flatMap((note) => note.tags))].sort((a, b) => a.localeCompare(b));
}

export function App() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<ViewId>('all');
  const [selectedNoteId, setSelectedNoteId] = useState<EntityId | null>(null);
  const [query, setQuery] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<EntityId | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [auth, setAuth] = useState<AuthState>({ status: 'checking', user: null });
  const [authError, setAuthError] = useState<string | null>(null);
  const [offlineMessage, setOfflineMessage] = useState<string | null>(null);
  const [cloudUpdatedAt, setCloudUpdatedAt] = useState<number | null>(null);
  const [pendingCloud, setPendingCloud] = useState<PendingCloudWorkspace | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [recoveryBackup, setRecoveryBackup] = useState<RecoveryBackup | undefined>();
  const [loading, setLoading] = useState(true);
  const importInputRef = useRef<HTMLInputElement>(null);
  const booted = useRef(false);
  const saveRequest = useRef(0);
  const cloudRevisionRef = useRef<number | null>(null);
  const cloudSyncEnabled = useRef(false);
  const cloudSyncTimer = useRef<number | null>(null);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    if (!isCloudConfigured()) {
      setAuth({ status: 'signed-out', user: null });
      setLoading(false);
      return;
    }

    getSession()
      .then(async (session) => {
        if (!session.authenticated || !session.user) {
          setAuth({ status: 'signed-out', user: null });
          setLoading(false);
          return;
        }

        setAuth({ status: 'signed-in', user: session.user });
        await openSignedInWorkspace();
      })
      .catch(async (error) => {
        try {
          await openOfflineWorkspace("Cloud sync is unavailable. Your local notes remain available on this device.");
          setAuth({ status: 'offline', user: null });
        } catch {
          setAuth({ status: 'signed-out', user: null });
          setAuthError(error instanceof Error ? error.message : "We couldn't open your workspace. Check your connection and try again.");
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    if (!settings || auth.status !== 'signed-in' || !cloudSyncEnabled.current) return;
    if (cloudSyncTimer.current !== null) window.clearTimeout(cloudSyncTimer.current);

    const snapshot: WorkspaceSnapshot = { folders, notes, settings };
    setSyncState('syncing');
    cloudSyncTimer.current = window.setTimeout(() => {
      void saveCloudWorkspace(snapshot, cloudRevisionRef.current)
        .then((result) => {
          cloudRevisionRef.current = result.revision;
          setCloudUpdatedAt(result.updatedAt);
          setSyncState('synced');
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : "We couldn't sync your workspace.";
          if (error instanceof CloudApiError && error.status === 409) {
            void enterSyncConflict();
            return;
          }
          setOfflineMessage("Your local changes are safe on this device. Retry sync when the connection is available.");
          setSyncState(error instanceof CloudApiError ? 'error' : 'offline');
          showToast(message, 'danger');
        });
    }, 900);

    return () => {
      if (cloudSyncTimer.current !== null) window.clearTimeout(cloudSyncTimer.current);
    };
  }, [auth.status, folders, notes, settings]);

  useEffect(() => () => {
    if (cloudSyncTimer.current !== null) window.clearTimeout(cloudSyncTimer.current);
  }, []);

  useEffect(() => {
    function onResize() {
      if (window.innerWidth <= 880) setInspectorOpen(false);
    }

    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (auth.status !== 'signed-in' && auth.status !== 'offline') return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        void handleCreateNote();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const activeFolders = useMemo(() => folders.filter((folder) => !folder.deletedAt), [folders]);
  const activeNotes = useMemo(() => notes.filter((note) => note.status !== 'trashed'), [notes]);
  const trashedFolders = useMemo(() => folders.filter((folder) => folder.deletedAt), [folders]);
  const trashedNotes = useMemo(() => notes.filter((note) => note.status === 'trashed'), [notes]);
  const selectedNote = useMemo(() => activeNotes.find((note) => note.id === selectedNoteId) ?? null, [activeNotes, selectedNoteId]);
  const tags = useMemo(() => uniqueTags(activeNotes), [activeNotes]);
  const searchHits = useMemo(() => rankNotes(activeNotes, query), [activeNotes, query]);

  const visibleNotes = useMemo(() => {
    if (selectedFolderId === 'trash') return trashedNotes;
    if (query.trim()) return searchHits.map((hit) => hit.note);
    if (selectedFolderId === 'favorites') return activeNotes.filter((note) => note.favorite);
    if (selectedFolderId === 'unfiled') return activeNotes.filter((note) => note.folderId === null);
    if (selectedFolderId === 'all') return activeNotes;
    return activeNotes.filter((note) => note.folderId === selectedFolderId);
  }, [activeNotes, query, searchHits, selectedFolderId, trashedNotes]);

  function showToast(message: string, tone: ToastState['tone'] = 'info', action?: ToastState['action']) {
    const id = `${Date.now()}`;
    setToast({ id, message, tone, action });
    setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, 3000);
  }

  function applyWorkspaceSnapshot(snapshot: WorkspaceSnapshot, recovery?: RecoveryBackup) {
    setFolders(snapshot.folders);
    setNotes(snapshot.notes);
    setSettings(snapshot.settings);
    setRecoveryBackup(recovery);
    setSelectedNoteId(snapshot.settings.lastOpenedNoteId ?? snapshot.notes[0]?.id ?? null);
    setSelectedFolderId('all');
  }

  async function openOfflineWorkspace(message: string) {
    const local = await loadWorkspace();
    applyWorkspaceSnapshot(workspaceFromLocal(local), local.recoveryBackup);
    cloudSyncEnabled.current = false;
    cloudRevisionRef.current = null;
    setPendingCloud(null);
    setCloudUpdatedAt(null);
    setOfflineMessage(message);
    setSyncState('offline');
    setLoading(false);
  }

  async function openSignedInWorkspace() {
    cloudSyncEnabled.current = false;
    setLoading(true);
    setAuthError(null);
    setOfflineMessage(null);
    setPendingCloud(null);

    const local = await loadWorkspace();
    const localSnapshot = workspaceFromLocal(local);
    let cloud;
    try {
      cloud = await loadCloudWorkspace();
    } catch {
      applyWorkspaceSnapshot(localSnapshot, local.recoveryBackup);
      cloudSyncEnabled.current = false;
      cloudRevisionRef.current = null;
      setCloudUpdatedAt(null);
      setOfflineMessage('Cloud sync is unavailable. Your local notes remain available on this device.');
      setSyncState('offline');
      setLoading(false);
      return;
    }

    let snapshot = localSnapshot;
    let backup = local.recoveryBackup;

    if (cloud.workspace && !isFreshWorkspace(localSnapshot) && !sameWorkspace(localSnapshot, cloud.workspace)) {
      applyWorkspaceSnapshot(localSnapshot, local.recoveryBackup);
      cloudRevisionRef.current = cloud.revision;
      setCloudUpdatedAt(cloud.updatedAt);
      setPendingCloud({ workspace: cloud.workspace, revision: cloud.revision, updatedAt: cloud.updatedAt });
      setOfflineMessage('This device and your cloud workspace contain different changes. Choose which copy to keep.');
      setSyncState('conflict');
      setLoading(false);
      return;
    }

    if (cloud.workspace) {
      snapshot = cloud.workspace;
      backup = undefined;
      await replaceWorkspace(snapshot);
      cloudRevisionRef.current = cloud.revision;
      setCloudUpdatedAt(cloud.updatedAt);
    } else {
      try {
        const result = await saveCloudWorkspace(snapshot, null);
        cloudRevisionRef.current = result.revision;
        setCloudUpdatedAt(result.updatedAt);
      } catch {
        applyWorkspaceSnapshot(localSnapshot, local.recoveryBackup);
        cloudSyncEnabled.current = false;
        setOfflineMessage('Cloud sync is unavailable. Your local notes remain available on this device.');
        setSyncState('offline');
        setLoading(false);
        return;
      }
    }

    applyWorkspaceSnapshot(snapshot, backup);
    setSyncState('synced');
    setLoading(false);

    window.setTimeout(() => {
      cloudSyncEnabled.current = true;
    }, 0);
  }

  async function enterSyncConflict() {
    cloudSyncEnabled.current = false;
    try {
      const latest = await loadCloudWorkspace();
      if (latest.workspace) {
        setPendingCloud({ workspace: latest.workspace, revision: latest.revision, updatedAt: latest.updatedAt });
        cloudRevisionRef.current = latest.revision;
        setCloudUpdatedAt(latest.updatedAt);
      }
    } catch {
      setOfflineMessage('Cloud sync is unavailable. Your local changes remain on this device.');
      setSyncState('offline');
      return;
    }
    setOfflineMessage('Cloud changes need your review before syncing can continue.');
    setSyncState('conflict');
    showToast('Choose which workspace copy to keep.', 'danger');
  }

  async function handleRetryCloudSync() {
    setSyncState('syncing');
    setOfflineMessage(null);
    try {
      const session = await getSession();
      if (!session.authenticated || !session.user) {
        setAuth({ status: 'signed-out', user: null });
        setLoading(false);
        return;
      }
      setAuth({ status: 'signed-in', user: session.user });
      await openSignedInWorkspace();
    } catch {
      setOfflineMessage('Cloud sync is still unavailable. Your local notes remain available on this device.');
      setSyncState('offline');
    }
  }

  async function handleKeepLocalChanges() {
    if (!pendingCloud || !settings) return;
    const snapshot: WorkspaceSnapshot = { folders, notes, settings };
    setSyncState('syncing');
    try {
      const result = await saveCloudWorkspace(snapshot, pendingCloud.revision);
      cloudRevisionRef.current = result.revision;
      setCloudUpdatedAt(result.updatedAt);
      setPendingCloud(null);
      setOfflineMessage(null);
      setSyncState('synced');
      cloudSyncEnabled.current = true;
      showToast('This device is now synced');
    } catch (error) {
      if (error instanceof CloudApiError && error.status === 409) {
        await enterSyncConflict();
        return;
      }
      setOfflineMessage('Your local changes are safe on this device. Retry sync when the connection is available.');
      setSyncState(error instanceof CloudApiError ? 'error' : 'offline');
    }
  }

  async function handleUseCloudCopy() {
    if (!pendingCloud) return;
    setSyncState('syncing');
    try {
      await replaceWorkspace(pendingCloud.workspace);
      applyWorkspaceSnapshot(pendingCloud.workspace);
      cloudRevisionRef.current = pendingCloud.revision;
      setCloudUpdatedAt(pendingCloud.updatedAt);
      setPendingCloud(null);
      setOfflineMessage(null);
      setSyncState('synced');
      cloudSyncEnabled.current = true;
      showToast('Cloud workspace loaded');
    } catch {
      setOfflineMessage('The cloud copy could not be loaded. Your local notes remain unchanged.');
      setSyncState('error');
    }
  }

  async function handleGoogleCredential(credential: string) {
    try {
      setLoading(true);
      setAuthError(null);
      const result = await loginWithGoogle(credential);
      setAuth({ status: 'signed-in', user: result.user });
      await openSignedInWorkspace();
      showToast('Workspace ready');
    } catch (error) {
      setLoading(false);
      setAuth({ status: 'signed-out', user: null });
      setAuthError(error instanceof Error ? error.message : 'Google sign-in failed. Please try again.');
    }
  }

  async function handleSignOut() {
    if (auth.status === 'signed-in' && syncState !== 'synced' && !window.confirm('Cloud sync is not complete. Sign out and clear this device\'s local copy anyway?')) return;
    cloudSyncEnabled.current = false;
    if (cloudSyncTimer.current !== null) window.clearTimeout(cloudSyncTimer.current);
    if (auth.status === 'signed-in') {
      await logoutFromCloud().catch(() => undefined);
    }
    await clearLocalWorkspace().catch(() => undefined);
    window.google?.accounts.id.disableAutoSelect();
    setAuth({ status: 'signed-out', user: null });
    setFolders([]);
    setNotes([]);
    setSettings(null);
    setSelectedNoteId(null);
    setSelectedFolderId('all');
    setCloudUpdatedAt(null);
    cloudRevisionRef.current = null;
    setPendingCloud(null);
    setOfflineMessage(null);
    setSyncState('idle');
    setLoading(false);
  }

  async function handleDeleteAccount() {
    if (!window.confirm('Delete your Notebook account, cloud data, and this device\'s local copy? This cannot be undone.')) return;

    try {
      await deleteCloudAccount();
      await clearLocalWorkspace().catch(() => undefined);
      window.google?.accounts.id.disableAutoSelect();
      setAuth({ status: 'signed-out', user: null });
      setFolders([]);
      setNotes([]);
      setSettings(null);
      setSelectedNoteId(null);
      setSelectedFolderId('all');
      setCloudUpdatedAt(null);
      setPendingCloud(null);
      cloudRevisionRef.current = null;
      setSyncState('idle');
      setLoading(false);
      showToast('Account and cloud data deleted');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Your account could not be deleted. Please try again.', 'danger');
    }
  }

  async function handleCreateFolder() {
    const folder = createFolder('New folder', folders.length);
    await saveFolder(folder);
    setFolders((current) => [...current, folder]);
    setSelectedFolderId(folder.id);
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
    await recordCommand('Create folder');
  }

  function startRenameFolder(folder: Folder) {
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
  }

  function cancelRenameFolder() {
    setEditingFolderId(null);
    setEditingFolderName('');
  }

  async function commitRenameFolder(folderId: EntityId) {
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return;

    const name = editingFolderName.trim() || folder.name;
    const updated = await saveFolder({ ...folder, name });
    setFolders((current) => current.map((item) => (item.id === folderId ? updated : item)));
    setEditingFolderId(null);
    setEditingFolderName('');
    showToast('Folder renamed');
  }

  function selectFolder(folderId: ViewId) {
    setSelectedFolderId(folderId);
    if (folderId === 'trash') setSelectedNoteId(null);
    setSidebarOpen(false);
  }

  async function handleCreateNote(folderId: EntityId | null = selectedFolderId === 'all' || selectedFolderId === 'favorites' || selectedFolderId === 'unfiled' || selectedFolderId === 'trash' ? activeFolders[0]?.id ?? null : selectedFolderId) {
    const note = createNote(folderId, { title: 'Untitled note', position: Date.now() });
    const saved = await saveNote(note);
    setNotes((current) => [saved, ...current]);
    setSelectedNoteId(saved.id);
    setSelectedFolderId(folderId ?? 'unfiled');
    await persistLastOpened(saved.id);
    await recordCommand('Create note');
  }

  async function handleSaveNote(note: Note) {
    const requestId = ++saveRequest.current;
    setSaveState('saving');
    setNotes((current) => current.map((item) => (item.id === note.id ? note : item)));
    try {
      const saved = await saveNote(note);
      setNotes((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      if (requestId === saveRequest.current) setSaveState('saved');
      await persistLastOpened(saved.id);
    } catch {
      if (requestId === saveRequest.current) setSaveState('error');
      showToast("Couldn't save this note. Please try again.", 'danger');
    }
  }

  async function persistLastOpened(noteId: EntityId) {
    if (!settings) return;
    const next = await saveSettings({ ...settings, lastOpenedNoteId: noteId });
    setSettings(next);
  }

  async function handleSelectNote(noteId: EntityId) {
    setSelectedNoteId(noteId);
    await persistLastOpened(noteId);
    setSidebarOpen(false);
  }

  async function handleDeleteNote(noteId: EntityId, noteOverride?: Note) {
    const note = noteOverride ?? notes.find((item) => item.id === noteId);
    if (!note) return;
    const trashed = await trashNote(note);
    setNotes((current) => current.map((item) => (item.id === trashed.id ? trashed : item)));
    if (selectedNoteId === noteId) {
      const next = activeNotes.find((item) => item.id !== noteId)?.id ?? null;
      setSelectedNoteId(next);
    }
    showToast('Note moved to Trash', 'info', {
      label: 'Undo',
      run: async () => {
        const restored = await restoreNote(trashed, folders);
        setNotes((current) => current.map((item) => (item.id === restored.id ? restored : item)));
      },
    });
  }

  async function handleDeleteFolder(folderId: EntityId) {
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return;
    const result = await trashFolder(folder, notes);
    setFolders((current) => current.map((item) => (item.id === result.folder.id ? result.folder : item)));
    setNotes((current) => current.map((item) => result.notes.find((updated) => updated.id === item.id) ?? item));
    setSelectedFolderId('all');
    showToast(`“${folder.name}” moved to Trash`, 'info', {
      label: 'Undo',
      run: async () => {
        const restored = await restoreFolder(result.folder, result.notes);
        setFolders((current) => current.map((item) => (item.id === restored.folder.id ? restored.folder : item)));
        setNotes((current) => current.map((item) => restored.notes.find((updated) => updated.id === item.id) ?? item));
      },
    });
  }

  async function handleRestoreNote(note: Note) {
    const restored = await restoreNote(note, folders);
    setNotes((current) => current.map((item) => (item.id === restored.id ? restored : item)));
    showToast(restored.folderId ? 'Note restored' : 'Note restored to Unfiled');
  }

  async function handleRestoreFolder(folder: Folder) {
    const result = await restoreFolder(folder, notes);
    setFolders((current) => current.map((item) => (item.id === result.folder.id ? result.folder : item)));
    setNotes((current) => current.map((item) => result.notes.find((updated) => updated.id === item.id) ?? item));
    showToast('Folder and its notes restored');
  }

  async function handleDeleteNoteForever(note: Note) {
    if (!window.confirm(`Delete “${note.title || 'Untitled note'}” forever? This cannot be undone.`)) return;
    await deleteNote(note.id);
    setNotes((current) => current.filter((item) => item.id !== note.id));
    showToast('Note permanently deleted', 'danger');
  }

  async function handleDeleteFolderForever(folder: Folder) {
    const folderNotes = notes.filter((note) => note.folderId === folder.id);
    if (!window.confirm(`Delete “${folder.name}” and its ${folderNotes.length} note${folderNotes.length === 1 ? '' : 's'} forever? This cannot be undone.`)) return;
    await deleteFolderPermanently(folder.id, notes);
    setFolders((current) => current.filter((item) => item.id !== folder.id));
    setNotes((current) => current.filter((note) => note.folderId !== folder.id));
    showToast('Folder permanently deleted', 'danger');
  }

  async function patchSelectedNote(patch: Partial<Note>, baseNote = selectedNote) {
    if (!baseNote) return;
    await handleSaveNote({ ...baseNote, ...patch });
  }

  function exportJson() {
    if (!settings) return;
    const backup = createBackup(folders, notes, settings);
    downloadText(`notebook-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
    showToast('Backup exported');
  }

  function exportRecoveryBackup() {
    if (!recoveryBackup) return;
    const backup = createBackup(recoveryBackup.folders, recoveryBackup.notes, recoveryBackup.settings);
    downloadText(`notebook-recovery-${new Date(recoveryBackup.createdAt).toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
    showToast('Recovery copy exported');
  }

  function exportMarkdown() {
    exportWorkspaceMarkdown(activeNotes);
    showToast('Markdown export created');
  }

  function exportCurrentNote() {
    if (!selectedNote) return;
    exportNoteMarkdown(selectedNote);
    showToast(`${safeFilename(selectedNote.title)}.md exported`);
  }

  function requestImport() {
    importInputRef.current?.click();
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    if (!window.confirm('Import this backup and replace the current workspace? Export the current workspace first if you need to keep it.')) return;

    try {
      const snapshot = parseBackup(await file.text());
      await replaceWorkspace(snapshot);
      setFolders(snapshot.folders);
      setNotes(snapshot.notes);
      setSettings(snapshot.settings);
      setRecoveryBackup(undefined);
      setSelectedNoteId(snapshot.settings.lastOpenedNoteId ?? snapshot.notes[0]?.id ?? null);
      setSelectedFolderId('all');
      showToast('Backup imported');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Import failed.', 'danger');
    }
  }

  const emptyState = selectedFolderId !== 'trash' && activeNotes.length === 0;
  const emptyVisibleNotes = selectedFolderId === 'trash'
    ? visibleNotes.length === 0 && trashedFolders.length === 0
    : !emptyState && visibleNotes.length === 0;

  if (auth.status === 'checking') {
    return <WorkspaceLoadingScreen />;
  }

  if (auth.status === 'signed-out') {
    return (
      <AuthScreen
        busy={loading}
        error={authError}
        onCredential={(credential) => void handleGoogleCredential(credential)}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-button mobile-only" type="button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>
          <Menu size={18} />
        </button>
        <div className="brand" aria-label="Notebook">
          <span className="brand-mark">N</span>
          <span>Notebook</span>
        </div>
        <label className="global-search">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes, tags, backlinks" />
        </label>
        <button className="command-button" type="button" aria-label="Open command palette" onClick={() => setPaletteOpen(true)}>
          <Command size={15} />
          <span>Command</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="cloud-account">
          {syncState === 'offline' || syncState === 'error' || syncState === 'conflict' ? (
            <button className={`sync-pill ${syncState}`} type="button" title="Retry workspace sync" onClick={() => void handleRetryCloudSync()}>
              <RefreshCw size={14} />
              {syncText(syncState)}
            </button>
          ) : (
            <span className={`sync-pill ${syncState}`} title={cloudUpdatedAt ? `Last synced ${timeAgo(cloudUpdatedAt)}` : undefined}>
              <Cloud size={14} />
              {syncText(syncState)}
            </span>
          )}
          {auth.user?.picture ? <img src={auth.user.picture} alt="" /> : <span className="account-initial">{auth.user?.email?.[0]?.toUpperCase() ?? 'U'}</span>}
          <span className="account-email">{auth.user?.email ?? 'Offline workspace'}</span>
          <button className="icon-button" type="button" aria-label={auth.status === 'offline' ? 'Clear local workspace' : 'Sign out'} title={auth.status === 'offline' ? 'Clear local workspace' : 'Sign out'} onClick={() => void handleSignOut()}>
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {offlineMessage && !pendingCloud && (
        <div className="workspace-alert" role="status">
          <CloudOff size={16} />
          <span>{offlineMessage}</span>
          <button className="secondary-button" type="button" onClick={() => void handleRetryCloudSync()}>
            <RefreshCw size={15} />
            Retry sync
          </button>
        </div>
      )}

      {pendingCloud && (
        <div className="workspace-alert conflict" role="alert">
          <Cloud size={16} />
          <span>{offlineMessage ?? 'Choose which workspace copy to keep.'}</span>
          <button className="secondary-button" type="button" onClick={() => void handleKeepLocalChanges()}>
            Keep this device
          </button>
          <button className="secondary-button" type="button" onClick={() => void handleUseCloudCopy()}>
            Use cloud copy
          </button>
        </div>
      )}

      <div className="workspace">
        {sidebarOpen && <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="Workspace navigation">
          <div className="mobile-sidebar-header">
            <strong>Notebook</strong>
            <button className="icon-button" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}>
              <X size={18} />
            </button>
          </div>
          <div className="sidebar-section">
            <button className={`nav-item ${selectedFolderId === 'all' ? 'active' : ''}`} onClick={() => selectFolder('all')}>
              <Archive size={16} />
              <span>All notes</span>
              <strong>{activeNotes.length}</strong>
            </button>
            <button className={`nav-item ${selectedFolderId === 'favorites' ? 'active' : ''}`} onClick={() => selectFolder('favorites')}>
              <Star size={16} />
              <span>Favorites</span>
              <strong>{activeNotes.filter((note) => note.favorite).length}</strong>
            </button>
            <button className={`nav-item ${selectedFolderId === 'unfiled' ? 'active' : ''}`} onClick={() => selectFolder('unfiled')}>
              <FileDown size={16} />
              <span>Unfiled</span>
              <strong>{activeNotes.filter((note) => note.folderId === null).length}</strong>
            </button>
            <button className={`nav-item ${selectedFolderId === 'trash' ? 'active' : ''}`} onClick={() => selectFolder('trash')}>
              <Trash2 size={16} />
              <span>Trash</span>
              <strong>{trashedNotes.length + trashedFolders.length}</strong>
            </button>
          </div>

          <div className="sidebar-heading">
            <span>Folders</span>
            <button className="icon-button" type="button" aria-label="Create folder" onClick={() => void handleCreateFolder()}>
              <FolderPlus size={15} />
            </button>
          </div>
          <div className="sidebar-section">
            {activeFolders.map((folder) => (
              <div className="folder-row" key={folder.id}>
                {editingFolderId === folder.id ? (
                  <form className="folder-rename" onSubmit={(event) => {
                    event.preventDefault();
                    void commitRenameFolder(folder.id);
                  }}>
                    <span className={`folder-dot color-${folder.color}`} />
                    <input
                      autoFocus
                      value={editingFolderName}
                      maxLength={500}
                      aria-label="Folder name"
                      onBlur={() => void commitRenameFolder(folder.id)}
                      onChange={(event) => setEditingFolderName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          cancelRenameFolder();
                        }
                      }}
                    />
                  </form>
                ) : (
                  <>
                    <button className={`nav-item color-${folder.color} ${selectedFolderId === folder.id ? 'active' : ''}`} onClick={() => selectFolder(folder.id)}>
                      <span className="folder-dot" />
                      <span>{folder.name}</span>
                      <strong>{activeNotes.filter((note) => note.folderId === folder.id).length}</strong>
                    </button>
                    <button className="icon-button quiet" type="button" aria-label={`Rename ${folder.name}`} onClick={() => startRenameFolder(folder)}>
                      <Pencil size={14} />
                    </button>
                    <button className="icon-button quiet folder-delete" type="button" aria-label={`Delete ${folder.name}`} onClick={() => void handleDeleteFolder(folder.id)}>
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          {tags.length > 0 && (
            <>
              <div className="sidebar-heading">
                <span>Tags</span>
                <Tags size={15} />
              </div>
              <div className="tag-cloud">
                {tags.map((tag) => <button key={tag} onClick={() => setQuery(`#${tag}`)}>#{tag}</button>)}
              </div>
            </>
          )}

          <details className="sidebar-actions">
            <summary>Backup</summary>
            <div>
              <button type="button" onClick={exportJson}>
                <Download size={16} />
                Export JSON backup
              </button>
              <button type="button" onClick={exportMarkdown}>
                <FileDown size={16} />
                Export Markdown
              </button>
              <button type="button" onClick={requestImport}>
                <Import size={16} />
                Import JSON backup
              </button>
              {recoveryBackup && (
                <button type="button" onClick={exportRecoveryBackup}>
                  <ShieldCheck size={16} />
                  Export recovery copy
                </button>
              )}
            </div>
          {recoveryBackup && <p className="backup-note">A recovery copy from a previous workspace update is available.</p>}
          </details>

          <details className="sidebar-actions">
            <summary>Account</summary>
            <div>
              <button type="button" onClick={() => void handleSignOut()}>
                <LogOut size={16} />
                {auth.status === 'offline' ? 'Clear local workspace' : 'Sign out'}
              </button>
              {auth.status === 'signed-in' && (
                <button type="button" onClick={() => void handleDeleteAccount()}>
                  <UserRoundX size={16} />
                  Delete account and data
                </button>
              )}
            </div>
          </details>
        </aside>

        <main className="note-list-pane" aria-label="Notes">
          <div className="list-header">
            <div>
              <h1>{query && selectedFolderId !== 'trash' ? 'Search results' : selectedFolderId === 'all' ? 'All notes' : selectedFolderId === 'favorites' ? 'Favorites' : selectedFolderId === 'unfiled' ? 'Unfiled' : selectedFolderId === 'trash' ? 'Trash' : folderName(folders, selectedFolderId)}</h1>
              <p>{selectedFolderId === 'trash' ? `${countLabel(visibleNotes.length, 'note')}, ${countLabel(trashedFolders.length, 'folder')}` : countLabel(visibleNotes.length, 'note')}</p>
            </div>
            {selectedFolderId !== 'trash' && (
              <button className="primary-button" type="button" onClick={() => void handleCreateNote()}>
                <Plus size={16} />
                New note
              </button>
            )}
          </div>

          {loading ? (
            <div className="note-list skeleton-list" aria-label="Loading notes">
              <span />
              <span />
              <span />
            </div>
          ) : selectedFolderId === 'trash' && visibleNotes.length === 0 && trashedFolders.length === 0 ? (
            <div className="empty-panel compact">
              <ArchiveRestore size={30} />
              <h2>Trash is empty</h2>
              <p>Items remain here until you restore them or permanently delete them.</p>
            </div>
          ) : emptyState ? (
            <div className="empty-panel">
              <FilePlus2 size={34} />
              <h2>Start a new note</h2>
              <p>Capture an idea, add context, and keep it organized in a folder.</p>
              <button className="primary-button" type="button" onClick={() => void handleCreateNote(activeFolders[0]?.id ?? null)}>
                <Plus size={16} />
                Create note
              </button>
            </div>
          ) : emptyVisibleNotes ? (
            <div className="empty-panel compact">
              <Search size={30} />
              <h2>{query ? 'No matching notes' : 'No notes in this view'}</h2>
              <p>{query ? 'Try a different title, phrase, backlink, or tag.' : 'Create a note here or browse All notes.'}</p>
              <button className="primary-button" type="button" onClick={() => void handleCreateNote()}>
                <Plus size={16} />
                New note
              </button>
            </div>
          ) : (
            <div className="note-list">
              {selectedFolderId === 'trash' && trashedFolders.length > 0 && (
                <section className="trash-group" aria-labelledby="trashed-folders-heading">
                  <h2 id="trashed-folders-heading">Folders</h2>
                  {trashedFolders.map((folder) => (
                    <div className="trash-row" key={folder.id}>
                      <span className={`folder-dot color-${folder.color}`} />
                      <span className="trash-row-main">
                        <strong>{folder.name}</strong>
                        <span>{countLabel(trashedNotes.filter((note) => note.folderId === folder.id).length, 'note')}</span>
                      </span>
                      <button className="secondary-button" type="button" onClick={() => void handleRestoreFolder(folder)}>
                        <ArchiveRestore size={15} />
                        Restore
                      </button>
                      <button className="icon-button danger" type="button" aria-label={`Delete ${folder.name} forever`} title="Delete forever" onClick={() => void handleDeleteFolderForever(folder)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </section>
              )}
              {visibleNotes.map((note) => (
                selectedFolderId === 'trash' ? (
                  <div className="note-card trash-card" key={note.id}>
                    <span className={`note-color color-${note.color}`} />
                    <span className="note-card-main">
                      <span className="note-card-title">{note.title || 'Untitled note'}</span>
                      <span className="note-card-text">{note.text || 'No text yet'}</span>
                      <span className="note-card-meta">{folderName(folders, note.folderId)} · Deleted {timeAgo(note.trashedAt ?? note.updatedAt)}</span>
                    </span>
                    <span className="trash-card-actions">
                      <button className="secondary-button" type="button" onClick={() => void handleRestoreNote(note)}>
                        <ArchiveRestore size={15} />
                        Restore
                      </button>
                      <button className="icon-button danger" type="button" aria-label={`Delete ${note.title || 'Untitled note'} forever`} title="Delete forever" onClick={() => void handleDeleteNoteForever(note)}>
                        <Trash2 size={16} />
                      </button>
                    </span>
                  </div>
                ) : (
                  <button className={`note-card ${note.id === selectedNoteId ? 'active' : ''}`} key={note.id} onClick={() => void handleSelectNote(note.id)}>
                    <span className={`note-color color-${note.color}`} />
                    <span className="note-card-main">
                      <span className="note-card-title">
                        {note.pinned && <Pin size={13} />}
                        {note.title || 'Untitled note'}
                      </span>
                      <span className="note-card-text">{note.text || 'No text yet'}</span>
                      <span className="note-card-meta">
                        {folderName(folders, note.folderId)} · {timeAgo(note.updatedAt)}
                      </span>
                    </span>
                  </button>
                )
              ))}
            </div>
          )}
        </main>

        <section className={`editor-pane-shell ${inspectorOpen ? '' : 'wide'}`}>
          {loading ? (
            <div className="empty-editor skeleton-editor" aria-label="Loading editor">
              <span />
              <span />
              <span />
            </div>
          ) : selectedNote ? (
            <EditorPane
              folders={activeFolders}
              note={selectedNote}
              saveState={saveState}
              onChange={(note) => void handleSaveNote(note)}
              onDelete={(note) => void handleDeleteNote(note.id, note)}
              onExport={exportCurrentNote}
              onPatch={(patch, baseNote) => void patchSelectedNote(patch, baseNote)}
              detailsOpen={inspectorOpen}
              onToggleDetails={() => setInspectorOpen((value) => !value)}
            />
          ) : (
            <div className="empty-editor">
              <h2>No note selected</h2>
              <p>Select a note from the list or create a new one to begin writing.</p>
              <button className="primary-button" type="button" onClick={() => void handleCreateNote()}>
                <Plus size={16} />
                Create note
              </button>
            </div>
          )}
        </section>

        {inspectorOpen && selectedNote && (
          <Inspector
            folders={activeFolders}
            notes={activeNotes}
            note={selectedNote}
            onOpenNote={(noteId) => void handleSelectNote(noteId)}
            onPatch={(patch) => void patchSelectedNote(patch)}
          />
        )}

      </div>

      <CommandPalette
        open={paletteOpen}
        folders={folders}
        notes={activeNotes}
        onClose={() => setPaletteOpen(false)}
        onCreateNote={() => void handleCreateNote()}
        onCreateFolder={() => void handleCreateFolder()}
        onSelectNote={(noteId) => void handleSelectNote(noteId)}
        onExportJson={exportJson}
        onExportMarkdown={exportMarkdown}
        onImport={requestImport}
      />

      <input ref={importInputRef} type="file" accept="application/json" hidden onChange={(event) => void handleImportFile(event.target.files?.[0])} />

      <div className="sr-status" role="status" aria-live="polite">
        {saveState === 'saving' ? 'Saving note locally' : saveState === 'saved' ? 'Note saved locally' : saveState === 'error' ? 'Note could not be saved' : syncState === 'syncing' ? 'Syncing workspace' : ''}
      </div>

      {toast && (
        <div className={`toast ${toast.tone}`} role="status">
          {toast.message}
          {toast.action && (
            <button type="button" className="toast-action" onClick={() => void toast.action?.run().finally(() => setToast(null))}>
              <RotateCcw size={14} />
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

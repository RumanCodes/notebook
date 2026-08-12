import type { ColorName, Folder, LegacyV1Backup, Note, NotebookBackupV2, Settings, WorkspaceSnapshot } from '../types';
import { legacyHtmlToDoc, jsonToText } from './content';

const colors = new Set<ColorName>(['slate', 'teal', 'blue', 'violet', 'amber', 'rose', 'green']);
const legacyColorMap: Record<string, ColorName> = {
  default: 'slate',
  blue: 'blue',
  green: 'green',
  yellow: 'amber',
  orange: 'amber',
  red: 'rose',
  purple: 'violet',
};

export function parseBackup(raw: string): WorkspaceSnapshot {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  if (isV2Backup(data)) {
    return {
      folders: data.folders.map(normalizeFolder),
      notes: data.notes.map(normalizeNote),
      settings: normalizeSettings(data.settings),
    };
  }

  if (isLegacyV1Backup(data)) {
    return migrateLegacyV1(data);
  }

  throw new Error('This file does not look like a Notebook backup.');
}

export function migrateLegacyV1(data: LegacyV1Backup): WorkspaceSnapshot {
  const now = Date.now();
  const folders = data.folders.map((folder, index) =>
    normalizeFolder({
      id: folder.id,
      name: folder.name,
      color: legacyColorMap[String(folder.color ?? 'default')] ?? 'slate',
      position: Number(folder.position ?? index),
      createdAt: Number(folder.createdAt ?? now),
      updatedAt: Number(folder.updatedAt ?? now),
    }),
  );

  const notes = data.notes.map((note, index) => {
    const content = legacyHtmlToDoc(note.content ?? '');
    return normalizeNote({
      id: note.id,
      folderId: note.folderId,
      title: note.title ?? '',
      content,
      text: jsonToText(content),
      tags: [],
      favorite: Boolean(note.favorite),
      pinned: false,
      status: 'active',
      color: legacyColorMap[String(note.color ?? 'default')] ?? 'slate',
      position: Number(note.position ?? index),
      createdAt: Number(note.createdAt ?? now),
      updatedAt: Number(note.updatedAt ?? now),
    });
  });

  return {
    folders,
    notes,
    settings: {
      id: 'settings',
      schemaVersion: 2,
      lastOpenedNoteId: notes[0]?.id ?? null,
      updatedAt: now,
    },
  };
}

function isV2Backup(value: unknown): value is NotebookBackupV2 {
  const backup = value as NotebookBackupV2;
  return backup?.appName === 'Notebook' && (backup.schemaVersion === 2 || backup.schemaVersion === 3) && Array.isArray(backup.folders) && Array.isArray(backup.notes);
}

function isLegacyV1Backup(value: unknown): value is LegacyV1Backup {
  const backup = value as LegacyV1Backup;
  return Array.isArray(backup?.folders) && Array.isArray(backup?.notes);
}

function normalizeFolder(folder: Folder): Folder {
  return {
    ...folder,
    name: String(folder.name || 'Untitled folder'),
    color: colors.has(folder.color) ? folder.color : 'slate',
    position: Number.isFinite(folder.position) ? folder.position : 0,
    createdAt: Number(folder.createdAt || Date.now()),
    updatedAt: Number(folder.updatedAt || Date.now()),
  };
}

function normalizeNote(note: Note): Note {
  const content = note.content ?? { type: 'doc', content: [{ type: 'paragraph' }] };
  return {
    ...note,
    title: String(note.title ?? ''),
    content,
    text: String(note.text || jsonToText(content)),
    tags: Array.isArray(note.tags) ? note.tags.map(String) : [],
    favorite: Boolean(note.favorite),
    pinned: Boolean(note.pinned),
    status: note.status === 'archived' || note.status === 'draft' || note.status === 'trashed' ? note.status : 'active',
    color: colors.has(note.color) ? note.color : 'slate',
    position: Number.isFinite(note.position) ? note.position : 0,
    createdAt: Number(note.createdAt || Date.now()),
    updatedAt: Number(note.updatedAt || Date.now()),
  };
}

function normalizeSettings(settings?: Settings): Settings {
  return {
    id: 'settings',
    schemaVersion: 2,
    lastOpenedNoteId: settings?.lastOpenedNoteId ?? null,
    updatedAt: Number(settings?.updatedAt || Date.now()),
  };
}

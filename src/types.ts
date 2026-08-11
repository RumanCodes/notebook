export type EntityId = string;

export type ColorName =
  | 'slate'
  | 'teal'
  | 'blue'
  | 'violet'
  | 'amber'
  | 'rose'
  | 'green';

export type NoteStatus = 'draft' | 'active' | 'archived';

export interface Folder {
  id: EntityId;
  name: string;
  color: ColorName;
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: EntityId;
  folderId: EntityId | null;
  title: string;
  content: unknown;
  text: string;
  tags: string[];
  favorite: boolean;
  pinned: boolean;
  status: NoteStatus;
  color: ColorName;
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  id: 'settings';
  schemaVersion: number;
  lastOpenedNoteId: EntityId | null;
  updatedAt: number;
}

export interface CommandHistory {
  id: EntityId;
  command: string;
  createdAt: number;
}

export interface AttachmentMeta {
  id: EntityId;
  noteId: EntityId;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
}

export interface LinkRecord {
  id: EntityId;
  sourceNoteId: EntityId;
  targetNoteId: EntityId | null;
  targetTitle: string;
  kind: 'wiki' | 'url';
  createdAt: number;
}

export interface WorkspaceSnapshot {
  folders: Folder[];
  notes: Note[];
  settings: Settings;
}

export interface LegacyV1Backup {
  appName?: string;
  version?: number;
  exportedAt?: string;
  folders: Array<Partial<Folder> & { id: string; name: string }>;
  notes: Array<{
    id: string;
    folderId: string;
    title?: string;
    content?: string;
    color?: string;
    favorite?: boolean;
    position?: number;
    createdAt?: number;
    updatedAt?: number;
  }>;
}

export interface NotebookBackupV2 {
  appName: 'Notebook';
  schemaVersion: 2;
  exportedAt: string;
  folders: Folder[];
  notes: Note[];
  settings: Settings;
}

export interface SearchHit {
  note: Note;
  score: number;
  reasons: string[];
}

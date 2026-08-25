import type { Folder, Note, Settings, WorkspaceSnapshot } from '../types';

export interface WorkspaceMergeConflict {
  id: string;
  kind: 'folder' | 'note';
  label: string;
}

export interface WorkspaceMergeResult {
  workspace: WorkspaceSnapshot | null;
  conflicts: WorkspaceMergeConflict[];
}

function withoutUpdatedAt<T extends { updatedAt: number }>(value: T): Omit<T, 'updatedAt'> {
  const { updatedAt: _updatedAt, ...rest } = value;
  return rest;
}

function sameEntity(left: Folder | Note, right: Folder | Note): boolean {
  return JSON.stringify(withoutUpdatedAt(left)) === JSON.stringify(withoutUpdatedAt(right));
}

function mergeEntities<T extends Folder | Note>(
  local: T[],
  cloud: T[],
  kind: WorkspaceMergeConflict['kind'],
  labelFor: (item: T) => string,
): { values: T[]; conflicts: WorkspaceMergeConflict[] } {
  const values = [...local];
  const conflicts: WorkspaceMergeConflict[] = [];

  for (const cloudItem of cloud) {
    const localItem = local.find((item) => item.id === cloudItem.id);
    if (!localItem) {
      values.push(cloudItem);
      continue;
    }

    if (!sameEntity(localItem, cloudItem)) {
      conflicts.push({ id: cloudItem.id, kind, label: labelFor(cloudItem) });
      continue;
    }

    const newer = cloudItem.updatedAt > localItem.updatedAt ? cloudItem : localItem;
    const index = values.findIndex((item) => item.id === newer.id);
    values[index] = newer;
  }

  return { values, conflicts };
}

export function mergeWorkspaces(local: WorkspaceSnapshot, cloud: WorkspaceSnapshot): WorkspaceMergeResult {
  const folders = mergeEntities(local.folders, cloud.folders, 'folder', (folder) => folder.name);
  const notes = mergeEntities(local.notes, cloud.notes, 'note', (note) => note.title || 'Untitled note');
  const settings: Settings = local.settings.updatedAt >= cloud.settings.updatedAt ? local.settings : cloud.settings;

  return {
    workspace: folders.conflicts.length || notes.conflicts.length
      ? null
      : { folders: folders.values, notes: notes.values, settings },
    conflicts: [...folders.conflicts, ...notes.conflicts],
  };
}

export function sameWorkspace(left: WorkspaceSnapshot, right: WorkspaceSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

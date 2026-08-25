import { describe, expect, it } from 'vitest';
import { mergeWorkspaces } from '../src/lib/migration';
import type { WorkspaceSnapshot } from '../src/types';

function workspace(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    folders: [{ id: 'folder-1', name: 'Inbox', color: 'teal', position: 0, createdAt: 1, updatedAt: 1 }],
    notes: [{
      id: 'note-1',
      folderId: 'folder-1',
      title: 'Local note',
      content: { type: 'doc' },
      text: 'Local text',
      tags: [],
      favorite: false,
      pinned: false,
      status: 'active',
      color: 'slate',
      position: 1,
      createdAt: 1,
      updatedAt: 1,
    }],
    settings: { id: 'settings', schemaVersion: 3, lastOpenedNoteId: 'note-1', updatedAt: 1 },
    ...overrides,
  };
}

describe('workspace migration merge', () => {
  it('unions independently created folders and notes', () => {
    const local = workspace({
      notes: [...workspace().notes, { ...workspace().notes[0], id: 'local-only', title: 'Local only' }],
    });
    const cloud = workspace({
      notes: [...workspace().notes, { ...workspace().notes[0], id: 'cloud-only', title: 'Cloud only' }],
    });

    const result = mergeWorkspaces(local, cloud);

    expect(result.conflicts).toEqual([]);
    expect(result.workspace?.notes.map((note) => note.id)).toEqual(['note-1', 'local-only', 'cloud-only']);
  });

  it('requires a choice when the same note was edited in both places', () => {
    const local = workspace();
    const cloud = workspace({ notes: [{ ...local.notes[0], title: 'Cloud edit', updatedAt: 2 }] });

    const result = mergeWorkspaces(local, cloud);

    expect(result.workspace).toBeNull();
    expect(result.conflicts).toEqual([{ id: 'note-1', kind: 'note', label: 'Cloud edit' }]);
  });

  it('keeps the newer copy when only updatedAt differs', () => {
    const local = workspace();
    const cloud = workspace({ notes: [{ ...local.notes[0], updatedAt: 4 }] });

    const result = mergeWorkspaces(local, cloud);

    expect(result.conflicts).toEqual([]);
    expect(result.workspace?.notes[0].updatedAt).toBe(4);
  });
});

import { describe, expect, it } from 'vitest';
import { parseBackup } from '../src/lib/import';

describe('backup import', () => {
  it('migrates the existing v1 backup shape', () => {
    const snapshot = parseBackup(
      JSON.stringify({
        appName: 'Notebook',
        version: 1,
        folders: [
          {
            id: 'folder-1',
            name: 'Work',
            color: 'purple',
            position: 0,
            createdAt: 100,
            updatedAt: 200,
          },
        ],
        notes: [
          {
            id: 'note-1',
            folderId: 'folder-1',
            title: 'Launch',
            content: '<h1>Plan</h1><p>Ship [[Brief]]</p>',
            color: 'yellow',
            favorite: true,
            position: 0,
            createdAt: 300,
            updatedAt: 400,
          },
        ],
      }),
    );

    expect(snapshot.folders[0]).toMatchObject({ id: 'folder-1', color: 'violet' });
    expect(snapshot.notes[0]).toMatchObject({
      id: 'note-1',
      folderId: 'folder-1',
      title: 'Launch',
      color: 'amber',
      favorite: true,
      pinned: false,
      status: 'active',
    });
    expect(snapshot.notes[0].text).toContain('Ship [[Brief]]');
    expect(snapshot.settings.schemaVersion).toBe(2);
  });

  it('rejects unknown files', () => {
    expect(() => parseBackup('{"hello":true}')).toThrow(/Notebook backup/);
  });
});

import { describe, expect, it } from 'vitest';
import { noteToMarkdown } from '../src/lib/content';
import type { Note } from '../src/types';

describe('markdown export', () => {
  it('serializes headings, tasks, and frontmatter', () => {
    const note: Note = {
      id: 'note-1',
      folderId: 'folder-1',
      title: 'Launch note',
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Plan' }],
          },
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: true },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Export backup' }] }],
              },
            ],
          },
        ],
      },
      text: 'Plan Export backup',
      tags: ['release'],
      favorite: true,
      pinned: false,
      status: 'active',
      color: 'teal',
      position: 0,
      createdAt: 1000,
      updatedAt: 2000,
    };

    const markdown = noteToMarkdown(note);
    expect(markdown).toContain('id: note-1');
    expect(markdown).toContain('# Launch note');
    expect(markdown).toContain('## Plan');
    expect(markdown).toContain('- [x] Export backup');
  });
});

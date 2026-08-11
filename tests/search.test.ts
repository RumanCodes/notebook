import { describe, expect, it } from 'vitest';
import { extractWikiLinks } from '../src/lib/content';
import { backlinksFor, rankNotes, relatedNotes } from '../src/lib/search';
import type { Note } from '../src/types';

const baseNote: Note = {
  id: 'n',
  folderId: 'f',
  title: '',
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  text: '',
  tags: [],
  favorite: false,
  pinned: false,
  status: 'active',
  color: 'slate',
  position: 0,
  createdAt: 1,
  updatedAt: 1,
};

function note(overrides: Partial<Note>): Note {
  return { ...baseNote, ...overrides };
}

describe('search and backlinks', () => {
  it('prioritizes title and tag matches above body matches', () => {
    const now = 10_000;
    const hits = rankNotes(
      [
        note({ id: 'body', title: 'Daily log', text: 'architecture decision', updatedAt: now }),
        note({ id: 'tag', title: 'Planning', text: '', tags: ['architecture'], updatedAt: now - 1 }),
        note({ id: 'title', title: 'Architecture map', text: '', updatedAt: now - 2 }),
      ],
      'architecture',
      now,
    );

    expect(hits.map((hit) => hit.note.id)).toEqual(['title', 'tag', 'body']);
  });

  it('supports hash-prefixed tag queries from tag chips', () => {
    const hits = rankNotes(
      [
        note({ id: 'tagged', title: 'Tagged', tags: ['welcome'], updatedAt: 10 }),
        note({ id: 'plain', title: 'Plain', text: 'welcome text', updatedAt: 10 }),
      ],
      '#welcome',
      10,
    );

    expect(hits[0].note.id).toBe('tagged');
    expect(hits[0].reasons).toContain('tag');
  });

  it('extracts wiki links and calculates backlink surfaces', () => {
    const target = note({ id: 'target', title: 'Brief' });
    const source = note({ id: 'source', title: 'Launch', text: 'Use [[Brief]] before writing.' });
    const sibling = note({ id: 'sibling', title: 'Research', text: 'Mentions [[Launch]]', tags: ['planning'] });

    expect(extractWikiLinks(source.text)).toEqual(['Brief']);
    expect(backlinksFor(target, [target, source, sibling]).map((item) => item.id)).toEqual(['source']);
    expect(relatedNotes(source, [target, source, sibling]).map((item) => item.id)).toContain('target');
  });
});

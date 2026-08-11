import type { Note, SearchHit } from '../types';
import { extractWikiLinks } from './content';

export function rankNotes(notes: Note[], query: string, now = Date.now()): SearchHit[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const terms = normalized
    .split(/\s+/)
    .map((term) => term.replace(/^#/, ''))
    .filter(Boolean);

  return notes
    .map((note) => {
      const title = note.title.toLowerCase();
      const text = note.text.toLowerCase();
      const tags = note.tags.map((tag) => tag.toLowerCase());
      const links = extractWikiLinks(note.text).map((link) => link.toLowerCase());
      let score = 0;
      const reasons: string[] = [];

      for (const term of terms) {
        if (title === normalized) {
          score += 100;
          reasons.push('exact title');
        }
        if (title.includes(term)) {
          score += 45;
          reasons.push('title');
        }
        if (tags.some((tag) => tag.includes(term))) {
          score += 30;
          reasons.push('tag');
        }
        if (links.some((link) => link.includes(term))) {
          score += 18;
          reasons.push('backlink');
        }
        if (text.includes(term)) {
          score += 10;
          reasons.push('body');
        }
      }

      const ageDays = Math.max(0, (now - note.updatedAt) / 86_400_000);
      score += Math.max(0, 16 - ageDays);
      if (note.pinned) score += 8;
      if (note.favorite) score += 5;

      return { note, score, reasons: [...new Set(reasons)] };
    })
    .filter((hit) => hit.score > 0 && hit.reasons.length > 0)
    .sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt);
}

export function relatedNotes(current: Note, notes: Note[]): Note[] {
  const currentTags = new Set(current.tags.map((tag) => tag.toLowerCase()));
  const currentLinks = new Set(extractWikiLinks(current.text).map((link) => link.toLowerCase()));
  const currentTitle = current.title.toLowerCase();

  return notes
    .filter((note) => note.id !== current.id)
    .map((note) => {
      let score = 0;
      note.tags.forEach((tag) => {
        if (currentTags.has(tag.toLowerCase())) score += 2;
      });
      if (currentLinks.has(note.title.toLowerCase())) score += 4;
      if (extractWikiLinks(note.text).some((link) => link.toLowerCase() === currentTitle)) score += 6;

      return { note, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt)
    .map((item) => item.note);
}

export function backlinksFor(note: Note, notes: Note[]): Note[] {
  const title = note.title.trim().toLowerCase();
  if (!title) return [];

  return notes
    .filter((candidate) => candidate.id !== note.id)
    .filter((candidate) => extractWikiLinks(candidate.text).some((link) => link.toLowerCase() === title))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

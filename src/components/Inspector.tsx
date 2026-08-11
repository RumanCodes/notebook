import { GitBranch, Link2, Tag, Workflow } from 'lucide-react';
import { backlinksFor, relatedNotes } from '../lib/search';
import type { EntityId, Folder, Note } from '../types';

interface InspectorProps {
  folders: Folder[];
  notes: Note[];
  note: Note;
  onOpenNote: (noteId: EntityId) => void;
  onPatch: (patch: Partial<Note>) => void;
}

export function Inspector({ folders, notes, note, onOpenNote, onPatch }: InspectorProps) {
  const backlinks = backlinksFor(note, notes);
  const related = relatedNotes(note, notes).slice(0, 6);

  function updateTags(value: string) {
    onPatch({
      tags: value
        .split(',')
        .map((tag) => tag.trim().replace(/^#/, ''))
        .filter(Boolean),
    });
  }

  return (
    <aside className="inspector" aria-label="Note inspector">
      <section>
        <h2>
          <Tag size={15} />
          Metadata
        </h2>
        <label className="field">
          Tags
          <input value={note.tags.join(', ')} onChange={(event) => updateTags(event.target.value)} placeholder="research, ideas" />
        </label>
        <label className="field">
          Color
          <select value={note.color} onChange={(event) => onPatch({ color: event.target.value as Note['color'] })}>
            <option value="slate">Slate</option>
            <option value="teal">Teal</option>
            <option value="blue">Blue</option>
            <option value="violet">Violet</option>
            <option value="amber">Amber</option>
            <option value="rose">Rose</option>
            <option value="green">Green</option>
          </select>
        </label>
        <div className="meta-grid">
          <span>Created</span>
          <strong>{new Date(note.createdAt).toLocaleDateString()}</strong>
          <span>Updated</span>
          <strong>{new Date(note.updatedAt).toLocaleDateString()}</strong>
          <span>Folder</span>
          <strong>{folders.find((folder) => folder.id === note.folderId)?.name ?? 'Unfiled'}</strong>
        </div>
      </section>

      <section>
        <h2>
          <Link2 size={15} />
          Backlinks
        </h2>
        {backlinks.length ? (
          <div className="reference-list">
            {backlinks.map((item) => (
              <button key={item.id} onClick={() => onOpenNote(item.id)}>
                <strong>{item.title || 'Untitled note'}</strong>
                <span>{item.text || 'Linked mention'}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">No notes link here yet. Use [[{note.title || 'this title'}]] in another note.</p>
        )}
      </section>

      <section>
        <h2>
          <Workflow size={15} />
          Related
        </h2>
        {related.length ? (
          <div className="reference-list">
            {related.map((item) => (
              <button key={item.id} onClick={() => onOpenNote(item.id)}>
                <strong>{item.title || 'Untitled note'}</strong>
                <span>{item.tags.map((tag) => `#${tag}`).join(' ') || item.text}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">Shared tags and wiki links will appear here.</p>
        )}
      </section>

      <section>
        <h2>
          <GitBranch size={15} />
          Graph
        </h2>
        <div className="mini-graph" aria-label="Local note graph">
          <span className="graph-node current">{note.title.slice(0, 2) || 'N'}</span>
          {backlinks.slice(0, 3).map((item) => (
            <button className="graph-node" key={item.id} onClick={() => onOpenNote(item.id)} title={item.title || 'Untitled note'}>
              {(item.title || 'N').slice(0, 2)}
            </button>
          ))}
          {related.slice(0, 3).map((item) => (
            <button className="graph-node soft" key={item.id} onClick={() => onOpenNote(item.id)} title={item.title || 'Untitled note'}>
              {(item.title || 'N').slice(0, 2)}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

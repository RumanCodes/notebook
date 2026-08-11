import { Download, FileDown, FilePlus2, FolderPlus, Import, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { rankNotes } from '../lib/search';
import type { EntityId, Folder, Note } from '../types';

interface CommandPaletteProps {
  open: boolean;
  folders: Folder[];
  notes: Note[];
  onClose: () => void;
  onCreateNote: () => void;
  onCreateFolder: () => void;
  onSelectNote: (noteId: EntityId) => void;
  onExportJson: () => void;
  onExportMarkdown: () => void;
  onImport: () => void;
}

export function CommandPalette({
  open,
  notes,
  onClose,
  onCreateNote,
  onCreateFolder,
  onSelectNote,
  onExportJson,
  onExportMarkdown,
  onImport,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  const noteHits = useMemo(() => rankNotes(notes, query).slice(0, 8), [notes, query]);

  if (!open) return null;

  const commands = [
    { label: 'Create note', icon: <FilePlus2 size={17} />, action: onCreateNote },
    { label: 'Create folder', icon: <FolderPlus size={17} />, action: onCreateFolder },
    { label: 'Export JSON backup', icon: <Download size={17} />, action: onExportJson },
    { label: 'Export Markdown bundle', icon: <FileDown size={17} />, action: onExportMarkdown },
    { label: 'Import V1 or V2 backup', icon: <Import size={17} />, action: onImport },
  ].filter((command) => command.label.toLowerCase().includes(query.toLowerCase()) || !query.trim());

  function run(action: () => void) {
    action();
    onClose();
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <label className="palette-search">
          <Search size={18} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type a command or note title" />
        </label>

        <div className="palette-section">
          <h2>Commands</h2>
          {commands.map((command) => (
            <button key={command.label} onClick={() => run(command.action)}>
              {command.icon}
              <span>{command.label}</span>
            </button>
          ))}
        </div>

        {query.trim() && (
          <div className="palette-section">
            <h2>Notes</h2>
            {noteHits.length ? (
              noteHits.map((hit) => (
                <button key={hit.note.id} onClick={() => run(() => onSelectNote(hit.note.id))}>
                  <FileDown size={17} />
                  <span>{hit.note.title || 'Untitled note'}</span>
                  <small>{hit.reasons.join(', ')}</small>
                </button>
              ))
            ) : (
              <p>No notes matched.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

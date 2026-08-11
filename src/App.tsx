import {
  Archive,
  Command,
  Download,
  FileDown,
  FilePlus2,
  FolderPlus,
  Import,
  Menu,
  Pencil,
  Pin,
  Plus,
  Search,
  Star,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { EditorPane } from './components/EditorPane';
import { Inspector } from './components/Inspector';
import { createBackup, downloadText, exportNoteMarkdown, exportWorkspaceMarkdown, safeFilename } from './lib/export';
import { parseBackup } from './lib/import';
import {
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  loadWorkspace,
  recordCommand,
  replaceWorkspace,
  saveFolder,
  saveNote,
  saveSettings,
} from './lib/repository';
import { rankNotes } from './lib/search';
import type { EntityId, Folder, Note, Settings } from './types';

type ToastState = { id: string; tone: 'info' | 'danger'; message: string };

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 20_000) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function folderName(folders: Folder[], id: EntityId | null): string {
  return folders.find((folder) => folder.id === id)?.name ?? 'Unfiled';
}

function uniqueTags(notes: Note[]): string[] {
  return [...new Set(notes.flatMap((note) => note.tags))].sort((a, b) => a.localeCompare(b));
}

export function App() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<EntityId | 'all' | 'favorites' | 'unfiled'>('all');
  const [selectedNoteId, setSelectedNoteId] = useState<EntityId | null>(null);
  const [query, setQuery] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<EntityId | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [loading, setLoading] = useState(true);
  const importInputRef = useRef<HTMLInputElement>(null);
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    loadWorkspace()
      .then((snapshot) => {
        setFolders(snapshot.folders);
        setNotes(snapshot.notes);
        setSettings(snapshot.settings);
        setSelectedNoteId(snapshot.settings.lastOpenedNoteId ?? snapshot.notes[0]?.id ?? null);
      })
      .catch((error) => showToast(error.message || 'Notebook could not open local storage.', 'danger'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function onResize() {
      if (window.innerWidth <= 880) setInspectorOpen(false);
    }

    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        void handleCreateNote();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const selectedNote = useMemo(() => notes.find((note) => note.id === selectedNoteId) ?? null, [notes, selectedNoteId]);
  const tags = useMemo(() => uniqueTags(notes), [notes]);
  const searchHits = useMemo(() => rankNotes(notes, query), [notes, query]);

  const visibleNotes = useMemo(() => {
    if (query.trim()) return searchHits.map((hit) => hit.note);
    if (selectedFolderId === 'favorites') return notes.filter((note) => note.favorite);
    if (selectedFolderId === 'unfiled') return notes.filter((note) => note.folderId === null);
    if (selectedFolderId === 'all') return notes;
    return notes.filter((note) => note.folderId === selectedFolderId);
  }, [notes, query, searchHits, selectedFolderId]);

  function showToast(message: string, tone: ToastState['tone'] = 'info') {
    const id = `${Date.now()}`;
    setToast({ id, message, tone });
    setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, 3000);
  }

  async function handleCreateFolder() {
    const folder = createFolder('New folder', folders.length);
    await saveFolder(folder);
    setFolders((current) => [...current, folder]);
    setSelectedFolderId(folder.id);
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
    await recordCommand('Create folder');
  }

  function startRenameFolder(folder: Folder) {
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
  }

  function cancelRenameFolder() {
    setEditingFolderId(null);
    setEditingFolderName('');
  }

  async function commitRenameFolder(folderId: EntityId) {
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return;

    const name = editingFolderName.trim() || folder.name;
    const updated = await saveFolder({ ...folder, name });
    setFolders((current) => current.map((item) => (item.id === folderId ? updated : item)));
    setEditingFolderId(null);
    setEditingFolderName('');
    showToast('Folder renamed');
  }

  function selectFolder(folderId: EntityId | 'all' | 'favorites' | 'unfiled') {
    setSelectedFolderId(folderId);
    setSidebarOpen(false);
  }

  async function handleCreateNote(folderId: EntityId | null = selectedFolderId === 'all' || selectedFolderId === 'favorites' || selectedFolderId === 'unfiled' ? folders[0]?.id ?? null : selectedFolderId) {
    const note = createNote(folderId, { title: 'Untitled note', position: Date.now() });
    const saved = await saveNote(note);
    setNotes((current) => [saved, ...current]);
    setSelectedNoteId(saved.id);
    setSelectedFolderId(folderId ?? 'unfiled');
    await persistLastOpened(saved.id);
    await recordCommand('Create note');
  }

  async function handleSaveNote(note: Note) {
    setSaveState('saving');
    try {
      const saved = await saveNote(note);
      setNotes((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      setSaveState('saved');
      await persistLastOpened(saved.id);
    } catch {
      setSaveState('error');
      showToast('The note could not be saved.', 'danger');
    }
  }

  async function persistLastOpened(noteId: EntityId) {
    if (!settings) return;
    const next = await saveSettings({ ...settings, lastOpenedNoteId: noteId });
    setSettings(next);
  }

  async function handleSelectNote(noteId: EntityId) {
    setSelectedNoteId(noteId);
    await persistLastOpened(noteId);
    setSidebarOpen(false);
  }

  async function handleDeleteNote(noteId: EntityId) {
    await deleteNote(noteId);
    setNotes((current) => current.filter((note) => note.id !== noteId));
    if (selectedNoteId === noteId) {
      const next = notes.find((note) => note.id !== noteId)?.id ?? null;
      setSelectedNoteId(next);
    }
    showToast('Note deleted');
  }

  async function handleDeleteFolder(folderId: EntityId) {
    await deleteFolder(folderId, notes);
    setFolders((current) => current.filter((folder) => folder.id !== folderId));
    setNotes((current) => current.map((note) => (note.folderId === folderId ? { ...note, folderId: null } : note)));
    setSelectedFolderId('all');
    showToast('Folder removed; notes moved to Unfiled');
  }

  async function patchSelectedNote(patch: Partial<Note>) {
    if (!selectedNote) return;
    await handleSaveNote({ ...selectedNote, ...patch });
  }

  function exportJson() {
    if (!settings) return;
    const backup = createBackup(folders, notes, settings);
    downloadText(`notebook-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
    showToast('Backup exported');
  }

  function exportMarkdown() {
    exportWorkspaceMarkdown(notes);
    showToast('Markdown export created');
  }

  function exportCurrentNote() {
    if (!selectedNote) return;
    exportNoteMarkdown(selectedNote);
    showToast(`${safeFilename(selectedNote.title)}.md exported`);
  }

  function requestImport() {
    importInputRef.current?.click();
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return;

    try {
      const snapshot = parseBackup(await file.text());
      await replaceWorkspace(snapshot);
      setFolders(snapshot.folders);
      setNotes(snapshot.notes);
      setSettings(snapshot.settings);
      setSelectedNoteId(snapshot.settings.lastOpenedNoteId ?? snapshot.notes[0]?.id ?? null);
      setSelectedFolderId('all');
      showToast('Backup imported');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Import failed.', 'danger');
    }
  }

  const emptyState = notes.length === 0;
  const emptyVisibleNotes = !emptyState && visibleNotes.length === 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-button mobile-only" type="button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>
          <Menu size={18} />
        </button>
        <div className="brand" aria-label="Notebook">
          <span className="brand-mark">N</span>
          <span>Notebook</span>
        </div>
        <label className="global-search">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes, tags, backlinks" />
        </label>
        <button className="command-button" type="button" aria-label="Open command palette" onClick={() => setPaletteOpen(true)}>
          <Command size={15} />
          <span>Command</span>
          <kbd>⌘K</kbd>
        </button>
      </header>

      <div className="workspace">
        {sidebarOpen && <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="Workspace navigation">
          <div className="mobile-sidebar-header">
            <strong>Notebook</strong>
            <button className="icon-button" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}>
              <X size={18} />
            </button>
          </div>
          <div className="sidebar-section">
            <button className={`nav-item ${selectedFolderId === 'all' ? 'active' : ''}`} onClick={() => selectFolder('all')}>
              <Archive size={16} />
              <span>All notes</span>
              <strong>{notes.length}</strong>
            </button>
            <button className={`nav-item ${selectedFolderId === 'favorites' ? 'active' : ''}`} onClick={() => selectFolder('favorites')}>
              <Star size={16} />
              <span>Favorites</span>
              <strong>{notes.filter((note) => note.favorite).length}</strong>
            </button>
            <button className={`nav-item ${selectedFolderId === 'unfiled' ? 'active' : ''}`} onClick={() => selectFolder('unfiled')}>
              <FileDown size={16} />
              <span>Unfiled</span>
              <strong>{notes.filter((note) => note.folderId === null).length}</strong>
            </button>
          </div>

          <div className="sidebar-heading">
            <span>Folders</span>
            <button className="icon-button" type="button" aria-label="Create folder" onClick={() => void handleCreateFolder()}>
              <FolderPlus size={15} />
            </button>
          </div>
          <div className="sidebar-section">
            {folders.map((folder) => (
              <div className="folder-row" key={folder.id}>
                {editingFolderId === folder.id ? (
                  <form className="folder-rename" onSubmit={(event) => {
                    event.preventDefault();
                    void commitRenameFolder(folder.id);
                  }}>
                    <span className={`folder-dot color-${folder.color}`} />
                    <input
                      autoFocus
                      value={editingFolderName}
                      aria-label="Folder name"
                      onBlur={() => void commitRenameFolder(folder.id)}
                      onChange={(event) => setEditingFolderName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          cancelRenameFolder();
                        }
                      }}
                    />
                  </form>
                ) : (
                  <>
                    <button className={`nav-item color-${folder.color} ${selectedFolderId === folder.id ? 'active' : ''}`} onClick={() => selectFolder(folder.id)}>
                      <span className="folder-dot" />
                      <span>{folder.name}</span>
                      <strong>{notes.filter((note) => note.folderId === folder.id).length}</strong>
                    </button>
                    <button className="icon-button quiet" type="button" aria-label={`Rename ${folder.name}`} onClick={() => startRenameFolder(folder)}>
                      <Pencil size={14} />
                    </button>
                    <button className="icon-button quiet folder-delete" type="button" aria-label={`Delete ${folder.name}`} onClick={() => void handleDeleteFolder(folder.id)}>
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          {tags.length > 0 && (
            <>
              <div className="sidebar-heading">
                <span>Tags</span>
                <Tags size={15} />
              </div>
              <div className="tag-cloud">
                {tags.map((tag) => <button key={tag} onClick={() => setQuery(`#${tag}`)}>#{tag}</button>)}
              </div>
            </>
          )}

          <details className="sidebar-actions">
            <summary>Backup</summary>
            <div>
              <button type="button" onClick={exportJson}>
                <Download size={16} />
                Export JSON
              </button>
              <button type="button" onClick={exportMarkdown}>
                <FileDown size={16} />
                Export Markdown
              </button>
              <button type="button" onClick={requestImport}>
                <Import size={16} />
                Import backup
              </button>
            </div>
          </details>
        </aside>

        <main className="note-list-pane" aria-label="Notes">
          <div className="list-header">
            <div>
              <h1>{query ? 'Search results' : selectedFolderId === 'all' ? 'All notes' : selectedFolderId === 'favorites' ? 'Favorites' : selectedFolderId === 'unfiled' ? 'Unfiled' : folderName(folders, selectedFolderId)}</h1>
              <p>{visibleNotes.length} visible notes</p>
            </div>
            <button className="primary-button" type="button" onClick={() => void handleCreateNote()}>
              <Plus size={16} />
              New note
            </button>
          </div>

          {loading ? (
            <div className="note-list skeleton-list" aria-label="Loading notes">
              <span />
              <span />
              <span />
            </div>
          ) : emptyState ? (
            <div className="empty-panel">
              <FilePlus2 size={34} />
              <h2>Start with one durable note</h2>
              <p>Create an Inbox note, add a tag, then export a backup. That is the local-first loop.</p>
              <button className="primary-button" type="button" onClick={() => void handleCreateNote(folders[0]?.id ?? null)}>
                <Plus size={16} />
                Create note
              </button>
            </div>
          ) : emptyVisibleNotes ? (
            <div className="empty-panel compact">
              <Search size={30} />
              <h2>{query ? 'No matching notes' : 'No notes in this view'}</h2>
              <p>{query ? 'Try a title, body phrase, backlink, or tag without changing your current notes.' : 'Create a note here or switch to All notes.'}</p>
              <button className="primary-button" type="button" onClick={() => void handleCreateNote()}>
                <Plus size={16} />
                New note
              </button>
            </div>
          ) : (
            <div className="note-list">
              {visibleNotes.map((note) => (
                <button className={`note-card ${note.id === selectedNoteId ? 'active' : ''}`} key={note.id} onClick={() => void handleSelectNote(note.id)}>
                  <span className={`note-color color-${note.color}`} />
                  <span className="note-card-main">
                    <span className="note-card-title">
                      {note.pinned && <Pin size={13} />}
                      {note.title || 'Untitled note'}
                    </span>
                    <span className="note-card-text">{note.text || 'No content yet'}</span>
                    <span className="note-card-meta">
                      {folderName(folders, note.folderId)} · {timeAgo(note.updatedAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </main>

        <section className={`editor-pane-shell ${inspectorOpen ? '' : 'wide'}`}>
          {loading ? (
            <div className="empty-editor skeleton-editor" aria-label="Loading editor">
              <span />
              <span />
              <span />
            </div>
          ) : selectedNote ? (
            <EditorPane
              folders={folders}
              note={selectedNote}
              saveState={saveState}
              onChange={(note) => void handleSaveNote(note)}
              onDelete={() => void handleDeleteNote(selectedNote.id)}
              onExport={exportCurrentNote}
              onPatch={(patch) => void patchSelectedNote(patch)}
              detailsOpen={inspectorOpen}
              onToggleDetails={() => setInspectorOpen((value) => !value)}
            />
          ) : (
            <div className="empty-editor">
              <h2>No note selected</h2>
              <p>Pick a note or create a new one from the command palette.</p>
              <button className="primary-button" type="button" onClick={() => void handleCreateNote()}>
                <Plus size={16} />
                Create note
              </button>
            </div>
          )}
        </section>

        {inspectorOpen && selectedNote && (
          <Inspector
            folders={folders}
            notes={notes}
            note={selectedNote}
            onOpenNote={(noteId) => void handleSelectNote(noteId)}
            onPatch={(patch) => void patchSelectedNote(patch)}
          />
        )}

      </div>

      <CommandPalette
        open={paletteOpen}
        folders={folders}
        notes={notes}
        onClose={() => setPaletteOpen(false)}
        onCreateNote={() => void handleCreateNote()}
        onCreateFolder={() => void handleCreateFolder()}
        onSelectNote={(noteId) => void handleSelectNote(noteId)}
        onExportJson={exportJson}
        onExportMarkdown={exportMarkdown}
        onImport={requestImport}
      />

      <input ref={importInputRef} type="file" accept="application/json" hidden onChange={(event) => void handleImportFile(event.target.files?.[0])} />

      <div className="sr-status" role="status" aria-live="polite">
        {saveState === 'saving' ? 'Saving note' : saveState === 'saved' ? 'Note saved' : saveState === 'error' ? 'Save failed' : ''}
      </div>

      {toast && (
        <div className={`toast ${toast.tone}`} role="status">
          {toast.message}
        </div>
      )}
    </div>
  );
}

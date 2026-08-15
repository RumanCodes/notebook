import {
  Archive,
  ArchiveRestore,
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
  RotateCcw,
  Search,
  ShieldCheck,
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
  deleteFolderPermanently,
  deleteNote,
  restoreFolder,
  restoreNote,
  loadWorkspace,
  recordCommand,
  replaceWorkspace,
  saveFolder,
  saveNote,
  saveSettings,
  trashFolder,
  trashNote,
} from './lib/repository';
import { rankNotes } from './lib/search';
import type { EntityId, Folder, Note, RecoveryBackup, Settings } from './types';

type ViewId = EntityId | 'all' | 'favorites' | 'unfiled' | 'trash';
type ToastState = { id: string; tone: 'info' | 'danger'; message: string; action?: { label: string; run: () => Promise<void> } };

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
  const [selectedFolderId, setSelectedFolderId] = useState<ViewId>('all');
  const [selectedNoteId, setSelectedNoteId] = useState<EntityId | null>(null);
  const [query, setQuery] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<EntityId | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [recoveryBackup, setRecoveryBackup] = useState<RecoveryBackup | undefined>();
  const [loading, setLoading] = useState(true);
  const importInputRef = useRef<HTMLInputElement>(null);
  const booted = useRef(false);
  const saveRequest = useRef(0);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    loadWorkspace()
      .then((snapshot) => {
        setFolders(snapshot.folders);
        setNotes(snapshot.notes);
        setSettings(snapshot.settings);
        setRecoveryBackup(snapshot.recoveryBackup);
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

  const activeFolders = useMemo(() => folders.filter((folder) => !folder.deletedAt), [folders]);
  const activeNotes = useMemo(() => notes.filter((note) => note.status !== 'trashed'), [notes]);
  const trashedFolders = useMemo(() => folders.filter((folder) => folder.deletedAt), [folders]);
  const trashedNotes = useMemo(() => notes.filter((note) => note.status === 'trashed'), [notes]);
  const selectedNote = useMemo(() => activeNotes.find((note) => note.id === selectedNoteId) ?? null, [activeNotes, selectedNoteId]);
  const tags = useMemo(() => uniqueTags(activeNotes), [activeNotes]);
  const searchHits = useMemo(() => rankNotes(activeNotes, query), [activeNotes, query]);

  const visibleNotes = useMemo(() => {
    if (selectedFolderId === 'trash') return trashedNotes;
    if (query.trim()) return searchHits.map((hit) => hit.note);
    if (selectedFolderId === 'favorites') return activeNotes.filter((note) => note.favorite);
    if (selectedFolderId === 'unfiled') return activeNotes.filter((note) => note.folderId === null);
    if (selectedFolderId === 'all') return activeNotes;
    return activeNotes.filter((note) => note.folderId === selectedFolderId);
  }, [activeNotes, query, searchHits, selectedFolderId, trashedNotes]);

  function showToast(message: string, tone: ToastState['tone'] = 'info', action?: ToastState['action']) {
    const id = `${Date.now()}`;
    setToast({ id, message, tone, action });
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

  function selectFolder(folderId: ViewId) {
    setSelectedFolderId(folderId);
    if (folderId === 'trash') setSelectedNoteId(null);
    setSidebarOpen(false);
  }

  async function handleCreateNote(folderId: EntityId | null = selectedFolderId === 'all' || selectedFolderId === 'favorites' || selectedFolderId === 'unfiled' || selectedFolderId === 'trash' ? activeFolders[0]?.id ?? null : selectedFolderId) {
    const note = createNote(folderId, { title: 'Untitled note', position: Date.now() });
    const saved = await saveNote(note);
    setNotes((current) => [saved, ...current]);
    setSelectedNoteId(saved.id);
    setSelectedFolderId(folderId ?? 'unfiled');
    await persistLastOpened(saved.id);
    await recordCommand('Create note');
  }

  async function handleSaveNote(note: Note) {
    const requestId = ++saveRequest.current;
    setSaveState('saving');
    setNotes((current) => current.map((item) => (item.id === note.id ? note : item)));
    try {
      const saved = await saveNote(note);
      setNotes((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      if (requestId === saveRequest.current) setSaveState('saved');
      await persistLastOpened(saved.id);
    } catch {
      if (requestId === saveRequest.current) setSaveState('error');
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

  async function handleDeleteNote(noteId: EntityId, noteOverride?: Note) {
    const note = noteOverride ?? notes.find((item) => item.id === noteId);
    if (!note) return;
    const trashed = await trashNote(note);
    setNotes((current) => current.map((item) => (item.id === trashed.id ? trashed : item)));
    if (selectedNoteId === noteId) {
      const next = activeNotes.find((item) => item.id !== noteId)?.id ?? null;
      setSelectedNoteId(next);
    }
    showToast('Note moved to Trash', 'info', {
      label: 'Undo',
      run: async () => {
        const restored = await restoreNote(trashed, folders);
        setNotes((current) => current.map((item) => (item.id === restored.id ? restored : item)));
      },
    });
  }

  async function handleDeleteFolder(folderId: EntityId) {
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return;
    const result = await trashFolder(folder, notes);
    setFolders((current) => current.map((item) => (item.id === result.folder.id ? result.folder : item)));
    setNotes((current) => current.map((item) => result.notes.find((updated) => updated.id === item.id) ?? item));
    setSelectedFolderId('all');
    showToast(`“${folder.name}” moved to Trash`, 'info', {
      label: 'Undo',
      run: async () => {
        const restored = await restoreFolder(result.folder, result.notes);
        setFolders((current) => current.map((item) => (item.id === restored.folder.id ? restored.folder : item)));
        setNotes((current) => current.map((item) => restored.notes.find((updated) => updated.id === item.id) ?? item));
      },
    });
  }

  async function handleRestoreNote(note: Note) {
    const restored = await restoreNote(note, folders);
    setNotes((current) => current.map((item) => (item.id === restored.id ? restored : item)));
    showToast(restored.folderId ? 'Note restored' : 'Note restored to Unfiled');
  }

  async function handleRestoreFolder(folder: Folder) {
    const result = await restoreFolder(folder, notes);
    setFolders((current) => current.map((item) => (item.id === result.folder.id ? result.folder : item)));
    setNotes((current) => current.map((item) => result.notes.find((updated) => updated.id === item.id) ?? item));
    showToast('Folder and its notes restored');
  }

  async function handleDeleteNoteForever(note: Note) {
    if (!window.confirm(`Delete “${note.title || 'Untitled note'}” forever? This cannot be undone.`)) return;
    await deleteNote(note.id);
    setNotes((current) => current.filter((item) => item.id !== note.id));
    showToast('Note permanently deleted', 'danger');
  }

  async function handleDeleteFolderForever(folder: Folder) {
    const folderNotes = notes.filter((note) => note.folderId === folder.id);
    if (!window.confirm(`Delete “${folder.name}” and its ${folderNotes.length} note${folderNotes.length === 1 ? '' : 's'} forever? This cannot be undone.`)) return;
    await deleteFolderPermanently(folder.id, notes);
    setFolders((current) => current.filter((item) => item.id !== folder.id));
    setNotes((current) => current.filter((note) => note.folderId !== folder.id));
    showToast('Folder permanently deleted', 'danger');
  }

  async function patchSelectedNote(patch: Partial<Note>, baseNote = selectedNote) {
    if (!baseNote) return;
    await handleSaveNote({ ...baseNote, ...patch });
  }

  function exportJson() {
    if (!settings) return;
    const backup = createBackup(folders, notes, settings);
    downloadText(`notebook-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
    showToast('Backup exported');
  }

  function exportRecoveryBackup() {
    if (!recoveryBackup) return;
    const backup = createBackup(recoveryBackup.folders, recoveryBackup.notes, recoveryBackup.settings);
    downloadText(`notebook-recovery-${new Date(recoveryBackup.createdAt).toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
    showToast('Recovery copy exported');
  }

  function exportMarkdown() {
    exportWorkspaceMarkdown(activeNotes);
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
      setRecoveryBackup(undefined);
      setSelectedNoteId(snapshot.settings.lastOpenedNoteId ?? snapshot.notes[0]?.id ?? null);
      setSelectedFolderId('all');
      showToast('Backup imported');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Import failed.', 'danger');
    }
  }

  const emptyState = selectedFolderId !== 'trash' && activeNotes.length === 0;
  const emptyVisibleNotes = selectedFolderId === 'trash'
    ? visibleNotes.length === 0 && trashedFolders.length === 0
    : !emptyState && visibleNotes.length === 0;

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
              <strong>{activeNotes.length}</strong>
            </button>
            <button className={`nav-item ${selectedFolderId === 'favorites' ? 'active' : ''}`} onClick={() => selectFolder('favorites')}>
              <Star size={16} />
              <span>Favorites</span>
              <strong>{activeNotes.filter((note) => note.favorite).length}</strong>
            </button>
            <button className={`nav-item ${selectedFolderId === 'unfiled' ? 'active' : ''}`} onClick={() => selectFolder('unfiled')}>
              <FileDown size={16} />
              <span>Unfiled</span>
              <strong>{activeNotes.filter((note) => note.folderId === null).length}</strong>
            </button>
            <button className={`nav-item ${selectedFolderId === 'trash' ? 'active' : ''}`} onClick={() => selectFolder('trash')}>
              <Trash2 size={16} />
              <span>Trash</span>
              <strong>{trashedNotes.length + trashedFolders.length}</strong>
            </button>
          </div>

          <div className="sidebar-heading">
            <span>Folders</span>
            <button className="icon-button" type="button" aria-label="Create folder" onClick={() => void handleCreateFolder()}>
              <FolderPlus size={15} />
            </button>
          </div>
          <div className="sidebar-section">
            {activeFolders.map((folder) => (
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
                      <strong>{activeNotes.filter((note) => note.folderId === folder.id).length}</strong>
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
              {recoveryBackup && (
                <button type="button" onClick={exportRecoveryBackup}>
                  <ShieldCheck size={16} />
                  Export recovery copy
                </button>
              )}
            </div>
            {recoveryBackup && <p className="backup-note">A safety copy from the last app upgrade is ready.</p>}
          </details>
        </aside>

        <main className="note-list-pane" aria-label="Notes">
          <div className="list-header">
            <div>
              <h1>{query && selectedFolderId !== 'trash' ? 'Search results' : selectedFolderId === 'all' ? 'All notes' : selectedFolderId === 'favorites' ? 'Favorites' : selectedFolderId === 'unfiled' ? 'Unfiled' : selectedFolderId === 'trash' ? 'Trash' : folderName(folders, selectedFolderId)}</h1>
              <p>{selectedFolderId === 'trash' ? `${visibleNotes.length} notes, ${trashedFolders.length} folders` : `${visibleNotes.length} visible notes`}</p>
            </div>
            {selectedFolderId !== 'trash' && (
              <button className="primary-button" type="button" onClick={() => void handleCreateNote()}>
                <Plus size={16} />
                New note
              </button>
            )}
          </div>

          {loading ? (
            <div className="note-list skeleton-list" aria-label="Loading notes">
              <span />
              <span />
              <span />
            </div>
          ) : selectedFolderId === 'trash' && visibleNotes.length === 0 && trashedFolders.length === 0 ? (
            <div className="empty-panel compact">
              <ArchiveRestore size={30} />
              <h2>Trash is empty</h2>
              <p>Deleted notes and folders stay here until you restore them or delete them forever.</p>
            </div>
          ) : emptyState ? (
            <div className="empty-panel">
              <FilePlus2 size={34} />
              <h2>Start with one durable note</h2>
              <p>Create an Inbox note, add a tag, then export a backup. That is the local-first loop.</p>
              <button className="primary-button" type="button" onClick={() => void handleCreateNote(activeFolders[0]?.id ?? null)}>
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
              {selectedFolderId === 'trash' && trashedFolders.length > 0 && (
                <section className="trash-group" aria-labelledby="trashed-folders-heading">
                  <h2 id="trashed-folders-heading">Folders</h2>
                  {trashedFolders.map((folder) => (
                    <div className="trash-row" key={folder.id}>
                      <span className={`folder-dot color-${folder.color}`} />
                      <span className="trash-row-main">
                        <strong>{folder.name}</strong>
                        <span>{trashedNotes.filter((note) => note.folderId === folder.id).length} notes</span>
                      </span>
                      <button className="secondary-button" type="button" onClick={() => void handleRestoreFolder(folder)}>
                        <ArchiveRestore size={15} />
                        Restore
                      </button>
                      <button className="icon-button danger" type="button" aria-label={`Delete ${folder.name} forever`} title="Delete forever" onClick={() => void handleDeleteFolderForever(folder)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </section>
              )}
              {visibleNotes.map((note) => (
                selectedFolderId === 'trash' ? (
                  <div className="note-card trash-card" key={note.id}>
                    <span className={`note-color color-${note.color}`} />
                    <span className="note-card-main">
                      <span className="note-card-title">{note.title || 'Untitled note'}</span>
                      <span className="note-card-text">{note.text || 'No content yet'}</span>
                      <span className="note-card-meta">{folderName(folders, note.folderId)} · Deleted {timeAgo(note.trashedAt ?? note.updatedAt)}</span>
                    </span>
                    <span className="trash-card-actions">
                      <button className="secondary-button" type="button" onClick={() => void handleRestoreNote(note)}>
                        <ArchiveRestore size={15} />
                        Restore
                      </button>
                      <button className="icon-button danger" type="button" aria-label={`Delete ${note.title || 'Untitled note'} forever`} title="Delete forever" onClick={() => void handleDeleteNoteForever(note)}>
                        <Trash2 size={16} />
                      </button>
                    </span>
                  </div>
                ) : (
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
                )
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
              folders={activeFolders}
              note={selectedNote}
              saveState={saveState}
              onChange={(note) => void handleSaveNote(note)}
              onDelete={(note) => void handleDeleteNote(note.id, note)}
              onExport={exportCurrentNote}
              onPatch={(patch, baseNote) => void patchSelectedNote(patch, baseNote)}
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
            folders={activeFolders}
            notes={activeNotes}
            note={selectedNote}
            onOpenNote={(noteId) => void handleSelectNote(noteId)}
            onPatch={(patch) => void patchSelectedNote(patch)}
          />
        )}

      </div>

      <CommandPalette
        open={paletteOpen}
        folders={folders}
        notes={activeNotes}
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
          {toast.action && (
            <button type="button" className="toast-action" onClick={() => void toast.action?.run().finally(() => setToast(null))}>
              <RotateCcw size={14} />
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

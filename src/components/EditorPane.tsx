import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Typography from '@tiptap/extension-typography';
import Underline from '@tiptap/extension-underline';
import { EditorContent, type JSONContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  CheckSquare,
  Code2,
  Download,
  Heading1,
  Heading2,
  Highlighter,
  Italic,
  LinkIcon,
  List,
  ListOrdered,
  PanelRightClose,
  PanelRightOpen,
  Pilcrow,
  Quote,
  Save,
  Table2,
  Trash2,
  UnderlineIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { saveDraft } from '../lib/repository';
import type { Folder, Note } from '../types';

interface EditorPaneProps {
  folders: Folder[];
  note: Note;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  onChange: (note: Note) => void;
  onPatch: (patch: Partial<Note>, baseNote: Note) => void;
  onDelete: (note: Note) => void;
  onExport: () => void;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}

export function EditorPane({ folders, note, saveState, onChange, onPatch, onDelete, onExport, detailsOpen, onToggleDetails }: EditorPaneProps) {
  const [title, setTitle] = useState(note.title);
  const saveTimer = useRef<number | null>(null);
  const currentNoteId = useRef(note.id);
  const draftRef = useRef(note);
  const pendingRef = useRef(false);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
      }),
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      Typography,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({
        placeholder: "Write with Markdown shortcuts. Type [[Note title]] to link knowledge.",
      }),
    ],
    content: note.content as JSONContent,
    autofocus: false,
    editorProps: {
      attributes: {
        class: 'prose-editor',
        'aria-label': 'Note body',
      },
    },
    onUpdate: ({ editor }) => scheduleSave({ content: editor.getJSON(), text: editor.getText() }),
  });

  function flushPendingSave() {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!pendingRef.current) return;

    pendingRef.current = false;
    onChangeRef.current(draftRef.current);
  }

  useEffect(() => {
    if (!editor) return;
    if (currentNoteId.current !== note.id) {
      flushPendingSave();
      currentNoteId.current = note.id;
      draftRef.current = note;
      editor.commands.setContent(note.content as JSONContent, false);
      setTitle(note.title);
      return;
    }
    if (!pendingRef.current) {
      draftRef.current = note;
      setTitle(note.title);
    }
  }, [editor, note]);

  useEffect(() => {
    function persistBeforePageIsHidden() {
      flushPendingSave();
    }

    window.addEventListener('pagehide', persistBeforePageIsHidden);
    document.addEventListener('visibilitychange', persistBeforePageIsHidden);

    return () => {
      window.removeEventListener('pagehide', persistBeforePageIsHidden);
      document.removeEventListener('visibilitychange', persistBeforePageIsHidden);
      flushPendingSave();
    };
  }, []);

  const folder = useMemo(() => folders.find((item) => item.id === note.folderId), [folders, note.folderId]);

  function scheduleSave(patch: Partial<Note>) {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    pendingRef.current = true;
    saveDraft(next);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      pendingRef.current = false;
      onChangeRef.current(draftRef.current);
    }, 450);
  }

  function updateTitle(value: string) {
    setTitle(value);
    scheduleSave({ title: value });
  }

  function applyPatch(patch: Partial<Note>) {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingRef.current = false;
    draftRef.current = { ...draftRef.current, ...patch };
    saveDraft(draftRef.current);
    onPatch(patch, draftRef.current);
  }

  function deleteCurrentNote() {
    flushPendingSave();
    onDelete(draftRef.current);
  }

  function setLink() {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', previousUrl ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  function insertTable() {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }

  return (
    <article className="editor-pane">
      <div className="editor-chrome">
        <div className="note-location">
          <span className={`folder-dot color-${folder?.color ?? 'slate'}`} />
          <span>{folder?.name ?? 'Unfiled'}</span>
        </div>
        <div className={`save-indicator ${saveState}`}>
          <Save size={14} />
          <span>{saveState === 'saving' ? 'Saving' : saveState === 'error' ? 'Save failed' : 'Saved'}</span>
        </div>
        <button className="icon-button" type="button" title="Export note as Markdown" onClick={onExport}>
          <Download size={16} />
        </button>
        <button className={`secondary-button ${detailsOpen ? 'active' : ''}`} type="button" onClick={onToggleDetails}>
          {detailsOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          Details
        </button>
        <button className="icon-button danger" type="button" title="Move note to Trash" aria-label="Move note to Trash" onClick={deleteCurrentNote}>
          <Trash2 size={16} />
        </button>
      </div>

      <input className="title-input" value={title} onChange={(event) => updateTitle(event.target.value)} placeholder="Untitled note" aria-label="Note title" />

      <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
        <ToolbarButton label="Paragraph" active={editor?.isActive('paragraph')} onClick={() => editor?.chain().focus().setParagraph().run()} icon={<Pilcrow size={16} />} />
        <ToolbarButton label="Heading 1" active={editor?.isActive('heading', { level: 1 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} icon={<Heading1 size={16} />} />
        <ToolbarButton label="Heading 2" active={editor?.isActive('heading', { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} icon={<Heading2 size={16} />} />
        <span className="toolbar-separator" />
        <ToolbarButton label="Bold" active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()} icon={<Bold size={16} />} />
        <ToolbarButton label="Italic" active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()} icon={<Italic size={16} />} />
        <ToolbarButton label="Underline" active={editor?.isActive('underline')} onClick={() => editor?.chain().focus().toggleUnderline().run()} icon={<UnderlineIcon size={16} />} />
        <ToolbarButton label="Highlight" active={editor?.isActive('highlight')} onClick={() => editor?.chain().focus().toggleHighlight().run()} icon={<Highlighter size={16} />} />
        <span className="toolbar-separator" />
        <ToolbarButton label="Bullet list" active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()} icon={<List size={16} />} />
        <ToolbarButton label="Ordered list" active={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()} icon={<ListOrdered size={16} />} />
        <ToolbarButton label="Task list" active={editor?.isActive('taskList')} onClick={() => editor?.chain().focus().toggleTaskList().run()} icon={<CheckSquare size={16} />} />
        <ToolbarButton label="Quote" active={editor?.isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()} icon={<Quote size={16} />} />
        <ToolbarButton label="Code block" active={editor?.isActive('codeBlock')} onClick={() => editor?.chain().focus().toggleCodeBlock().run()} icon={<Code2 size={16} />} />
        <span className="toolbar-separator" />
        <ToolbarButton label="Link" active={editor?.isActive('link')} onClick={setLink} icon={<LinkIcon size={16} />} />
        <ToolbarButton label="Table" active={editor?.isActive('table')} onClick={insertTable} icon={<Table2 size={16} />} />
      </div>

      <EditorContent editor={editor} />

      <div className="editor-footer">
        <label>
          Folder
          <select value={note.folderId ?? 'unfiled'} onChange={(event) => applyPatch({ folderId: event.target.value === 'unfiled' ? null : event.target.value })}>
            <option value="unfiled">Unfiled</option>
            {folders.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button className={`toggle-button ${note.favorite ? 'active' : ''}`} type="button" onClick={() => applyPatch({ favorite: !note.favorite })}>
          Favorite
        </button>
        <button className={`toggle-button ${note.pinned ? 'active' : ''}`} type="button" onClick={() => applyPatch({ pinned: !note.pinned })}>
          Pinned
        </button>
      </div>
    </article>
  );
}

function ToolbarButton({ label, active, onClick, icon }: { label: string; active?: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button className={`toolbar-button ${active ? 'active' : ''}`} type="button" title={label} aria-label={label} onClick={onClick}>
      {icon}
    </button>
  );
}

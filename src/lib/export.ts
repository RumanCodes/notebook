import type { Folder, Note, NotebookBackupV2, Settings } from '../types';
import { noteToMarkdown } from './content';

export function createBackup(folders: Folder[], notes: Note[], settings: Settings): NotebookBackupV2 {
  return {
    appName: 'Notebook',
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    folders,
    notes,
    settings,
  };
}

export function downloadText(filename: string, contents: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 100);
}

export function safeFilename(value: string): string {
  return (value || 'untitled-note')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || 'untitled-note';
}

export function exportNoteMarkdown(note: Note): void {
  downloadText(`${safeFilename(note.title)}.md`, noteToMarkdown(note), 'text/markdown;charset=utf-8');
}

export function exportWorkspaceMarkdown(notes: Note[]): void {
  const bundle = notes.map(noteToMarkdown).join('\n\n---\n\n');
  downloadText(`notebook-markdown-${new Date().toISOString().slice(0, 10)}.md`, bundle, 'text/markdown;charset=utf-8');
}

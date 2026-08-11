import type { Note } from '../types';

export const emptyDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
    },
  ],
};

type JSONNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: JSONNode[];
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
};

export function htmlToText(html: string): string {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const element = document.createElement('div');
  element.innerHTML = html;
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function jsonToText(value: unknown): string {
  const parts: string[] = [];

  function walk(node: JSONNode | undefined): void {
    if (!node) return;
    if (node.text) parts.push(node.text);
    node.content?.forEach(walk);
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem') {
      parts.push(' ');
    }
  }

  walk(value as JSONNode);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

export function legacyHtmlToDoc(html = ''): unknown {
  const text = htmlToText(html);
  if (!text) return emptyDoc;

  return {
    type: 'doc',
    content: text.split(/\n{2,}/).map((paragraph) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: paragraph.trim() }],
    })),
  };
}

export function extractWikiLinks(text: string): string[] {
  const links = new Set<string>();
  const matcher = /\[\[([^\]\n]{1,120})\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text))) {
    const title = match[1].trim();
    if (title) links.add(title);
  }

  return [...links];
}

export function noteToMarkdown(note: Note): string {
  const frontmatter = [
    '---',
    `id: ${note.id}`,
    note.folderId ? `folderId: ${note.folderId}` : 'folderId:',
    `createdAt: ${new Date(note.createdAt).toISOString()}`,
    `updatedAt: ${new Date(note.updatedAt).toISOString()}`,
    `favorite: ${String(note.favorite)}`,
    `pinned: ${String(note.pinned)}`,
    `tags: [${note.tags.map((tag) => `"${tag}"`).join(', ')}]`,
    '---',
    '',
  ].join('\n');

  return `${frontmatter}# ${note.title || 'Untitled note'}\n\n${jsonToMarkdown(note.content)}`.trimEnd();
}

function jsonToMarkdown(value: unknown): string {
  const node = value as JSONNode;
  const lines: string[] = [];

  function renderInline(child: JSONNode): string {
    let value = child.text ?? child.content?.map(renderInline).join('') ?? '';

    child.marks?.forEach((mark) => {
      if (mark.type === 'bold') value = `**${value}**`;
      if (mark.type === 'italic') value = `_${value}_`;
      if (mark.type === 'code') value = `\`${value}\``;
      if (mark.type === 'link') value = `[${value}](${String(mark.attrs?.href ?? '')})`;
    });

    return value;
  }

  function renderBlock(block: JSONNode, depth = 0): void {
    const inline = block.content?.map(renderInline).join('') ?? '';

    switch (block.type) {
      case 'heading':
        lines.push(`${'#'.repeat(Number(block.attrs?.level ?? 2))} ${inline}`.trim());
        break;
      case 'paragraph':
        if (inline) lines.push(inline);
        break;
      case 'bulletList':
        block.content?.forEach((item) => renderListItem(item, '-', depth));
        break;
      case 'orderedList':
        block.content?.forEach((item, index) => renderListItem(item, `${index + 1}.`, depth));
        break;
      case 'taskList':
        block.content?.forEach((item) => {
          const checked = item.attrs?.checked ? 'x' : ' ';
          renderListItem(item, `- [${checked}]`, depth);
        });
        break;
      case 'blockquote':
        block.content?.forEach((item) => {
          const before = lines.length;
          renderBlock(item, depth);
          lines.slice(before).forEach((line, index) => {
            lines[before + index] = `> ${line}`;
          });
        });
        break;
      case 'codeBlock':
        lines.push('```');
        lines.push(inline);
        lines.push('```');
        break;
      default:
        block.content?.forEach((child) => renderBlock(child, depth));
    }

    if (lines[lines.length - 1] !== '') lines.push('');
  }

  function renderListItem(item: JSONNode, marker: string, depth: number): void {
    const paragraph = item.content?.find((child) => child.type === 'paragraph');
    const text = paragraph?.content?.map(renderInline).join('') ?? '';
    lines.push(`${'  '.repeat(depth)}${marker} ${text}`.trimEnd());
    item.content
      ?.filter((child) => child.type !== 'paragraph')
      .forEach((child) => renderBlock(child, depth + 1));
  }

  node.content?.forEach((block) => renderBlock(block));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

# Notebook

Local-first V1 rebuild of the original single-file Notebook app. The legacy app remains in `notebook-app.html`; the new app lives in `src/` and runs on Vite, React, TypeScript, TipTap, and IndexedDB.

## Commands

```bash
npm install
npm run dev
npm run test
npm run build
```

## Data

Notebook stores V2 data locally in IndexedDB with stores for notes, folders, settings, links, attachments metadata, and command history. The import flow accepts the existing V1 JSON backup shape from `notebook-app.html` and migrates it into the V2 schema.

## Exports

- JSON backup for full workspace recovery.
- Markdown bundle for portable archive.
- Single-note Markdown export from the editor.

# Notebook

Local-first V1 rebuild of the original single-file Notebook app. The legacy app remains in `notebook-app.html`; the new app lives in `src/` and runs on Vite, React, TypeScript, TipTap, and IndexedDB.

## Commands

```bash
npm install
npm run dev
npm run test
npm run build
npm run deploy
```

## Data

Notebook stores data locally in IndexedDB with stores for notes, folders, settings, links, attachment metadata, command history, and migration recovery copies. The current database version is 3. Existing V2 data is upgraded in place, with an internal recovery copy created before records are migrated. The import flow accepts the existing V1 JSON backup shape from `notebook-app.html` and earlier Notebook JSON backups.

Deleting a note or folder first moves it to Trash. Folder deletion keeps its notes together. Trash supports restore, Undo immediately after deletion, and permanent deletion behind an explicit confirmation. Permanent deletion is the only destructive delete action in the normal interface.

## Exports

- JSON backup for full workspace recovery.
- Markdown bundle for portable archive.
- Single-note Markdown export from the editor.
- Recovery-copy export after a database upgrade.

## Cloudflare Workers

This app deploys as a Worker with static assets.

Use these Cloudflare Worker build settings:

- Root directory: leave blank, or use `.`
- Build command: `npm install`
- Deploy command: `npm run deploy`

`wrangler.jsonc` serves the Vite `dist/` output and uses single-page application fallback routing.

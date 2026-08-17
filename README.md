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

Notebook stores data locally in IndexedDB with stores for notes, folders, settings, links, attachment metadata, command history, and migration recovery copies. The current database version is 3. Existing V2 data is upgraded in place, with an internal recovery copy created before records are migrated. If the current workspace is empty, startup also checks the legacy `notebook_app_db` and migrates its notes automatically. The import flow accepts the existing V1 JSON backup shape from `notebook-app.html` and earlier Notebook JSON backups.

Editor changes are autosaved after a short debounce, flushed when the note changes or the page is hidden, and serialized per note so an older write cannot overwrite a newer one. A small synchronous `localStorage` pending-draft journal is also replayed into IndexedDB on the next load; this protects edits made immediately before a reload or tab close. The production Hostinger deployment uses Google sign-in plus the PHP/MySQL API in `public/api/` so each authenticated user's workspace is also saved permanently in MySQL. IndexedDB remains the local working cache.

Deleting a note or folder first moves it to Trash. Folder deletion keeps its notes together. Trash supports restore, Undo immediately after deletion, and permanent deletion behind an explicit confirmation. Permanent deletion is the only destructive delete action in the normal interface.

## Hostinger Permanent Storage

This deployment target is a static React build plus PHP endpoints copied into `public_html/api`. The API uses HTTP-only PHP sessions, verifies Google ID tokens on the server, and stores one workspace snapshot per Google user in Hostinger MySQL.

### 1. Create Google OAuth Client

In Google Cloud Console, create an OAuth 2.0 Web client.

- Authorized JavaScript origin: `https://your-domain.com`
- Authorized redirect URI: not required for the popup flow used here
- Copy the Web client ID

### 2. Create Hostinger MySQL Tables

In hPanel, create a MySQL database for the domain. Open phpMyAdmin and import:

```txt
public/api/schema.sql
```

### 3. Configure PHP API

On the deployed server, copy:

```txt
public_html/api/config.example.php
```

to:

```txt
public_html/api/config.php
```

Then fill in:

```php
const DB_HOST = 'localhost';
const DB_NAME = 'your_hostinger_database_name';
const DB_USER = 'your_hostinger_database_user';
const DB_PASS = 'your_hostinger_database_password';
const GOOGLE_CLIENT_ID = 'your-google-web-client-id.apps.googleusercontent.com';
```

Keep the public-service limits from `config.example.php` unless your hosting plan requires different values. They cap workspace size, note and folder counts, title and text lengths, and tags per note.

Do not commit `config.php`; it is ignored by git.
The included `api/.htaccess` also blocks direct access to PHP configuration and helper files. Keep PHP enabled for the endpoint files and HTTPS enabled for the domain.

### 4. Build for Hostinger

Create `.env.production` locally:

```txt
VITE_GOOGLE_CLIENT_ID=your-google-web-client-id.apps.googleusercontent.com
VITE_API_BASE_URL=/api
```

Build:

```bash
npm run build
```

Upload the contents of `dist/` to the domain's `public_html/`. Vite copies the PHP endpoints, including `public/api/config.php` when it exists locally, into `dist/api/`. The source and generated config files are ignored by Git, so verify that your deployment tool does not publish them to a public repository. Keep `api/.htaccess` in place so the PHP configuration cannot be downloaded as source.

### 5. Runtime Behavior

- Signed-out users see the Google sign-in screen.
- First sign-in creates or uploads that user's workspace.
- Later sign-ins load the user's MySQL workspace back into IndexedDB.
- Every local edit is saved to IndexedDB first and then synced to MySQL.
- If the API is unavailable, the local workspace remains usable and shows a retry control.
- If local and cloud workspaces differ, the app pauses syncing and lets the user keep either copy.
- Trash is retained until restored or permanently deleted.
- Account deletion removes the Google-linked user and workspace from MySQL.

### Local Session Troubleshooting

If Google sign-in succeeds but reload shows the sign-in screen again, the PHP session cookie is not being sent back to `api/me.php`.

For production, host the React files and `api/` folder on the same domain, for example `https://your-domain.com` and `https://your-domain.com/api`. Same-domain sessions use `SESSION_COOKIE_SAMESITE = 'Lax'`.

For local testing against a remote HTTPS API, add your local origin to `ALLOWED_ORIGINS` in `api/config.php`:

```php
const ALLOWED_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'];
const SESSION_COOKIE_SAMESITE = 'None';
```

Cross-site cookies can still be blocked by browser privacy settings, so the most reliable test is a same-domain Hostinger deployment.

## Exports

- JSON backup for full workspace recovery.
- Markdown bundle for portable archive.
- Single-note Markdown export from the editor.
- Recovery-copy export after a database upgrade.

## Open-source release

Read `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, and `PRIVACY.md` before publishing a hosted instance. The supported deployment target in this repository is a same-domain Hostinger site with PHP and MySQL.

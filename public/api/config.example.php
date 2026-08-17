<?php
declare(strict_types=1);

const DB_HOST = 'localhost';
const DB_NAME = 'replace-with-database-name';
const DB_USER = 'replace-with-database-user';
const DB_PASS = 'replace-with-database-password';

const GOOGLE_CLIENT_ID = 'replace-with-google-web-client-id.apps.googleusercontent.com';

// Keep this empty for same-domain production hosting. Add local dev origins only
// if you proxy these PHP endpoints from a different host while developing.
const ALLOWED_ORIGINS = [];

// Same-domain Hostinger hosting should use Lax. Cross-site local testing against
// an HTTPS API may require None, but browsers can still block third-party cookies.
const SESSION_COOKIE_SAMESITE = 'Lax';

// Public-service guardrails. Tune these for your hosting plan before launch.
const MAX_WORKSPACE_BYTES = 5 * 1024 * 1024;
const MAX_NOTES = 10000;
const MAX_FOLDERS = 1000;
const MAX_NOTE_TITLE_LENGTH = 500;
const MAX_NOTE_TEXT_LENGTH = 500000;
const MAX_TAGS_PER_NOTE = 50;
const MAX_TAG_LENGTH = 100;

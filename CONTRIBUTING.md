# Contributing

## Development

```bash
npm install
npm run dev
```

Before opening a pull request, run:

```bash
npm run test
npm run build
```

Keep changes focused, preserve the local-first behavior, and add tests for storage, import/export, search, authentication, or sync changes. Never commit `.env.local`, `.env.production`, `public/api/config.php`, database credentials, or OAuth secrets.

## Pull requests

Explain the user-visible behavior, data-migration impact, and verification performed. Changes that affect cloud storage or authentication require a short note describing failure and recovery behavior.

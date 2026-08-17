# Security Policy

## Supported versions

The latest version on the default branch is the supported version.

## Reporting a vulnerability

Do not open a public issue for a suspected security vulnerability. Contact the project maintainer privately with a description, reproduction steps, affected files, and impact. Remove credentials from reports and rotate any exposed database or OAuth credentials immediately.

Hosted operators should keep `public/api/config.php` outside version control, use HTTPS, restrict the Google OAuth origin to the deployed domain, and review PHP and MySQL logs regularly.

# Privacy Notes

Notebook stores note content locally in the browser and, when Google sign-in is enabled, stores the signed-in user's workspace in the configured MySQL database.

The server stores the Google subject identifier, email address, display name, profile picture URL, workspace snapshot, revision, and timestamps. It does not receive note content until the authenticated workspace sync runs.

Users can export JSON or Markdown backups and can delete their account and cloud workspace from the Account section. A hosted operator is responsible for its own privacy notice, retention period, database backups, access controls, and legal compliance.

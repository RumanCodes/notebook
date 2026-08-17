<?php
declare(strict_types=1);

require_once __DIR__ . '/_bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'PUT') {
    json_response(['error' => 'Method not allowed.'], 405);
}

if ($method === 'PUT') {
    require_notebook_request();
}

$userId = require_user_id();
$pdo = db();

if ($method === 'GET') {
    $stmt = $pdo->prepare('SELECT snapshot_json, revision, updated_at FROM notebook_workspaces WHERE user_id = ? LIMIT 1');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    if (!$row) {
        json_response(['workspace' => null, 'revision' => null, 'updatedAt' => null]);
    }

    $workspace = json_decode((string) $row['snapshot_json'], true);
    if (!is_array($workspace)) {
        json_response(['error' => 'Saved workspace is not valid JSON.'], 500);
    }

    json_response([
        'workspace' => $workspace,
        'revision' => (int) $row['revision'],
        'updatedAt' => (int) $row['updated_at'],
    ]);
}

$maxWorkspaceBytes = defined('MAX_WORKSPACE_BYTES') ? (int) MAX_WORKSPACE_BYTES : 5 * 1024 * 1024;
$body = read_json_body($maxWorkspaceBytes);
$snapshot = $body['workspace'] ?? null;
if (!is_array($snapshot) || !is_array($snapshot['folders'] ?? null) || !is_array($snapshot['notes'] ?? null) || !is_array($snapshot['settings'] ?? null)) {
    json_response(['error' => 'Invalid workspace snapshot.'], 400);
}

$maxNotes = defined('MAX_NOTES') ? (int) MAX_NOTES : 10000;
$maxFolders = defined('MAX_FOLDERS') ? (int) MAX_FOLDERS : 1000;
$maxTitleLength = defined('MAX_NOTE_TITLE_LENGTH') ? (int) MAX_NOTE_TITLE_LENGTH : 500;
$maxTextLength = defined('MAX_NOTE_TEXT_LENGTH') ? (int) MAX_NOTE_TEXT_LENGTH : 500000;
$maxTagsPerNote = defined('MAX_TAGS_PER_NOTE') ? (int) MAX_TAGS_PER_NOTE : 50;
$maxTagLength = defined('MAX_TAG_LENGTH') ? (int) MAX_TAG_LENGTH : 100;

if (count($snapshot['notes']) > $maxNotes || count($snapshot['folders']) > $maxFolders) {
    json_response(['error' => 'Workspace exceeds the allowed size.'], 413);
}

foreach ($snapshot['folders'] as $folder) {
    if (!is_array($folder) || !is_string($folder['name'] ?? null) || mb_strlen($folder['name']) > 500) {
        json_response(['error' => 'A folder name is invalid or too long.'], 400);
    }
}

foreach ($snapshot['notes'] as $note) {
    if (!is_array($note) || !is_string($note['title'] ?? null) || !is_string($note['text'] ?? null)) {
        json_response(['error' => 'A note is invalid.'], 400);
    }
    if (mb_strlen($note['title']) > $maxTitleLength || mb_strlen($note['text']) > $maxTextLength) {
        json_response(['error' => 'A note is too large.'], 413);
    }
    if (!is_array($note['tags'] ?? null) || count($note['tags']) > $maxTagsPerNote) {
        json_response(['error' => 'A note has too many tags.'], 413);
    }
    foreach ($note['tags'] as $tag) {
        if (!is_string($tag) || mb_strlen($tag) > $maxTagLength) {
            json_response(['error' => 'A note tag is invalid or too long.'], 400);
        }
    }
}

enforce_rate_limit('workspace-save-' . $userId, 120, 60);

$baseRevision = array_key_exists('baseRevision', $body) && $body['baseRevision'] !== null ? (int) $body['baseRevision'] : null;
$snapshotJson = json_encode($snapshot, JSON_UNESCAPED_SLASHES);
if (!is_string($snapshotJson)) {
    json_response(['error' => 'Workspace could not be serialized.'], 400);
}

$now = (int) floor(microtime(true) * 1000);
$pdo->beginTransaction();
try {
    $stmt = $pdo->prepare('SELECT revision FROM notebook_workspaces WHERE user_id = ? FOR UPDATE');
    $stmt->execute([$userId]);
    $existing = $stmt->fetch();

    if (!$existing) {
        $stmt = $pdo->prepare('INSERT INTO notebook_workspaces (user_id, snapshot_json, revision, created_at, updated_at) VALUES (?, ?, 1, ?, ?)');
        $stmt->execute([$userId, $snapshotJson, $now, $now]);
        $revision = 1;
    } else {
        $currentRevision = (int) $existing['revision'];
        if ($baseRevision !== null && $baseRevision !== $currentRevision) {
            $pdo->rollBack();
            json_response(['error' => 'Workspace was changed in another session.', 'revision' => $currentRevision], 409);
        }

        $revision = $currentRevision + 1;
        $stmt = $pdo->prepare('UPDATE notebook_workspaces SET snapshot_json = ?, revision = ?, updated_at = ? WHERE user_id = ?');
        $stmt->execute([$snapshotJson, $revision, $now, $userId]);
    }

    $pdo->commit();
} catch (Throwable $error) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    json_response(['error' => 'Workspace could not be saved.'], 500);
}

json_response(['revision' => $revision, 'updatedAt' => $now]);

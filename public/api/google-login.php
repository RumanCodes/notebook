<?php
declare(strict_types=1);

require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_google.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['error' => 'Method not allowed.'], 405);
}

require_notebook_request();
enforce_rate_limit('google-login', 20, 60);
$body = read_json_body();
$credential = trim((string) ($body['credential'] ?? ''));
if ($credential === '') {
    json_response(['error' => 'Missing Google credential.'], 400);
}

try {
    $claims = verify_google_id_token($credential);
} catch (Throwable) {
    json_response(['error' => 'Google sign-in could not be verified. Please try again.'], 401);
}

$now = (int) floor(microtime(true) * 1000);
$googleSub = (string) $claims['sub'];
$email = (string) $claims['email'];
$name = isset($claims['name']) ? (string) $claims['name'] : null;
$picture = isset($claims['picture']) ? (string) $claims['picture'] : null;

try {
    $pdo = db();
    $stmt = $pdo->prepare(
        'INSERT INTO notebook_users (google_sub, email, name, picture, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE email = VALUES(email), name = VALUES(name), picture = VALUES(picture), updated_at = VALUES(updated_at)'
    );
    $stmt->execute([$googleSub, $email, $name, $picture, $now, $now]);

    $stmt = $pdo->prepare('SELECT id, email, name, picture FROM notebook_users WHERE google_sub = ? LIMIT 1');
    $stmt->execute([$googleSub]);
    $user = $stmt->fetch();
    if (!$user) {
        json_response(['error' => 'Could not load signed-in user.'], 500);
    }
} catch (Throwable $error) {
    json_response(['error' => 'Sign-in could not be completed. Please try again.'], 500);
}

session_regenerate_id(true);
$_SESSION['user_id'] = (int) $user['id'];

json_response(['user' => $user]);

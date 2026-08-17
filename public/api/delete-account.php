<?php
declare(strict_types=1);

require_once __DIR__ . '/_bootstrap.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    json_response(['error' => 'Method not allowed.'], 405);
}

require_notebook_request();
$userId = require_user_id();

try {
    $stmt = db()->prepare('DELETE FROM notebook_users WHERE id = ?');
    $stmt->execute([$userId]);
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'] ?? '', (bool) $params['secure'], (bool) $params['httponly']);
    }
    session_destroy();
    json_response(['deleted' => true]);
} catch (Throwable $error) {
    json_response(['error' => 'Your account could not be deleted. Please try again.'], 500);
}

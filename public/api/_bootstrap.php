<?php
declare(strict_types=1);

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Missing api/config.php. Copy config.example.php and fill in your Hostinger database and Google client ID.']);
    exit;
}

require_once $configPath;

function configure_cors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = defined('ALLOWED_ORIGINS') ? ALLOWED_ORIGINS : [];
    if ($origin !== '' && in_array($origin, $allowed, true)) {
        header("Access-Control-Allow-Origin: {$origin}");
        header('Access-Control-Allow-Credentials: true');
        header('Vary: Origin');
    }

    header('Access-Control-Allow-Headers: Content-Type, X-Notebook-Request');
    header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function start_notebook_session(): void
{
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $sameSite = defined('SESSION_COOKIE_SAMESITE') ? SESSION_COOKIE_SAMESITE : 'Lax';
    if (!in_array($sameSite, ['Lax', 'Strict', 'None'], true)) {
        $sameSite = 'Lax';
    }

    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 30,
        'path' => '/',
        'secure' => $secure || $sameSite === 'None',
        'httponly' => true,
        'samesite' => $sameSite,
    ]);
    session_name('notebook_session');
    session_start();
}

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function read_json_body(?int $maxBytes = null): array
{
    $raw = file_get_contents('php://input');
    if ($maxBytes !== null && strlen($raw ?: '') > $maxBytes) {
        json_response(['error' => 'Request is too large.'], 413);
    }
    $data = json_decode($raw ?: '{}', true);
    if (!is_array($data)) {
        json_response(['error' => 'Invalid JSON body.'], 400);
    }
    return $data;
}

function enforce_rate_limit(string $bucket, int $limit, int $windowSeconds): void
{
    $identity = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $file = sys_get_temp_dir() . '/notebook-rate-' . hash('sha256', $bucket . '|' . $identity) . '.json';
    $now = time();
    $timestamps = [];

    if (is_file($file)) {
        $cached = json_decode((string) @file_get_contents($file), true);
        if (is_array($cached)) {
            $timestamps = array_values(array_filter($cached, static fn ($timestamp): bool => is_int($timestamp) && $timestamp > $now - $windowSeconds));
        }
    }

    if (count($timestamps) >= $limit) {
        header('Retry-After: ' . $windowSeconds);
        json_response(['error' => 'Too many requests. Please try again shortly.'], 429);
    }

    $timestamps[] = $now;
    @file_put_contents($file, json_encode($timestamps), LOCK_EX);
}

function require_notebook_request(): void
{
    if (($_SERVER['HTTP_X_NOTEBOOK_REQUEST'] ?? '') !== '1') {
        json_response(['error' => 'Missing notebook request header.'], 400);
    }
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}

function current_user_id(): ?int
{
    $id = $_SESSION['user_id'] ?? null;
    return is_int($id) ? $id : (is_numeric($id) ? (int) $id : null);
}

function require_user_id(): int
{
    $userId = current_user_id();
    if (!$userId) {
        json_response(['error' => 'Authentication required.'], 401);
    }
    return $userId;
}

function current_user(): ?array
{
    $userId = current_user_id();
    if (!$userId) {
        return null;
    }

    $stmt = db()->prepare('SELECT id, email, name, picture FROM notebook_users WHERE id = ? LIMIT 1');
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    return $user ?: null;
}

configure_cors();
start_notebook_session();

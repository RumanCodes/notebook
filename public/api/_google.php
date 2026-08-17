<?php
declare(strict_types=1);

function base64url_decode_strict(string $value): string
{
    $remainder = strlen($value) % 4;
    if ($remainder > 0) {
        $value .= str_repeat('=', 4 - $remainder);
    }
    $decoded = base64_decode(strtr($value, '-_', '+/'), true);
    if ($decoded === false) {
        throw new RuntimeException('Invalid base64url value.');
    }
    return $decoded;
}

function google_public_certs(): array
{
    $cacheFile = sys_get_temp_dir() . '/notebook_google_certs.json';
    if (is_file($cacheFile)) {
        $cached = json_decode((string) file_get_contents($cacheFile), true);
        if (is_array($cached) && ($cached['expires_at'] ?? 0) > time() && is_array($cached['certs'] ?? null)) {
            return $cached['certs'];
        }
    }

    $ch = curl_init('https://www.googleapis.com/oauth2/v1/certs');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_HEADER => true,
    ]);
    $response = curl_exec($ch);
    if (!is_string($response)) {
        throw new RuntimeException('Could not fetch Google public certificates.');
    }

    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $headers = substr($response, 0, $headerSize);
    $body = substr($response, $headerSize);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    if ($status < 200 || $status >= 300) {
        throw new RuntimeException('Google public certificates request failed.');
    }

    $certs = json_decode($body, true);
    if (!is_array($certs)) {
        throw new RuntimeException('Invalid Google public certificate response.');
    }

    $maxAge = 3600;
    if (preg_match('/cache-control:.*max-age=(\d+)/i', $headers, $match)) {
        $maxAge = max(60, (int) $match[1]);
    }

    @file_put_contents($cacheFile, json_encode([
        'expires_at' => time() + $maxAge,
        'certs' => $certs,
    ]));

    return $certs;
}

function verify_google_id_token(string $token): array
{
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        throw new RuntimeException('Invalid Google credential.');
    }

    [$encodedHeader, $encodedPayload, $encodedSignature] = $parts;
    $header = json_decode(base64url_decode_strict($encodedHeader), true);
    $payload = json_decode(base64url_decode_strict($encodedPayload), true);
    if (!is_array($header) || !is_array($payload)) {
        throw new RuntimeException('Invalid Google credential payload.');
    }

    if (($header['alg'] ?? '') !== 'RS256' || empty($header['kid'])) {
        throw new RuntimeException('Unsupported Google credential signature.');
    }

    $certs = google_public_certs();
    $certificate = $certs[$header['kid']] ?? null;
    if (!is_string($certificate)) {
        throw new RuntimeException('Unknown Google credential certificate.');
    }

    $signed = $encodedHeader . '.' . $encodedPayload;
    $signature = base64url_decode_strict($encodedSignature);
    $verified = openssl_verify($signed, $signature, $certificate, OPENSSL_ALGO_SHA256);
    if ($verified !== 1) {
        throw new RuntimeException('Invalid Google credential signature.');
    }

    $issuer = $payload['iss'] ?? '';
    if ($issuer !== 'https://accounts.google.com' && $issuer !== 'accounts.google.com') {
        throw new RuntimeException('Invalid Google credential issuer.');
    }

    if (($payload['aud'] ?? '') !== GOOGLE_CLIENT_ID) {
        throw new RuntimeException('Invalid Google credential audience.');
    }

    if (!isset($payload['exp']) || (int) $payload['exp'] < time()) {
        throw new RuntimeException('Expired Google credential.');
    }

    if (empty($payload['sub']) || empty($payload['email'])) {
        throw new RuntimeException('Google credential is missing account identity.');
    }

    if (($payload['email_verified'] ?? false) !== true) {
        throw new RuntimeException('Google account email is not verified.');
    }

    return $payload;
}

<?php
/**
 * RolplayPro Analytics — DB Bridge
 * Upload this file to: https://improveyourpitchbeta.net/rolplay-ai/rolplay-bridge.php
 *
 * This file acts as a secure HTTP-to-MySQL proxy.
 * The Next.js dashboard calls it via HTTPS with an API key.
 * The PHP process connects to MySQL locally (no port 3306 needed externally).
 */

// ── Security ──────────────────────────────────────────────────────────────────
// Change this to any long random string. Set the same value in BRIDGE_SECRET env var.
define('BRIDGE_SECRET', 'REDACTED_BRIDGE_SECRET');

header('Content-Type: application/json');

$apiKey = $_SERVER['HTTP_X_BRIDGE_KEY'] ?? '';
if ($apiKey !== BRIDGE_SECRET || $apiKey === '') {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

// ── DB connection ─────────────────────────────────────────────────────────────
$host   = '127.0.0.1';
$user   = 'root';
$pass   = 'IYP-DB-2023-06';
$dbname = 'rolplay_pro_analytics';

try {
    $pdo = new PDO(
        "mysql:host={$host};dbname={$dbname};charset=utf8mb4",
        $user,
        $pass,
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'DB connection failed: ' . $e->getMessage()]);
    exit;
}

// ── Request body ──────────────────────────────────────────────────────────────
$body = json_decode(file_get_contents('php://input'), true);

if (!isset($body['sql'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing sql']);
    exit;
}

$sql    = $body['sql'];
$params = $body['params'] ?? [];

// ── Execute ───────────────────────────────────────────────────────────────────
try {
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    // Cast numeric strings to proper types
    $typed = array_map(function ($row) {
        return array_map(function ($v) {
            if (is_numeric($v) && $v !== '') return $v + 0;
            return $v;
        }, $row);
    }, $rows);

    echo json_encode($typed);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Query failed: ' . $e->getMessage()]);
}

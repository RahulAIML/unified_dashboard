<?php
/**
 * rolplay-bridge-new.php — Full read/write PHP bridge
 *
 * Supports: SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP
 * Auth:     X-Bridge-Key header
 * DB:       rolplay_pro_analytics @ localhost
 *
 * UPLOAD THIS FILE to /src/rolplay-bridge.php (overwrite the current one)
 */

// ════════════════════════════════════════════════════════════════════
// CONFIGURATION — all values pre-filled from project env
// ════════════════════════════════════════════════════════════════════
define('DB_HOST',     'localhost');                   // server-local connection
define('DB_USER',     'rpsim');                       // from .env.local
define('DB_PASS',     'skeleton-scribe-selective');   // from .env.local
define('DB_NAME',     'rolplay_pro_analytics');       // confirmed from bridge test
define('BRIDGE_KEY',  'REDACTED_BRIDGE_SECRET');  // from .env.local
// ════════════════════════════════════════════════════════════════════

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Bridge-Key');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// ── Security: Validate API Key ────────────────────────────────────
$key = $_SERVER['HTTP_X_BRIDGE_KEY'] ?? '';
if ($key !== BRIDGE_KEY) {
    http_response_code(401);
    echo json_encode(['success' => false, 'data' => null, 'error' => 'Unauthorized']);
    exit;
}

// ── Database Connection ───────────────────────────────────────────
function getConnection() {
    $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    $conn->set_charset('utf8mb4');
    if ($conn->connect_error) {
        throw new Exception('DB connection failed: ' . $conn->connect_error);
    }
    return $conn;
}

// ── Response Helpers ──────────────────────────────────────────────
function success($data) {
    echo json_encode(['success' => true, 'data' => $data, 'error' => null]);
    exit;
}

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'data' => null, 'error' => $message]);
    exit;
}

// ── GET Requests (action-based) ───────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? '';

    if ($action === 'test') {
        try {
            $conn = getConnection();
            $res = $conn->query("SELECT VERSION() AS v, DATABASE() AS d");
            $row = $res->fetch_assoc();
            $conn->close();
            success([
                'message'      => 'bridge working',
                'server_time'  => date('Y-m-d H:i:s'),
                'db_version'   => $row['v'],
                'db_name'      => $row['d'],
                'write_access' => 'ENABLED',
            ]);
        } catch (Exception $e) {
            fail($e->getMessage(), 500);
        }
    }

    fail('Unknown action');
}

// ── POST Requests (SQL queries) ───────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);

    // Support both formats:
    //   { "sql": "...", "params": [] }    ← used by Next.js lib/db.ts
    //   { "action": "...", "query": "..." } ← legacy format
    $sql    = $body['sql']    ?? $body['query'] ?? '';
    $params = $body['params'] ?? [];

    if (empty($sql)) {
        fail('Missing sql');
    }

    try {
        $conn = getConnection();

        // ── Execute with parameters ───────────────────────────────
        if (!empty($params)) {
            $stmt = $conn->prepare($sql);
            if (!$stmt) {
                fail('Prepare error: ' . $conn->error, 500);
            }

            // Build bind_param type string
            $types = '';
            foreach ($params as $p) {
                if (is_int($p))   $types .= 'i';
                elseif (is_float($p)) $types .= 'd';
                else $types .= 's';
            }

            $stmt->bind_param($types, ...$params);

            if (!$stmt->execute()) {
                fail('Execute error: ' . $stmt->error, 500);
            }

            $result = $stmt->get_result();

            if ($result !== false) {
                // SELECT query
                $rows = [];
                while ($row = $result->fetch_assoc()) {
                    $rows[] = $row;
                }
                $stmt->close();
                $conn->close();
                success($rows);
            } else {
                // INSERT / UPDATE / DELETE / CREATE / ALTER / DROP
                $out = [
                    'affected_rows' => $stmt->affected_rows,
                    'insert_id'     => $stmt->insert_id,
                ];
                $stmt->close();
                $conn->close();
                success($out);
            }

        // ── Execute without parameters ────────────────────────────
        } else {
            $result = $conn->query($sql);

            if ($result === false) {
                fail('Query error: ' . $conn->error, 500);
            }

            if ($result === true) {
                // DDL / DML (CREATE, ALTER, INSERT, UPDATE, DELETE, DROP)
                $out = [
                    'affected_rows' => $conn->affected_rows,
                    'insert_id'     => $conn->insert_id,
                ];
                $conn->close();
                success($out);
            } else {
                // SELECT
                $rows = [];
                while ($row = $result->fetch_assoc()) {
                    $rows[] = $row;
                }
                $result->free();
                $conn->close();
                success($rows);
            }
        }

    } catch (Exception $e) {
        fail($e->getMessage(), 500);
    }
}

fail('Method not allowed', 405);
?>

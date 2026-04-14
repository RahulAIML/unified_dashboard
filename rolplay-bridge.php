<?php
/**
 * RolplayPro Analytics — DB Bridge (production-ready)
 * Upload to: https://improveyourpitchbeta.net/rolplay-ai/rolplay-bridge.php
 *
 * Modes:
 *  GET  ?action=test|kpis|trend|modules  → named action endpoints
 *  POST {sql, params}                    → raw SQL proxy (used by lib/db.ts)
 *
 * Security: all requests require X-Bridge-Key header matching BRIDGE_SECRET.
 */

// ── Configuration ─────────────────────────────────────────────────────────────
define('BRIDGE_SECRET', 'REDACTED_BRIDGE_SECRET');
define('DB_HOST',       '127.0.0.1');
define('DB_USER',       'rpsim');
define('DB_PASS',       'skeleton-scribe-selective');
define('DB_NAME',       'roleplay_demorp6');
define('DB_CHARSET',    'utf8mb4');
define('DB_PORT',       3306);

// ── Helpers ───────────────────────────────────────────────────────────────────
function send(bool $success, $data = null, string $error = null, int $status = 200): void
{
    http_response_code($status);
    echo json_encode(
        ['success' => $success, 'data' => $data, 'error' => $error],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
    exit;
}

function fail(string $message, int $status = 400): void
{
    send(false, null, $message, $status);
}

// ── CORS headers (must come before any output) ────────────────────────────────
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Bridge-Key');
header('Content-Type: application/json; charset=utf-8');

// Handle preflight — return 204 with no body
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Suppress PHP error output (errors go to JSON, not HTML) ──────────────────
ini_set('display_errors', '0');
error_reporting(0);

// ── API key validation ────────────────────────────────────────────────────────
$apiKey = $_SERVER['HTTP_X_BRIDGE_KEY'] ?? '';
if ($apiKey === '' || $apiKey !== BRIDGE_SECRET) {
    fail('Unauthorized', 401);
}

// ── DB connection (PDO) ───────────────────────────────────────────────────────
try {
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=%s',
        DB_HOST, DB_PORT, DB_NAME, DB_CHARSET
    );
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
        PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci",
    ]);
} catch (PDOException $e) {
    // Never expose $e->getMessage() to the outside in production
    error_log('[rolplay-bridge] DB connect failed: ' . $e->getMessage());
    fail('Database unavailable', 503);
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function dateParam(string $key, string $default): string
{
    $raw = $_GET[$key] ?? $default;
    // Accept ISO 8601 (from JS .toISOString()) and plain YYYY-MM-DD
    $dt  = DateTime::createFromFormat('Y-m-d\TH:i:s.v\Z', $raw)
        ?: DateTime::createFromFormat('Y-m-d\TH:i:s\Z', $raw)
        ?: DateTime::createFromFormat('Y-m-d', substr($raw, 0, 10));
    return $dt ? $dt->format('Y-m-d H:i:s') : $default;
}

// ── Numeric casting helper (mirrors lib/data-provider.ts cast logic) ──────────
function castRow(array $row): array
{
    return array_map(function ($v) {
        if ($v === null || $v === '') return $v;
        if (is_numeric($v)) return $v + 0;
        return $v;
    }, $row);
}

// ── Action router ─────────────────────────────────────────────────────────────
$action = strtolower(trim($_GET['action'] ?? ''));

// Default date range: last 30 days
$defaultFrom = date('Y-m-d H:i:s', strtotime('-30 days'));
$defaultTo   = date('Y-m-d H:i:s');
$from        = dateParam('from', $defaultFrom);
$to          = dateParam('to',   $defaultTo);

switch ($action) {

    // ── ?action=test ─────────────────────────────────────────────────────────
    case 'test':
        try {
            $stmt = $pdo->query('SELECT NOW() AS server_time, VERSION() AS version');
            $row  = $stmt->fetch();
            send(true, [
                'message'     => 'bridge working',
                'server_time' => $row['server_time'],
                'db_version'  => $row['version'],
                'db_name'     => DB_NAME,
            ]);
        } catch (PDOException $e) {
            error_log('[rolplay-bridge] test query failed: ' . $e->getMessage());
            fail('DB query error', 500);
        }
        break;

    // ── ?action=kpis ─────────────────────────────────────────────────────────
    // Returns: avg_score, pass_rate, total_sessions, passed_evaluations
    case 'kpis':
        try {
            // Score + total
            $stmt = $pdo->prepare(
                "SELECT COUNT(DISTINCT saved_report_id) AS total_sessions,
                        ROUND(AVG(value_num), 1)        AS avg_score
                 FROM report_field_current
                 WHERE field_key = 'overall_score'
                   AND report_created_at BETWEEN ? AND ?"
            );
            $stmt->execute([$from, $to]);
            $scoreRow = $stmt->fetch();

            // Pass / fail (anything != 'Deficiente' is a pass)
            $stmt2 = $pdo->prepare(
                "SELECT COUNT(CASE WHEN value_text != 'Deficiente' THEN 1 END) AS passed,
                        COUNT(*)                                                 AS total_results
                 FROM report_field_current
                 WHERE field_key = 'overall_result'
                   AND report_created_at BETWEEN ? AND ?"
            );
            $stmt2->execute([$from, $to]);
            $pfRow = $stmt2->fetch();

            $totalSessions = (int)($scoreRow['total_sessions'] ?? 0);
            $avgScore      = $scoreRow['avg_score'] !== null ? (float)$scoreRow['avg_score'] : null;
            $passed        = (int)($pfRow['passed']         ?? 0);
            $totalResults  = (int)($pfRow['total_results']  ?? 0);
            $passRate      = $totalResults > 0
                ? round(($passed / $totalResults) * 100, 1)
                : null;

            send(true, [
                'avg_score'           => $avgScore,
                'pass_rate'           => $passRate,
                'total_sessions'      => $totalSessions,
                'passed_evaluations'  => $passed,
            ]);
        } catch (PDOException $e) {
            error_log('[rolplay-bridge] kpis query failed: ' . $e->getMessage());
            fail('DB query error', 500);
        }
        break;

    // ── ?action=trend ─────────────────────────────────────────────────────────
    // Returns: daily score trend + daily pass/fail counts
    case 'trend':
        try {
            $stmt = $pdo->prepare(
                "SELECT DATE(report_created_at)       AS date,
                        ROUND(AVG(value_num), 1)      AS avg_score,
                        COUNT(DISTINCT saved_report_id) AS session_count
                 FROM report_field_current
                 WHERE field_key = 'overall_score'
                   AND report_created_at BETWEEN ? AND ?
                 GROUP BY DATE(report_created_at)
                 ORDER BY date ASC
                 LIMIT 90"
            );
            $stmt->execute([$from, $to]);
            $scoreTrend = array_map('castRow', $stmt->fetchAll());

            $stmt2 = $pdo->prepare(
                "SELECT DATE(report_created_at)                                        AS date,
                        COUNT(CASE WHEN value_text != 'Deficiente' THEN 1 END)         AS passed,
                        COUNT(CASE WHEN value_text  = 'Deficiente' THEN 1 END)         AS failed
                 FROM report_field_current
                 WHERE field_key = 'overall_result'
                   AND report_created_at BETWEEN ? AND ?
                 GROUP BY DATE(report_created_at)
                 ORDER BY date ASC
                 LIMIT 90"
            );
            $stmt2->execute([$from, $to]);
            $passFail = array_map('castRow', $stmt2->fetchAll());

            send(true, [
                'score_trend' => $scoreTrend,
                'pass_fail'   => $passFail,
            ]);
        } catch (PDOException $e) {
            error_log('[rolplay-bridge] trend query failed: ' . $e->getMessage());
            fail('DB query error', 500);
        }
        break;

    // ── ?action=modules ───────────────────────────────────────────────────────
    // Returns: per-usecase breakdown (total, avg_score, pass_rate)
    case 'modules':
        try {
            $stmt = $pdo->prepare(
                "SELECT s.usecase_id,
                        COUNT(DISTINCT s.saved_report_id)                           AS total_evaluations,
                        ROUND(AVG(s.value_num), 1)                                  AS avg_score,
                        COUNT(DISTINCT CASE WHEN r.value_text != 'Deficiente'
                                            THEN r.saved_report_id END)             AS passed,
                        COUNT(DISTINCT r.saved_report_id)                           AS total_results
                 FROM report_field_current s
                 LEFT JOIN report_field_current r
                        ON s.saved_report_id = r.saved_report_id
                       AND r.field_key       = 'overall_result'
                 WHERE s.field_key = 'overall_score'
                   AND s.report_created_at BETWEEN ? AND ?
                 GROUP BY s.usecase_id
                 ORDER BY total_evaluations DESC
                 LIMIT 20"
            );
            $stmt->execute([$from, $to]);
            $rows = $stmt->fetchAll();

            $data = array_map(function ($r) {
                $total   = (int)$r['total_evaluations'];
                $passed  = (int)$r['passed'];
                $results = (int)$r['total_results'];
                return [
                    'usecase_id'        => (int)$r['usecase_id'],
                    'total_evaluations' => $total,
                    'avg_score'         => $r['avg_score'] !== null ? (float)$r['avg_score'] : null,
                    'passed'            => $passed,
                    'pass_rate'         => $results > 0 ? round(($passed / $results) * 100, 1) : null,
                ];
            }, $rows);

            send(true, $data);
        } catch (PDOException $e) {
            error_log('[rolplay-bridge] modules query failed: ' . $e->getMessage());
            fail('DB query error', 500);
        }
        break;

    // ── POST {sql, params} — raw SQL proxy ────────────────────────────────────
    // Used by lib/db.ts when BRIDGE_URL is set.
    // Only reached when no ?action= is in the query string.
    case '':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            fail('POST required for raw SQL mode', 405);
        }

        $body = json_decode(file_get_contents('php://input'), true);

        if (!is_array($body) || !isset($body['sql']) || !is_string($body['sql'])) {
            fail('Missing or invalid sql field', 400);
        }

        $sql    = trim($body['sql']);
        $params = isset($body['params']) && is_array($body['params']) ? $body['params'] : [];

        // Basic guard: allow only SELECT / SHOW / EXPLAIN (read-only proxy)
        if (!preg_match('/^\s*(SELECT|SHOW|EXPLAIN)\s/i', $sql)) {
            fail('Only SELECT queries are permitted', 403);
        }

        try {
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            $rows = array_map('castRow', $stmt->fetchAll());
            send(true, $rows);
        } catch (PDOException $e) {
            error_log('[rolplay-bridge] raw query failed: ' . $e->getMessage());
            fail('Query execution error', 500);
        }
        break;

    // ── Unknown action ────────────────────────────────────────────────────────
    default:
        fail("Unknown action: {$action}", 404);
        break;
}

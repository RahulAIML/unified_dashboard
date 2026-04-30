<?php
/**
 * rolplay-bridge.php — Production Analytics Bridge
 *
 * VERIFIED schema (2026-04-30):
 *   coach_app.coach_users      → id, customer_id, user_email, user_pass, user_name, signup, date_added, timezone
 *   coach_app.site_users       → id, customer_id, uname, email, pwd, date_added
 *   coach_app.usecases         → id, customer_id, usecase_name, ...
 *   coach_app.saved_reports    → id, uid, usecase_id, coach_user_id, score, passed_flag, ...
 *   rolplay_pro_analytics.report_field_current
 *                              → id, saved_report_id, user_id, customer_id, usecase_id,
 *                                report_created_at, field_key, field_label,
 *                                value_num, value_text, value_longtext, created_at
 *   rolplay_pro_analytics.report_payload_current
 *                              → saved_report_id, closing_json, ...
 *
 * Tenant isolation:
 *   - Tenant resolved at login via: coach_app.coach_users WHERE user_email = ?
 *   - All analytics scoped via:    report_field_current.customer_id = ?
 *
 * Deploy: Upload as https://rolplayadmin.com/coach-app/src/rolplay-bridge.php
 */

declare(strict_types=1);

// ── Configuration ─────────────────────────────────────────────────────────────
$bridgeSecret = getenv('BRIDGE_SECRET') ?: 'REDACTED_BRIDGE_SECRET';
define('BRIDGE_SECRET', $bridgeSecret);
define('DB_HOST',    getenv('DB_HOST')    ?: 'localhost');
define('DB_USER',    getenv('DB_USER')    ?: 'rpsim');
define('DB_PASS',    getenv('DB_PASS')    ?: '');
define('DB_NAME',    getenv('DB_NAME')    ?: 'rolplay_pro_analytics');
define('DB_CHARSET', 'utf8mb4');
define('DB_PORT',    (int)(getenv('DB_PORT') ?: 3306));

// ── Response helpers ──────────────────────────────────────────────────────────
function send(bool $success, $data = null, ?string $error = null, int $status = 200): void {
  http_response_code($status);
  echo json_encode(
    ['success' => $success, 'data' => $data, 'error' => $error],
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
  );
  exit;
}

function fail(string $message, int $status = 400): void {
  send(false, null, $message, $status);
}

// ── CORS / headers ────────────────────────────────────────────────────────────
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Bridge-Key');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

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
  error_log('[bridge] DB connect failed: ' . $e->getMessage());
  fail('Database unavailable', 503);
}

// ── Route: GET action= or POST body ──────────────────────────────────────────
$action = null;
$postBody = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $raw = file_get_contents('php://input');
  $postBody = json_decode($raw, true);
  // POST with raw SQL (legacy mode — for debugging only)
  if (isset($postBody['sql'])) {
    $sql    = $postBody['sql']    ?? '';
    $params = $postBody['params'] ?? [];
    if (!is_string($sql) || trim($sql) === '') fail('Missing sql');
    if (!is_array($params)) $params = [];
    try {
      $stmt = $pdo->prepare($sql);
      $stmt->execute($params);
      $method = strtoupper(explode(' ', trim($sql))[0]);
      if (in_array($method, ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'])) {
        send(true, $stmt->fetchAll());
      } else {
        send(true, ['affected' => $stmt->rowCount()]);
      }
    } catch (PDOException $e) {
      error_log('[bridge] raw-sql error: ' . $e->getMessage());
      fail($e->getMessage(), 500);
    }
  }
  $action = $postBody['action'] ?? ($_GET['action'] ?? '');
} else {
  $action = $_GET['action'] ?? '';
}

if (!is_string($action) || $action === '') fail('Missing action', 400);

// ── Helpers ───────────────────────────────────────────────────────────────────
function requireParam(string $key): string {
  $v = $_GET[$key] ?? (is_array($GLOBALS['postBody'] ?? null) ? ($GLOBALS['postBody'][$key] ?? '') : '');
  if (!is_string($v) || trim($v) === '') fail("Missing parameter: $key", 400);
  return trim($v);
}

function optionalParam(string $key): string {
  $v = $_GET[$key] ?? (is_array($GLOBALS['postBody'] ?? null) ? ($GLOBALS['postBody'][$key] ?? '') : '');
  return is_string($v) ? trim($v) : '';
}

function parseIntParam(string $key): int {
  $raw = requireParam($key);
  if (!preg_match('/^\d+$/', $raw)) fail("Invalid integer: $key", 400);
  $n = (int)$raw;
  if ($n <= 0) fail("Invalid integer: $key", 400);
  return $n;
}

function parseIsoToMysql(string $key): string {
  $raw = requireParam($key);
  try {
    $dt = new DateTimeImmutable($raw);
    return $dt->format('Y-m-d H:i:s');
  } catch (Exception $e) {
    fail("Invalid datetime: $key", 400);
  }
}

function parseUsecaseIds(): array {
  $raw = $_GET['usecase_ids'] ?? (is_array($GLOBALS['postBody'] ?? null) ? ($GLOBALS['postBody']['usecase_ids'] ?? '') : '');
  if (!is_string($raw) || trim($raw) === '') return [];
  $out = [];
  foreach (explode(',', $raw) as $p) {
    $p = trim($p);
    if ($p === '' || !preg_match('/^\d+$/', $p)) continue;
    $n = (int)$p;
    if ($n > 0) $out[] = $n;
  }
  return array_values(array_unique(array_slice($out, 0, 50)));
}

function priorPeriod(string $fromMysql, string $toMysql): array {
  $from = new DateTimeImmutable($fromMysql);
  $to   = new DateTimeImmutable($toMysql);
  $span = max(0, $to->getTimestamp() - $from->getTimestamp());
  $prevTo   = $from->modify('-1 second');
  $prevFrom = $prevTo->modify("-{$span} seconds");
  return [$prevFrom->format('Y-m-d H:i:s'), $prevTo->format('Y-m-d H:i:s')];
}

// Appends usecase_id IN (...) clause and adds params
function usecaseClause(array $usecaseIds, array &$params): string {
  if (count($usecaseIds) === 0) return '';
  $placeholders = implode(',', array_fill(0, count($usecaseIds), '?'));
  foreach ($usecaseIds as $id) $params[] = $id;
  return " AND rfc.usecase_id IN ($placeholders)";
}

// ── Action handlers ───────────────────────────────────────────────────────────
switch ($action) {

  // ── Health / connectivity test ──────────────────────────────────────────────
  case 'test': {
    try {
      $row = $pdo->query("SELECT VERSION() AS v, DATABASE() AS d")->fetch();
      send(true, [
        'message'      => 'bridge working',
        'server_time'  => date('Y-m-d H:i:s'),
        'db_version'   => $row['v'] ?? null,
        'db_name'      => $row['d'] ?? null,
        'write_access' => 'ENABLED',
      ]);
    } catch (PDOException $e) {
      fail('DB query error', 500);
    }
  }

  // ── Tenant resolution: user_email → customer_id ─────────────────────────────
  // Uses coach_app.coach_users (verified: has user_email + customer_id columns)
  case 'resolve_customer_id': {
    $email = strtolower(requireParam('email'));
    try {
      // Primary: coach_users
      $stmt = $pdo->prepare(
        "SELECT customer_id FROM coach_app.coach_users WHERE user_email = ? LIMIT 1"
      );
      $stmt->execute([$email]);
      $row = $stmt->fetch();

      // Fallback: site_users (has email column)
      if (!$row) {
        $stmt2 = $pdo->prepare(
          "SELECT customer_id FROM coach_app.site_users WHERE email = ? LIMIT 1"
        );
        $stmt2->execute([$email]);
        $row = $stmt2->fetch();
      }

      send(true, ['customer_id' => $row ? (int)$row['customer_id'] : null]);
    } catch (PDOException $e) {
      error_log('[bridge] resolve_customer_id error: ' . $e->getMessage());
      fail('DB query error', 500);
    }
  }

  // ── Overview KPIs ────────────────────────────────────────────────────────────
  // Returns { current, prev } with session counts, avg score, pass counts
  case 'overview_kpis': {
    $customerId = parseIntParam('customer_id');
    $from       = parseIsoToMysql('from');
    $to         = parseIsoToMysql('to');
    $usecaseIds = parseUsecaseIds();

    // Closure: query one time period
    $fetchPeriod = function(string $pFrom, string $pTo) use ($pdo, $customerId, $usecaseIds) {
      $params = [$customerId, $pFrom, $pTo];
      $uc     = usecaseClause($usecaseIds, $params);

      // Sessions + avg score (from overall_score field)
      $stmt = $pdo->prepare(
        "SELECT
           COUNT(DISTINCT rfc.saved_report_id)               AS total_sessions,
           ROUND(AVG(rfc.value_num), 2)                      AS avg_score,
           SUM(CASE WHEN sr.passed_flag = 1 THEN 1 ELSE 0 END) AS passed,
           COUNT(DISTINCT rfc.saved_report_id)               AS total_results
         FROM rolplay_pro_analytics.report_field_current rfc
         JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
         WHERE rfc.customer_id = ?
           AND rfc.report_created_at BETWEEN ? AND ?
           AND rfc.field_key = 'overall_score'$uc"
      );
      $stmt->execute($params);
      $row = $stmt->fetch();
      return [
        'total_sessions' => (int)($row['total_sessions'] ?? 0),
        'avg_score'      => $row['avg_score'] !== null ? (float)$row['avg_score'] : null,
        'passed'         => (int)($row['passed'] ?? 0),
        'total_results'  => (int)($row['total_results'] ?? 0),
      ];
    };

    try {
      [$pFrom, $pTo] = priorPeriod($from, $to);
      $current = $fetchPeriod($from, $to);
      $prev    = $fetchPeriod($pFrom, $pTo);
      send(true, ['current' => $current, 'prev' => $prev]);
    } catch (PDOException $e) {
      error_log('[bridge] overview_kpis error: ' . $e->getMessage());
      fail('DB query error', 500);
    }
  }

  // ── Trend series ─────────────────────────────────────────────────────────────
  // Returns { score_trend, pass_fail, eval_count }
  case 'trends': {
    $customerId = parseIntParam('customer_id');
    $from       = parseIsoToMysql('from');
    $to         = parseIsoToMysql('to');
    $usecaseIds = parseUsecaseIds();

    try {
      $params = [$customerId, $from, $to];
      $uc     = usecaseClause($usecaseIds, $params);

      $base =
        " FROM rolplay_pro_analytics.report_field_current rfc
          JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
         WHERE rfc.customer_id = ?
           AND rfc.report_created_at BETWEEN ? AND ?
           AND rfc.field_key = 'overall_score'$uc";

      // Score trend
      $q1 = $pdo->prepare(
        "SELECT DATE(rfc.report_created_at) AS date,
                ROUND(AVG(rfc.value_num), 1) AS avg_score
         $base
         GROUP BY DATE(rfc.report_created_at)
         ORDER BY date ASC LIMIT 90"
      );
      $q1->execute($params);

      // Pass/fail trend
      $q2 = $pdo->prepare(
        "SELECT DATE(rfc.report_created_at) AS date,
                SUM(CASE WHEN sr.passed_flag = 1 THEN 1 ELSE 0 END) AS passed,
                SUM(CASE WHEN sr.passed_flag = 0 THEN 1 ELSE 0 END) AS failed
         $base
         GROUP BY DATE(rfc.report_created_at)
         ORDER BY date ASC LIMIT 90"
      );
      $q2->execute($params);

      // Session count trend
      $q3 = $pdo->prepare(
        "SELECT DATE(rfc.report_created_at) AS date,
                COUNT(DISTINCT rfc.saved_report_id) AS sessions
         $base
         GROUP BY DATE(rfc.report_created_at)
         ORDER BY date ASC LIMIT 90"
      );
      $q3->execute($params);

      send(true, [
        'score_trend' => $q1->fetchAll(),
        'pass_fail'   => $q2->fetchAll(),
        'eval_count'  => $q3->fetchAll(),
      ]);
    } catch (PDOException $e) {
      error_log('[bridge] trends error: ' . $e->getMessage());
      fail('DB query error', 500);
    }
  }

  // ── Evaluation results list ───────────────────────────────────────────────────
  case 'results': {
    $customerId = parseIntParam('customer_id');
    $from       = parseIsoToMysql('from');
    $to         = parseIsoToMysql('to');
    $usecaseIds = parseUsecaseIds();
    $limit      = max(1, min(200, (int)(optionalParam('limit') ?: '50')));

    try {
      $params = [$customerId, $from, $to];
      $uc     = usecaseClause($usecaseIds, $params);
      $params[] = $limit;

      $stmt = $pdo->prepare(
        "SELECT rfc.saved_report_id,
                rfc.usecase_id,
                rfc.value_num                                       AS score,
                sr.passed_flag,
                DATE(rfc.report_created_at)                         AS report_created_at
         FROM rolplay_pro_analytics.report_field_current rfc
         JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
         WHERE rfc.customer_id = ?
           AND rfc.report_created_at BETWEEN ? AND ?
           AND rfc.field_key = 'overall_score'$uc
         ORDER BY rfc.report_created_at DESC
         LIMIT ?"
      );
      $stmt->execute($params);
      send(true, $stmt->fetchAll());
    } catch (PDOException $e) {
      error_log('[bridge] results error: ' . $e->getMessage());
      fail('DB query error', 500);
    }
  }

  // ── Usecase breakdown ─────────────────────────────────────────────────────────
  case 'usecase_breakdown': {
    $customerId = parseIntParam('customer_id');
    $from       = parseIsoToMysql('from');
    $to         = parseIsoToMysql('to');
    $usecaseIds = parseUsecaseIds();

    try {
      $params = [$customerId, $from, $to];
      $uc     = usecaseClause($usecaseIds, $params);

      $stmt = $pdo->prepare(
        "SELECT rfc.usecase_id,
                uc.usecase_name,
                COUNT(DISTINCT rfc.saved_report_id)                     AS total_evaluations,
                ROUND(AVG(rfc.value_num), 2)                            AS avg_score,
                SUM(CASE WHEN sr.passed_flag = 1 THEN 1 ELSE 0 END)     AS passed,
                COUNT(DISTINCT rfc.saved_report_id)                     AS total_results
         FROM rolplay_pro_analytics.report_field_current rfc
         JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
         LEFT JOIN coach_app.usecases uc ON uc.id = rfc.usecase_id
         WHERE rfc.customer_id = ?
           AND rfc.report_created_at BETWEEN ? AND ?
           AND rfc.field_key = 'overall_score'$uc
         GROUP BY rfc.usecase_id, uc.usecase_name
         ORDER BY total_evaluations DESC
         LIMIT 30"
      );
      $stmt->execute($params);
      send(true, $stmt->fetchAll());
    } catch (PDOException $e) {
      error_log('[bridge] usecase_breakdown error: ' . $e->getMessage());
      fail('DB query error', 500);
    }
  }

  // ── Drilldown (tenant-scoped) ─────────────────────────────────────────────────
  case 'drilldown': {
    $customerId    = parseIntParam('customer_id');
    $savedReportId = parseIntParam('saved_report_id');

    try {
      // Verify report belongs to this customer
      $check = $pdo->prepare(
        "SELECT MIN(report_created_at) AS report_created_at, usecase_id
         FROM rolplay_pro_analytics.report_field_current
         WHERE saved_report_id = ? AND customer_id = ?
         LIMIT 1"
      );
      $check->execute([$savedReportId, $customerId]);
      $header = $check->fetch();
      if (!$header || !$header['report_created_at']) {
        send(true, null);
      }

      // All fields for this report
      $fields = $pdo->prepare(
        "SELECT field_key, field_label, value_num, value_text, value_longtext
         FROM rolplay_pro_analytics.report_field_current
         WHERE saved_report_id = ? AND customer_id = ?
         ORDER BY id ASC"
      );
      $fields->execute([$savedReportId, $customerId]);

      // Closing JSON
      $payload = $pdo->prepare(
        "SELECT closing_json
         FROM rolplay_pro_analytics.report_payload_current
         WHERE saved_report_id = ?
         LIMIT 1"
      );
      $payload->execute([$savedReportId]);
      $p = $payload->fetch();

      send(true, [
        'saved_report_id'    => $savedReportId,
        'usecase_id'         => $header['usecase_id'] !== null ? (int)$header['usecase_id'] : null,
        'report_created_at'  => $header['report_created_at'],
        'fields'             => $fields->fetchAll(),
        'closing_json'       => $p ? ($p['closing_json'] ?? null) : null,
      ]);
    } catch (PDOException $e) {
      error_log('[bridge] drilldown error: ' . $e->getMessage());
      fail('DB query error', 500);
    }
  }

  default:
    fail('Unknown action', 400);
}

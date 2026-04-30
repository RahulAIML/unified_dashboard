<?php
/**
 * rolplay-bridge.php — Safe Analytics Bridge (multi-tenant)
 *
 * Deploy as:
 *   https://rolplay.pro/src/rolplay-bridge.php
 *
 * This file is intentionally self-contained for straightforward deployment.
 */

declare(strict_types=1);

// ── Configuration ─────────────────────────────────────────────────────────────
$bridgeSecret = getenv('BRIDGE_SECRET');
if ($bridgeSecret === false || trim($bridgeSecret) === '') {
  http_response_code(500);
  echo json_encode(
    ['success' => false, 'data' => null, 'error' => 'BRIDGE_SECRET is not configured.'],
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
  );
  exit;
}
define('BRIDGE_SECRET', $bridgeSecret);
define('DB_HOST',       getenv('DB_HOST') ?: 'localhost');
define('DB_USER',       getenv('DB_USER') ?: 'root');
define('DB_PASS',       getenv('DB_PASS') ?: '');
define('DB_NAME',       getenv('DB_NAME') ?: 'rolplay_pro_analytics');
define('DB_CHARSET',    'utf8mb4');
define('DB_PORT',       (int)(getenv('DB_PORT') ?: 3306));

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

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Bridge-Key');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
  fail('Method not allowed', 405);
}

$apiKey = $_SERVER['HTTP_X_BRIDGE_KEY'] ?? '';
if ($apiKey === '' || $apiKey !== BRIDGE_SECRET) {
  fail('Unauthorized', 401);
}

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
  error_log('[rolplay-bridge] DB connect failed: ' . $e->getMessage());
  fail('Database unavailable', 503);
}

function requireParam(string $key): string {
  $v = $_GET[$key] ?? '';
  if (!is_string($v) || trim($v) === '') fail("Missing parameter: $key", 400);
  return trim($v);
}

function parseIntParam(string $key): int {
  $raw = requireParam($key);
  if (!preg_match('/^\d+$/', $raw)) fail("Invalid integer parameter: $key", 400);
  $n = (int)$raw;
  if ($n <= 0) fail("Invalid integer parameter: $key", 400);
  return $n;
}

function parseIsoToMysql(string $key): string {
  $raw = requireParam($key);
  try {
    $dt = new DateTimeImmutable($raw);
    return $dt->format('Y-m-d H:i:s');
  } catch (Exception $e) {
    fail("Invalid datetime parameter: $key", 400);
  }
}

function priorPeriod(string $fromMysql, string $toMysql): array {
  $from = new DateTimeImmutable($fromMysql);
  $to = new DateTimeImmutable($toMysql);
  $span = $to->getTimestamp() - $from->getTimestamp();
  if ($span < 0) $span = 0;
  $prevTo = $from->modify('-1 second');
  $prevFrom = $prevTo->modify("-{$span} seconds");
  return [$prevFrom->format('Y-m-d H:i:s'), $prevTo->format('Y-m-d H:i:s')];
}

function parseUsecaseIds(): array {
  $raw = $_GET['usecase_ids'] ?? '';
  if (!is_string($raw) || trim($raw) === '') return [];
  $parts = explode(',', $raw);
  $out = [];
  foreach ($parts as $p) {
    $p = trim($p);
    if ($p === '') continue;
    if (!preg_match('/^\d+$/', $p)) continue;
    $n = (int)$p;
    if ($n > 0) $out[] = $n;
  }
  $out = array_values(array_unique($out));
  if (count($out) > 50) $out = array_slice($out, 0, 50);
  return $out;
}

function usecaseClause(array $usecaseIds, array &$params): string {
  if (count($usecaseIds) === 0) return '';
  $placeholders = implode(',', array_fill(0, count($usecaseIds), '?'));
  foreach ($usecaseIds as $id) $params[] = $id;
  return " AND sr.usecase_id IN ($placeholders)";
}

$SCORE_KEYS  = ["overall_score", "final_score"];
$RESULT_KEYS = ["overall_result", "status"];

function inClause(array $values): string {
  $quoted = array_map(function($v) { return "'" . str_replace("'", "''", $v) . "'"; }, $values);
  return implode(',', $quoted);
}

$action = $_GET['action'] ?? '';
if (!is_string($action) || $action === '') fail('Missing action', 400);

switch ($action) {
  case 'test': {
    try {
      $row = $pdo->query("SELECT VERSION() AS v, DATABASE() AS d")->fetch();
      send(true, [
        'message'      => 'bridge working',
        'server_time'  => date('Y-m-d H:i:s'),
        'db_version'   => $row['v'] ?? null,
        'db_name'      => $row['d'] ?? null,
        'mode'         => 'SAFE_ACTIONS_ONLY',
      ]);
    } catch (PDOException $e) {
      error_log('[rolplay-bridge] test failed: ' . $e->getMessage());
      fail('DB query error', 500);
    }
  }

  case 'setup_coach_users_view': {
    try {
      $sql = "CREATE OR REPLACE VIEW coach_users AS
              SELECT email AS user_email, customer_id
              FROM rolplay_pro.site_users";
      $pdo->exec($sql);
      send(true, ['view' => 'rolplay_pro_analytics.coach_users', 'status' => 'ready']);
    } catch (PDOException $e) {
      error_log('[rolplay-bridge] setup_coach_users_view failed: ' . $e->getMessage());
      fail('Failed to create view', 500);
    }
  }

  case 'resolve_customer_id': {
    $email = strtolower(requireParam('email'));
    try {
      $stmt = $pdo->prepare("SELECT customer_id FROM coach_users WHERE user_email = ? LIMIT 1");
      $stmt->execute([$email]);
      $row = $stmt->fetch();
      send(true, ['customer_id' => $row ? (int)$row['customer_id'] : null]);
    } catch (PDOException $e) {
      error_log('[rolplay-bridge] resolve_customer_id failed: ' . $e->getMessage());
      fail('DB query error', 500);
    }
  }

  case 'overview_kpis': {
    $customerId = parseIntParam('customer_id');
    $from = parseIsoToMysql('from');
    $to = parseIsoToMysql('to');
    $usecaseIds = parseUsecaseIds();

    $scoreIn = inClause($SCORE_KEYS);
    $resultIn = inClause($RESULT_KEYS);

    $fetchPeriod = function(string $pFrom, string $pTo) use ($pdo, $customerId, $usecaseIds, $scoreIn, $resultIn) {
      $params = [$customerId, $pFrom, $pTo];
      $uc = usecaseClause($usecaseIds, $params);

      $baseJoin =
        " FROM rolplay_pro_analytics.report_field_current rfc
           JOIN rolplay_pro.saved_reports sr ON sr.id = rfc.saved_report_id
           JOIN rolplay_pro.usecases u ON u.id = sr.usecase_id
          WHERE u.customer_id = ?
            AND rfc.report_created_at BETWEEN ? AND ?$uc";

      $total = $pdo->prepare("SELECT COUNT(DISTINCT rfc.saved_report_id) AS total_sessions $baseJoin");
      $total->execute($params);
      $totalRow = $total->fetch();

      $score = $pdo->prepare("SELECT ROUND(AVG(rfc.value_num), 2) AS avg_score $baseJoin AND rfc.field_key IN ($scoreIn)");
      $score->execute($params);
      $scoreRow = $score->fetch();

      $pf = $pdo->prepare(
        "SELECT SUM(CASE WHEN TRIM(rfc.value_text) != 'Deficiente' THEN 1 ELSE 0 END) AS passed,
                COUNT(*) AS total_results
         $baseJoin AND rfc.field_key IN ($resultIn)"
      );
      $pf->execute($params);
      $pfRow = $pf->fetch();

      return [
        'total_sessions' => (int)($totalRow['total_sessions'] ?? 0),
        'avg_score' => $scoreRow && $scoreRow['avg_score'] !== null ? (float)$scoreRow['avg_score'] : null,
        'passed' => (int)($pfRow['passed'] ?? 0),
        'total_results' => (int)($pfRow['total_results'] ?? 0),
      ];
    };

    try {
      [$pFrom, $pTo] = priorPeriod($from, $to);
      $current = $fetchPeriod($from, $to);
      $prev = $fetchPeriod($pFrom, $pTo);
      send(true, ['current' => $current, 'prev' => $prev]);
    } catch (PDOException $e) {
      error_log('[rolplay-bridge] overview_kpis failed: ' . $e->getMessage());
      fail('DB query error', 500);
    }
  }

  case 'trends': {
    $customerId = parseIntParam('customer_id');
    $from = parseIsoToMysql('from');
    $to = parseIsoToMysql('to');
    $usecaseIds = parseUsecaseIds();

    $scoreIn = inClause($SCORE_KEYS);
    $resultIn = inClause($RESULT_KEYS);

    try {
      $params = [$customerId, $from, $to];
      $uc = usecaseClause($usecaseIds, $params);

      $baseJoin =
        " FROM rolplay_pro_analytics.report_field_current rfc
           JOIN rolplay_pro.saved_reports sr ON sr.id = rfc.saved_report_id
           JOIN rolplay_pro.usecases u ON u.id = sr.usecase_id
          WHERE u.customer_id = ?
            AND rfc.report_created_at BETWEEN ? AND ?$uc";

      $q1 = $pdo->prepare(
        "SELECT DATE(rfc.report_created_at) AS date,
                ROUND(AVG(rfc.value_num), 1) AS avg_score
         $baseJoin AND rfc.field_key IN ($scoreIn)
         GROUP BY DATE(rfc.report_created_at)
         ORDER BY date ASC
         LIMIT 90"
      );
      $q1->execute($params);
      $scoreTrend = $q1->fetchAll();

      $q2 = $pdo->prepare(
        "SELECT DATE(rfc.report_created_at) AS date,
                SUM(CASE WHEN TRIM(rfc.value_text) != 'Deficiente' THEN 1 ELSE 0 END) AS passed,
                SUM(CASE WHEN TRIM(rfc.value_text)  = 'Deficiente' THEN 1 ELSE 0 END) AS failed
         $baseJoin AND rfc.field_key IN ($resultIn)
         GROUP BY DATE(rfc.report_created_at)
         ORDER BY date ASC
         LIMIT 90"
      );
      $q2->execute($params);
      $passFail = $q2->fetchAll();

      $q3 = $pdo->prepare(
        "SELECT DATE(rfc.report_created_at) AS date,
                COUNT(DISTINCT rfc.saved_report_id) AS sessions
         $baseJoin
         GROUP BY DATE(rfc.report_created_at)
         ORDER BY date ASC
         LIMIT 90"
      );
      $q3->execute($params);
      $evalCount = $q3->fetchAll();

      send(true, [
        'score_trend' => $scoreTrend,
        'pass_fail' => $passFail,
        'eval_count' => $evalCount,
      ]);
    } catch (PDOException $e) {
      error_log('[rolplay-bridge] trends failed: ' . $e->getMessage());
      fail('DB query error', 500);
    }
  }

  case 'results': {
    $customerId = parseIntParam('customer_id');
    $from = parseIsoToMysql('from');
    $to = parseIsoToMysql('to');
    $usecaseIds = parseUsecaseIds();
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 50;
    if ($limit <= 0) $limit = 50;
    if ($limit > 200) $limit = 200;

    $scoreIn = inClause($SCORE_KEYS);
    $resultIn = inClause($RESULT_KEYS);

    try {
      $params = [$customerId, $from, $to];
      $uc = usecaseClause($usecaseIds, $params);

      $sql =
        "SELECT base.saved_report_id,
                base.usecase_id,
                sc.value_num AS score,
                r.value_text AS result,
                DATE(base.report_created_at) AS report_created_at
         FROM (
           SELECT DISTINCT rfc.saved_report_id, sr.usecase_id, rfc.report_created_at
           FROM rolplay_pro_analytics.report_field_current rfc
           JOIN rolplay_pro.saved_reports sr ON sr.id = rfc.saved_report_id
           JOIN rolplay_pro.usecases u ON u.id = sr.usecase_id
           WHERE u.customer_id = ?
             AND rfc.report_created_at BETWEEN ? AND ?$uc
         ) base
         LEFT JOIN rolplay_pro_analytics.report_field_current sc
                ON sc.saved_report_id = base.saved_report_id
               AND sc.field_key IN ($scoreIn)
         LEFT JOIN rolplay_pro_analytics.report_field_current r
                ON r.saved_report_id  = base.saved_report_id
               AND r.field_key IN ($resultIn)
         ORDER BY base.report_created_at DESC
         LIMIT ?";

      $params2 = array_merge($params, [$limit]);
      $stmt = $pdo->prepare($sql);
      $stmt->execute($params2);
      send(true, $stmt->fetchAll());
    } catch (PDOException $e) {
      error_log('[rolplay-bridge] results failed: ' . $e->getMessage());
      fail('DB query error', 500);
    }
  }

  case 'usecase_breakdown': {
    $customerId = parseIntParam('customer_id');
    $from = parseIsoToMysql('from');
    $to = parseIsoToMysql('to');
    $usecaseIds = parseUsecaseIds();

    $scoreIn = inClause($SCORE_KEYS);
    $resultIn = inClause($RESULT_KEYS);

    try {
      $params = [$customerId, $from, $to];
      $uc = usecaseClause($usecaseIds, $params);

      $sql =
        "SELECT base.usecase_id,
                COUNT(DISTINCT base.saved_report_id) AS total_evaluations,
                ROUND(AVG(sc.value_num), 2) AS avg_score,
                SUM(CASE WHEN TRIM(r.value_text) != 'Deficiente' THEN 1 ELSE 0 END) AS passed,
                COUNT(r.value_text) AS total_results
         FROM (
           SELECT DISTINCT rfc.saved_report_id, sr.usecase_id
           FROM rolplay_pro_analytics.report_field_current rfc
           JOIN rolplay_pro.saved_reports sr ON sr.id = rfc.saved_report_id
           JOIN rolplay_pro.usecases u ON u.id = sr.usecase_id
           WHERE u.customer_id = ?
             AND rfc.report_created_at BETWEEN ? AND ?$uc
         ) base
         LEFT JOIN rolplay_pro_analytics.report_field_current sc
                ON sc.saved_report_id = base.saved_report_id
               AND sc.field_key IN ($scoreIn)
         LEFT JOIN rolplay_pro_analytics.report_field_current r
                ON r.saved_report_id  = base.saved_report_id
               AND r.field_key IN ($resultIn)
         GROUP BY base.usecase_id
         ORDER BY total_evaluations DESC
         LIMIT 20";

      $stmt = $pdo->prepare($sql);
      $stmt->execute($params);
      send(true, $stmt->fetchAll());
    } catch (PDOException $e) {
      error_log('[rolplay-bridge] usecase_breakdown failed: ' . $e->getMessage());
      fail('DB query error', 500);
    }
  }

  case 'drilldown': {
    $customerId = parseIntParam('customer_id');
    $savedReportId = parseIntParam('saved_report_id');

    try {
      $stmtH = $pdo->prepare(
        "SELECT sr.id AS saved_report_id,
                sr.usecase_id AS usecase_id,
                MIN(rfc.report_created_at) AS report_created_at
         FROM rolplay_pro_analytics.report_field_current rfc
         JOIN rolplay_pro.saved_reports sr ON sr.id = rfc.saved_report_id
         JOIN rolplay_pro.usecases u ON u.id = sr.usecase_id
         WHERE u.customer_id = ?
           AND rfc.saved_report_id = ?
         GROUP BY sr.id, sr.usecase_id
         LIMIT 1"
      );
      $stmtH->execute([$customerId, $savedReportId]);
      $header = $stmtH->fetch();
      if (!$header) {
        send(true, null);
      }

      $stmtF = $pdo->prepare(
        "SELECT rfc.field_key, rfc.field_label, rfc.value_num, rfc.value_text, rfc.value_longtext
         FROM rolplay_pro_analytics.report_field_current rfc
         JOIN rolplay_pro.saved_reports sr ON sr.id = rfc.saved_report_id
         JOIN rolplay_pro.usecases u ON u.id = sr.usecase_id
         WHERE u.customer_id = ?
           AND rfc.saved_report_id = ?
         ORDER BY rfc.id ASC"
      );
      $stmtF->execute([$customerId, $savedReportId]);
      $fields = $stmtF->fetchAll();

      $stmtP = $pdo->prepare(
        "SELECT rpc.closing_json
         FROM rolplay_pro_analytics.report_payload_current rpc
         JOIN rolplay_pro.saved_reports sr ON sr.id = rpc.saved_report_id
         JOIN rolplay_pro.usecases u ON u.id = sr.usecase_id
         WHERE u.customer_id = ?
           AND rpc.saved_report_id = ?
         LIMIT 1"
      );
      $stmtP->execute([$customerId, $savedReportId]);
      $payload = $stmtP->fetch();

      send(true, [
        'saved_report_id' => (int)$header['saved_report_id'],
        'usecase_id' => $header['usecase_id'] !== null ? (int)$header['usecase_id'] : null,
        'report_created_at' => $header['report_created_at'],
        'fields' => $fields,
        'closing_json' => $payload ? ($payload['closing_json'] ?? null) : null,
      ]);
    } catch (PDOException $e) {
      error_log('[rolplay-bridge] drilldown failed: ' . $e->getMessage());
      fail('DB query error', 500);
    }
  }

  default:
    fail('Unknown action', 400);
}

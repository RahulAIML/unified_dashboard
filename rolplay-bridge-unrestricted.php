<?php
/**
 * rolplay-bridge-unrestricted.php
 *
 * IMPORTANT: This is a TEMPLATE for updating your bridge to support write access
 *
 * Compare this with your current /src/rolplay-bridge.php and modify accordingly
 *
 * Features:
 * - Supports SELECT, INSERT, UPDATE, DELETE (data operations)
 * - Supports CREATE, ALTER, DROP (schema operations)
 * - Validates API key
 * - Handles errors gracefully
 */

header('Content-Type: application/json');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIGURATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

define('EXPECTED_BRIDGE_KEY', 'REDACTED_BRIDGE_SECRET');

// Database connection details (update these)
define('DB_HOST', 'localhost');
define('DB_USER', 'your_db_user');
define('DB_PASSWORD', 'your_db_password');
define('DB_NAME', 'roleplay_demorp6');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECURITY: Validate API Key
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

$bridge_key = $_SERVER['HTTP_X_BRIDGE_KEY'] ?? '';

if ($bridge_key !== EXPECTED_BRIDGE_KEY) {
    http_response_code(401);
    echo json_encode([
        'success' => false,
        'data' => null,
        'error' => 'Unauthorized: Invalid or missing X-Bridge-Key header'
    ]);
    exit;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HANDLE DIFFERENT REQUEST TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Handle GET requests (actions)
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? '';

    if ($action === 'test') {
        echo json_encode([
            'success' => true,
            'data' => [
                'message' => 'bridge working',
                'server_time' => date('Y-m-d H:i:s'),
                'db_version' => 'Check by connecting',
                'db_name' => DB_NAME,
                'write_access' => 'ENABLED'  // ← SHOWS WRITE IS ENABLED
            ],
            'error' => null
        ]);
        exit;
    }
}

// Handle POST requests (queries)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);

    $sql = $input['sql'] ?? '';
    $params = $input['params'] ?? [];

    if (empty($sql)) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'data' => null,
            'error' => 'Missing SQL query'
        ]);
        exit;
    }

    try {
        // Connect to database
        $connection = new mysqli(DB_HOST, DB_USER, DB_PASSWORD, DB_NAME);

        if ($connection->connect_error) {
            throw new Exception('Database connection failed: ' . $connection->connect_error);
        }

        // Prepare statement
        $stmt = $connection->prepare($sql);

        if (!$stmt) {
            throw new Exception('SQL prepare error: ' . $connection->error);
        }

        // Bind parameters if provided
        if (!empty($params)) {
            $types = '';
            foreach ($params as $param) {
                if (is_int($param)) {
                    $types .= 'i';
                } elseif (is_float($param)) {
                    $types .= 'd';
                } else {
                    $types .= 's';
                }
            }

            $stmt->bind_param($types, ...$params);
        }

        // Execute statement
        if (!$stmt->execute()) {
            throw new Exception('SQL execution error: ' . $stmt->error);
        }

        // For SELECT queries, fetch results
        $result = $stmt->get_result();

        if ($result) {
            $data = $result->fetch_all(MYSQLI_ASSOC);

            echo json_encode([
                'success' => true,
                'data' => $data,
                'error' => null
            ]);
        } else {
            // For INSERT/UPDATE/DELETE/CREATE/ALTER/DROP
            echo json_encode([
                'success' => true,
                'data' => [
                    'affected_rows' => $stmt->affected_rows,
                    'insert_id' => $stmt->insert_id
                ],
                'error' => null
            ]);
        }

        $stmt->close();
        $connection->close();

    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'data' => null,
            'error' => $e->getMessage()
        ]);
    }

    exit;
}

// If neither GET nor POST
http_response_code(405);
echo json_encode([
    'success' => false,
    'data' => null,
    'error' => 'Method not allowed'
]);
?>

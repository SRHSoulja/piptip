<?php
/**
 * Alchemy webhook receiver (Address Activity or Custom Logs).
 * - Verifies X-Alchemy-Signature (HMAC-SHA256 over raw body)
 * - Normalizes events
 * - Forwards to Node /internal/credit (Node enforces token allowlist + min)
 */

// Load environment variables from .env file
function loadEnv($filePath) {
    if (!file_exists($filePath)) {
        return;
    }
    
    $lines = file($filePath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos(trim($line), '#') === 0) {
            continue; // Skip comments
        }
        
        list($name, $value) = explode('=', $line, 2);
        $name = trim($name);
        $value = trim($value);
        
        // Remove quotes if present
        if (preg_match('/^(["\'])(.*)\\1$/', $value, $matches)) {
            $value = $matches[2];
        }
        
        if (!array_key_exists($name, $_ENV)) {
            $_ENV[$name] = $value;
        }
    }
}

// Load .env file from same directory as this script
loadEnv(__DIR__ . '/.env');

// Environment variables with fallbacks
// Strictly require environment variables - fail if not set
$ALCHEMY_SIGNING_KEY = $_ENV['ALCHEMY_SIGNING_KEY'] ?? die('ERROR: ALCHEMY_SIGNING_KEY environment variable is required');
$TREASURY            = $_ENV['TREASURY_AGW_ADDRESS'] ?? die('ERROR: TREASURY_AGW_ADDRESS environment variable is required');
$NODE_INTERNAL_CREDIT_URL = $_ENV['NODE_INTERNAL_CREDIT_URL'] ?? die('ERROR: NODE_INTERNAL_CREDIT_URL environment variable is required');
$NODE_INTERNAL_BEARER     = $_ENV['INTERNAL_BEARER'] ?? die('ERROR: INTERNAL_BEARER environment variable is required');
$DEBUG = filter_var($_ENV['WEBHOOK_DEBUG'] ?? 'false', FILTER_VALIDATE_BOOLEAN);
$LOG_FILE = __DIR__ . '/alchemy_deposits.log';

function log_line($f,$m){ @file_put_contents($f,'['.date('c')."] $m\n",FILE_APPEND); }

/** hex -> decimal string (fallbacks baked in) */
function hexToDecStr($hex) {
  $hex = strtolower($hex ?? '0x0');
  if (strpos($hex,'0x')===0) $hex = substr($hex,2);
  if ($hex==='') return '0';
  if (function_exists('gmp_init')) return gmp_strval(gmp_init($hex,16),10);
  // BCMath fallback
  $hex = ltrim($hex,'0'); if ($hex==='') return '0';
  $dec = '0';
  for ($i=0,$n=strlen($hex); $i<$n; $i++) {
    $digit = strpos('0123456789abcdef',$hex[$i]);
    $dec = bcmul($dec,'16',0);
    $dec = bcadd($dec,(string)$digit,0);
  }
  return $dec;
}

/** Forward to Node with retry logic */
function forwardToNode($data, $maxRetries = 3) {
  global $NODE_INTERNAL_CREDIT_URL, $NODE_INTERNAL_BEARER, $LOG_FILE, $DEBUG;
  
  $post = json_encode($data);
  $opts = [
    'http' => [
      'method'  => 'POST',
      'header'  => "Content-Type: application/json\r\nAuthorization: Bearer {$NODE_INTERNAL_BEARER}\r\n",
      'content' => $post,
      'timeout' => 10,
      'ignore_errors' => true, // Get response even on HTTP errors
    ]
  ];
  
  for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
    $context = stream_context_create($opts);
    $resp = @file_get_contents($NODE_INTERNAL_CREDIT_URL, false, $context);
    
    if ($resp !== false) {
      $result = json_decode($resp, true);
      
      if ($DEBUG) {
        log_line($LOG_FILE, "attempt_{$attempt}_resp: " . substr($resp, 0, 200));
      }
      
      // Check if Node.js responded successfully
      if ($result && isset($result['ok']) && $result['ok']) {
        if ($DEBUG) {
          $status = $result['credited'] ? 'credited' : ($result['duplicate'] ? 'duplicate' : 'skipped');
          log_line($LOG_FILE, "forward_success: {$status} for tx {$data['tx']}");
        }
        return $result;
      }
      
      // Node responded but with error
      if ($result && isset($result['error'])) {
        log_line($LOG_FILE, "node_error_attempt_{$attempt}: " . $result['error']);
        // Don't retry on validation errors (400-level)
        if (strpos($resp, '"error"') !== false && strpos($resp, 'missing fields') !== false) {
          break;
        }
      }
    } else {
      // Network/connection error
      $error = error_get_last();
      log_line($LOG_FILE, "network_error_attempt_{$attempt}: " . ($error['message'] ?? 'unknown'));
    }
    
    // Wait before retry (exponential backoff)
    if ($attempt < $maxRetries) {
      $delay = min(pow(2, $attempt), 8); // Max 8 seconds
      sleep($delay);
    }
  }
  
  log_line($LOG_FILE, "forward_failed_all_attempts: tx {$data['tx']}");
  return false;
}

/** Simple rate limiting */
function checkRateLimit() {
  global $LOG_FILE;
  
  $rate_file = __DIR__ . '/webhook_rate.txt';
  $now = time();
  $requests = [];
  
  if (file_exists($rate_file)) {
    $rate_data = @file_get_contents($rate_file);
    $requests = $rate_data ? json_decode($rate_data, true) : [];
  }
  
  // Clean old entries (last 60 seconds)
  $requests = array_filter($requests, function($time) use ($now) {
    return ($now - $time) <= 60;
  });
  
  // Check rate (max 200 requests per minute)
  if (count($requests) >= 200) {
    log_line($LOG_FILE, "rate_limit_exceeded: " . count($requests) . " requests");
    http_response_code(429);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'rate limit exceeded']);
    exit;
  }
  
  $requests[] = $now;
  @file_put_contents($rate_file, json_encode($requests));
}

@touch($LOG_FILE);

// Basic rate limiting
checkRateLimit();

// --- Read raw and verify signature ---
$raw = file_get_contents('php://input') ?? '';
$sent = $_SERVER['HTTP_X_ALCHEMY_SIGNATURE'] ?? '';
$calc = hash_hmac('sha256',$raw,$ALCHEMY_SIGNING_KEY);

if ($DEBUG) {
  log_line($LOG_FILE,"---- webhook hit ---- IP={$_SERVER['REMOTE_ADDR']}");
  log_line($LOG_FILE,"sig_sent=$sent");
  log_line($LOG_FILE,"sig_calc=$calc");
}

if (!hash_equals($calc,$sent)) {
  if ($DEBUG) log_line($LOG_FILE,"signature mismatch -> 401");
  http_response_code(401);
  header('Content-Type: application/json');
  echo json_encode(['ok'=>false,'error'=>'bad signature']);
  exit;
}

// --- Parse JSON ---
$payload = json_decode($raw,true);
if (!$payload) {
  if ($DEBUG) log_line($LOG_FILE,"bad json -> 400");
  http_response_code(400);
  header('Content-Type: application/json');
  echo json_encode(['ok'=>false,'error'=>'bad json']);
  exit;
}

$treasury = strtolower($TREASURY);

// Multi shapes: Address Activity (event.activity) or Custom (logs)
$items = [];
if (isset($payload['event']['activity']) && is_array($payload['event']['activity'])) {
  $items = $payload['event']['activity'];
} elseif (isset($payload['data']['activity']) && is_array($payload['data']['activity'])) {
  $items = $payload['data']['activity'];
} elseif (isset($payload['logs']) && is_array($payload['logs'])) {
  $items = $payload['logs'];
}

$forwarded = 0;
$failed = 0;

foreach ($items as $it) {
  // Normalize common fields
  $to     = strtolower($it['toAddress']    ?? $it['to']    ?? '');
  $from   = strtolower($it['fromAddress']  ?? $it['from']  ?? '');
  $token  = strtolower($it['contractAddress'] ?? ($it['rawContract']['address'] ?? ''));
  $tx     = $it['hash'] ?? ($it['transactionHash'] ?? ($it['transaction']['hash'] ?? ''));

  // Defensive value parsing
  $rawVal = '';
  if (isset($it['rawContract']['rawValue'])) {
    $rawVal = $it['rawContract']['rawValue'];
  } elseif (isset($it['rawContract']['value'])) {
    $rawVal = $it['rawContract']['value'];
  } elseif (isset($it['value'])) {
    $rawVal = $it['value'];
  }

  // Validate required fields
  if (!$to || !$token || !$tx || !$rawVal) {
    if ($DEBUG) {
      log_line($LOG_FILE, "missing_fields: to=$to, token=$token, tx=$tx, value=$rawVal");
    }
    continue;
  }
  
  if ($to !== $treasury) {
    if ($DEBUG) {
      log_line($LOG_FILE, "not_treasury: $to != $treasury");
    }
    continue; // only deposits to our treasury
  }

  // Convert value to decimal string
  $valueAtomic = (is_string($rawVal) && strpos($rawVal,'0x')===0)
    ? hexToDecStr($rawVal)
    : (string)$rawVal;

  // Validate amount is positive
  if ($valueAtomic === '0' || $valueAtomic === '') {
    if ($DEBUG) {
      log_line($LOG_FILE, "zero_amount: tx=$tx");
    }
    continue;
  }

  // Forward to Node with retry logic
  if (!empty($NODE_INTERNAL_CREDIT_URL) && !empty($NODE_INTERNAL_BEARER)) {
    $forwardData = [
      'from'        => $from,
      'to'          => $to,
      'token'       => $token,
      'valueAtomic' => $valueAtomic,
      'tx'          => $tx,
    ];
    
    if (forwardToNode($forwardData)) {
      $forwarded++;
    } else {
      $failed++;
    }
  }
}

if ($DEBUG) {
  log_line($LOG_FILE, "batch_complete: forwarded=$forwarded, failed=$failed");
}

http_response_code(200);
header('Content-Type: application/json');
echo json_encode([
  'ok' => true, 
  'forwarded' => $forwarded,
  'failed' => $failed
]);
?>

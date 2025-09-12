// src/services/log_scrubber.ts - Secret scrubbing for logs

const SENSITIVE_PATTERNS = [
  // Discord tokens
  /[A-Za-z0-9]{70,}/g,
  /MTQ[A-Za-z0-9._-]{56,}/g,
  
  // Database URLs
  /postgresql:\/\/[^@]+:[^@]+@[^\/]+\/[^\s"']+/gi,
  /postgres:\/\/[^@]+:[^@]+@[^\/]+\/[^\s"']+/gi,
  
  // Private keys
  /0x[a-fA-F0-9]{64}/g,
  /[a-fA-F0-9]{64}/g,
  
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi,
  
  // Webhook URLs
  /https:\/\/discord\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/gi,
  /discordapp\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/gi,
];

const REPLACEMENT_TEXT = '[REDACTED]';

/**
 * Scrub sensitive information from log messages
 */
export function scrubSecrets(message: string): string {
  let scrubbed = message;
  
  for (const pattern of SENSITIVE_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, REPLACEMENT_TEXT);
  }
  
  return scrubbed;
}

/**
 * Scrub sensitive information from objects (for structured logging)
 */
export function scrubSecretsFromObject(obj: any): any {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  
  const scrubbed: any = Array.isArray(obj) ? [] : {};
  
  for (const [key, value] of Object.entries(obj)) {
    // Scrub sensitive keys
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('token') || 
        lowerKey.includes('secret') || 
        lowerKey.includes('key') ||
        lowerKey.includes('password') ||
        lowerKey.includes('webhook') ||
        lowerKey === 'authorization') {
      scrubbed[key] = REPLACEMENT_TEXT;
    } else if (typeof value === 'string') {
      scrubbed[key] = scrubSecrets(value);
    } else if (typeof value === 'object' && value !== null) {
      scrubbed[key] = scrubSecretsFromObject(value);
    } else {
      scrubbed[key] = value;
    }
  }
  
  return scrubbed;
}

/**
 * Safe console.log with secret scrubbing
 */
export function secureLog(message: string, ...args: any[]) {
  const scrubbed = scrubSecrets(message);
  const scrubbed_args = args.map(arg => 
    typeof arg === 'string' ? scrubSecrets(arg) : scrubSecretsFromObject(arg)
  );
  
  console.log(scrubbed, ...scrubbed_args);
}

/**
 * Safe console.error with secret scrubbing
 */
export function secureError(message: string, ...args: any[]) {
  const scrubbed = scrubSecrets(message);
  const scrubbed_args = args.map(arg => 
    typeof arg === 'string' ? scrubSecrets(arg) : scrubSecretsFromObject(arg)
  );
  
  console.error(scrubbed, ...scrubbed_args);
}

/**
 * Safe console.warn with secret scrubbing
 */
export function secureWarn(message: string, ...args: any[]) {
  const scrubbed = scrubSecrets(message);
  const scrubbed_args = args.map(arg => 
    typeof arg === 'string' ? scrubSecrets(arg) : scrubSecretsFromObject(arg)
  );
  
  console.warn(scrubbed, ...scrubbed_args);
}
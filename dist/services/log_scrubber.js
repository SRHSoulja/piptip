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
  /discordapp\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/gi
];
const REPLACEMENT_TEXT = "[REDACTED]";
function scrubSecrets(message) {
  let scrubbed = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, REPLACEMENT_TEXT);
  }
  return scrubbed;
}
function scrubSecretsFromObject(obj) {
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }
  const scrubbed = Array.isArray(obj) ? [] : {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes("token") || lowerKey.includes("secret") || lowerKey.includes("key") || lowerKey.includes("password") || lowerKey.includes("webhook") || lowerKey === "authorization") {
      scrubbed[key] = REPLACEMENT_TEXT;
    } else if (typeof value === "string") {
      scrubbed[key] = scrubSecrets(value);
    } else if (typeof value === "object" && value !== null) {
      scrubbed[key] = scrubSecretsFromObject(value);
    } else {
      scrubbed[key] = value;
    }
  }
  return scrubbed;
}
function secureLog(message, ...args) {
  const scrubbed = scrubSecrets(message);
  const scrubbed_args = args.map(
    (arg) => typeof arg === "string" ? scrubSecrets(arg) : scrubSecretsFromObject(arg)
  );
  console.log(scrubbed, ...scrubbed_args);
}
function secureError(message, ...args) {
  const scrubbed = scrubSecrets(message);
  const scrubbed_args = args.map(
    (arg) => typeof arg === "string" ? scrubSecrets(arg) : scrubSecretsFromObject(arg)
  );
  console.error(scrubbed, ...scrubbed_args);
}
function secureWarn(message, ...args) {
  const scrubbed = scrubSecrets(message);
  const scrubbed_args = args.map(
    (arg) => typeof arg === "string" ? scrubSecrets(arg) : scrubSecretsFromObject(arg)
  );
  console.warn(scrubbed, ...scrubbed_args);
}
export {
  scrubSecrets,
  scrubSecretsFromObject,
  secureError,
  secureLog,
  secureWarn
};
//# sourceMappingURL=log_scrubber.js.map

import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";
class SecureKeyManager {
  encryptedKey = null;
  keyDerivation = null;
  lastAccessed = 0;
  accessCount = 0;
  maxMemoryTime = 5 * 60 * 1e3;
  // 5 minutes
  maxAccessCount = 1e3;
  // Prevent excessive access
  constructor() {
    this.initializeKey();
    setInterval(() => {
      this.clearStaleMemory();
    }, 6e4);
  }
  initializeKey() {
    const rawKey = process.env.AGW_SESSION_PRIVATE_KEY;
    if (!rawKey) {
      throw new Error("SECURITY: AGW_SESSION_PRIVATE_KEY not found in environment");
    }
    if (rawKey.length < 32 || !/^[0-9a-fA-F]+$/.test(rawKey.replace("0x", ""))) {
      throw new Error("SECURITY: Invalid private key format detected");
    }
    const systemSalt = (process.env.NODE_ENV || "development") + process.pid + Math.random();
    this.keyDerivation = createHash("sha256").update(systemSalt).update(Buffer.from(rawKey.slice(0, 8))).digest();
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", this.keyDerivation, iv);
    let encrypted = cipher.update(rawKey, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();
    this.encryptedKey = iv.toString("hex") + ":" + authTag.toString("hex") + ":" + encrypted;
    console.log("\u{1F510} Treasury private key encrypted and loaded securely");
  }
  getPrivateKey() {
    if (!this.encryptedKey || !this.keyDerivation) {
      throw new Error("SECURITY: Private key not initialized");
    }
    this.accessCount++;
    if (this.accessCount > this.maxAccessCount) {
      throw new Error("SECURITY: Private key access limit exceeded - possible attack");
    }
    this.lastAccessed = Date.now();
    try {
      const [ivHex, authTagHex, encryptedData] = this.encryptedKey.split(":");
      if (!ivHex || !authTagHex || !encryptedData) {
        throw new Error("SECURITY: Malformed encrypted key data");
      }
      const iv = Buffer.from(ivHex, "hex");
      const authTag = Buffer.from(authTagHex, "hex");
      const decipher = createDecipheriv("aes-256-gcm", this.keyDerivation, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encryptedData, "hex", "utf8");
      decrypted += decipher.final("utf8");
      if (!decrypted || decrypted.length < 32) {
        throw new Error("SECURITY: Key decryption failed");
      }
      return decrypted;
    } catch (error) {
      console.error("\u{1F6A8} SECURITY: Private key decryption failed:", error);
      throw new Error("SECURITY: Unable to access treasury private key");
    }
  }
  validateKeyIntegrity() {
    try {
      const key = this.getPrivateKey();
      const cleanKey = key.replace("0x", "");
      if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
        return false;
      }
      const testKeyHashes = [
        "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        // hardhat test key
        "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
        // another common test key
      ];
      if (testKeyHashes.includes(cleanKey.toLowerCase())) {
        console.error("\u{1F6A8} SECURITY: Test private key detected in production!");
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }
  rotateKey(newPrivateKey) {
    try {
      if (!newPrivateKey || newPrivateKey.length < 32) {
        return false;
      }
      this.clearMemory();
      process.env.AGW_SESSION_PRIVATE_KEY = newPrivateKey;
      this.initializeKey();
      console.log("\u{1F504} Treasury private key rotated successfully");
      return true;
    } catch (error) {
      console.error("\u{1F6A8} SECURITY: Key rotation failed:", error);
      return false;
    }
  }
  clearMemory() {
    if (this.encryptedKey) {
      this.encryptedKey = randomBytes(this.encryptedKey.length).toString("hex");
      this.encryptedKey = null;
    }
    if (this.keyDerivation) {
      this.keyDerivation.fill(0);
      this.keyDerivation = null;
    }
    this.lastAccessed = 0;
    this.accessCount = 0;
  }
  clearStaleMemory() {
    const now = Date.now();
    if (this.lastAccessed > 0 && now - this.lastAccessed > this.maxMemoryTime) {
      console.log("\u{1F9F9} Clearing stale private key from memory for security");
      this.clearMemory();
    }
  }
  // Get memory usage statistics for monitoring
  getSecurityStats() {
    return {
      isInitialized: !!(this.encryptedKey && this.keyDerivation),
      lastAccessed: this.lastAccessed,
      accessCount: this.accessCount,
      timeSinceAccess: this.lastAccessed > 0 ? Date.now() - this.lastAccessed : -1
    };
  }
}
class SecureCredentialManager {
  credentialCache = /* @__PURE__ */ new Map();
  derivationKey = null;
  maxMemoryTime = 5 * 60 * 1e3;
  // 5 minutes
  maxAccessCount = 1e3;
  constructor() {
    this.initializeDerivationKey();
    setInterval(() => {
      this.cleanupStaleCredentials();
    }, 6e4);
  }
  initializeDerivationKey() {
    const systemSalt = (process.env.NODE_ENV || "development") + process.pid + Math.random();
    this.derivationKey = createHash("sha256").update(systemSalt).update("SECURE_CREDENTIAL_MANAGER").digest();
  }
  encryptCredential(value) {
    if (!this.derivationKey) {
      throw new Error("SECURITY: Credential manager not initialized");
    }
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", this.derivationKey, iv);
    let encrypted = cipher.update(value, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();
    return iv.toString("hex") + ":" + authTag.toString("hex") + ":" + encrypted;
  }
  decryptCredential(encryptedData) {
    if (!this.derivationKey) {
      throw new Error("SECURITY: Credential manager not initialized");
    }
    const [ivHex, authTagHex, encrypted] = encryptedData.split(":");
    if (!ivHex || !authTagHex || !encrypted) {
      throw new Error("SECURITY: Malformed credential data");
    }
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = createDecipheriv("aes-256-gcm", this.derivationKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }
  getSecureCredential(envVarName) {
    const cached = this.credentialCache.get(envVarName);
    if (cached) {
      cached.accessCount++;
      if (cached.accessCount > this.maxAccessCount) {
        throw new Error(`SECURITY: Credential access limit exceeded for ${envVarName}`);
      }
      cached.lastAccessed = Date.now();
      try {
        return this.decryptCredential(cached.encrypted);
      } catch (error) {
        console.error(`\u{1F6A8} SECURITY: Failed to decrypt credential ${envVarName}:`, error);
        throw new Error(`SECURITY: Unable to access credential ${envVarName}`);
      }
    }
    const rawValue = process.env[envVarName];
    if (!rawValue) {
      throw new Error(`SECURITY: Credential ${envVarName} not found in environment`);
    }
    this.validateCredential(envVarName, rawValue);
    const encrypted = this.encryptCredential(rawValue);
    this.credentialCache.set(envVarName, {
      encrypted,
      lastAccessed: Date.now(),
      accessCount: 1
    });
    return rawValue;
  }
  validateCredential(envVarName, value) {
    if (envVarName.includes("SECRET") || envVarName.includes("PASSWORD") || envVarName.includes("TOKEN")) {
      if (value.length < 16) {
        console.warn(`\u26A0\uFE0F SECURITY: ${envVarName} appears weak (less than 16 characters)`);
      }
    }
    if (envVarName === "ADMIN_SECRET" && value.length < 32) {
      console.warn(`\u26A0\uFE0F SECURITY: ADMIN_SECRET should be at least 32 characters for production`);
    }
    if (envVarName.includes("PRIVATE_KEY")) {
      const cleanKey = value.replace("0x", "");
      if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
        throw new Error(`SECURITY: Invalid private key format for ${envVarName}`);
      }
      const testKeys = [
        "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
      ];
      if (testKeys.includes(cleanKey.toLowerCase())) {
        console.error(`\u{1F6A8} SECURITY: Test private key detected for ${envVarName}!`);
      }
    }
  }
  cleanupStaleCredentials() {
    const now = Date.now();
    const staleKeys = [];
    for (const [key, cached] of this.credentialCache.entries()) {
      if (now - cached.lastAccessed > this.maxMemoryTime) {
        staleKeys.push(key);
      }
    }
    if (staleKeys.length > 0) {
      console.log(`\u{1F9F9} Clearing ${staleKeys.length} stale credentials from memory`);
      for (const key of staleKeys) {
        this.credentialCache.delete(key);
      }
    }
  }
  clearAllCredentials() {
    this.credentialCache.clear();
    if (this.derivationKey) {
      this.derivationKey.fill(0);
      this.derivationKey = null;
    }
  }
  getCredentialStats() {
    const stats = {};
    const now = Date.now();
    for (const [key, cached] of this.credentialCache.entries()) {
      stats[key] = {
        lastAccessed: cached.lastAccessed,
        accessCount: cached.accessCount,
        timeSinceAccess: now - cached.lastAccessed
      };
    }
    return stats;
  }
}
const secureKeyManager = new SecureKeyManager();
const secureCredentialManager = new SecureCredentialManager();
function getSecureTreasuryPrivateKey() {
  return secureKeyManager.getPrivateKey();
}
function validateTreasuryKeyIntegrity() {
  return secureKeyManager.validateKeyIntegrity();
}
function rotateTreasuryKey(newPrivateKey) {
  return secureKeyManager.rotateKey(newPrivateKey);
}
function clearTreasuryKeyFromMemory() {
  secureKeyManager.clearMemory();
}
function getTreasuryKeySecurityStats() {
  return secureKeyManager.getSecurityStats();
}
function getSecureCredential(envVarName) {
  return secureCredentialManager.getSecureCredential(envVarName);
}
function clearAllSecureCredentials() {
  secureCredentialManager.clearAllCredentials();
  secureKeyManager.clearMemory();
}
function getAllCredentialStats() {
  return {
    treasuryKey: secureKeyManager.getSecurityStats(),
    credentials: secureCredentialManager.getCredentialStats()
  };
}
function getSecureAdminSecret() {
  return secureCredentialManager.getSecureCredential("ADMIN_SECRET");
}
function getSecureDiscordToken() {
  return secureCredentialManager.getSecureCredential("DISCORD_TOKEN");
}
function getSecureDiscordClientSecret() {
  return secureCredentialManager.getSecureCredential("DISCORD_CLIENT_SECRET");
}
function getSecureTreasuryPrivateKeyAlt() {
  return secureCredentialManager.getSecureCredential("TREASURY_PRIVATE_KEY");
}
process.on("exit", () => {
  secureKeyManager.clearMemory();
  secureCredentialManager.clearAllCredentials();
});
process.on("SIGINT", () => {
  secureKeyManager.clearMemory();
  secureCredentialManager.clearAllCredentials();
  process.exit();
});
process.on("SIGTERM", () => {
  secureKeyManager.clearMemory();
  secureCredentialManager.clearAllCredentials();
  process.exit();
});
export {
  clearAllSecureCredentials,
  clearTreasuryKeyFromMemory,
  getAllCredentialStats,
  getSecureAdminSecret,
  getSecureCredential,
  getSecureDiscordClientSecret,
  getSecureDiscordToken,
  getSecureTreasuryPrivateKey,
  getSecureTreasuryPrivateKeyAlt,
  getTreasuryKeySecurityStats,
  rotateTreasuryKey,
  validateTreasuryKeyIntegrity
};
//# sourceMappingURL=secure_key.js.map

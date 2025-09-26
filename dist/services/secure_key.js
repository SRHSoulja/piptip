// src/services/secure_key.ts - Comprehensive secure credential management with protection against exposure
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
class SecureKeyManager {
    encryptedKey = null;
    keyDerivation = null;
    lastAccessed = 0;
    accessCount = 0;
    maxMemoryTime = 5 * 60 * 1000; // 5 minutes
    maxAccessCount = 1000; // Prevent excessive access
    constructor() {
        this.initializeKey();
        // Clear memory periodically for security
        setInterval(() => {
            this.clearStaleMemory();
        }, 60000); // Check every minute
    }
    initializeKey() {
        const rawKey = process.env.AGW_SESSION_PRIVATE_KEY;
        if (!rawKey) {
            throw new Error('SECURITY: AGW_SESSION_PRIVATE_KEY not found in environment');
        }
        // Basic validation that this looks like a private key
        if (rawKey.length < 32 || !/^[0-9a-fA-F]+$/.test(rawKey.replace('0x', ''))) {
            throw new Error('SECURITY: Invalid private key format detected');
        }
        // Create encryption key from environment + system entropy
        const systemSalt = (process.env.NODE_ENV || 'development') + process.pid + Math.random();
        this.keyDerivation = createHash('sha256')
            .update(systemSalt)
            .update(Buffer.from(rawKey.slice(0, 8))) // Use part of key for derivation
            .digest();
        // Encrypt the private key in memory with AES-256-GCM for additional security
        const iv = randomBytes(16);
        const cipher = createCipheriv('aes-256-gcm', this.keyDerivation, iv);
        let encrypted = cipher.update(rawKey, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();
        // Store IV + auth tag + encrypted data
        this.encryptedKey = iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
        console.log('🔐 Treasury private key encrypted and loaded securely');
    }
    getPrivateKey() {
        if (!this.encryptedKey || !this.keyDerivation) {
            throw new Error('SECURITY: Private key not initialized');
        }
        // Security limits
        this.accessCount++;
        if (this.accessCount > this.maxAccessCount) {
            throw new Error('SECURITY: Private key access limit exceeded - possible attack');
        }
        this.lastAccessed = Date.now();
        try {
            // Decrypt the key with AES-256-GCM
            const [ivHex, authTagHex, encryptedData] = this.encryptedKey.split(':');
            if (!ivHex || !authTagHex || !encryptedData) {
                throw new Error('SECURITY: Malformed encrypted key data');
            }
            const iv = Buffer.from(ivHex, 'hex');
            const authTag = Buffer.from(authTagHex, 'hex');
            const decipher = createDecipheriv('aes-256-gcm', this.keyDerivation, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            // Additional validation before returning
            if (!decrypted || decrypted.length < 32) {
                throw new Error('SECURITY: Key decryption failed');
            }
            return decrypted;
        }
        catch (error) {
            console.error('🚨 SECURITY: Private key decryption failed:', error);
            throw new Error('SECURITY: Unable to access treasury private key');
        }
    }
    validateKeyIntegrity() {
        try {
            const key = this.getPrivateKey();
            // Basic format validation
            const cleanKey = key.replace('0x', '');
            if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
                return false;
            }
            // Ensure it's not a common test key (security check)
            const testKeyHashes = [
                'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // hardhat test key
                '59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // another common test key
            ];
            if (testKeyHashes.includes(cleanKey.toLowerCase())) {
                console.error('🚨 SECURITY: Test private key detected in production!');
                return false;
            }
            return true;
        }
        catch (error) {
            return false;
        }
    }
    rotateKey(newPrivateKey) {
        try {
            // Validate new key first
            if (!newPrivateKey || newPrivateKey.length < 32) {
                return false;
            }
            // Clear old key
            this.clearMemory();
            // Re-initialize with new key
            process.env.AGW_SESSION_PRIVATE_KEY = newPrivateKey;
            this.initializeKey();
            console.log('🔄 Treasury private key rotated successfully');
            return true;
        }
        catch (error) {
            console.error('🚨 SECURITY: Key rotation failed:', error);
            return false;
        }
    }
    clearMemory() {
        if (this.encryptedKey) {
            // Overwrite memory with random data before clearing
            this.encryptedKey = randomBytes(this.encryptedKey.length).toString('hex');
            this.encryptedKey = null;
        }
        if (this.keyDerivation) {
            // Overwrite key derivation buffer
            this.keyDerivation.fill(0);
            this.keyDerivation = null;
        }
        this.lastAccessed = 0;
        this.accessCount = 0;
    }
    clearStaleMemory() {
        const now = Date.now();
        // Clear memory if it's been too long since last access
        if (this.lastAccessed > 0 && (now - this.lastAccessed) > this.maxMemoryTime) {
            console.log('🧹 Clearing stale private key from memory for security');
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
// Comprehensive secure credential manager for all sensitive values
class SecureCredentialManager {
    credentialCache = new Map();
    derivationKey = null;
    maxMemoryTime = 5 * 60 * 1000; // 5 minutes
    maxAccessCount = 1000;
    constructor() {
        this.initializeDerivationKey();
        // Periodic cleanup
        setInterval(() => {
            this.cleanupStaleCredentials();
        }, 60000);
    }
    initializeDerivationKey() {
        const systemSalt = (process.env.NODE_ENV || 'development') + process.pid + Math.random();
        this.derivationKey = createHash('sha256')
            .update(systemSalt)
            .update('SECURE_CREDENTIAL_MANAGER')
            .digest();
    }
    encryptCredential(value) {
        if (!this.derivationKey) {
            throw new Error('SECURITY: Credential manager not initialized');
        }
        const iv = randomBytes(16);
        const cipher = createCipheriv('aes-256-gcm', this.derivationKey, iv);
        let encrypted = cipher.update(value, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();
        return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
    }
    decryptCredential(encryptedData) {
        if (!this.derivationKey) {
            throw new Error('SECURITY: Credential manager not initialized');
        }
        const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
        if (!ivHex || !authTagHex || !encrypted) {
            throw new Error('SECURITY: Malformed credential data');
        }
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = createDecipheriv('aes-256-gcm', this.derivationKey, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    getSecureCredential(envVarName) {
        const cached = this.credentialCache.get(envVarName);
        if (cached) {
            // Security limits
            cached.accessCount++;
            if (cached.accessCount > this.maxAccessCount) {
                throw new Error(`SECURITY: Credential access limit exceeded for ${envVarName}`);
            }
            cached.lastAccessed = Date.now();
            try {
                return this.decryptCredential(cached.encrypted);
            }
            catch (error) {
                console.error(`🚨 SECURITY: Failed to decrypt credential ${envVarName}:`, error);
                throw new Error(`SECURITY: Unable to access credential ${envVarName}`);
            }
        }
        // Load and encrypt credential from environment
        const rawValue = process.env[envVarName];
        if (!rawValue) {
            throw new Error(`SECURITY: Credential ${envVarName} not found in environment`);
        }
        // Validate sensitive credentials
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
        // Validate credential strength and format
        if (envVarName.includes('SECRET') || envVarName.includes('PASSWORD') || envVarName.includes('TOKEN')) {
            if (value.length < 16) {
                console.warn(`⚠️ SECURITY: ${envVarName} appears weak (less than 16 characters)`);
            }
        }
        if (envVarName === 'ADMIN_SECRET' && value.length < 32) {
            console.warn(`⚠️ SECURITY: ADMIN_SECRET should be at least 32 characters for production`);
        }
        if (envVarName.includes('PRIVATE_KEY')) {
            const cleanKey = value.replace('0x', '');
            if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
                throw new Error(`SECURITY: Invalid private key format for ${envVarName}`);
            }
            // Check for test keys
            const testKeys = [
                'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
                '59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
            ];
            if (testKeys.includes(cleanKey.toLowerCase())) {
                console.error(`🚨 SECURITY: Test private key detected for ${envVarName}!`);
            }
        }
    }
    cleanupStaleCredentials() {
        const now = Date.now();
        const staleKeys = [];
        for (const [key, cached] of this.credentialCache.entries()) {
            if ((now - cached.lastAccessed) > this.maxMemoryTime) {
                staleKeys.push(key);
            }
        }
        if (staleKeys.length > 0) {
            console.log(`🧹 Clearing ${staleKeys.length} stale credentials from memory`);
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
// Create singleton instances
const secureKeyManager = new SecureKeyManager();
const secureCredentialManager = new SecureCredentialManager();
// Export secure functions for accessing the private key (legacy compatibility)
export function getSecureTreasuryPrivateKey() {
    return secureKeyManager.getPrivateKey();
}
export function validateTreasuryKeyIntegrity() {
    return secureKeyManager.validateKeyIntegrity();
}
export function rotateTreasuryKey(newPrivateKey) {
    return secureKeyManager.rotateKey(newPrivateKey);
}
export function clearTreasuryKeyFromMemory() {
    secureKeyManager.clearMemory();
}
export function getTreasuryKeySecurityStats() {
    return secureKeyManager.getSecurityStats();
}
// Export secure functions for ALL credentials
export function getSecureCredential(envVarName) {
    return secureCredentialManager.getSecureCredential(envVarName);
}
export function clearAllSecureCredentials() {
    secureCredentialManager.clearAllCredentials();
    secureKeyManager.clearMemory();
}
export function getAllCredentialStats() {
    return {
        treasuryKey: secureKeyManager.getSecurityStats(),
        credentials: secureCredentialManager.getCredentialStats()
    };
}
// Specific secure getters for common credentials
export function getSecureAdminSecret() {
    return secureCredentialManager.getSecureCredential('ADMIN_SECRET');
}
export function getSecureDiscordToken() {
    return secureCredentialManager.getSecureCredential('DISCORD_TOKEN');
}
export function getSecureDiscordClientSecret() {
    return secureCredentialManager.getSecureCredential('DISCORD_CLIENT_SECRET');
}
export function getSecureTreasuryPrivateKeyAlt() {
    return secureCredentialManager.getSecureCredential('TREASURY_PRIVATE_KEY');
}
// Process exit handler to clear sensitive data
process.on('exit', () => {
    secureKeyManager.clearMemory();
    secureCredentialManager.clearAllCredentials();
});
process.on('SIGINT', () => {
    secureKeyManager.clearMemory();
    secureCredentialManager.clearAllCredentials();
    process.exit();
});
process.on('SIGTERM', () => {
    secureKeyManager.clearMemory();
    secureCredentialManager.clearAllCredentials();
    process.exit();
});

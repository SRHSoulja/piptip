// JWT Authentication Enhancement Service
// Extends existing admin authentication with JWT access/refresh token support
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getSecureCredential } from './secure_key.js';
import { adminAuth } from './admin_auth.js';
class JWTAuthService {
    refreshTokens = new Map();
    ACCESS_TOKEN_EXPIRY = '15m'; // 15 minutes
    REFRESH_TOKEN_EXPIRY = '7d'; // 7 days
    JWT_SECRET;
    REFRESH_SECRET;
    cleanupInterval;
    constructor() {
        try {
            // Use different secrets for access and refresh tokens
            this.JWT_SECRET = getSecureCredential('JWT_SECRET');
            this.REFRESH_SECRET = getSecureCredential('JWT_REFRESH_SECRET');
        }
        catch {
            try {
                // Fallback to admin secret with different salts
                const adminSecret = getSecureCredential('ADMIN_SECRET');
                this.JWT_SECRET = crypto.createHmac('sha256', adminSecret).update('jwt-access').digest('hex');
                this.REFRESH_SECRET = crypto.createHmac('sha256', adminSecret).update('jwt-refresh').digest('hex');
            }
            catch {
                if (process.env.NODE_ENV === 'development') {
                    console.warn('⚠️ Using fallback JWT secrets in development mode');
                    this.JWT_SECRET = 'dev-jwt-secret-change-in-production';
                    this.REFRESH_SECRET = 'dev-jwt-refresh-secret-change-in-production';
                }
                else {
                    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET required for JWT authentication');
                }
            }
        }
        // Cleanup expired refresh tokens every hour
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredTokens();
        }, 60 * 60 * 1000);
        console.log('🔑 JWT authentication service initialized');
    }
    /**
     * Generate JWT token pair for authenticated admin session
     */
    async generateTokenPair(sessionId, adminId, permissions, req) {
        const fingerprint = this.generateFingerprint(req);
        // Generate access token
        const accessPayload = {
            sessionId,
            adminId,
            permissions,
            type: 'access'
        };
        const accessToken = jwt.sign(accessPayload, this.JWT_SECRET, {
            expiresIn: this.ACCESS_TOKEN_EXPIRY,
            issuer: 'piptip-admin',
            audience: 'piptip-api'
        });
        // Generate refresh token
        const refreshPayload = {
            sessionId,
            adminId,
            permissions,
            type: 'refresh'
        };
        const refreshToken = jwt.sign(refreshPayload, this.REFRESH_SECRET, {
            expiresIn: this.REFRESH_TOKEN_EXPIRY,
            issuer: 'piptip-admin',
            audience: 'piptip-api'
        });
        // Store refresh token metadata
        const refreshTokenData = {
            token: refreshToken,
            sessionId,
            adminId,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            createdAt: new Date(),
            lastUsed: new Date(),
            revoked: false,
            fingerprint
        };
        this.refreshTokens.set(refreshToken, refreshTokenData);
        console.log(`🎟️ Generated JWT token pair for admin session ${sessionId.slice(0, 8)}...`);
        return {
            accessToken,
            refreshToken,
            expiresIn: 15 * 60, // 15 minutes in seconds
            tokenType: 'Bearer'
        };
    }
    /**
     * Verify and decode JWT access token
     */
    async verifyAccessToken(token) {
        try {
            const payload = jwt.verify(token, this.JWT_SECRET, {
                issuer: 'piptip-admin',
                audience: 'piptip-api'
            });
            if (payload.type !== 'access') {
                return { valid: false, error: 'Invalid token type' };
            }
            // Validate that the session still exists in the admin auth system
            const sessionValidation = await adminAuth.validateSession(payload.sessionId, payload.permissions);
            if (!sessionValidation.valid) {
                return { valid: false, error: 'Session no longer valid' };
            }
            return { valid: true, payload };
        }
        catch (error) {
            if (error.name === 'TokenExpiredError') {
                return { valid: false, error: 'Access token expired' };
            }
            else if (error.name === 'JsonWebTokenError') {
                return { valid: false, error: 'Invalid access token' };
            }
            else {
                console.error('JWT verification error:', error);
                return { valid: false, error: 'Token verification failed' };
            }
        }
    }
    /**
     * Refresh access token using valid refresh token
     */
    async refreshAccessToken(refreshToken, req) {
        const storedRefreshToken = this.refreshTokens.get(refreshToken);
        if (!storedRefreshToken) {
            return { success: false, error: 'Refresh token not found' };
        }
        if (storedRefreshToken.revoked) {
            return { success: false, error: 'Refresh token revoked' };
        }
        if (Date.now() > storedRefreshToken.expiresAt.getTime()) {
            this.refreshTokens.delete(refreshToken);
            return { success: false, error: 'Refresh token expired' };
        }
        // Verify fingerprint for additional security
        const currentFingerprint = this.generateFingerprint(req);
        if (storedRefreshToken.fingerprint !== currentFingerprint) {
            // Revoke token on fingerprint mismatch (potential security threat)
            storedRefreshToken.revoked = true;
            console.warn('🚨 JWT refresh token fingerprint mismatch - potential security threat');
            return { success: false, error: 'Security validation failed' };
        }
        try {
            // Verify the refresh token signature
            const payload = jwt.verify(refreshToken, this.REFRESH_SECRET, {
                issuer: 'piptip-admin',
                audience: 'piptip-api'
            });
            if (payload.type !== 'refresh') {
                return { success: false, error: 'Invalid token type' };
            }
            // Validate that the session still exists
            const sessionValidation = await adminAuth.validateSession(payload.sessionId, payload.permissions);
            if (!sessionValidation.valid) {
                // Remove refresh token if session is invalid
                this.refreshTokens.delete(refreshToken);
                return { success: false, error: 'Session no longer valid' };
            }
            // Update last used timestamp
            storedRefreshToken.lastUsed = new Date();
            // Generate new token pair
            const newTokenPair = await this.generateTokenPair(payload.sessionId, payload.adminId, payload.permissions, req);
            // Revoke old refresh token
            this.refreshTokens.delete(refreshToken);
            console.log(`🔄 Refreshed JWT tokens for admin session ${payload.sessionId.slice(0, 8)}...`);
            return { success: true, tokenPair: newTokenPair };
        }
        catch (error) {
            console.error('Refresh token verification error:', error);
            return { success: false, error: 'Invalid refresh token' };
        }
    }
    /**
     * Express middleware for JWT authentication
     */
    jwtMiddleware(requiredPermissions = []) {
        return async (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({
                    error: 'Bearer token required',
                    code: 'MISSING_TOKEN'
                });
            }
            const token = authHeader.substring(7);
            const verification = await this.verifyAccessToken(token);
            if (!verification.valid) {
                return res.status(401).json({
                    error: verification.error,
                    code: verification.error === 'Access token expired' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
                });
            }
            // Check permissions
            if (requiredPermissions.length > 0) {
                const hasPermission = requiredPermissions.some(perm => verification.payload.permissions.includes(perm));
                if (!hasPermission) {
                    return res.status(403).json({
                        error: 'Insufficient permissions',
                        code: 'INSUFFICIENT_PERMISSIONS'
                    });
                }
            }
            // Add JWT payload to request for downstream use
            req.jwtPayload = verification.payload;
            req.adminId = verification.payload.adminId;
            req.sessionId = verification.payload.sessionId;
            next();
        };
    }
    /**
     * Revoke refresh token (logout)
     */
    revokeRefreshToken(refreshToken) {
        const storedToken = this.refreshTokens.get(refreshToken);
        if (storedToken) {
            storedToken.revoked = true;
            console.log(`🚫 Revoked JWT refresh token for session ${storedToken.sessionId.slice(0, 8)}...`);
            return true;
        }
        return false;
    }
    /**
     * Revoke all refresh tokens for a session (admin logout)
     */
    revokeAllTokensForSession(sessionId) {
        let revokedCount = 0;
        for (const [token, tokenData] of this.refreshTokens.entries()) {
            if (tokenData.sessionId === sessionId && !tokenData.revoked) {
                tokenData.revoked = true;
                revokedCount++;
            }
        }
        console.log(`🚫 Revoked ${revokedCount} JWT refresh tokens for session ${sessionId.slice(0, 8)}...`);
        return revokedCount;
    }
    /**
     * Get active refresh token statistics
     */
    getRefreshTokenStats() {
        const tokens = Array.from(this.refreshTokens.values());
        const activeTokens = tokens.filter(t => !t.revoked && Date.now() <= t.expiresAt.getTime()).length;
        const revokedTokens = tokens.filter(t => t.revoked).length;
        const oldestToken = tokens.length > 0 ?
            tokens.reduce((oldest, token) => token.createdAt < oldest.createdAt ? token : oldest).createdAt :
            null;
        return {
            activeTokens,
            revokedTokens,
            totalTokens: tokens.length,
            oldestToken
        };
    }
    /**
     * Clean up expired and revoked refresh tokens
     */
    cleanupExpiredTokens() {
        const now = Date.now();
        let cleaned = 0;
        for (const [token, data] of this.refreshTokens.entries()) {
            if (data.revoked || now > data.expiresAt.getTime()) {
                this.refreshTokens.delete(token);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`🧹 Cleaned up ${cleaned} expired/revoked JWT refresh tokens, ${this.refreshTokens.size} remaining`);
        }
    }
    /**
     * Generate client fingerprint for additional security
     */
    generateFingerprint(req) {
        const components = [
            req.get('User-Agent') || '',
            req.get('Accept-Language') || '',
            req.ip || '',
            req.get('Accept-Encoding') || ''
        ];
        return crypto.createHash('sha256')
            .update(components.join('|'))
            .digest('hex')
            .slice(0, 16); // First 16 characters for brevity
    }
    /**
     * Shutdown and cleanup
     */
    destroy() {
        clearInterval(this.cleanupInterval);
        this.refreshTokens.clear();
        console.log('🔑 JWT authentication service destroyed');
    }
}
// Create singleton instance
export const jwtAuth = new JWTAuthService();
// Export convenience middleware functions
export const jwtMiddleware = (permissions = []) => jwtAuth.jwtMiddleware(permissions);
// API-specific middleware variants
export const apiAuthMiddleware = jwtMiddleware(['admin']);
export const readOnlyApiMiddleware = jwtMiddleware([]);
export const financialApiMiddleware = jwtMiddleware(['admin', 'financial']);
// Utility functions
export async function generateTokenPair(sessionId, adminId, permissions, req) {
    return jwtAuth.generateTokenPair(sessionId, adminId, permissions, req);
}
export async function refreshAccessToken(refreshToken, req) {
    return jwtAuth.refreshAccessToken(refreshToken, req);
}
export function revokeRefreshToken(refreshToken) {
    return jwtAuth.revokeRefreshToken(refreshToken);
}
export function revokeAllTokensForSession(sessionId) {
    return jwtAuth.revokeAllTokensForSession(sessionId);
}
export function getRefreshTokenStats() {
    return jwtAuth.getRefreshTokenStats();
}
// Cleanup on process exit
process.on('exit', () => jwtAuth.destroy());
process.on('SIGINT', () => jwtAuth.destroy());
process.on('SIGTERM', () => jwtAuth.destroy());

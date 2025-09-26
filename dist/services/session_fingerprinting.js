// Session Fingerprinting Service
// Detects potential session hijacking by tracking client characteristics
import crypto from 'crypto';
class SessionFingerprintingService {
    fingerprints = new Map();
    suspiciousActivities = [];
    cleanupInterval;
    MAX_ACTIVITIES = 1000; // Keep last 1000 suspicious activities
    constructor() {
        // Cleanup old fingerprints and activities every hour
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 60 * 60 * 1000);
        console.log('🔍 Session fingerprinting service initialized');
    }
    /**
     * Generate fingerprint from request headers and client info
     */
    generateFingerprint(req) {
        const userAgent = req.get('User-Agent') || 'Unknown';
        const acceptLanguage = req.get('Accept-Language') || 'Unknown';
        const acceptEncoding = req.get('Accept-Encoding') || 'Unknown';
        const ipAddress = this.getClientIP(req);
        // Extract additional client info from custom headers (set by client-side JavaScript)
        const timeZone = req.get('X-Client-Timezone') || 'Unknown';
        const screenResolution = req.get('X-Client-Screen') || undefined;
        const colorDepth = req.get('X-Client-Color-Depth') || undefined;
        const platform = req.get('X-Client-Platform') || undefined;
        const components = {
            userAgent,
            acceptLanguage,
            acceptEncoding,
            timeZone,
            screenResolution,
            colorDepth,
            platform
        };
        // Create hash of all components
        const fingerprintString = [
            userAgent,
            acceptLanguage,
            acceptEncoding,
            timeZone,
            screenResolution || '',
            colorDepth || '',
            platform || '',
            ipAddress
        ].join('|');
        const hash = crypto.createHash('sha256').update(fingerprintString).digest('hex');
        return {
            hash,
            components,
            ipAddress,
            createdAt: new Date(),
            lastSeen: new Date(),
            verified: false,
            suspiciousChanges: []
        };
    }
    /**
     * Validate session fingerprint and detect potential hijacking
     */
    async validateFingerprint(sessionId, req) {
        const currentFingerprint = this.generateFingerprint(req);
        const storedFingerprint = this.fingerprints.get(sessionId);
        // First time seeing this session
        if (!storedFingerprint) {
            this.fingerprints.set(sessionId, currentFingerprint);
            return {
                valid: true,
                riskLevel: 'LOW',
                action: 'ALLOW'
            };
        }
        // Update last seen
        storedFingerprint.lastSeen = new Date();
        // Compare fingerprints
        const changes = this.compareFingerprints(storedFingerprint, currentFingerprint);
        if (changes.length === 0) {
            // Perfect match - very safe
            return {
                valid: true,
                riskLevel: 'LOW',
                action: 'ALLOW'
            };
        }
        // Analyze risk level based on changes
        const riskAnalysis = this.analyzeRisk(changes, storedFingerprint, currentFingerprint);
        // Log suspicious activity
        const suspicious = {
            sessionId,
            oldFingerprint: storedFingerprint,
            newFingerprint: currentFingerprint,
            riskLevel: riskAnalysis.riskLevel,
            changes,
            timestamp: new Date(),
            action: riskAnalysis.action
        };
        this.suspiciousActivities.push(suspicious);
        if (this.suspiciousActivities.length > this.MAX_ACTIVITIES) {
            this.suspiciousActivities = this.suspiciousActivities.slice(-this.MAX_ACTIVITIES);
        }
        // Update stored fingerprint for non-critical changes
        if (riskAnalysis.riskLevel !== 'CRITICAL') {
            storedFingerprint.suspiciousChanges.push(...changes);
            // Keep only last 10 suspicious changes
            if (storedFingerprint.suspiciousChanges.length > 10) {
                storedFingerprint.suspiciousChanges = storedFingerprint.suspiciousChanges.slice(-10);
            }
        }
        console.log(`🚨 Session fingerprint analysis: ${riskAnalysis.riskLevel} risk for session ${sessionId.slice(0, 8)}...`, {
            changes: changes.slice(0, 3), // Log first 3 changes
            action: riskAnalysis.action
        });
        return {
            valid: riskAnalysis.action !== 'BLOCK',
            riskLevel: riskAnalysis.riskLevel,
            action: riskAnalysis.action,
            changes,
            suspicious
        };
    }
    /**
     * Compare two fingerprints and return list of changes
     */
    compareFingerprints(stored, current) {
        const changes = [];
        // Check IP address change
        if (stored.ipAddress !== current.ipAddress) {
            changes.push(`IP changed from ${stored.ipAddress} to ${current.ipAddress}`);
        }
        // Check User-Agent change
        if (stored.components.userAgent !== current.components.userAgent) {
            changes.push('User-Agent changed');
        }
        // Check language preference change
        if (stored.components.acceptLanguage !== current.components.acceptLanguage) {
            changes.push('Accept-Language changed');
        }
        // Check encoding support change
        if (stored.components.acceptEncoding !== current.components.acceptEncoding) {
            changes.push('Accept-Encoding changed');
        }
        // Check timezone change
        if (stored.components.timeZone !== current.components.timeZone) {
            changes.push(`Timezone changed from ${stored.components.timeZone} to ${current.components.timeZone}`);
        }
        // Check screen resolution change
        if (stored.components.screenResolution !== current.components.screenResolution) {
            changes.push('Screen resolution changed');
        }
        // Check platform change
        if (stored.components.platform !== current.components.platform) {
            changes.push('Platform changed');
        }
        return changes;
    }
    /**
     * Analyze risk level based on fingerprint changes
     */
    analyzeRisk(changes, stored, current) {
        let riskScore = 0;
        const criticalChanges = [];
        const highRiskChanges = [];
        for (const change of changes) {
            if (change.includes('IP changed')) {
                riskScore += 30;
                criticalChanges.push(change);
            }
            else if (change.includes('User-Agent changed')) {
                riskScore += 25;
                highRiskChanges.push(change);
            }
            else if (change.includes('Platform changed')) {
                riskScore += 20;
                highRiskChanges.push(change);
            }
            else if (change.includes('Timezone changed')) {
                // Timezone changes can be legitimate (travel, VPN)
                riskScore += 10;
            }
            else if (change.includes('Screen resolution changed')) {
                // Resolution changes can be legitimate (different devices, window resize)
                riskScore += 5;
            }
            else {
                // Language, encoding changes
                riskScore += 8;
            }
        }
        // Consider frequency of changes
        const recentSuspiciousChanges = stored.suspiciousChanges.filter(change => change.includes('IP changed') || change.includes('User-Agent changed')).length;
        if (recentSuspiciousChanges >= 3) {
            riskScore += 20; // Pattern of suspicious changes
        }
        // Determine risk level and action
        if (riskScore >= 50 || criticalChanges.length >= 2) {
            return { riskLevel: 'CRITICAL', action: 'BLOCK' };
        }
        else if (riskScore >= 30 || criticalChanges.length >= 1) {
            return { riskLevel: 'HIGH', action: 'VERIFY' };
        }
        else if (riskScore >= 15 || highRiskChanges.length >= 1) {
            return { riskLevel: 'MEDIUM', action: 'WARN' };
        }
        else {
            return { riskLevel: 'LOW', action: 'ALLOW' };
        }
    }
    /**
     * Express middleware for session fingerprint validation
     */
    fingerprintMiddleware() {
        return async (req, res, next) => {
            // Skip fingerprinting for non-authenticated requests
            if (!req.sessionID || !req.session) {
                return next();
            }
            try {
                const validation = await this.validateFingerprint(req.sessionID, req);
                // Add fingerprint info to request for logging
                req.fingerprintValidation = validation;
                switch (validation.action) {
                    case 'ALLOW':
                        // Normal processing
                        break;
                    case 'WARN':
                        // Log warning but allow request
                        console.warn(`⚠️ Session fingerprint warning for ${req.sessionID.slice(0, 8)}...`, {
                            riskLevel: validation.riskLevel,
                            changes: validation.changes?.slice(0, 2)
                        });
                        break;
                    case 'VERIFY':
                        // Require additional verification
                        console.warn(`🔍 Session fingerprint verification required for ${req.sessionID.slice(0, 8)}...`);
                        // For API requests, return verification required
                        if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/')) {
                            return res.status(403).json({
                                error: 'Session verification required',
                                code: 'FINGERPRINT_VERIFICATION_REQUIRED',
                                message: 'Your session security fingerprint has changed. Please re-authenticate.',
                                riskLevel: validation.riskLevel
                            });
                        }
                        // For web requests, could redirect to re-auth page
                        // For now, we'll log and continue with elevated monitoring
                        break;
                    case 'BLOCK':
                        // Block the request
                        console.error(`🚫 Session fingerprint blocked for ${req.sessionID.slice(0, 8)}...`, {
                            riskLevel: validation.riskLevel,
                            changes: validation.changes?.slice(0, 3)
                        });
                        // Destroy the session
                        req.session.destroy((err) => {
                            if (err)
                                console.error('Session destruction error:', err);
                        });
                        return res.status(403).json({
                            error: 'Session security violation',
                            code: 'FINGERPRINT_SECURITY_VIOLATION',
                            message: 'Your session has been terminated due to suspicious activity.',
                            riskLevel: validation.riskLevel
                        });
                }
                next();
            }
            catch (error) {
                console.error('Fingerprint validation error:', error);
                // On error, allow request but log
                next();
            }
        };
    }
    /**
     * Mark a session fingerprint as verified (after MFA, etc.)
     */
    markAsVerified(sessionId) {
        const fingerprint = this.fingerprints.get(sessionId);
        if (fingerprint) {
            fingerprint.verified = true;
            return true;
        }
        return false;
    }
    /**
     * Get suspicious activity statistics
     */
    getSuspiciousActivityStats() {
        const riskLevelBreakdown = this.suspiciousActivities.reduce((acc, activity) => {
            acc[activity.riskLevel] = (acc[activity.riskLevel] || 0) + 1;
            return acc;
        }, {});
        const recentActivities = this.suspiciousActivities
            .slice(-20)
            .reverse(); // Most recent first
        const sessionCounts = this.suspiciousActivities.reduce((acc, activity) => {
            const shortId = activity.sessionId.slice(0, 8);
            acc[shortId] = (acc[shortId] || 0) + 1;
            return acc;
        }, {});
        const topSessions = Object.entries(sessionCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([sessionId, count]) => ({ sessionId, count }));
        return {
            totalActivities: this.suspiciousActivities.length,
            riskLevelBreakdown,
            recentActivities,
            topSessions
        };
    }
    /**
     * Get client IP address with proxy support
     */
    getClientIP(req) {
        const forwardedFor = req.headers['x-forwarded-for'];
        if (forwardedFor) {
            const ips = Array.isArray(forwardedFor) ? forwardedFor : forwardedFor.split(',');
            return ips[0].trim();
        }
        return req.ip || req.socket.remoteAddress || 'unknown';
    }
    /**
     * Clean up old fingerprints and activities
     */
    cleanup() {
        const now = Date.now();
        const OLD_THRESHOLD = 7 * 24 * 60 * 60 * 1000; // 7 days
        let cleanedFingerprints = 0;
        let cleanedActivities = 0;
        // Clean old fingerprints
        for (const [sessionId, fingerprint] of this.fingerprints.entries()) {
            if (now - fingerprint.lastSeen.getTime() > OLD_THRESHOLD) {
                this.fingerprints.delete(sessionId);
                cleanedFingerprints++;
            }
        }
        // Clean old activities (keep only last 1000, but also remove very old ones)
        const oldActivities = this.suspiciousActivities.filter(activity => now - activity.timestamp.getTime() > OLD_THRESHOLD);
        cleanedActivities = oldActivities.length;
        this.suspiciousActivities = this.suspiciousActivities.filter(activity => now - activity.timestamp.getTime() <= OLD_THRESHOLD);
        if (cleanedFingerprints > 0 || cleanedActivities > 0) {
            console.log(`🧹 Cleaned up ${cleanedFingerprints} old fingerprints and ${cleanedActivities} old activities`);
        }
    }
    /**
     * Shutdown and cleanup
     */
    destroy() {
        clearInterval(this.cleanupInterval);
        this.fingerprints.clear();
        this.suspiciousActivities = [];
        console.log('🔍 Session fingerprinting service destroyed');
    }
}
// Create singleton instance
export const sessionFingerprinting = new SessionFingerprintingService();
// Export middleware
export const fingerprintMiddleware = () => sessionFingerprinting.fingerprintMiddleware();
// Utility functions
export function markSessionAsVerified(sessionId) {
    return sessionFingerprinting.markAsVerified(sessionId);
}
export function getSuspiciousActivityStats() {
    return sessionFingerprinting.getSuspiciousActivityStats();
}
// Cleanup on process exit
process.on('exit', () => sessionFingerprinting.destroy());
process.on('SIGINT', () => sessionFingerprinting.destroy());
process.on('SIGTERM', () => sessionFingerprinting.destroy());

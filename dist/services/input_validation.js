// src/services/input_validation.ts - Comprehensive input validation for security
import { CriteriaRegistry } from './achievement_criteria_engine.js';
// Achievement data validation
export function validateAchievementData(data) {
    const errors = [];
    const { name, description, criteriaType, criteriaData, threshold, iconEmoji, badgeColor, category, rarity } = data;
    // Required field validation with size limits
    if (!name || typeof name !== 'string') {
        errors.push('Name is required and must be a string');
    }
    else if (name.length > 100) {
        errors.push('Name must be 100 characters or less');
    }
    else if (name.length < 3) {
        errors.push('Name must be at least 3 characters');
    }
    if (!description || typeof description !== 'string') {
        errors.push('Description is required and must be a string');
    }
    else if (description.length > 500) {
        errors.push('Description must be 500 characters or less');
    }
    else if (description.length < 10) {
        errors.push('Description must be at least 10 characters');
    }
    // Threshold validation
    if (threshold === undefined || threshold === null) {
        errors.push('Threshold is required');
    }
    else {
        const numThreshold = Number(threshold);
        if (isNaN(numThreshold) || numThreshold < 1 || numThreshold > 1000000) {
            errors.push('Threshold must be a number between 1 and 1,000,000');
        }
    }
    // Criteria validation
    if (!criteriaType || typeof criteriaType !== 'string') {
        errors.push('Criteria type is required');
    }
    else {
        const evaluator = CriteriaRegistry.get(criteriaType);
        if (!evaluator) {
            errors.push(`Invalid criteria type: ${criteriaType}`);
        }
        else if (criteriaData) {
            // Validate criteria data structure
            const dataSize = JSON.stringify(criteriaData).length;
            if (dataSize > 5000) {
                errors.push('Criteria data too large (max 5KB)');
            }
            // Validate with specific evaluator
            const criteriaValidation = evaluator.validateConfig(criteriaData);
            if (!criteriaValidation.valid) {
                errors.push(...criteriaValidation.errors.map(err => `Criteria: ${err}`));
            }
        }
    }
    // Category validation
    const validCategories = ['streaks', 'tips', 'deposits', 'referrals', 'veteran', 'special', 'community'];
    if (category && !validCategories.includes(category)) {
        errors.push(`Category must be one of: ${validCategories.join(', ')}`);
    }
    // Rarity validation
    const validRarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    if (rarity && !validRarities.includes(rarity)) {
        errors.push(`Rarity must be one of: ${validRarities.join(', ')}`);
    }
    // Emoji validation (prevent XSS in Discord)
    if (iconEmoji && typeof iconEmoji === 'string') {
        // Unicode emoji regex
        const emojiRegex = /^[\u{1F600}-\u{1F64F}|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}|\u{1F1E0}-\u{1F1FF}]+$/u;
        if (!emojiRegex.test(iconEmoji)) {
            errors.push('Icon emoji must be a valid Unicode emoji');
        }
    }
    // Badge color validation (hex color)
    if (badgeColor && typeof badgeColor === 'string') {
        const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
        if (!hexColorRegex.test(badgeColor)) {
            errors.push('Badge color must be a valid hex color (e.g., #FF0000)');
        }
    }
    return { valid: errors.length === 0, errors };
}
// Bulk operation validation
export function validateBulkOperation(data) {
    const errors = [];
    const { operation, achievementIds, data: opData } = data;
    // Operation validation
    const validOperations = ['enable', 'disable', 'update-category', 'update-rarity', 'update-threshold'];
    if (!operation || !validOperations.includes(operation)) {
        errors.push(`Operation must be one of: ${validOperations.join(', ')}`);
    }
    // Achievement IDs validation
    if (!achievementIds || !Array.isArray(achievementIds)) {
        errors.push('Achievement IDs must be an array');
    }
    else {
        if (achievementIds.length === 0) {
            errors.push('At least one achievement ID is required');
        }
        else if (achievementIds.length > 100) {
            errors.push('Cannot operate on more than 100 achievements at once');
        }
        // Validate each ID is a positive integer
        for (const id of achievementIds) {
            if (!Number.isInteger(id) || id <= 0) {
                errors.push(`Invalid achievement ID: ${id}`);
                break;
            }
        }
    }
    // Operation data validation based on type
    if (opData) {
        switch (operation) {
            case 'update-category':
                const validCategories = ['streaks', 'tips', 'deposits', 'referrals', 'veteran', 'special', 'community'];
                if (!opData.category || !validCategories.includes(opData.category)) {
                    errors.push(`Category must be one of: ${validCategories.join(', ')}`);
                }
                break;
            case 'update-rarity':
                const validRarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
                if (!opData.rarity || !validRarities.includes(opData.rarity)) {
                    errors.push(`Rarity must be one of: ${validRarities.join(', ')}`);
                }
                break;
            case 'update-threshold':
                const threshold = Number(opData.threshold);
                if (isNaN(threshold) || threshold < 1 || threshold > 1000000) {
                    errors.push('Threshold must be a number between 1 and 1,000,000');
                }
                break;
        }
    }
    return { valid: errors.length === 0, errors };
}
// Manual grant/revoke validation
export function validateManualOperation(data) {
    const errors = [];
    const { operation, userDiscordId, achievementId, reason } = data;
    // Operation validation
    const validOperations = ['grant', 'revoke'];
    if (!operation || !validOperations.includes(operation)) {
        errors.push(`Operation must be one of: ${validOperations.join(', ')}`);
    }
    // Discord ID validation
    if (!userDiscordId || typeof userDiscordId !== 'string') {
        errors.push('User Discord ID is required');
    }
    else if (!/^\d{17,20}$/.test(userDiscordId)) {
        errors.push('Invalid Discord ID format (must be 17-20 digits)');
    }
    // Achievement ID validation
    if (!Number.isInteger(achievementId) || achievementId <= 0) {
        errors.push('Invalid achievement ID');
    }
    // Reason validation
    if (!reason || typeof reason !== 'string') {
        errors.push('Reason is required for manual operations');
    }
    else if (reason.length > 200) {
        errors.push('Reason must be 200 characters or less');
    }
    return { valid: errors.length === 0, errors };
}
// Sanitization functions
export function sanitizeString(input) {
    if (typeof input !== 'string')
        return '';
    return input
        .trim()
        .replace(/[<>\"'&]/g, '') // Remove potentially dangerous characters
        .substring(0, 1000); // Limit length
}
export function sanitizeNumber(input, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const num = Number(input);
    if (isNaN(num))
        return min;
    return Math.max(min, Math.min(max, Math.floor(num)));
}
export function sanitizeDiscordId(input) {
    if (typeof input !== 'string')
        return null;
    const cleaned = input.trim();
    if (!/^\d{17,20}$/.test(cleaned))
        return null;
    return cleaned;
}
// Rate limiting validation (for use with express-rate-limit)
export function createRateLimitConfig() {
    return {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // limit each IP to 100 requests per windowMs
        message: {
            error: 'Too many admin requests, please try again later',
            retryAfter: '15 minutes'
        },
        standardHeaders: true,
        legacyHeaders: false,
    };
}

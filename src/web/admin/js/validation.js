// src/web/admin/js/validation.js - Comprehensive input validation and security functions

import { escapeHtml, sanitizeInput } from './security.js';

/**
 * Validation patterns for different types of admin input
 */
export const ValidationPatterns = {
  // Discord snowflake ID (17-19 digits)
  DISCORD_ID: /^\d{17,19}$/,

  // Ethereum address (0x + 40 hex chars)
  ETH_ADDRESS: /^0x[a-fA-F0-9]{40}$/,

  // Token symbol (2-10 uppercase alphanumeric)
  TOKEN_SYMBOL: /^[A-Z][A-Z0-9]{1,9}$/,

  // Username (alphanumeric, spaces, some special chars)
  USERNAME: /^[a-zA-Z0-9\s\-_\.]{1,32}$/,

  // Positive decimal number
  POSITIVE_DECIMAL: /^\d*\.?\d+$/,

  // Percentage (0-100 with up to 2 decimal places)
  PERCENTAGE: /^(?:100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)$/,

  // Server/Guild name
  SERVER_NAME: /^[a-zA-Z0-9\s\-_\.!@#$%^&*()]{1,100}$/,

  // Generic safe text (no HTML/script tags)
  SAFE_TEXT: /^[^<>"`]+$/,

  // Numeric ID
  NUMERIC_ID: /^\d+$/,

  // ISO date string
  ISO_DATE: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
};

/**
 * Security limits for different types of input
 */
export const SecurityLimits = {
  MAX_USERNAME_LENGTH: 32,
  MAX_SERVER_NAME_LENGTH: 100,
  MAX_TOKEN_SYMBOL_LENGTH: 10,
  MAX_DESCRIPTION_LENGTH: 500,
  MAX_SEARCH_QUERY_LENGTH: 100,
  MAX_DECIMAL_PLACES: 18,
  MAX_PERCENTAGE: 100,
  MIN_PERCENTAGE: 0,
  MAX_AMOUNT: 1e18, // 1 quintillion
  MIN_AMOUNT: 0
};

/**
 * Comprehensive input validator for admin forms
 */
export class AdminInputValidator {
  constructor() {
    this.errors = [];
  }

  /**
   * Clear validation errors
   */
  clearErrors() {
    this.errors = [];
  }

  /**
   * Add validation error
   * @param {string} field - Field name
   * @param {string} message - Error message
   */
  addError(field, message) {
    this.errors.push({ field, message });
  }

  /**
   * Get all validation errors
   * @returns {Array} - Array of error objects
   */
  getErrors() {
    return this.errors;
  }

  /**
   * Check if validation passed
   * @returns {boolean} - True if no errors
   */
  isValid() {
    return this.errors.length === 0;
  }

  /**
   * Validate Discord ID
   * @param {string} value - Discord ID to validate
   * @param {string} fieldName - Field name for error reporting
   * @returns {string|null} - Validated value or null if invalid
   */
  validateDiscordId(value, fieldName = 'Discord ID') {
    if (!value || typeof value !== 'string') {
      this.addError(fieldName, 'Discord ID is required');
      return null;
    }

    const trimmed = value.trim();
    if (!ValidationPatterns.DISCORD_ID.test(trimmed)) {
      this.addError(fieldName, 'Invalid Discord ID format (must be 17-19 digits)');
      return null;
    }

    return trimmed;
  }

  /**
   * Validate Ethereum address
   * @param {string} value - Address to validate
   * @param {string} fieldName - Field name for error reporting
   * @param {boolean} optional - Whether field is optional
   * @returns {string|null} - Validated value or null if invalid
   */
  validateEthAddress(value, fieldName = 'Ethereum Address', optional = false) {
    if (!value || typeof value !== 'string') {
      if (!optional) {
        this.addError(fieldName, 'Ethereum address is required');
      }
      return null;
    }

    const trimmed = value.trim();
    if (!ValidationPatterns.ETH_ADDRESS.test(trimmed)) {
      this.addError(fieldName, 'Invalid Ethereum address format');
      return null;
    }

    return trimmed;
  }

  /**
   * Validate token symbol
   * @param {string} value - Token symbol to validate
   * @param {string} fieldName - Field name for error reporting
   * @returns {string|null} - Validated value or null if invalid
   */
  validateTokenSymbol(value, fieldName = 'Token Symbol') {
    if (!value || typeof value !== 'string') {
      this.addError(fieldName, 'Token symbol is required');
      return null;
    }

    const trimmed = value.trim().toUpperCase();
    if (!ValidationPatterns.TOKEN_SYMBOL.test(trimmed)) {
      this.addError(fieldName, 'Invalid token symbol (2-10 uppercase letters/numbers, start with letter)');
      return null;
    }

    return trimmed;
  }

  /**
   * Validate username
   * @param {string} value - Username to validate
   * @param {string} fieldName - Field name for error reporting
   * @param {boolean} optional - Whether field is optional
   * @returns {string|null} - Validated value or null if invalid
   */
  validateUsername(value, fieldName = 'Username', optional = false) {
    if (!value || typeof value !== 'string') {
      if (!optional) {
        this.addError(fieldName, 'Username is required');
      }
      return null;
    }

    const trimmed = value.trim();
    if (trimmed.length > SecurityLimits.MAX_USERNAME_LENGTH) {
      this.addError(fieldName, `Username too long (max ${SecurityLimits.MAX_USERNAME_LENGTH} characters)`);
      return null;
    }

    if (!ValidationPatterns.USERNAME.test(trimmed)) {
      this.addError(fieldName, 'Invalid username format (alphanumeric, spaces, and basic symbols only)');
      return null;
    }

    return escapeHtml(trimmed);
  }

  /**
   * Validate positive decimal number
   * @param {string|number} value - Number to validate
   * @param {string} fieldName - Field name for error reporting
   * @param {boolean} optional - Whether field is optional
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @returns {number|null} - Validated value or null if invalid
   */
  validatePositiveDecimal(value, fieldName = 'Amount', optional = false, min = SecurityLimits.MIN_AMOUNT, max = SecurityLimits.MAX_AMOUNT) {
    if (value === null || value === undefined || value === '') {
      if (!optional) {
        this.addError(fieldName, `${fieldName} is required`);
      }
      return null;
    }

    const numValue = Number(value);
    if (isNaN(numValue)) {
      this.addError(fieldName, `${fieldName} must be a valid number`);
      return null;
    }

    if (numValue < min) {
      this.addError(fieldName, `${fieldName} must be at least ${min}`);
      return null;
    }

    if (numValue > max) {
      this.addError(fieldName, `${fieldName} cannot exceed ${max}`);
      return null;
    }

    // Check decimal places
    const decimalPlaces = (numValue.toString().split('.')[1] || '').length;
    if (decimalPlaces > SecurityLimits.MAX_DECIMAL_PLACES) {
      this.addError(fieldName, `${fieldName} cannot have more than ${SecurityLimits.MAX_DECIMAL_PLACES} decimal places`);
      return null;
    }

    return numValue;
  }

  /**
   * Validate percentage
   * @param {string|number} value - Percentage to validate
   * @param {string} fieldName - Field name for error reporting
   * @param {boolean} optional - Whether field is optional
   * @returns {number|null} - Validated value or null if invalid
   */
  validatePercentage(value, fieldName = 'Percentage', optional = false) {
    return this.validatePositiveDecimal(
      value,
      fieldName,
      optional,
      SecurityLimits.MIN_PERCENTAGE,
      SecurityLimits.MAX_PERCENTAGE
    );
  }

  /**
   * Validate numeric ID
   * @param {string|number} value - ID to validate
   * @param {string} fieldName - Field name for error reporting
   * @returns {number|null} - Validated value or null if invalid
   */
  validateNumericId(value, fieldName = 'ID') {
    if (!value && value !== 0) {
      this.addError(fieldName, `${fieldName} is required`);
      return null;
    }

    const numValue = Number(value);
    if (isNaN(numValue) || numValue < 1 || !Number.isInteger(numValue)) {
      this.addError(fieldName, `${fieldName} must be a positive integer`);
      return null;
    }

    return numValue;
  }

  /**
   * Validate safe text input
   * @param {string} value - Text to validate
   * @param {string} fieldName - Field name for error reporting
   * @param {number} maxLength - Maximum length
   * @param {boolean} optional - Whether field is optional
   * @returns {string|null} - Validated value or null if invalid
   */
  validateSafeText(value, fieldName = 'Text', maxLength = SecurityLimits.MAX_DESCRIPTION_LENGTH, optional = false) {
    if (!value || typeof value !== 'string') {
      if (!optional) {
        this.addError(fieldName, `${fieldName} is required`);
      }
      return null;
    }

    const trimmed = value.trim();
    if (trimmed.length > maxLength) {
      this.addError(fieldName, `${fieldName} too long (max ${maxLength} characters)`);
      return null;
    }

    if (!ValidationPatterns.SAFE_TEXT.test(trimmed)) {
      this.addError(fieldName, `${fieldName} contains unsafe characters`);
      return null;
    }

    return escapeHtml(trimmed);
  }

  /**
   * Validate boolean value
   * @param {any} value - Value to validate
   * @param {string} fieldName - Field name for error reporting
   * @returns {boolean} - Validated boolean value
   */
  validateBoolean(value, fieldName = 'Boolean') {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower === 'true' || lower === '1') return true;
      if (lower === 'false' || lower === '0') return false;
    }

    if (typeof value === 'number') {
      return value !== 0;
    }

    this.addError(fieldName, `${fieldName} must be a boolean value`);
    return false;
  }
}

/**
 * Sanitize and validate form data from admin forms
 * @param {FormData|Object} formData - Form data to validate
 * @param {Object} schema - Validation schema
 * @returns {Object} - Validation result with data and errors
 */
export function validateAdminForm(formData, schema) {
  const validator = new AdminInputValidator();
  const result = {};

  for (const [fieldName, config] of Object.entries(schema)) {
    const value = formData instanceof FormData ? formData.get(fieldName) : formData[fieldName];

    let validatedValue = null;

    switch (config.type) {
      case 'discordId':
        validatedValue = validator.validateDiscordId(value, config.label || fieldName);
        break;

      case 'ethAddress':
        validatedValue = validator.validateEthAddress(value, config.label || fieldName, config.optional);
        break;

      case 'tokenSymbol':
        validatedValue = validator.validateTokenSymbol(value, config.label || fieldName);
        break;

      case 'username':
        validatedValue = validator.validateUsername(value, config.label || fieldName, config.optional);
        break;

      case 'positiveDecimal':
        validatedValue = validator.validatePositiveDecimal(
          value,
          config.label || fieldName,
          config.optional,
          config.min,
          config.max
        );
        break;

      case 'percentage':
        validatedValue = validator.validatePercentage(value, config.label || fieldName, config.optional);
        break;

      case 'numericId':
        validatedValue = validator.validateNumericId(value, config.label || fieldName);
        break;

      case 'safeText':
        validatedValue = validator.validateSafeText(
          value,
          config.label || fieldName,
          config.maxLength,
          config.optional
        );
        break;

      case 'boolean':
        validatedValue = validator.validateBoolean(value, config.label || fieldName);
        break;

      default:
        validator.addError(fieldName, `Unknown validation type: ${config.type}`);
    }

    if (validatedValue !== null || config.optional) {
      result[fieldName] = validatedValue;
    }
  }

  return {
    isValid: validator.isValid(),
    data: result,
    errors: validator.getErrors()
  };
}

/**
 * Rate limiting for admin operations
 */
export class AdminRateLimit {
  constructor() {
    this.operations = new Map();
    this.limits = {
      userDeletion: { max: 5, window: 60000 }, // 5 deletions per minute
      tokenCreation: { max: 10, window: 300000 }, // 10 tokens per 5 minutes
      balanceEdit: { max: 20, window: 60000 }, // 20 edits per minute
      export: { max: 10, window: 60000 } // 10 exports per minute
    };
  }

  /**
   * Check if operation is allowed
   * @param {string} operation - Operation type
   * @param {string} identifier - User/session identifier
   * @returns {boolean} - Whether operation is allowed
   */
  isAllowed(operation, identifier = 'default') {
    const key = `${operation}:${identifier}`;
    const limit = this.limits[operation];

    if (!limit) return true; // No limit defined

    const now = Date.now();
    const records = this.operations.get(key) || [];

    // Remove old records outside the window
    const validRecords = records.filter(time => now - time < limit.window);

    if (validRecords.length >= limit.max) {
      return false;
    }

    // Add current operation
    validRecords.push(now);
    this.operations.set(key, validRecords);

    return true;
  }

  /**
   * Get remaining operations for a limit
   * @param {string} operation - Operation type
   * @param {string} identifier - User/session identifier
   * @returns {number} - Remaining operations
   */
  getRemaining(operation, identifier = 'default') {
    const key = `${operation}:${identifier}`;
    const limit = this.limits[operation];

    if (!limit) return Infinity;

    const now = Date.now();
    const records = this.operations.get(key) || [];
    const validRecords = records.filter(time => now - time < limit.window);

    return Math.max(0, limit.max - validRecords.length);
  }
}

// Global rate limiter instance
export const adminRateLimit = new AdminRateLimit();
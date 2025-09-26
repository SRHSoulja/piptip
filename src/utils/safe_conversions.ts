// src/utils/safe_conversions.ts - Safe number conversion utilities for financial operations
export class ValidationError extends Error {
  constructor(message: string, public value: any) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface SafeNumberOptions {
  min?: number;
  max?: number;
  allowZero?: boolean;
  label?: string;
}

/**
 * Safely convert value to number with validation for financial operations
 */
export function safeToNumber(value: any, options: SafeNumberOptions = {}): number {
  const { min, max, allowZero = true, label = 'value' } = options;

  // Handle null/undefined
  if (value == null) {
    throw new ValidationError(`${label} cannot be null or undefined`, value);
  }

  // Convert to number
  let num: number;
  if (typeof value === 'number') {
    num = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      throw new ValidationError(`${label} cannot be empty string`, value);
    }
    num = Number(trimmed);
  } else if (typeof value === 'bigint') {
    num = Number(value);
  } else {
    num = Number(value);
  }

  // Check for NaN
  if (isNaN(num)) {
    throw new ValidationError(`${label} must be a valid number, got: ${value}`, value);
  }

  // Check for infinity
  if (!isFinite(num)) {
    throw new ValidationError(`${label} must be finite, got: ${value}`, value);
  }

  // Check zero
  if (!allowZero && num === 0) {
    throw new ValidationError(`${label} cannot be zero`, value);
  }

  // Check min/max bounds
  if (min !== undefined && num < min) {
    throw new ValidationError(`${label} must be at least ${min}, got: ${num}`, value);
  }

  if (max !== undefined && num > max) {
    throw new ValidationError(`${label} cannot exceed ${max}, got: ${num}`, value);
  }

  return num;
}

/**
 * Safely convert balance values with financial constraints
 */
export function safeBalanceToNumber(value: any, label = 'balance'): number {
  return safeToNumber(value, {
    min: 0,
    allowZero: true,
    max: Number.MAX_SAFE_INTEGER,
    label
  });
}

/**
 * Safely convert amount values for tips/transfers with financial constraints
 */
export function safeAmountToNumber(value: any, label = 'amount'): number {
  return safeToNumber(value, {
    min: 0,
    allowZero: false, // Amounts should be positive for financial operations
    max: 1000000000, // 1 billion limit
    label
  });
}

/**
 * Safely convert percentage values (0-100)
 */
export function safePercentageToNumber(value: any, label = 'percentage'): number {
  return safeToNumber(value, {
    min: 0,
    max: 100,
    allowZero: true,
    label
  });
}

/**
 * Safely parse integer with radix for consistent parsing
 */
export function safeParseInt(value: string | number, radix = 10, label = 'integer'): number {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new ValidationError(`${label} must be an integer, got: ${value}`, value);
    }
    return value;
  }

  const trimmed = String(value).trim();
  if (trimmed === '') {
    throw new ValidationError(`${label} cannot be empty`, value);
  }

  const parsed = parseInt(trimmed, radix);
  if (isNaN(parsed)) {
    throw new ValidationError(`${label} must be a valid integer, got: ${value}`, value);
  }

  return parsed;
}
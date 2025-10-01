class ValidationError extends Error {
  constructor(message, value) {
    super(message);
    this.value = value;
    this.name = "ValidationError";
  }
}
function safeToNumber(value, options = {}) {
  const { min, max, allowZero = true, label = "value" } = options;
  if (value == null) {
    throw new ValidationError(`${label} cannot be null or undefined`, value);
  }
  let num;
  if (typeof value === "number") {
    num = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      throw new ValidationError(`${label} cannot be empty string`, value);
    }
    num = Number(trimmed);
  } else if (typeof value === "bigint") {
    num = Number(value);
  } else {
    num = Number(value);
  }
  if (isNaN(num)) {
    throw new ValidationError(`${label} must be a valid number, got: ${value}`, value);
  }
  if (!isFinite(num)) {
    throw new ValidationError(`${label} must be finite, got: ${value}`, value);
  }
  if (!allowZero && num === 0) {
    throw new ValidationError(`${label} cannot be zero`, value);
  }
  if (min !== void 0 && num < min) {
    throw new ValidationError(`${label} must be at least ${min}, got: ${num}`, value);
  }
  if (max !== void 0 && num > max) {
    throw new ValidationError(`${label} cannot exceed ${max}, got: ${num}`, value);
  }
  return num;
}
function safeBalanceToNumber(value, label = "balance") {
  return safeToNumber(value, {
    min: 0,
    allowZero: true,
    max: Number.MAX_SAFE_INTEGER,
    label
  });
}
function safeAmountToNumber(value, label = "amount") {
  return safeToNumber(value, {
    min: 0,
    allowZero: false,
    // Amounts should be positive for financial operations
    max: 1e9,
    // 1 billion limit
    label
  });
}
function safePercentageToNumber(value, label = "percentage") {
  return safeToNumber(value, {
    min: 0,
    max: 100,
    allowZero: true,
    label
  });
}
function safeParseInt(value, radix = 10, label = "integer") {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new ValidationError(`${label} must be an integer, got: ${value}`, value);
    }
    return value;
  }
  const trimmed = String(value).trim();
  if (trimmed === "") {
    throw new ValidationError(`${label} cannot be empty`, value);
  }
  const parsed = parseInt(trimmed, radix);
  if (isNaN(parsed)) {
    throw new ValidationError(`${label} must be a valid integer, got: ${value}`, value);
  }
  return parsed;
}
export {
  ValidationError,
  safeAmountToNumber,
  safeBalanceToNumber,
  safeParseInt,
  safePercentageToNumber,
  safeToNumber
};
//# sourceMappingURL=safe_conversions.js.map

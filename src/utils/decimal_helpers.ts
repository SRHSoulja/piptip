// src/utils/decimal_helpers.ts - Safe conversion helpers for bigint ↔ Decimal
import { Prisma } from '@prisma/client';

/**
 * Safely convert bigint to Prisma.Decimal
 * Ensures no precision loss or scientific notation issues
 */
export function bigintToDecimal(value: bigint): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

/**
 * Safely convert Decimal to bigint
 * Throws if Decimal has fractional part
 */
export function decimalToBigInt(value: Prisma.Decimal | string | number): bigint {
  const decimalValue = new Prisma.Decimal(value.toString());

  // Check if has fractional part
  if (!decimalValue.isInteger()) {
    throw new Error(`Cannot convert Decimal ${value} to bigint - has fractional part`);
  }

  return BigInt(decimalValue.toFixed(0));
}

/**
 * Convert bigint with decimals to Decimal (for token amounts)
 * Example: 1000000000000000000n with 18 decimals = 1.0
 */
export function atomicToBigintDecimal(atomic: bigint, decimals: number): Prisma.Decimal {
  const atomicStr = atomic.toString();

  if (decimals === 0) {
    return new Prisma.Decimal(atomicStr);
  }

  // Handle negative values
  const isNegative = atomic < 0n;
  const absAtomic = isNegative ? -atomic : atomic;
  const absStr = absAtomic.toString();

  // Pad with zeros if needed
  const padded = absStr.padStart(decimals + 1, '0');
  const integerPart = padded.slice(0, -decimals) || '0';
  const fractionalPart = padded.slice(-decimals);

  const result = `${isNegative ? '-' : ''}${integerPart}.${fractionalPart}`;
  return new Prisma.Decimal(result);
}

/**
 * Convert Decimal to atomic bigint (for token amounts)
 * Example: 1.0 with 18 decimals = 1000000000000000000n
 */
export function bigintDecimalToAtomic(value: Prisma.Decimal | string | number, decimals: number): bigint {
  const decimal = new Prisma.Decimal(value.toString());

  if (decimals === 0) {
    return decimalToBigInt(decimal);
  }

  // Multiply by 10^decimals to get atomic units
  const multiplier = new Prisma.Decimal(10).pow(decimals);
  const atomic = decimal.mul(multiplier);

  return decimalToBigInt(atomic);
}
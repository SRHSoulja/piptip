import { Prisma } from "@prisma/client";
function bigintToDecimal(value) {
  return new Prisma.Decimal(value.toString());
}
function decimalToBigInt(value) {
  const decimalValue = new Prisma.Decimal(value.toString());
  if (!decimalValue.isInteger()) {
    throw new Error(`Cannot convert Decimal ${value} to bigint - has fractional part`);
  }
  return BigInt(decimalValue.toFixed(0));
}
function atomicToBigintDecimal(atomic, decimals) {
  const atomicStr = atomic.toString();
  if (decimals === 0) {
    return new Prisma.Decimal(atomicStr);
  }
  const isNegative = atomic < 0n;
  const absAtomic = isNegative ? -atomic : atomic;
  const absStr = absAtomic.toString();
  const padded = absStr.padStart(decimals + 1, "0");
  const integerPart = padded.slice(0, -decimals) || "0";
  const fractionalPart = padded.slice(-decimals);
  const result = `${isNegative ? "-" : ""}${integerPart}.${fractionalPart}`;
  return new Prisma.Decimal(result);
}
function bigintDecimalToAtomic(value, decimals) {
  const decimal = new Prisma.Decimal(value.toString());
  if (decimals === 0) {
    return decimalToBigInt(decimal);
  }
  const multiplier = new Prisma.Decimal(10).pow(decimals);
  const atomic = decimal.mul(multiplier);
  return decimalToBigInt(atomic);
}
export {
  atomicToBigintDecimal,
  bigintDecimalToAtomic,
  bigintToDecimal,
  decimalToBigInt
};
//# sourceMappingURL=decimal_helpers.js.map

// Legacy token fallback service - handles TOKEN_ADDRESS migration
// Provides fallback to PENGU or first active token when TOKEN_ADDRESS is needed

import { getActiveTokens, getTokenBySymbol } from "./token.js";

/**
 * Get the legacy default token for backward compatibility.
 * Priority: PENGU > first active token > error
 */
export async function getLegacyDefaultToken() {
  const tokens = await getActiveTokens();

  if (tokens.length === 0) {
    throw new Error("No active tokens configured in database");
  }

  // Try to find PENGU first (main token)
  const pengu = await getTokenBySymbol("PENGU");
  if (pengu) {
    return pengu;
  }

  // Fallback to first active token
  return tokens[0];
}

/**
 * Get legacy token address for TOKEN_ADDRESS compatibility.
 * Returns PENGU address if available, otherwise first active token.
 */
export async function getLegacyTokenAddress(): Promise<string> {
  const token = await getLegacyDefaultToken();
  return token.address;
}

/**
 * Get legacy token decimals for TOKEN_DECIMALS compatibility.
 */
export async function getLegacyTokenDecimals(): Promise<number> {
  const token = await getLegacyDefaultToken();
  return token.decimals;
}

/**
 * Check if TOKEN_ADDRESS environment variable matches any active token.
 * Used for validation and migration warnings.
 */
export async function validateTokenAddressEnv(): Promise<{
  valid: boolean;
  configured?: string;
  recommended?: string;
  message: string;
}> {
  const envTokenAddress = process.env.TOKEN_ADDRESS?.toLowerCase();

  if (!envTokenAddress) {
    const recommended = await getLegacyTokenAddress();
    return {
      valid: false,
      recommended,
      message: "TOKEN_ADDRESS not configured"
    };
  }

  const tokens = await getActiveTokens();
  const matchingToken = tokens.find(t => t.address === envTokenAddress);

  if (matchingToken) {
    return {
      valid: true,
      configured: envTokenAddress,
      message: `TOKEN_ADDRESS matches active token: ${matchingToken.symbol}`
    };
  }

  const recommended = await getLegacyTokenAddress();
  return {
    valid: false,
    configured: envTokenAddress,
    recommended,
    message: "TOKEN_ADDRESS does not match any active token"
  };
}
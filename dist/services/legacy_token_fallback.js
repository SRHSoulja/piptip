import { getActiveTokens, getTokenBySymbol } from "./token.js";
async function getLegacyDefaultToken() {
  const tokens = await getActiveTokens();
  if (tokens.length === 0) {
    throw new Error("No active tokens configured in database");
  }
  const pengu = await getTokenBySymbol("PENGU");
  if (pengu) {
    return pengu;
  }
  return tokens[0];
}
async function getLegacyTokenAddress() {
  const token = await getLegacyDefaultToken();
  return token.address;
}
async function getLegacyTokenDecimals() {
  const token = await getLegacyDefaultToken();
  return token.decimals;
}
async function validateTokenAddressEnv() {
  const envTokenAddress = process.env.TOKEN_ADDRESS?.toLowerCase();
  if (!envTokenAddress) {
    const recommended2 = await getLegacyTokenAddress();
    return {
      valid: false,
      recommended: recommended2,
      message: "TOKEN_ADDRESS not configured"
    };
  }
  const tokens = await getActiveTokens();
  const matchingToken = tokens.find((t) => t.address === envTokenAddress);
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
export {
  getLegacyDefaultToken,
  getLegacyTokenAddress,
  getLegacyTokenDecimals,
  validateTokenAddressEnv
};
//# sourceMappingURL=legacy_token_fallback.js.map

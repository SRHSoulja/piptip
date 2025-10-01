const MOCK_PRICES = {
  "ABSTER": 0.02,
  "ICE": 0.01,
  "PEBBLE": 1e-3,
  "PIPCHIPS": 1e-4
};
async function getMockTokenPrice(symbol) {
  await new Promise((resolve) => setTimeout(resolve, 10));
  return MOCK_PRICES[symbol] || 0.01;
}
function isTestMode() {
  return process.env.NODE_ENV === "test" || process.env.USE_MOCK_PRICES === "true" || process.argv.some((arg) => arg.includes("test"));
}
function getTransactionTimeout() {
  if (isTestMode()) {
    return 15e3;
  }
  return 5e3;
}
function getValidTransactionTypes() {
  return {
    // Daily rewards
    DAILY_BONUS: "DAILY_BONUS",
    STREAK_BONUS: "STREAK_BONUS",
    STARTING_BONUS: "STARTING_BONUS",
    // Purchases
    PURCHASE: "PURCHASE",
    // Match betting (1v1 games)
    BET_PLACED: "BET_PLACED",
    BET_WON: "BET_WON",
    BET_REFUNDED: "BET_REFUNDED",
    // Prediction markets
    PREDICTION_BET: "PREDICTION_BET",
    PREDICTION_WIN: "PREDICTION_WIN",
    PREDICTION_LOSS: "PREDICTION_LOSS",
    // Tournaments
    TOURNAMENT_ENTRY: "TOURNAMENT_ENTRY",
    TOURNAMENT_BET: "TOURNAMENT_BET",
    TOURNAMENT_WIN: "TOURNAMENT_WIN",
    TOURNAMENT_PRIZE: "TOURNAMENT_PRIZE",
    // Admin operations
    ADMIN_CREDIT: "ADMIN_CREDIT",
    ADMIN_DEBIT: "ADMIN_DEBIT",
    // Referrals
    REFERRAL_BONUS: "REFERRAL_BONUS"
  };
}
function getAllTransactionTypes() {
  return Object.values(getValidTransactionTypes());
}
export {
  MOCK_PRICES,
  getAllTransactionTypes,
  getMockTokenPrice,
  getTransactionTimeout,
  getValidTransactionTypes,
  isTestMode
};
//# sourceMappingURL=test_mocks.js.map

/**
 * Test Mocks Module
 *
 * Provides mock implementations for external services during testing
 * to avoid timeouts, rate limits, and unnecessary API calls.
 */
// Mock price data for testing
export const MOCK_PRICES = {
    'ABSTER': 0.02,
    'ICE': 0.01,
    'PEBBLE': 0.001,
    'PIPCHIPS': 0.0001,
};
/**
 * Mock price API that returns fixed values instantly
 */
export async function getMockTokenPrice(symbol) {
    // Simulate minimal network delay (10ms)
    await new Promise(resolve => setTimeout(resolve, 10));
    return MOCK_PRICES[symbol] || 0.01;
}
/**
 * Check if we're in test mode
 */
export function isTestMode() {
    return process.env.NODE_ENV === 'test' ||
        process.env.USE_MOCK_PRICES === 'true' ||
        process.argv.some(arg => arg.includes('test'));
}
/**
 * Get transaction timeout for current environment
 */
export function getTransactionTimeout() {
    // Use longer timeout in test mode to account for slower test databases
    if (isTestMode()) {
        return 15000; // 15 seconds for tests
    }
    // Production timeout
    return 5000; // 5 seconds
}
/**
 * Get valid PIPChips transaction types for testing
 *
 * These types correspond to the PipchipsTransactionType enum in schema.prisma
 * and are used throughout the application for transaction logging.
 */
export function getValidTransactionTypes() {
    return {
        // Daily rewards
        DAILY_BONUS: 'DAILY_BONUS',
        STREAK_BONUS: 'STREAK_BONUS',
        STARTING_BONUS: 'STARTING_BONUS',
        // Purchases
        PURCHASE: 'PURCHASE',
        // Match betting (1v1 games)
        BET_PLACED: 'BET_PLACED',
        BET_WON: 'BET_WON',
        BET_REFUNDED: 'BET_REFUNDED',
        // Prediction markets
        PREDICTION_BET: 'PREDICTION_BET',
        PREDICTION_WIN: 'PREDICTION_WIN',
        PREDICTION_LOSS: 'PREDICTION_LOSS',
        // Tournaments
        TOURNAMENT_ENTRY: 'TOURNAMENT_ENTRY',
        TOURNAMENT_BET: 'TOURNAMENT_BET',
        TOURNAMENT_WIN: 'TOURNAMENT_WIN',
        TOURNAMENT_PRIZE: 'TOURNAMENT_PRIZE',
        // Admin operations
        ADMIN_CREDIT: 'ADMIN_CREDIT',
        ADMIN_DEBIT: 'ADMIN_DEBIT',
        // Referrals
        REFERRAL_BONUS: 'REFERRAL_BONUS',
    };
}
/**
 * Get all valid transaction type values as an array
 */
export function getAllTransactionTypes() {
    return Object.values(getValidTransactionTypes());
}

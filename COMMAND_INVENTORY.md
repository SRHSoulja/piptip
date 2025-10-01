# Discord Command & Interaction Inventory

## Slash Commands (19 total)

### 1. `/pip_help` 
**Purpose:** Show help and command list  
**Platform:** Discord-only  
**Status:** ✅ Active - Redirects to website for prediction markets  
**Migration:** N/A - Keep as Discord navigation

### 2. `/pip_link`
**Purpose:** Link Discord account to Abstract wallet  
**Platform:** Discord-only (requires OAuth)  
**Status:** ✅ Active  
**Migration:** N/A - Discord-specific authentication

### 3. `/pip_deposit`
**Purpose:** Show deposit instructions  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Migration:** Could add to website dashboard

### 4. `/pip_withdraw`
**Purpose:** Request token withdrawal to wallet  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Blockchain:** YES - Transfers tokens from treasury  
**Migration:** Should add to website for accessibility

### 5. `/pip_balance`
**Purpose:** Check token balances  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Migration:** Should add to website dashboard

### 6. `/pip_game` (Rock-Paper-Scissors)
**Purpose:** Challenge another user to RPS match with wager  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Migration:** Could add web-based version

### 7. `/pip_tip`
**Purpose:** Send tokens to another user  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Migration:** Could add to website (like Venmo)

### 8. `/pip_daily`
**Purpose:** Claim daily PIPChips reward  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Migration:** Should add to website

### 9. `/pip_buy_chips`
**Purpose:** Purchase PIPChips with real tokens  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Blockchain:** YES - Token swap operation  
**Migration:** ⚠️ SHOULD MIGRATE - Critical for onboarding

### 10. `/pip_profile`
**Purpose:** View user profile and stats  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Migration:** Should add to website (PenguBook integration)

### 11. `/pip_bio`
**Purpose:** Set user bio for PenguBook  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Migration:** Should add to website profile editor

### 12. `/pip_pengubook`
**Purpose:** Browse user profiles  
**Platform:** Discord + Website  
**Status:** ✅ Active - Website at `/pengubook`  
**Migration:** ✅ DONE

### 13. `/pip_achievements`
**Purpose:** View unlocked achievements  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Migration:** Should add to website profile

### 14. `/pip_stats`
**Purpose:** View personal statistics  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Migration:** Should add to website dashboard

### 15. `/pip_leaderboard`
**Purpose:** View top players  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Migration:** Should add to website

### 16. `/pip_referral`
**Purpose:** Generate referral code  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Migration:** Should add to website

### 17. `/pip_settings`
**Purpose:** Manage user preferences  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Migration:** Should add to website settings page

### 18. `/pip_safety`
**Purpose:** Set responsible gaming limits  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Migration:** ⚠️ MUST MIGRATE - Regulatory compliance

### 19. `/pip_apply`
**Purpose:** Apply for server approval  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Migration:** N/A - Server-specific

### 20. `/pip_automation_status`
**Purpose:** Check automation status (admin)  
**Platform:** Discord-only  
**Status:** ✅ Active  
**Migration:** Should add to admin panel

---

## Button Interactions (13 files)

### Match Buttons (`src/interactions/buttons/matches.ts`)
- `accept_match` - Accept match challenge
- `decline_match` - Decline match challenge
- `play_rock`, `play_paper`, `play_scissors` - Make move

### Withdrawal Buttons (`src/interactions/buttons/withdrawals.ts`)
- `confirm_withdrawal` - Confirm withdrawal request
- `cancel_withdrawal` - Cancel withdrawal
**Blockchain:** YES - Processes on-chain transfers

### Deposit Buttons (`src/interactions/buttons/deposits.ts`)
- `check_deposit` - Check deposit status
- `deposit_tutorial` - Show deposit guide

### Tip Buttons (`src/interactions/buttons/tips.ts`)
- `tip_confirm` - Confirm tip transaction
- `tip_cancel` - Cancel tip

### Profile Buttons (`src/interactions/buttons/profile.ts`)
- `view_profile` - View user profile
- `edit_bio` - Edit bio
- `set_social` - Set social links

### Settings Buttons (`src/interactions/buttons/settings.ts`)
- `toggle_pengubook` - Show/hide in PenguBook
- `toggle_tips` - Allow/block tips

### Wallet Buttons (`src/interactions/buttons/wallet.ts`)
- `link_wallet` - Link Abstract wallet
- `unlink_wallet` - Unlink wallet

### Achievement Buttons (`src/interactions/buttons/achievements.ts`)
- `view_achievement` - View achievement details
- `claim_reward` - Claim achievement reward

### Tier Buttons (`src/interactions/buttons/tiers.ts`)
- `purchase_tier` - Buy premium tier
- `view_tier_benefits` - Show tier perks

### Help Buttons (`src/interactions/buttons/help.ts`)
- Navigation buttons for help system

### Stats Buttons (`src/interactions/buttons/stats.ts`)
- `refresh_stats` - Reload statistics

### PenguBook Buttons (`src/interactions/buttons/pengubook.ts`)
- `browse_profiles` - Browse user profiles
- `send_message` - Send DM

### Group Tip (`src/interactions/group_tip_*.ts`)
- `create_group_tip` - Create group tip pool
- `contribute_group_tip` - Add to pool
- `claim_group_tip` - Claim from pool

---

## Blockchain Operations

### Deposit Detection (`src/workers/deposits.ts`)
**Flow:**
1. Poll Abstract blockchain for token transfers to treasury
2. Detect user deposits via memo/tag
3. Credit UserBalance
4. Create Transaction + BalanceDelta records
**Status:** ✅ Active worker process

### Withdrawal Processing (`src/services/atomic_withdrawal.ts`)
**Flow:**
1. User requests withdrawal via `/pip_withdraw`
2. Validate balance, limits, safety checks
3. Create pending WithdrawalAttempt
4. Treasury sends tokens on-chain
5. Store txHash, update balances
**Status:** ✅ Active
**Safety:** Rate limits, daily caps, fraud detection

### Treasury Operations (`src/services/treasury.ts`)
**Functions:**
- `getBalance()` - Check treasury balance
- `sendTokens()` - Execute withdrawals
- `estimateGas()` - Calculate transaction cost
**Status:** ✅ Active

### Cold Storage Transfer (`src/services/treasury_cold_transfer.ts`)
**Purpose:** Auto-transfer excess treasury to cold wallet
**Trigger:** Treasury balance > threshold
**Status:** ✅ Active with monitoring

### PIPChips Purchase (`/pip_buy_chips`)
**Flow:**
1. User specifies token and amount
2. Debit user's token balance
3. Credit PIPChips at exchange rate
4. Create swap transaction record
**Blockchain:** Indirect (uses existing balances)

---

## Migration Priority

### HIGH Priority (User-facing critical features)
1. ⚠️ `/pip_buy_chips` - Onboarding flow
2. ⚠️ `/pip_safety` - Responsible gaming (regulatory)
3. ⚠️ `/pip_withdraw` - Money out (accessibility)
4. ⚠️ `/pip_balance` - Account overview

### MEDIUM Priority (Convenience features)
5. `/pip_daily` - Daily rewards
6. `/pip_tip` - Social tipping
7. `/pip_profile` - User profiles
8. `/pip_achievements` - Gamification
9. `/pip_leaderboard` - Competition

### LOW Priority (Discord-native features)
10. `/pip_game` - RPS (works well in Discord)
11. `/pip_help` - Navigation (keep in Discord)
12. `/pip_apply` - Server admin (keep in Discord)

---

## Testing Coverage Gaps

### Currently Tested (Backend only)
✅ Match logic (wagers, payouts, rake)
✅ Prediction markets (betting, resolution)
✅ TPIP tournaments
✅ Balance calculations
✅ Transaction logging

### NOT Tested (Need integration tests)
❌ Discord command execution
❌ Button interaction handling
❌ Deposit detection from blockchain
❌ Withdrawal execution to blockchain
❌ Treasury reconciliation
❌ Cold storage transfers
❌ Rate limiting
❌ Concurrent user interactions

---

## Recommended Test Files

### 1. `tests/discord_integration.test.ts`
Mock Discord interactions, test:
- Command parsing and validation
- Button interaction handling
- Error message formatting
- Permission checks
- Rate limiting

### 2. `tests/blockchain_ops.test.ts`
Test on Abstract testnet:
- Deposit detection and crediting
- Withdrawal processing and txHash storage
- Treasury balance reconciliation
- Gas estimation accuracy
- Multi-token operations

### 3. `tests/scaling_failover.test.ts`
Stress test:
- 100+ concurrent matches
- Process crash and restart
- Database connection loss
- Redis failover
- Orphaned transaction detection


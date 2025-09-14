# Manual Viral Notification Testing Procedure

## Skip the Mock - Test with Real Accounts

### Test Setup (5 minutes)
1. Create 3-5 test Discord accounts
2. Join your test Discord server with all accounts
3. Set up a dedicated #achievement-spam channel for testing
4. Prepare one easy achievement (e.g., "Send your first tip")

### Viral Moment Simulation (10 minutes)

```bash
# Step 1: Trigger simultaneous achievement unlocks
# Have all 5 test accounts perform the same action within 30 seconds
# Example: All accounts send tips to unlock "First Tip" achievement

# Step 2: Monitor notification behavior
# Check #achievement-spam channel for:
# - Message count (should be batched, not 5 individual messages)
# - Response time (should be under 3 seconds total)
# - No Discord rate limit errors

# Step 3: Scale test with automation
# Use Discord.js script to simulate 10+ accounts:
const accounts = []; // Your test bot tokens
const simultaneousActions = accounts.map(account =>
  triggerAchievement(account, 'first_tip')
);
await Promise.all(simultaneousActions);
```

### Success Criteria ✅
- Multiple users unlocking same achievement → Single batched notification
- No Discord rate limit errors (429 responses)
- Channel doesn't get spammed with individual messages
- Users still feel celebrated (mention in batched message)

### Expected Results
**GOOD**: "🎉 5 users just unlocked 'First Tip' achievement! @user1 @user2 @user3 @user4 @user5"

**BAD**: 5 separate messages flooding the channel

### If Issues Found:
1. Check Discord webhook rate limits (5 requests/second)
2. Verify notification batching logic in `src/services/notifications.ts`
3. Test with smaller batches (2-3 users first)

**Time Investment**: 15 minutes vs days of mock fixing
**Real Value**: Actual Discord API behavior validation ✅
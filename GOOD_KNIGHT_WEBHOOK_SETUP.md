# Good Knight Webhook Integration Setup

PIPTip now integrates with **Good Knight's secure webhook management system** to ensure all Discord webhooks are properly authorized and secure.

## 🛡️ What Good Knight Provides

Good Knight's webhook manager prevents unauthorized webhook usage by:
- **Centralized Authorization**: Only approved webhooks can send messages
- **Security Validation**: Prevents webhook token leaks and unauthorized access
- **Management Interface**: Easy webhook registration/unregistration
- **Audit Trail**: Track all webhook activity

## 📋 Setup Steps

### 1. Register Your Webhook with Good Knight

Use Good Knight's webhook management panel:

1. **Command**: Use Good Knight's webhook manager (appears to be triggered by a bot command)
2. **Choose "Register"**: Select the register option
3. **Provide Webhook ID**: Extract from your `DISCORD_WEBHOOK_URL`

**Extract Webhook ID from URL:**
```
https://discord.com/api/webhooks/1234567890123456789/abcdef123456...
                                 ^^^^^^^^^^^^^^^^^^^ <- This is your Webhook ID
```

### 2. Environment Configuration

Add these environment variables to your `.env`:

```bash
# Your existing Discord webhook (must be registered with Good Knight)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_TOKEN
DISCORD_GUILD_ID=your_guild_id_here
DISCORD_CHANNEL_ID=your_channel_id_here

# Good Knight Integration - WEBHOOK ID ONLY (17-19 digits)
GOOD_KNIGHT_WEBHOOK_ALLOWLIST=YOUR_WEBHOOK_ID
GOOD_KNIGHT_AUTHORIZED_WEBHOOKS=YOUR_WEBHOOK_ID:YOUR_TOKEN:your_guild_id:your_channel_id:alerts|monitoring|system

# Optional: Multiple webhooks (comma separated IDs only)
# GOOD_KNIGHT_WEBHOOK_ALLOWLIST=1234567890123456789,9876543210987654321
```

### 3. Test Integration

1. **Access Admin Panel**: `/admin/ui`
2. **Navigate to**: Good Knight Webhooks section
3. **Check Status**: View webhook authorization status
4. **Send Test**: Use the test webhook feature

## 🔧 Good Knight Webhook Features

### Automatic Authorization Checks
```typescript
// PIPTip automatically checks Good Knight authorization
const result = await sendGoodKnightAlert('alert', 'Test Alert', 'Message content');
```

### Webhook Types Supported
- **🚨 alert**: Critical system alerts (negative balances, security issues)
- **📊 monitoring**: Resource usage alerts, performance warnings
- **⚙️ system**: General system notifications
- **🏆 achievement**: Achievement unlock notifications (future)

### Fallback System
If Good Knight webhook fails:
- ✅ Messages logged to fallback system
- ✅ Admin dashboard shows failed attempts
- ✅ No data loss - all alerts preserved

## 📊 Admin Dashboard Integration

### Webhook Status Panel
- **Authorization Status**: Shows which webhooks are Good Knight approved
- **Recent Activity**: Last 20 webhook attempts with success/failure
- **Configuration Check**: Validates environment setup
- **Test Function**: Send test messages through Good Knight

### Resource Monitoring Alerts
PIPTip will automatically send Good Knight webhooks when:
- **Memory > 85%**: Critical - immediate upgrade needed
- **CPU > 80%**: Warning - monitor closely
- **Event Loop > 300ms**: Performance degraded

## 🚨 Required Actions for You

### Step 1: Register Webhook ID with Good Knight
1. Use Good Knight webhook manager
2. Select "Register"
3. Provide your webhook ID: `extract from DISCORD_WEBHOOK_URL`

### Step 2: Set Environment Variables
```bash
# Add to your .env file
DISCORD_GUILD_ID=your_server_id
GOOD_KNIGHT_WEBHOOK_ALLOWLIST=your_webhook_id_only

# Example:
# GOOD_KNIGHT_WEBHOOK_ALLOWLIST=1234567890123456789
```

### Step 3: Test the Integration
1. Deploy updated PIPTip
2. Check `/admin/ui` → Good Knight section
3. Send test webhook to verify authorization

## 🔍 Troubleshooting

### Webhook Not Authorized
- **Check**: Good Knight registration status
- **Verify**: `GOOD_KNIGHT_WEBHOOK_ALLOWLIST` contains only webhook ID (17-19 digits)
- **Confirm**: Webhook ID matches registered ID exactly

### Alerts Not Sending
- **Review**: Admin panel webhook status
- **Check**: Fallback logs for error messages
- **Verify**: Good Knight bot permissions in your Discord server

### Testing Webhook Authorization
```bash
# Check current webhook status
curl -H "Authorization: Bearer $ADMIN_SECRET" \
  https://your-domain.com/admin/good-knight/status

# Send test webhook
curl -X POST -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"type":"system","message":"Test from curl"}' \
  https://your-domain.com/admin/good-knight/test
```

## ✅ Benefits

- **🛡️ Enhanced Security**: Only authorized webhooks can send messages
- **📊 Better Monitoring**: Resource alerts via Discord when Replit needs upgrading
- **🚨 Critical Alerts**: Immediate notifications for system issues
- **📈 Audit Trail**: Complete webhook activity logging
- **🔄 Fallback Protection**: No message loss even if webhooks fail

Your PIPTip bot is now **secure and monitored** with Good Knight integration! 🎯
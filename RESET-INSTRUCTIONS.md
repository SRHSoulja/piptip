# 🚨 SAFE DATA RESET INSTRUCTIONS

## ⚠️ CRITICAL WARNING
This process will **PERMANENTLY DELETE ALL USER DATA** from your PIPTip bot. Use with extreme caution.

## What Gets Deleted ❌
- All users and their Discord associations
- All user balances (tokens will be lost forever)
- All tips (direct and group) 
- All transactions and transaction history
- All matches and game records
- All notifications and claims
- All tier memberships

## What Gets Preserved ✅
- Token configurations and settings
- Approved Discord servers
- Admin configuration
- Tier definitions and pricing
- Application settings (fees, limits, etc.)
- Database schema and structure

## Pre-Execution Checklist

### 1. **STOP THE BOT** 🛑
```bash
# Stop your production bot first
pm2 stop piptip
# OR if running directly
# Kill the node process
```

### 2. **Verify Database Connection** 🔍
Make sure you're connected to the **correct database**:
```bash
# Check your DATABASE_URL
echo $DATABASE_URL
# Should show your production database URL
```

### 3. **Manual Backup** 💾 (Recommended)
Create an additional manual backup for extra safety:
```bash
# Replace with your actual database details
pg_dump -h your-host -U your-user -d your-database > manual-backup-$(date +%Y%m%d-%H%M%S).sql
```

## Execution Steps

### Step 1: Navigate to Project Directory
```bash
cd /path/to/your/piptip
```

### Step 2: Install Dependencies (if needed)
```bash
npm install
```

### Step 3: Run the Reset Tool
```bash
npm run reset-data
```

### Step 4: Follow All Prompts Carefully
The script will:
1. Show current database statistics
2. Require 4+ exact confirmation phrases
3. Create an automatic pre-reset backup
4. Require final "DELETE ALL DATA" confirmation
5. Perform the reset in a database transaction
6. Show detailed deletion summary

### Step 5: Restart Your Bot
```bash
pm2 start piptip
# OR start however you normally run it
```

## Testing After Reset

1. **Test user registration**: `/pip register`
2. **Test wallet linking**: `/pip link <wallet>`  
3. **Test deposits**: Send tokens to treasury
4. **Test direct tips**: `/pip tip @user amount token`
5. **Test group tips**: Use group tip flow
6. **Test profile stats**: `/pip profile` (should show clean data)

## Recovery Process (If Needed)

If something goes wrong, you can restore from the backup:

### Find the Backup File
```bash
ls -la backups/
# Look for the newest file with today's date
```

### Restore from Backup
```bash
# STOP THE BOT FIRST
pm2 stop piptip

# Restore from backup (replace filename)
psql -h your-host -U your-user -d your-database < backups/piptip_backup_YYYY-MM-DDTHH-MM-SS-SSSZ.sql

# START THE BOT
pm2 start piptip
```

## Emergency Contacts 📞

If you encounter any issues:
1. **DO NOT PANIC** - your data is backed up
2. Check the backup files in `/backups/` folder
3. The database transaction should prevent partial failures
4. All system configuration remains intact

## Final Reminders 🎯

- ✅ **Bot must be stopped** during reset
- ✅ **Multiple backups created** automatically  
- ✅ **System config preserved** (tokens, servers, etc.)
- ✅ **Transaction ensures atomicity** (all-or-nothing)
- ✅ **Easy to revert** from backup if needed

**This is your "child" - treat it with the respect and caution it deserves! 🤖💚**
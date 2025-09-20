# PIPTip Tier Role Management Setup

This guide explains how to set up Discord role management for tier memberships in PIPTip.

## Overview

The tier role management system automatically assigns Discord roles to users based on their active tier memberships. When users purchase or renew memberships, they receive corresponding Discord roles. When memberships expire, roles are automatically removed.

## Features

- ✅ **Automatic Role Assignment**: Roles assigned when memberships are purchased/renewed
- ✅ **Automatic Role Removal**: Roles removed when memberships expire
- ✅ **Periodic Sync**: Background service ensures role consistency (every 6 hours)
- ✅ **Membership Expiry Cleanup**: Background service processes expired memberships (every hour)
- ✅ **Admin Interface**: Manual role management via admin dashboard
- ✅ **Hierarchical Logic**: Users get role for their highest tier only

## Setup Instructions

### 1. Create Discord Roles

First, create roles in your Discord server:

1. Go to your Discord server settings
2. Navigate to "Roles"
3. Create roles for each tier (e.g., "PIP Bronze", "PIP Silver", "PIP Gold")
4. Position roles in hierarchy (higher tiers should be above lower tiers)
5. Copy each role's ID (right-click role → "Copy ID" with Developer Mode enabled)

### 2. Configure Environment Variables

Add the following to your `.env` file:

```bash
# Discord Tier Role Configuration
# Main server guild ID where roles will be assigned
DISCORD_MAIN_GUILD_ID=YOUR_GUILD_ID_HERE

# Tier role mappings (format: TIER_ID:ROLE_ID)
TIER_ROLE_BRONZE=1:123456789012345678
TIER_ROLE_SILVER=2:234567890123456789
TIER_ROLE_GOLD=3:345678901234567890

# Enable tier role management
ENABLE_TIER_ROLES=true
```

### 3. Update Role Configuration

Edit `/src/services/tier_role_manager.ts` and update the `TIER_ROLE_MAPPING` array:

```typescript
const TIER_ROLE_MAPPING: TierRoleConfig[] = [
  {
    tierId: 1,
    tierName: "Bronze",
    roleId: "123456789012345678",
    roleName: "PIP Bronze",
    guildId: "YOUR_GUILD_ID_HERE"
  },
  {
    tierId: 2,
    tierName: "Silver",
    roleId: "234567890123456789",
    roleName: "PIP Silver",
    guildId: "YOUR_GUILD_ID_HERE"
  },
  {
    tierId: 3,
    tierName: "Gold",
    roleId: "345678901234567890",
    roleName: "PIP Gold",
    guildId: "YOUR_GUILD_ID_HERE"
  }
];
```

### 4. Bot Permissions

Ensure your Discord bot has the "Manage Roles" permission in your server and can assign the tier roles (bot's role must be above the tier roles in the hierarchy).

### 5. Restart and Test

1. Restart your PIPTip application
2. Check logs for successful service startup:
   ```
   Tier management services started
   ```
3. Test via admin interface at `/admin/tier-roles/status`

## Admin Interface

Access tier role management via the admin dashboard:

### Endpoints

- **GET** `/admin/tier-roles/status` - View membership summary and status
- **POST** `/admin/tier-roles/sync` - Manual sync all tier roles
- **POST** `/admin/tier-roles/cleanup-expired` - Manual cleanup expired memberships
- **POST** `/admin/tier-roles/assign` - Manual role assignment
- **POST** `/admin/tier-roles/remove` - Manual role removal
- **GET** `/admin/tier-roles/configuration` - Get configuration template

### Example API Usage

```bash
# Check status
curl -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  http://localhost:3000/admin/tier-roles/status

# Manual sync all roles
curl -X POST -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  http://localhost:3000/admin/tier-roles/sync

# Assign role manually
curl -X POST -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"discordId":"123456789012345678","tierId":2}' \
  http://localhost:3000/admin/tier-roles/assign
```

## How It Works

### Automatic Role Assignment

1. **Purchase/Renewal**: When a user purchases or renews a tier membership via `/pip_profile` → tier purchase buttons
2. **Role Assignment**: The system automatically assigns the corresponding Discord role
3. **Hierarchy**: If user has multiple tiers, they get the role for their highest tier only
4. **Lower Tier Cleanup**: Roles for lower tiers are automatically removed

### Membership Expiry

1. **Background Service**: Runs every hour to check for expired memberships
2. **Status Update**: Changes expired `TierMembership` status from `ACTIVE` to `EXPIRED`
3. **Role Removal**: Removes Discord roles for expired memberships
4. **Multi-Tier Logic**: If user has other active memberships, assigns role for highest remaining tier

### Periodic Sync

1. **Background Service**: Runs every 6 hours to ensure role consistency
2. **Full Audit**: Checks all users with tier memberships
3. **Correction**: Assigns missing roles and removes incorrect roles
4. **Self-Healing**: Automatically fixes any role mismatches

## Troubleshooting

### Common Issues

1. **Roles not assigned**: Check bot permissions and role hierarchy
2. **Configuration errors**: Verify guild and role IDs are correct
3. **Service not starting**: Check logs for detailed error messages

### Debug Commands

```bash
# View recent logs
tail -f logs/piptip.log | grep -i "tier\|role"

# Test API connectivity
curl -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  http://localhost:3000/admin/tier-roles/configuration
```

### Manual Recovery

If roles get out of sync:

1. Use `/admin/tier-roles/sync` to fix all role assignments
2. Use `/admin/tier-roles/cleanup-expired` to process expired memberships
3. Check individual users with `/admin/tier-roles/assign` or `/admin/tier-roles/remove`

## Database Schema

The system uses these database models:

- **Tier**: Defines available membership tiers
- **TierMembership**: Tracks user memberships with expiry dates
- **User**: Links Discord IDs to internal user accounts

## Security Notes

- Admin endpoints require `ADMIN_SECRET` authentication
- Role operations fail gracefully without affecting membership purchases
- Services auto-recover on bot restart
- All role operations are logged for audit trails

## Future Enhancements

- Environment-based configuration (move role mapping to .env)
- Multi-guild support for bots in multiple servers
- Role change notifications to users
- Integration with achievement system
- Custom role colors and permissions per tier
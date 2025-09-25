#!/usr/bin/env tsx
// scripts/setup_super_user.ts - Setup super user for admin system

import { prisma } from '../src/services/db';
import { AdminLevel } from '../src/services/admin_permissions';

async function setupSuperUser(discordId: string, username: string) {
  try {
    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { discordId }
    });

    if (existingUser) {
      // Update existing user to super user
      const updated = await prisma.user.update({
        where: { discordId },
        data: {
          isSuperUser: true,
          isAdmin: true,
          adminLevel: AdminLevel.SUPER_USER,
          canCreateMarkets: true,
          adminPromotedAt: new Date(),
          adminPromotedBy: 'SYSTEM'
        }
      });

      console.log(`✅ Updated existing user Discord ID: ${discordId} to super user`);
    } else {
      // Create new super user
      const created = await prisma.user.create({
        data: {
          discordId,
          username,
          isSuperUser: true,
          isAdmin: true,
          adminLevel: AdminLevel.SUPER_USER,
          canCreateMarkets: true,
          adminPromotedAt: new Date(),
          adminPromotedBy: 'SYSTEM'
        }
      });

      console.log(`✅ Created new super user Discord ID: ${discordId}`);
    }

    // List all super users
    const superUsers = await prisma.user.findMany({
      where: {
        OR: [
          { isSuperUser: true },
          { adminLevel: { gte: AdminLevel.SUPER_USER } }
        ]
      },
      select: {
        discordId: true,
        isSuperUser: true,
        adminLevel: true
      }
    });

    console.log('\n📋 Current super users:');
    superUsers.forEach(user => {
      console.log(`  - Discord ID: ${user.discordId} - Admin Level: ${user.adminLevel}`);
    });

  } catch (error) {
    console.error('❌ Error setting up super user:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log(`
Usage: npx tsx scripts/setup_super_user.ts <discord_id> <username>

Example:
  npx tsx scripts/setup_super_user.ts "123456789012345678" "AdminUser"

This script will:
  1. Create or update a user with super admin privileges
  2. Set adminLevel to SUPER_USER (3)
  3. Enable all admin features
  4. List all current super users
`);
  process.exit(1);
}

const [discordId, username] = args;

console.log(`🚀 Setting up super user: ${username} (${discordId})...`);
setupSuperUser(discordId, username);
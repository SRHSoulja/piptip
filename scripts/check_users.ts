#!/usr/bin/env tsx
import { prisma } from '../src/services/db';

async function checkUsers() {
  try {
    const users = await prisma.user.findMany({
      select: {
        discordId: true,
        isAdmin: true,
        isSuperUser: true,
        adminLevel: true
      }
    });

    console.log('All users in database:');
    users.forEach(user => {
      console.log(`- Discord ID: ${user.discordId}`);
      console.log(`  Admin: ${user.isAdmin}, SuperUser: ${user.isSuperUser}, Level: ${user.adminLevel}`);
    });

    const superUsers = users.filter(u => u.isSuperUser || u.adminLevel >= 3);
    console.log(`\nFound ${superUsers.length} super users`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUsers();
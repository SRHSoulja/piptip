#!/usr/bin/env tsx
import { prisma } from '../src/services/db';

async function checkActivities() {
  try {
    const activities = await prisma.activityFeedItem.findMany({
      where: { type: 'reaction' },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { data: true, createdAt: true }
    });

    console.log('Recent reaction activities:');
    activities.forEach((a, i) => {
      console.log(`${i+1}:`, JSON.stringify(a, null, 2));
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkActivities();
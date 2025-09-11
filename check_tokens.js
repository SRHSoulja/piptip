import { prisma } from './dist/services/db.js';

(async () => {
  try {
    const tokens = await prisma.token.findMany({
      select: { symbol: true, decimals: true, active: true }
    });
    console.log('Active tokens:');
    tokens.forEach(t => {
      console.log(`  ${t.symbol}: ${t.decimals} decimals (active: ${t.active})`);
    });
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
})();
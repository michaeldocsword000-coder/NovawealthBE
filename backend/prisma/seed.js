const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

async function main() {
  const adminPassword = await bcrypt.hash('Admin@123456', 12);

  await prisma.user.upsert({
    where: { email: 'admin@blueinvest.com' },
    update: {},
    create: {
      email: 'admin@blueinvest.com',
      username: 'admin',
      password: adminPassword,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      emailVerified: true,
      referralCode: 'ADMIN001',
    },
  });

  const plans = [
    { name: 'Tier 1 - Starter', tier: 1, amount: 2000, dailyProfit: 300, duration: 30 },
    { name: 'Tier 2 - Growth', tier: 2, amount: 4000, dailyProfit: 400, duration: 30 },
    { name: 'Tier 3 - Premium', tier: 3, amount: 6000, dailyProfit: 600, duration: 30 },
  ];

  for (const plan of plans) {
    await prisma.investmentPlan.upsert({
      where: { tier: plan.tier },
      update: plan,
      create: plan,
    });
  }

  console.log('Seed completed: Admin user and investment plans created.');
  console.log('Admin login: admin@blueinvest.com / Admin@123456');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const { createNotification } = require('./notification');

const prisma = new PrismaClient();

const processDailyProfits = async () => {
  console.log('[Cron] Processing daily profits...');

  const activeInvestments = await prisma.investment.findMany({
    where: { status: 'ACTIVE' },
    include: { user: true, plan: true },
  });

  const now = new Date();

  for (const investment of activeInvestments) {
    const lastProfit = investment.lastProfitAt || investment.startDate;
    const hoursSinceLastProfit = (now - new Date(lastProfit)) / (1000 * 60 * 60);

    if (hoursSinceLastProfit < 24) continue;

    if (investment.daysCompleted >= investment.duration) {
      await prisma.investment.update({
        where: { id: investment.id },
        data: { status: 'COMPLETED' },
      });
      await createNotification(
        investment.userId,
        'Investment Completed',
        `Your ${investment.plan.name} investment has completed after ${investment.duration} days.`
      );
      continue;
    }

    const profit = investment.dailyProfit;

    await prisma.$transaction([
      prisma.user.update({
        where: { id: investment.userId },
        data: { balance: { increment: profit } },
      }),
      prisma.investment.update({
        where: { id: investment.id },
        data: {
          daysCompleted: { increment: 1 },
          totalEarned: { increment: profit },
          lastProfitAt: now,
        },
      }),
      prisma.transaction.create({
        data: {
          userId: investment.userId,
          type: 'DAILY_PROFIT',
          amount: profit,
          status: 'COMPLETED',
          description: `Daily profit from ${investment.plan.name} - Day ${investment.daysCompleted + 1}`,
        },
      }),
    ]);

    await createNotification(
      investment.userId,
      'Daily Profit Credited',
      `₦${profit.toLocaleString()} has been credited to your wallet from ${investment.plan.name}.`
    );
  }

  console.log('[Cron] Daily profits processed.');
};

const startCronJobs = () => {
  cron.schedule('0 * * * *', processDailyProfits);
  console.log('[Cron] Daily profit job scheduled (runs every hour, checks 24h interval).');
};

module.exports = { startCronJobs, processDailyProfits };

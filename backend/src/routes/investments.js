const express = require('express');
const { body } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { validate, authenticate, requireActive } = require('../middleware/auth');
const { createNotification } = require('../services/notification');

const router = express.Router();
const prisma = new PrismaClient();

router.get('/plans', authenticate, async (req, res) => {
  try {
    const plans = await prisma.investmentPlan.findMany({
      where: { isActive: true },
      orderBy: { tier: 'asc' },
    });
    res.json({ success: true, plans });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch plans' });
  }
});

router.get('/my', authenticate, requireActive, async (req, res) => {
  try {
    const investments = await prisma.investment.findMany({
      where: { userId: req.user.id },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, investments });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch investments' });
  }
});

router.post(
  '/purchase',
  authenticate,
  requireActive,
  [body('planId').isUUID()],
  validate,
  async (req, res) => {
    try {
      const { planId } = req.body;
      const userId = req.user.id;

      const hasApprovedDeposit = await prisma.deposit.findFirst({
        where: { userId, status: 'APPROVED' },
      });

      if (!hasApprovedDeposit) {
        return res.status(403).json({
          success: false,
          message: 'Your deposit must be approved before you can activate an investment plan',
        });
      }

      const existingActive = await prisma.investment.findFirst({
        where: { userId, status: 'ACTIVE' },
      });
      if (existingActive) {
        return res.status(400).json({ success: false, message: 'You already have an active investment plan' });
      }

      const [user, plan] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId } }),
        prisma.investmentPlan.findUnique({ where: { id: planId } }),
      ]);

      if (!plan || !plan.isActive) {
        return res.status(404).json({ success: false, message: 'Plan not found' });
      }

      if (user.balance < plan.amount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient balance. You need ₦${plan.amount.toLocaleString()}`,
        });
      }

      const endDate = new Date();
      endDate.setDate(endDate.getDate() + plan.duration);

      const investment = await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { balance: { decrement: plan.amount } },
        });

        const inv = await tx.investment.create({
          data: {
            userId,
            planId: plan.id,
            amount: plan.amount,
            dailyProfit: plan.dailyProfit,
            duration: plan.duration,
            endDate,
          },
          include: { plan: true },
        });

        await tx.transaction.create({
          data: {
            userId,
            type: 'INVESTMENT',
            amount: plan.amount,
            status: 'COMPLETED',
            description: `Purchased ${plan.name}`,
          },
        });

        return inv;
      });

      await createNotification(
        userId,
        'Investment Activated',
        `Your ${plan.name} plan is now active. Daily profit: ₦${plan.dailyProfit.toLocaleString()}.`
      );

      res.status(201).json({ success: true, investment });
    } catch (error) {
      console.error('Purchase error:', error);
      res.status(500).json({ success: false, message: 'Failed to purchase plan' });
    }
  }
);

module.exports = router;

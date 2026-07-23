const express = require('express');
const { body } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { validate, authenticate, requireAdmin } = require('../middleware/auth');
const { createNotification } = require('../services/notification');

const router = express.Router();
const prisma = new PrismaClient();

router.use(authenticate, requireAdmin);

router.get('/dashboard', async (req, res) => {
  try {
    const [
      totalUsers,
      totalDeposits,
      totalWithdrawals,
      totalInvestments,
      pendingDeposits,
      pendingWithdrawals,
      revenue,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'USER' } }),
      prisma.deposit.aggregate({ where: { status: 'APPROVED' }, _sum: { amount: true } }),
      prisma.withdrawal.aggregate({
        where: { status: { in: ['APPROVED', 'PAID'] } },
        _sum: { amount: true },
      }),
      prisma.investment.count(),
      prisma.deposit.count({ where: { status: 'PENDING' } }),
      prisma.withdrawal.count({ where: { status: 'PENDING' } }),
      prisma.investment.aggregate({ _sum: { amount: true } }),
    ]);

    res.json({
      success: true,
      data: {
        totalUsers,
        totalDeposits: totalDeposits._sum.amount || 0,
        totalWithdrawals: totalWithdrawals._sum.amount || 0,
        totalInvestments,
        pendingDeposits,
        pendingWithdrawals,
        revenue: revenue._sum.amount || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load admin dashboard' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { role: 'USER' };
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          balance: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ success: true, users, total });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const { balance, status, firstName, lastName } = req.body;
    const data = {};
    if (balance !== undefined) data.balance = parseFloat(balance);
    if (status) data.status = status;
    if (firstName !== undefined) data.firstName = firstName;
    if (lastName !== undefined) data.lastName = lastName;

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
    });

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update user' });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete user' });
  }
});

router.get('/deposits', async (req, res) => {
  try {
    const { status = 'PENDING' } = req.query;
    const deposits = await prisma.deposit.findMany({
      where: status ? { status } : {},
      include: {
        user: { select: { username: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, deposits });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch deposits' });
  }
});

router.put('/deposits/:id/approve', async (req, res) => {
  try {
    const deposit = await prisma.deposit.findUnique({ where: { id: req.params.id } });
    if (!deposit || deposit.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: 'Invalid deposit' });
    }

    await prisma.$transaction([
      prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: 'APPROVED' },
      }),
      prisma.user.update({
        where: { id: deposit.userId },
        data: { balance: { increment: deposit.amount } },
      }),
      prisma.transaction.updateMany({
        where: {
          userId: deposit.userId,
          type: 'DEPOSIT',
          status: 'PENDING',
          amount: deposit.amount,
        },
        data: { status: 'COMPLETED' },
      }),
    ]);

    await createNotification(
      deposit.userId,
      'Deposit Approved',
      `Your deposit of ₦${deposit.amount.toLocaleString()} has been approved and credited to your wallet.`
    );

    res.json({ success: true, message: 'Deposit approved' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to approve deposit' });
  }
});

router.put('/deposits/:id/reject', async (req, res) => {
  try {
    const { adminNote } = req.body;
    const deposit = await prisma.deposit.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', adminNote },
    });

    await prisma.transaction.updateMany({
      where: {
        userId: deposit.userId,
        type: 'DEPOSIT',
        status: 'PENDING',
        amount: deposit.amount,
      },
      data: { status: 'REJECTED' },
    });

    await createNotification(
      deposit.userId,
      'Deposit Rejected',
      `Your deposit of ₦${deposit.amount.toLocaleString()} was rejected.${adminNote ? ` Reason: ${adminNote}` : ''}`
    );

    res.json({ success: true, message: 'Deposit rejected' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to reject deposit' });
  }
});

router.get('/withdrawals', async (req, res) => {
  try {
    const { status = 'PENDING' } = req.query;
    const withdrawals = await prisma.withdrawal.findMany({
      where: status ? { status } : {},
      include: {
        user: { select: { username: true, email: true, balance: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, withdrawals });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch withdrawals' });
  }
});

router.put('/withdrawals/:id/approve', async (req, res) => {
  try {
    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: req.params.id } });
    if (!withdrawal || withdrawal.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: 'Invalid withdrawal' });
    }

    const user = await prisma.user.findUnique({ where: { id: withdrawal.userId } });
    if (user.balance < withdrawal.amount) {
      return res.status(400).json({ success: false, message: 'User has insufficient balance' });
    }

    await prisma.$transaction([
      prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'APPROVED' },
      }),
      prisma.user.update({
        where: { id: withdrawal.userId },
        data: { balance: { decrement: withdrawal.amount } },
      }),
      prisma.transaction.updateMany({
        where: {
          userId: withdrawal.userId,
          type: 'WITHDRAWAL',
          status: 'PENDING',
          amount: withdrawal.amount,
        },
        data: { status: 'COMPLETED' },
      }),
    ]);

    await createNotification(
      withdrawal.userId,
      'Withdrawal Approved',
      `Your withdrawal of ₦${withdrawal.amount.toLocaleString()} has been approved.`
    );

    res.json({ success: true, message: 'Withdrawal approved' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to approve withdrawal' });
  }
});

router.put('/withdrawals/:id/reject', async (req, res) => {
  try {
    const { adminNote } = req.body;
    const withdrawal = await prisma.withdrawal.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', adminNote },
    });

    await prisma.transaction.updateMany({
      where: {
        userId: withdrawal.userId,
        type: 'WITHDRAWAL',
        status: 'PENDING',
        amount: withdrawal.amount,
      },
      data: { status: 'REJECTED' },
    });

    await createNotification(
      withdrawal.userId,
      'Withdrawal Rejected',
      `Your withdrawal of ₦${withdrawal.amount.toLocaleString()} was rejected.${adminNote ? ` Reason: ${adminNote}` : ''}`
    );

    res.json({ success: true, message: 'Withdrawal rejected' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to reject withdrawal' });
  }
});

router.put('/withdrawals/:id/paid', async (req, res) => {
  try {
    await prisma.withdrawal.update({
      where: { id: req.params.id },
      data: { status: 'PAID' },
    });
    res.json({ success: true, message: 'Withdrawal marked as paid' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to mark as paid' });
  }
});

router.get('/plans', async (req, res) => {
  try {
    const plans = await prisma.investmentPlan.findMany({ orderBy: { tier: 'asc' } });
    res.json({ success: true, plans });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch plans' });
  }
});

router.put(
  '/plans/:id',
  [
    body('amount').optional().isFloat({ min: 0 }),
    body('dailyProfit').optional().isFloat({ min: 0 }),
    body('duration').optional().isInt({ min: 1 }),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  async (req, res) => {
    try {
      const plan = await prisma.investmentPlan.update({
        where: { id: req.params.id },
        data: req.body,
      });
      res.json({ success: true, plan });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to update plan' });
    }
  }
);

router.post(
  '/notifications',
  [body('userId').isUUID(), body('title').notEmpty(), body('message').notEmpty()],
  validate,
  async (req, res) => {
    try {
      const notification = await createNotification(req.body.userId, req.body.title, req.body.message);
      res.status(201).json({ success: true, notification });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to create notification' });
    }
  }
);

router.get('/analytics', async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [recentUsers, recentDeposits, recentWithdrawals, dailyProfits] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo }, role: 'USER' } }),
      prisma.deposit.findMany({
        where: { status: 'APPROVED', createdAt: { gte: thirtyDaysAgo } },
        select: { amount: true, createdAt: true },
      }),
      prisma.withdrawal.findMany({
        where: { status: { in: ['APPROVED', 'PAID'] }, createdAt: { gte: thirtyDaysAgo } },
        select: { amount: true, createdAt: true },
      }),
      prisma.transaction.findMany({
        where: { type: 'DAILY_PROFIT', createdAt: { gte: thirtyDaysAgo } },
        select: { amount: true, createdAt: true },
      }),
    ]);

    res.json({
      success: true,
      data: { recentUsers, recentDeposits, recentWithdrawals, dailyProfits },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch analytics' });
  }
});

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { validate, authenticate, requireActive } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();
const prisma = new PrismaClient();

router.get('/dashboard', authenticate, requireActive, async (req, res) => {
  try {
    const userId = req.user.id;

    const [user, activeInvestment, transactions, notifications, stats] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          email: true,
          firstName: true,
          lastName: true,
          profilePicture: true,
          balance: true,
          referralBonus: true,
          referralCode: true,
        },
      }),
      prisma.investment.findFirst({
        where: { userId, status: 'ACTIVE' },
        include: { plan: true },
      }),
      prisma.transaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      Promise.all([
        prisma.transaction.aggregate({
          where: { userId, type: 'DAILY_PROFIT', status: 'COMPLETED' },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: { userId, type: 'DEPOSIT', status: 'COMPLETED' },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: { userId, type: 'WITHDRAWAL', status: 'COMPLETED' },
          _sum: { amount: true },
        }),
        prisma.referral.count({ where: { referrerId: userId } }),
        prisma.notification.count({ where: { userId, isRead: false } }),
      ]),
    ]);

    const [totalEarnings, totalDeposits, totalWithdrawals, totalReferrals, unreadNotifications] = stats;

    res.json({
      success: true,
      data: {
        user,
        activeInvestment: activeInvestment || null,
        hasActivePlan: !!activeInvestment,
        totalEarnings: totalEarnings._sum.amount || 0,
        totalDeposits: totalDeposits._sum.amount || 0,
        totalWithdrawals: totalWithdrawals._sum.amount || 0,
        totalReferrals,
        unreadNotifications,
        recentTransactions: transactions,
        notifications,
      },
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ success: false, message: 'Failed to load dashboard' });
  }
});

router.put(
  '/profile',
  authenticate,
  requireActive,
  [
    body('firstName').optional().trim(),
    body('lastName').optional().trim(),
    body('username').optional().isLength({ min: 3 }).trim(),
  ],
  validate,
  async (req, res) => {
    try {
      const { firstName, lastName, username } = req.body;
      const data = {};

      if (firstName !== undefined) data.firstName = firstName;
      if (lastName !== undefined) data.lastName = lastName;
      if (username) {
        const existing = await prisma.user.findFirst({
          where: { username, NOT: { id: req.user.id } },
        });
        if (existing) {
          return res.status(400).json({ success: false, message: 'Username taken' });
        }
        data.username = username;
      }

      const user = await prisma.user.update({
        where: { id: req.user.id },
        data,
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          profilePicture: true,
        },
      });

      res.json({ success: true, user });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to update profile' });
    }
  }
);

router.post(
  '/profile-picture',
  authenticate,
  requireActive,
  upload.single('profilePicture'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }

      const profilePicture = `/uploads/${req.file.filename}`;
      const user = await prisma.user.update({
        where: { id: req.user.id },
        data: { profilePicture },
        select: { id: true, profilePicture: true },
      });

      res.json({ success: true, user });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to upload picture' });
    }
  }
);

router.put(
  '/change-password',
  authenticate,
  requireActive,
  [body('currentPassword').notEmpty(), body('newPassword').isLength({ min: 6 })],
  validate,
  async (req, res) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!(await bcrypt.compare(req.body.currentPassword, user.password))) {
        return res.status(400).json({ success: false, message: 'Current password incorrect' });
      }

      const hashedPassword = await bcrypt.hash(req.body.newPassword, 12);
      await prisma.user.update({
        where: { id: req.user.id },
        data: { password: hashedPassword },
      });

      res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to change password' });
    }
  }
);

router.get('/referrals', authenticate, requireActive, async (req, res) => {
  try {
    const referrals = await prisma.referral.findMany({
      where: { referrerId: req.user.id },
      include: {
        referred: { select: { username: true, email: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { referralCode: true, referralBonus: true },
    });

    res.json({
      success: true,
      data: {
        referralCode: user.referralCode,
        referralBonus: user.referralBonus,
        totalReferrals: referrals.length,
        referrals,
        referralLink: `${process.env.FRONTEND_URL}/register?ref=${user.referralCode}`,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch referrals' });
  }
});

module.exports = router;

const express = require('express');
const { body } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { validate, authenticate, requireActive } = require('../middleware/auth');
const { createNotification } = require('../services/notification');

const router = express.Router();
const prisma = new PrismaClient();

router.post(
  '/',
  authenticate,
  requireActive,
  [
    body('amount').isFloat({ min: 500 }),
    body('bankName').notEmpty().trim(),
    body('accountNumber').notEmpty().trim(),
    body('accountName').notEmpty().trim(),
  ],
  validate,
  async (req, res) => {
    try {
      const { amount, bankName, accountNumber, accountName } = req.body;
      const withdrawAmount = parseFloat(amount);

      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (user.balance < withdrawAmount) {
        return res.status(400).json({ success: false, message: 'Insufficient balance' });
      }

      const withdrawal = await prisma.withdrawal.create({
        data: {
          userId: req.user.id,
          amount: withdrawAmount,
          bankName,
          accountNumber,
          accountName,
        },
      });

      await prisma.transaction.create({
        data: {
          userId: req.user.id,
          type: 'WITHDRAWAL',
          amount: withdrawAmount,
          status: 'PENDING',
          description: `Withdrawal to ${bankName} - ${accountNumber}`,
        },
      });

      await createNotification(
        req.user.id,
        'Withdrawal Requested',
        `Your withdrawal of ₦${withdrawAmount.toLocaleString()} is pending approval.`,
        false
      );

      res.status(201).json({ success: true, withdrawal });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to submit withdrawal' });
    }
  }
);

router.get('/', authenticate, requireActive, async (req, res) => {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, withdrawals });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch withdrawals' });
  }
});

module.exports = router;

const express = require('express');
const { body } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { validate, authenticate, requireActive } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { createNotification } = require('../services/notification');

const router = express.Router();
const prisma = new PrismaClient();

router.get('/bank-details', authenticate, (req, res) => {
  res.json({
    success: true,
    data: {
      bankName: process.env.BANK_NAME,
      accountNumber: process.env.BANK_ACCOUNT_NUMBER,
      accountName: process.env.BANK_ACCOUNT_NAME,
    },
  });
});

router.post(
  '/',
  authenticate,
  requireActive,
  upload.single('screenshot'),
  [
    body('amount').isFloat({ min: 100 }),
    body('senderName').notEmpty().trim(),
    body('reference').optional().trim(),
  ],
  validate,
  async (req, res) => {
    try {
      const { amount, senderName, reference } = req.body;
      const screenshot = req.file ? `/uploads/${req.file.filename}` : null;

      const deposit = await prisma.deposit.create({
        data: {
          userId: req.user.id,
          amount: parseFloat(amount),
          senderName,
          reference,
          screenshot,
        },
      });

      await prisma.transaction.create({
        data: {
          userId: req.user.id,
          type: 'DEPOSIT',
          amount: parseFloat(amount),
          status: 'PENDING',
          description: `Deposit from ${senderName}${reference ? ` - Ref: ${reference}` : ''}`,
        },
      });

      await createNotification(
        req.user.id,
        'Deposit Submitted',
        `Your deposit of ₦${parseFloat(amount).toLocaleString()} is pending approval.`,
        false
      );

      res.status(201).json({ success: true, deposit });
    } catch (error) {
      console.error('Deposit error:', error);
      res.status(500).json({ success: false, message: 'Failed to submit deposit' });
    }
  }
);

router.get('/', authenticate, requireActive, async (req, res) => {
  try {
    const deposits = await prisma.deposit.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, deposits });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch deposits' });
  }
});

module.exports = router;

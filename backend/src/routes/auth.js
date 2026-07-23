const express = require('express');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { body } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { generateToken, generateReferralCode, generateVerifyToken } = require('../utils/helpers');
const { validate, authenticate } = require('../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/email');
const { createNotification } = require('../services/notification');

const router = express.Router();
const prisma = new PrismaClient();

app.use(cors({
  origin: 'https://novawealthglobal.onrender.com',
  credentials: true,
}));

app.use(express.json());

app.use('/api/auth', router);
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('username').isLength({ min: 3 }).trim(),
    body('password').isLength({ min: 6 }),
    body('firstName').optional().trim(),
    body('lastName').optional().trim(),
    body('referralCode').optional().trim(),
  ],
  validate,
  async (req, res) => {
    try {
      const { email, username, password, firstName, lastName, referralCode } = req.body;

      const existing = await prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
      });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Email or username already exists' });
      }

      let referrer = null;
      if (referralCode) {
        referrer = await prisma.user.findUnique({ where: { referralCode } });
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const verifyToken = generateVerifyToken();
      const userReferralCode = generateReferralCode();

      const user = await prisma.user.create({
        data: {
          email,
          username,
          password: hashedPassword,
          firstName,
          lastName,
          referralCode: userReferralCode,
          referredById: referrer?.id,
          verifyToken,
        },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          balance: true,
          referralBonus: true,
          referralCode: true,
          role: true,
          createdAt: true,
        },
      });

      if (referrer) {
        const bonus = parseFloat(process.env.REFERRAL_BONUS || '500');
        await prisma.$transaction([
          prisma.referral.create({
            data: { referrerId: referrer.id, referredId: user.id, bonus },
          }),
          prisma.user.update({
            where: { id: referrer.id },
            data: {
              referralBonus: { increment: bonus },
              balance: { increment: bonus },
            },
          }),
          prisma.transaction.create({
            data: {
              userId: referrer.id,
              type: 'REFERRAL_BONUS',
              amount: bonus,
              status: 'COMPLETED',
              description: `Referral bonus for ${username}`,
            },
          }),
        ]);
        await createNotification(
          referrer.id,
          'Referral Bonus Earned',
          `You earned ₦${bonus.toLocaleString()} for referring ${username}.`
        );
      }

      sendVerificationEmail(user, verifyToken).catch(console.error);

      const token = generateToken({ id: user.id, email: user.email, role: user.role });

      res.status(201).json({ success: true, message: 'Registration successful', user, token });
    } catch (error) {
      console.error('Register error:', error);
      res.status(500).json({ success: false, message: 'Registration failed' });
    }
  }
);

router.post(
  '/login',
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  validate,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      if (user.status === 'SUSPENDED') {
        return res.status(403).json({ success: false, message: 'Account suspended' });
      }

      const token = generateToken({ id: user.id, email: user.email, role: user.role });

      const { password: _, verifyToken, resetToken, resetTokenExp, ...safeUser } = user;

      res.json({ success: true, user: safeUser, token });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ success: false, message: 'Login failed' });
    }
  }
);

router.post(
  '/forgot-password',
  [body('email').isEmail().normalizeEmail()],
  validate,
  async (req, res) => {
    try {
      const user = await prisma.user.findUnique({ where: { email: req.body.email } });
      if (!user) {
        return res.json({ success: true, message: 'If email exists, reset link sent' });
      }

      const resetToken = generateVerifyToken();
      const resetTokenExp = new Date(Date.now() + 3600000);

      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken, resetTokenExp },
      });

      sendPasswordResetEmail(user, resetToken).catch(console.error);

      res.json({ success: true, message: 'If email exists, reset link sent' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to process request' });
    }
  }
);

router.post(
  '/reset-password',
  [body('token').notEmpty(), body('password').isLength({ min: 6 })],
  validate,
  async (req, res) => {
    try {
      const user = await prisma.user.findFirst({
        where: {
          resetToken: req.body.token,
          resetTokenExp: { gt: new Date() },
        },
      });

      if (!user) {
        return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
      }

      const hashedPassword = await bcrypt.hash(req.body.password, 12);
      await prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword, resetToken: null, resetTokenExp: null },
      });

      res.json({ success: true, message: 'Password reset successful' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Password reset failed' });
    }
  }
);

router.get('/verify-email/:token', async (req, res) => {
  try {
    const user = await prisma.user.findFirst({ where: { verifyToken: req.params.token } });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid verification token' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, verifyToken: null },
    });

    res.json({ success: true, message: 'Email verified successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        profilePicture: true,
        balance: true,
        referralBonus: true,
        referralCode: true,
        role: true,
        status: true,
        emailVerified: true,
        createdAt: true,
      },
    });

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
});

module.exports = router;

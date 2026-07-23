require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const depositRoutes = require('./routes/deposits');
const withdrawalRoutes = require('./routes/withdrawals');
const investmentRoutes = require('./routes/investments');
const transactionRoutes = require('./routes/transactions');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const { startCronJobs } = require('./services/cron');

const app = express();
const PORT = process.env.PORT || 5000;

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'https://novawealthglobal.onrender.com',
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(uploadsDir));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later' },
});
app.use('novawealthbe.onrender.com/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many auth attempts' },
});
app.use('novawealthbe.onrender.com/auth/login', authLimiter);
app.use('novawealthbe.onrender.com/auth/register', authLimiter);

app.use('novawealthbe.onrender.com/auth', authRoutes);
app.use('novawealthbe.onrender.com/user', userRoutes);
app.use('novawealthbe.onrender.com/deposits', depositRoutes);
app.use('novawealthbe.onrender.com/withdrawals', withdrawalRoutes);
app.use('novawealthbe.onrender.com/investments', investmentRoutes);
app.use('novawealthbe.onrender.com/transactions', transactionRoutes);
app.use('novawealthbe.onrender.com/notifications', notificationRoutes);
app.use('novawealthbe.onrender.com/admin', adminRoutes);

app.get('novawealthbe.onrender.com/health', (req, res) => {
  res.json({ success: true, message: 'Blue Invest API is running' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Blue Invest API running on port ${PORT}`);
  startCronJobs();
});

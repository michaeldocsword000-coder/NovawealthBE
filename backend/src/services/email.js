const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendEmail = async ({ to, subject, html }) => {
  if (!process.env.SMTP_USER) {
    console.log(`[Email skipped] To: ${to}, Subject: ${subject}`);
    return;
  }
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
  });
};

const sendVerificationEmail = async (user, token) => {
  const url = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: 'Verify your Blue Invest account',
    html: `<h2>Welcome to Blue Invest!</h2><p>Click <a href="${url}">here</a> to verify your email.</p>`,
  });
};

const sendPasswordResetEmail = async (user, token) => {
  const url = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: 'Reset your Blue Invest password',
    html: `<h2>Password Reset</h2><p>Click <a href="${url}">here</a> to reset your password. Link expires in 1 hour.</p>`,
  });
};

const sendNotificationEmail = async (user, title, message) => {
  await sendEmail({
    to: user.email,
    subject: `Blue Invest: ${title}`,
    html: `<h2>${title}</h2><p>${message}</p>`,
  });
};

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendNotificationEmail,
};

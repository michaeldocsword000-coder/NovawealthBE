const { PrismaClient } = require('@prisma/client');
const { sendNotificationEmail } = require('./email');

const prisma = new PrismaClient();

const createNotification = async (userId, title, message, sendEmail = true) => {
  const notification = await prisma.notification.create({
    data: { userId, title, message },
  });

  if (sendEmail) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      sendNotificationEmail(user, title, message).catch(console.error);
    }
  }

  return notification;
};

module.exports = { createNotification };

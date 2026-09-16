const Notification = require('./notification.model');
const User = require('../users/user.model');
const { sendPush } = require('../../services/push.service');

/**
 * Creates a notification record and sends a push notification if recipient has an FCM token.
 * Push delivery failure never affects the notification creation or throws to the caller.
 *
 * @param {Object} params
 * @param {import('mongoose').Types.ObjectId|string} params.recipientId
 * @param {import('mongoose').Types.ObjectId|string} params.organizationId
 * @param {'ASSIGNED'|'CORRECTION_REQUIRED'|'APPROVED'|'REJECTED'} params.type
 * @param {import('mongoose').Types.ObjectId|string} params.relatedClaimId
 * @param {string} params.title
 * @param {string} params.body
 * @returns {Promise<Object>} The created Notification document
 */
const createAndSendNotification = async ({
  recipientId,
  organizationId,
  type,
  relatedClaimId,
  title,
  body,
}) => {
  // 1. Always create the Notification document first
  const notification = await Notification.create({
    recipientId,
    organizationId,
    type,
    relatedClaimId,
    title,
    body,
  });

  // 2. Look up recipient User by recipientId (lean, select only fcmToken)
  try {
    const recipient = await User.findById(recipientId).select('fcmToken').lean();

    // 3. If fcmToken present, call sendPush
    if (recipient && recipient.fcmToken) {
      await sendPush(recipient.fcmToken, title, body, {
        claimId: relatedClaimId,
        type,
      });
    }
  } catch (pushError) {
    // 4. Caught and logged only — must NEVER propagate to the caller
    console.error('Failed to send push notification:', pushError);
  }

  // 5. Return the created Notification document
  return notification;
};

module.exports = {
  createAndSendNotification,
};

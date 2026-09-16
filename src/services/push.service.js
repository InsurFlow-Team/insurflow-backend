const admin = require('../config/firebase');

/**
 * Send a single-recipient push notification via Firebase Cloud Messaging (FCM).
 *
 * @param {string} token - FCM registration device token
 * @param {string} title - Notification title
 * @param {string} body - Notification body text
 * @param {Object} [data={}] - Key-value data payload (all values are coerced to strings)
 * @returns {Promise<string>} - FCM message ID
 */
const sendPush = async (token, title, body, data = {}) => {
  const stringifiedData = {};

  if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) {
        stringifiedData[key] = '';
      } else if (typeof value === 'object') {
        stringifiedData[key] = JSON.stringify(value);
      } else {
        stringifiedData[key] = String(value);
      }
    }
  }

  const message = {
    token,
    notification: {
      title,
      body,
    },
    data: stringifiedData,
  };

  return await admin.messaging().send(message);
};

module.exports = {
  sendPush,
};

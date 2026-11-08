const Notification = require('./notification.model');
const User = require('../users/user.model');
const { sendPush } = require('../../services/push.service');
const AppError = require('../../utils/appError');

/**
 * Serializes a plain notification document into a notification DTO.
 *
 * @param {Object} doc - Plain notification object (from .lean())
 * @returns {Object|null} Serialized notification DTO
 */
const toNotificationDto = (doc) => {
  if (!doc) {
    return null;
  }

  let relatedClaimId = null;
  if (
    doc.relatedClaimId &&
    typeof doc.relatedClaimId === 'object' &&
    (doc.relatedClaimId._id || doc.relatedClaimId.id) &&
    doc.relatedClaimId.claimNumber !== undefined &&
    doc.relatedClaimId.claimNumber !== null
  ) {
    const claimId = String(doc.relatedClaimId._id || doc.relatedClaimId.id);
    relatedClaimId = {
      id: claimId,
      _id: claimId, // NOTE: _id stays only until mobile developer confirms, removed in a later story
      claimNumber: doc.relatedClaimId.claimNumber,
    };
  }

  return {
    id: String(doc._id),
    _id: String(doc._id), // NOTE: _id stays only until the mobile developer confirms, then removed in a later story
    recipientId: doc.recipientId,
    organizationId: doc.organizationId,
    type: doc.type,
    relatedClaimId,
    title: doc.title,
    body: doc.body,
    params: doc.params
      ? {
          actor: doc.params.actor
            ? {
                employeeCode: doc.params.actor.employeeCode,
                name: doc.params.actor.name,
              }
            : null,
          reason: doc.params.reason ?? null,
          notes: doc.params.notes ?? null,
        }
      : { actor: null, reason: null, notes: null }, // NOTE: fallback exists only for the window between deploying this code and running the cleanup script
    readAt: doc.readAt ?? null,
    createdAt: doc.createdAt,
  };
};

/**
 * Creates a notification record and sends a push notification if recipient has an FCM token.
 * Push delivery failure never affects the notification creation or throws to the caller.
 *
 * @param {Object} params
 * @param {import('mongoose').Types.ObjectId|string} params.recipientId
 * @param {import('mongoose').Types.ObjectId|string} params.organizationId
 * @param {'ASSIGNED'|'PENDING_ACCEPTANCE'|'CORRECTION_REQUIRED'|'APPROVED'|'REJECTED'|'ASSIGNMENT_DECLINED'|'INSPECTION_COMPLETED'|'NEW_CLAIM'} params.type
 * @param {import('mongoose').Types.ObjectId|string} params.relatedClaimId
 * @param {string} params.title
 * @param {string} params.body
 * @param {Object} [params.params]
 * @returns {Promise<Object>} The created Notification document
 */
const createAndSendNotification = async ({
  recipientId,
  organizationId,
  type,
  relatedClaimId,
  title,
  body,
  params,
}) => {
  // 1. Always create the Notification document first
  const notification = await Notification.create({
    recipientId,
    organizationId,
    type,
    relatedClaimId,
    title,
    body,
    ...(params !== undefined && { params }),
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

/**
 * Retrieves paginated notifications for the authenticated user (newest first).
 *
 * @param {Object} authUser
 * @param {import('mongoose').Types.ObjectId|string} authUser.userId
 * @param {import('mongoose').Types.ObjectId|string} authUser.organizationId
 * @param {Object} [queryOptions]
 * @param {number} [queryOptions.page=1]
 * @param {number} [queryOptions.limit=50]
 * @param {boolean} [queryOptions.unreadOnly=false]
 * @returns {Promise<{ notifications: Array, pagination: Object }>}
 */
const listNotifications = async (authUser, queryOptions = {}) => {
  const { userId, organizationId } = authUser;
  const { page = 1, limit = 50, unreadOnly = false } = queryOptions;
  const skip = (page - 1) * limit;

  const query = {
    recipientId: userId,
    organizationId,
  };

  if (unreadOnly) {
    query.readAt = null;
  }

  const [totalCount, notifications] = await Promise.all([
    Notification.countDocuments(query),
    Notification.find(query)
      .populate('relatedClaimId', 'claimNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const totalPages = Math.ceil(totalCount / limit);

  return {
    notifications: notifications.map(toNotificationDto),
    pagination: {
      totalCount,
      page: Number(page),
      limit: Number(limit),
      totalPages,
    },
  };
};

/**
 * Retrieves the count of unread notifications for the authenticated user.
 *
 * @param {Object} authUser
 * @param {import('mongoose').Types.ObjectId|string} authUser.userId
 * @param {import('mongoose').Types.ObjectId|string} authUser.organizationId
 * @returns {Promise<{ count: number }>}
 */
const getUnreadCount = async (authUser) => {
  const { userId, organizationId } = authUser;
  const count = await Notification.countDocuments({
    recipientId: userId,
    organizationId,
    readAt: null,
  });

  return { count };
};

/**
 * Marks a single notification as read (sets readAt to current timestamp if null).
 * Idempotent: if already read, returns the existing document without modifying readAt.
 * Stealth tenancy: throws 404 if notification not found or not owned by authUser.
 *
 * @param {string} notificationId
 * @param {Object} authUser
 * @returns {Promise<Object>}
 */
const markAsRead = async (notificationId, authUser) => {
  const { userId, organizationId } = authUser;

  // 1. Try atomic update where readAt is null
  const updatedNotification = await Notification.findOneAndUpdate(
    {
      _id: notificationId,
      recipientId: userId,
      organizationId,
      readAt: null,
    },
    {
      $set: { readAt: new Date() },
    },
    {
      returnDocument: 'after',
    }
  )
    .populate('relatedClaimId', 'claimNumber')
    .lean();

  if (updatedNotification) {
    return toNotificationDto(updatedNotification);
  }

  // 2. If not updated, check if it already exists and is owned by the user (already read)
  const existingNotification = await Notification.findOne({
    _id: notificationId,
    recipientId: userId,
    organizationId,
  })
    .populate('relatedClaimId', 'claimNumber')
    .lean();

  if (!existingNotification) {
    throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
  }

  return toNotificationDto(existingNotification);
};

/**
 * Sends notifications to all active CLAIMS_OFFICER and ADMIN users in an organization
 * using loop-per-recipient (one separate Notification document per recipient).
 * Zero active recipients produces zero documents and cleanly returns without throwing.
 *
 * @param {Object} params
 * @param {import('mongoose').Types.ObjectId|string} params.organizationId
 * @param {string} params.type
 * @param {import('mongoose').Types.ObjectId|string} params.relatedClaimId
 * @param {string} params.title
 * @param {string} params.body
 * @param {import('mongoose').Types.ObjectId|string} [params.excludeUserId]
 * @param {Object} [params.params]
 * @returns {Promise<Array>} Array of created Notification documents
 */
const sendToOrganization = async ({
  organizationId,
  type,
  relatedClaimId,
  title,
  body,
  excludeUserId,
  params,
}) => {
  const userQuery = {
    organizationId,
    role: { $in: ['CLAIMS_OFFICER', 'ADMIN'] },
    status: 'ACTIVE',
  };

  if (excludeUserId) {
    userQuery._id = { $ne: excludeUserId };
  }

  const recipients = await User.find(userQuery).select('_id fcmToken').lean();

  if (!recipients || recipients.length === 0) {
    return [];
  }

  const createdNotifications = [];
  for (const recipient of recipients) {
    try {
      const notification = await createAndSendNotification({
        recipientId: recipient._id,
        organizationId,
        type,
        relatedClaimId,
        title,
        body,
        params,
      });
      createdNotifications.push(notification);
    } catch (err) {
      console.error(`Failed to send notification to recipient ${recipient._id}:`, err);
    }
  }

  return createdNotifications;
};

module.exports = {
  createAndSendNotification,
  listNotifications,
  getUnreadCount,
  markAsRead,
  sendToOrganization,
  toNotificationDto,
};

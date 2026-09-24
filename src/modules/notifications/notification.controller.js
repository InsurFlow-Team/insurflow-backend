const notificationService = require('./notification.service');
const asyncWrapper = require('../../utils/asyncWrapper');
const { successResponse } = require('../../utils/apiResponse');

/**
 * GET /api/v1/notifications
 * Lists paginated notifications for the authenticated user (newest first).
 */
const listNotifications = async (req, res) => {
  const { page, limit, unreadOnly } = req.query;
  const { notifications, pagination } = await notificationService.listNotifications(
    req.user,
    { page, limit, unreadOnly }
  );

  res.set('X-Total-Count', String(pagination.totalCount));
  res.set('X-Page', String(pagination.page));
  res.set('X-Limit', String(pagination.limit));
  res.set('X-Total-Pages', String(pagination.totalPages));

  return res.status(200).json(successResponse('Notifications retrieved successfully', notifications));
};

/**
 * GET /api/v1/notifications/unread-count
 * Returns the unread notification count for the authenticated user.
 */
const getUnreadCount = async (req, res) => {
  const result = await notificationService.getUnreadCount(req.user);
  return res.status(200).json(successResponse('Unread count retrieved successfully', result));
};

/**
 * PATCH /api/v1/notifications/:id/read
 * Marks a notification as read (idempotent).
 */
const markAsRead = async (req, res) => {
  const { id } = req.params;
  const result = await notificationService.markAsRead(id, req.user);
  return res.status(200).json(successResponse('Notification marked as read', result));
};

module.exports = {
  listNotifications: asyncWrapper(listNotifications),
  getUnreadCount: asyncWrapper(getUnreadCount),
  markAsRead: asyncWrapper(markAsRead),
};

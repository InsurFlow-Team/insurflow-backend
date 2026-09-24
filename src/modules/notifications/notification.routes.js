const express = require('express');
const notificationController = require('./notification.controller');
const authenticate = require('../../middlewares/auth.middleware');
const { validate, validateObjectId } = require('../../middlewares/validate.middleware');
const { listNotificationsQuerySchema } = require('./notification.validation');

const router = express.Router();

// All notification routes require authentication
router.use(authenticate);

// GET /api/v1/notifications — List notifications (paginated, optional ?unreadOnly=true)
router.get(
  '/',
  validate(listNotificationsQuerySchema, 'query'),
  notificationController.listNotifications
);

// GET /api/v1/notifications/unread-count — Get unread count
router.get(
  '/unread-count',
  notificationController.getUnreadCount
);

// PATCH /api/v1/notifications/:id/read — Mark notification as read
router.patch(
  '/:id/read',
  validateObjectId('id'),
  notificationController.markAsRead
);

module.exports = router;

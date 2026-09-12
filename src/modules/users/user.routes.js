const express = require('express');
const userController = require('./user.controller');
const authenticate = require('../../middlewares/auth.middleware');
const authorizeRole = require('../../middlewares/role.middleware');
const { validate, validateObjectId } = require('../../middlewares/validate.middleware');
const {
  createUserSchema,
  updateUserSchema,
  updateStatusSchema,
  resetPasswordSchema,
  getAdjustersQuerySchema,
  listUsersQuerySchema,
} = require('./user.validation');

const router = express.Router();

// All user routes require authentication
router.use(authenticate);

// GET /api/v1/users/adjusters — List available adjusters
router.get(
  '/adjusters',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validate(getAdjustersQuerySchema, 'query'),
  userController.getAdjusters
);

// ADMIN user management routes
router.post('/', authorizeRole(['ADMIN']), validate(createUserSchema), userController.createUser);
router.get('/', authorizeRole(['ADMIN']), validate(listUsersQuerySchema, 'query'), userController.listUsers);
router.patch('/:userId', authorizeRole(['ADMIN']), validateObjectId('userId'), validate(updateUserSchema), userController.updateUser);
router.patch('/:userId/status', authorizeRole(['ADMIN']), validateObjectId('userId'), validate(updateStatusSchema), userController.updateUserStatus);
router.patch('/:userId/reset-password', authorizeRole(['ADMIN']), validateObjectId('userId'), validate(resetPasswordSchema), userController.resetUserPassword);

module.exports = router;

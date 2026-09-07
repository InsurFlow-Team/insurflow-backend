const express = require('express');
const userController = require('./user.controller');
const authenticate = require('../../middlewares/auth.middleware');
const authorizeRole = require('../../middlewares/role.middleware');
const { validate, validateObjectId } = require('../../middlewares/validate.middleware');
const {
  createUserSchema,
  updateStatusSchema,
  resetPasswordSchema,
} = require('./user.validation');

const router = express.Router();

// All user routes require authentication
router.use(authenticate);

// GET /api/v1/users/adjusters — List available adjusters
router.get(
  '/adjusters',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  userController.getAdjusters
);

// ADMIN user management routes
router.post('/', authorizeRole(['ADMIN']), validate(createUserSchema), userController.createUser);
router.get('/', authorizeRole(['ADMIN']), userController.listUsers);
router.patch('/:userId/status', authorizeRole(['ADMIN']), validateObjectId('userId'), validate(updateStatusSchema), userController.updateUserStatus);
router.patch('/:userId/reset-password', authorizeRole(['ADMIN']), validateObjectId('userId'), validate(resetPasswordSchema), userController.resetUserPassword);

module.exports = router;

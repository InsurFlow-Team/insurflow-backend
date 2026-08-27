const express = require('express');
const userController = require('./user.controller');
const authenticate = require('../../middlewares/auth.middleware');
const authorizeRole = require('../../middlewares/role.middleware');

const router = express.Router();

// All user routes require authentication
router.use(authenticate);

// GET /api/v1/users/adjusters — List available adjusters
router.get(
  '/adjusters',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  userController.getAdjusters
);

module.exports = router;

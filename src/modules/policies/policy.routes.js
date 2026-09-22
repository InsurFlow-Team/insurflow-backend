const express = require('express');
const policyController = require('./policy.controller');
const authenticate = require('../../middlewares/auth.middleware');
const adjusterLocationMiddleware = require('../../middlewares/adjusterLocation.middleware');
const authorizeRole = require('../../middlewares/role.middleware');
const validate = require('../../middlewares/validate.middleware');
const { verifyPolicySchema } = require('./policy.validation');

const router = express.Router();

// All policy routes require authentication
router.use(authenticate);
router.use(adjusterLocationMiddleware);

// POST /api/v1/policies/verify — Verify policy eligibility before claim intake
router.post(
  '/verify',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validate(verifyPolicySchema),
  policyController.verifyPolicy
);

module.exports = router;

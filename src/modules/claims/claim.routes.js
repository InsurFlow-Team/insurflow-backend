const express = require('express');
const claimController = require('./claim.controller');
const authenticate = require('../../middlewares/auth.middleware');
const authorizeRole = require('../../middlewares/role.middleware');
const { validate, validateObjectId } = require('../../middlewares/validate.middleware');
const {
  createClaimSchema,
  assignClaimSchema,
  updateVehicleSchema,
  updateAccidentSchema,
  updateLocationSchema,
  listClaimsQuerySchema,
  requestCorrectionSchema,
  decisionSchema,
  closeClaimSchema,
} = require('./claim.validation');

const router = express.Router();

// All claim routes require authentication
router.use(authenticate);

// POST /api/v1/claims — Create a new claim
router.post(
  '/',
  authorizeRole(['CLAIMS_OFFICER']),
  validate(createClaimSchema),
  claimController.createClaim
);

// GET /api/v1/claims — List claims (role-filtered)
router.get(
  '/',
  authorizeRole(['CLAIMS_OFFICER', 'FIELD_ADJUSTER', 'ADMIN']),
  validate(listClaimsQuerySchema, 'query'),
  claimController.getClaims
);

// GET /api/v1/claims/:claimId — Claim details
router.get(
  '/:claimId',
  authorizeRole(['CLAIMS_OFFICER', 'FIELD_ADJUSTER', 'ADMIN']),
  validateObjectId('claimId'),
  claimController.getClaimById
);

// POST /api/v1/claims/:claimId/assign — Assign claim to adjuster
router.post(
  '/:claimId/assign',
  authorizeRole(['CLAIMS_OFFICER']),
  validateObjectId('claimId'),
  validate(assignClaimSchema),
  claimController.assignClaim
);

router.post(
  '/:claimId/inspection/start',
  authorizeRole(['FIELD_ADJUSTER']),
  validateObjectId('claimId'),
  claimController.startInspection
);

router.put(
  '/:claimId/vehicle',
  authorizeRole(['FIELD_ADJUSTER']),
  validateObjectId('claimId'),
  validate(updateVehicleSchema),
  claimController.updateVehicle
);
router.put(
  '/:claimId/accident',
  authorizeRole(['FIELD_ADJUSTER']),
  validateObjectId('claimId'),
  validate(updateAccidentSchema),
  claimController.updateAccident
);
router.put(
  '/:claimId/location',
  authorizeRole(['FIELD_ADJUSTER']),
  validateObjectId('claimId'),
  validate(updateLocationSchema),
  claimController.updateLocation
);

router.post(
  '/:claimId/inspection/submit',
  authorizeRole(['FIELD_ADJUSTER']),
  validateObjectId('claimId'),
  claimController.submitInspection
);
router.post(
  '/:claimId/review/start',
  authorizeRole(['CLAIMS_OFFICER']),
  validateObjectId('claimId'),
  claimController.startReview
);
router.post(
  '/:claimId/review/request-correction',
  authorizeRole(['CLAIMS_OFFICER']),
  validateObjectId('claimId'),
  validate(requestCorrectionSchema),
  claimController.requestCorrection
);

// POST /api/v1/claims/:claimId/decision — Approve or reject a claim
router.post(
  '/:claimId/decision',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validateObjectId('claimId'),
  validate(decisionSchema),
  claimController.decideClaim
);

// POST /api/v1/claims/:claimId/close — Admin closes an approved claim
router.post(
  '/:claimId/close',
  authorizeRole(['ADMIN']),
  validateObjectId('claimId'),
  validate(closeClaimSchema),
  claimController.closeClaim
);

module.exports = router;

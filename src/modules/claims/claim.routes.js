const express = require('express');
const claimController = require('./claim.controller');
const authenticate = require('../../middlewares/auth.middleware');
const adjusterLocationMiddleware = require('../../middlewares/adjusterLocation.middleware');
const authorizeRole = require('../../middlewares/role.middleware');
const { validate, validateObjectId } = require('../../middlewares/validate.middleware');
const upload = require('../../middlewares/upload.middleware');
const {
  createClaimSchema,
  assignClaimSchema,
  acceptAssignmentSchema,
  declineAssignmentSchema,
  updateVehicleSchema,
  updateAccidentSchema,
  updateLocationSchema,
  listClaimsQuerySchema,
  requestCorrectionSchema,
  decisionSchema,
  closeClaimSchema,
  uploadEvidenceSchema,
  getClaimStatsQuerySchema,
  createEstimateSchema,
  compareEstimatesQuerySchema,
  approveEstimateParamsSchema,
  createRepairOrderSchema,
  updateRepairOrderStatusSchema,
  repairOrderParamsSchema,
  adjustReserveSchema,
  dischargeParamsSchema,
  recordPaymentSchema,
  reversePaymentSchema,
  paymentParamsSchema,
} = require('./claim.validation');

const router = express.Router();

// All claim routes require authentication
router.use(authenticate);
router.use(adjusterLocationMiddleware);

// POST /api/v1/claims — Create a new claim
router.post(
  '/',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
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

// GET /api/v1/claims/stats — Dashboard KPI statistics (role-filtered)
router.get(
  '/stats',
  authorizeRole(['CLAIMS_OFFICER', 'FIELD_ADJUSTER', 'ADMIN']),
  validate(getClaimStatsQuerySchema, 'query'),
  claimController.getClaimStats
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
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validateObjectId('claimId'),
  validate(assignClaimSchema),
  claimController.assignClaim
);

// POST /api/v1/claims/:claimId/decline-assignment — Decline assigned claim
router.post(
  '/:claimId/decline-assignment',
  authorizeRole(['FIELD_ADJUSTER']),
  validateObjectId('claimId'),
  validate(declineAssignmentSchema),
  claimController.declineAssignment
);

// POST /api/v1/claims/:claimId/accept-assignment — Accept pending assignment
router.post(
  '/:claimId/accept-assignment',
  authorizeRole(['FIELD_ADJUSTER']),
  validateObjectId('claimId'),
  validate(acceptAssignmentSchema),
  claimController.acceptAssignment
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
  '/:claimId/evidence',
  authorizeRole(['FIELD_ADJUSTER']),
  validateObjectId('claimId'),
  upload.single('file'),
  validate(uploadEvidenceSchema),
  claimController.uploadEvidence
);

router.post(
  '/:claimId/signature',
  authorizeRole(['FIELD_ADJUSTER']),
  validateObjectId('claimId'),
  upload.single('file'),
  claimController.uploadSignature
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

// POST /api/v1/claims/:claimId/estimates — Create an estimate or garage quote
router.post(
  '/:claimId/estimates',
  authorizeRole(['CLAIMS_OFFICER', 'FIELD_ADJUSTER', 'ADMIN']),
  validateObjectId('claimId'),
  validate(createEstimateSchema),
  claimController.createEstimate
);

// GET /api/v1/claims/:claimId/estimates/compare — Compare surveyor and garage estimates
router.get(
  '/:claimId/estimates/compare',
  authorizeRole(['CLAIMS_OFFICER', 'FIELD_ADJUSTER', 'ADMIN']),
  validateObjectId('claimId'),
  validate(compareEstimatesQuerySchema, 'query'),
  claimController.compareEstimates
);

// GET /api/v1/claims/:claimId/estimates — List all estimate versions
router.get(
  '/:claimId/estimates',
  authorizeRole(['CLAIMS_OFFICER', 'FIELD_ADJUSTER', 'ADMIN']),
  validateObjectId('claimId'),
  claimController.getEstimates
);

// POST /api/v1/claims/:claimId/estimates/:version/approve — Approve an estimate version
router.post(
  '/:claimId/estimates/:version/approve',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validate(approveEstimateParamsSchema, 'params'),
  claimController.approveEstimate
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

// GET /api/v1/claims/:claimId/report — Download final claim PDF report
router.get(
  '/:claimId/report',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validateObjectId('claimId'),
  claimController.getClaimReport
);

// POST /api/v1/claims/:claimId/reserve-adjustments — Manual adjustment of indemnity or expense reserve
router.post(
  '/:claimId/reserve-adjustments',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validateObjectId('claimId'),
  validate(adjustReserveSchema),
  claimController.adjustReserve
);

// GET /api/v1/claims/:claimId/reserve — Get current reserve and adjustment history
router.get(
  '/:claimId/reserve',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validateObjectId('claimId'),
  claimController.getClaimReserve
);

// ── Repair Orders Endpoints (PB-10) ──────────────────────────────────────────
// POST /api/v1/claims/:claimId/repair-orders — Create a repair order
router.post(
  '/:claimId/repair-orders',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validateObjectId('claimId'),
  validate(createRepairOrderSchema),
  claimController.createRepairOrder
);

// GET /api/v1/claims/:claimId/repair-orders — List repair orders
router.get(
  '/:claimId/repair-orders',
  authorizeRole(['CLAIMS_OFFICER', 'FIELD_ADJUSTER', 'ADMIN']),
  validateObjectId('claimId'),
  claimController.getRepairOrders
);

// PATCH /api/v1/claims/:claimId/repair-orders/:orderNumber/status — Update status
router.patch(
  '/:claimId/repair-orders/:orderNumber/status',
  authorizeRole(['CLAIMS_OFFICER', 'FIELD_ADJUSTER', 'ADMIN']),
  validate(repairOrderParamsSchema, 'params'),
  validate(updateRepairOrderStatusSchema),
  claimController.updateRepairOrderStatus
);

// ── Discharge Endpoints (PB-15) ──────────────────────────────────────────────
// POST /api/v1/claims/:claimId/discharges — Generate final discharge
router.post(
  '/:claimId/discharges',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validateObjectId('claimId'),
  claimController.createDischarge
);

// POST /api/v1/claims/:claimId/discharges/:dischargeNumber/signed-scan — Upload signed scan
router.post(
  '/:claimId/discharges/:dischargeNumber/signed-scan',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validate(dischargeParamsSchema, 'params'),
  upload.single('file'),
  claimController.signDischarge
);

// GET /api/v1/claims/:claimId/discharges — List discharges (newest first)
router.get(
  '/:claimId/discharges',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validateObjectId('claimId'),
  claimController.getDischarges
);

// GET /api/v1/claims/:claimId/discharges/:dischargeNumber/pdf — Download discharge PDF
router.get(
  '/:claimId/discharges/:dischargeNumber/pdf',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validate(dischargeParamsSchema, 'params'),
  claimController.getDischargePdf
);

// ── Payment Endpoints (PB-16) ────────────────────────────────────────────────
// POST /api/v1/claims/:claimId/payments — Record a payment
router.post(
  '/:claimId/payments',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validateObjectId('claimId'),
  validate(recordPaymentSchema),
  claimController.recordPayment
);

// POST /api/v1/claims/:claimId/payments/:paymentNumber/reverse — Reverse a payment
router.post(
  '/:claimId/payments/:paymentNumber/reverse',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validate(paymentParamsSchema, 'params'),
  validate(reversePaymentSchema),
  claimController.reversePayment
);

// GET /api/v1/claims/:claimId/payments — Read payments and payment status
router.get(
  '/:claimId/payments',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validateObjectId('claimId'),
  claimController.getPayments
);

const letterRoutes = require('../letters/letter.routes');

// Nested letter subresource
router.use('/:claimId/letters', validateObjectId('claimId'), letterRoutes);

module.exports = router;

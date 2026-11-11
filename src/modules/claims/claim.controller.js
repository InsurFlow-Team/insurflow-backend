const claimService = require('./claim.service');
const { successResponse } = require('../../utils/apiResponse');
const asyncWrapper = require('../../utils/asyncWrapper');

/**
 * POST /api/v1/claims
 * Creates a new claim. Authorized: CLAIMS_OFFICER, ADMIN.
 */
const createClaim = async (req, res) => {
  const result = await claimService.createClaim(req.body, req.user);
  return res.status(201).json(successResponse('Claim created successfully', result));
};

/**
 * POST /api/v1/claims/:claimId/assign
 * Assigns a claim to a Field Adjuster. Authorized: CLAIMS_OFFICER, ADMIN.
 */
const assignClaim = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.assignClaim(claimId, req.body, req.user);
  return res.status(200).json(successResponse('Assignment pending acceptance', result));
};

/**
 * POST /api/v1/claims/:claimId/accept-assignment
 * Accepts a pending assignment. Authorized: FIELD_ADJUSTER (assigned only).
 */
const acceptAssignment = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.acceptAssignment(claimId, req.user);
  return res.status(200).json(successResponse('Assignment accepted successfully', result));
};

/**
 * POST /api/v1/claims/:claimId/decline-assignment
 * Declines an assigned claim, returning it to NEW status.
 * Authorized: FIELD_ADJUSTER (the assigned adjuster only).
 */
const declineAssignment = async (req, res) => {
  const { claimId } = req.params;
  const { reason } = req.body;
  const result = await claimService.declineAssignment(claimId, reason, req.user);
  return res.status(200).json(successResponse('Assignment declined successfully', result));
};

/**
 * GET /api/v1/claims
 * Returns claims visible to the authenticated user (role-filtered).
 * Authorized: CLAIMS_OFFICER, FIELD_ADJUSTER, ADMIN.
 */
const getClaims = async (req, res) => {
  const { status, adjusterId, assignedTo, page, limit } = req.query;
  const { claims, pagination } = await claimService.getClaims(
    req.user,
    { status, adjusterId: adjusterId || assignedTo },
    { page, limit }
  );

  res.set('X-Total-Count', String(pagination.totalCount));
  res.set('X-Page', String(pagination.page));
  res.set('X-Limit', String(pagination.limit));
  res.set('X-Total-Pages', String(pagination.totalPages));

  return res.status(200).json(successResponse('Claims retrieved successfully', claims));
};


/**
 * GET /api/v1/claims/:claimId
 * Returns the full details of a single claim.
 * Authorized: CLAIMS_OFFICER, FIELD_ADJUSTER, ADMIN.
 */
const getClaimById = async (req, res) => {
  const { claimId } = req.params;
  const claim = await claimService.getClaimById(claimId, req.user);
  return res.status(200).json(successResponse('Claim retrieved successfully', claim));
};

const startInspection = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.startInspection(claimId, req.user);
  return res.status(200).json(successResponse('Inspection started successfully', result));
};

const updateVehicle = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.updateVehicle(claimId, req.body, req.user);
  return res.status(200).json(successResponse('Vehicle updated successfully', result));
};

const updateAccident = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.updateAccident(claimId, req.body, req.user);
  return res.status(200).json(successResponse('Accident updated successfully', result));
};

const updateLocation = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.updateLocation(claimId, req.body, req.user);
  return res.status(200).json(successResponse('Location updated successfully', result));
};

const uploadEvidence = async (req, res) => {
  const { claimId } = req.params;
  const { imageType } = req.body;
  const result = await claimService.uploadEvidence(claimId, imageType, req.file, req.user);
  return res.status(200).json(successResponse('Evidence uploaded successfully', result));
};

const uploadSignature = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.uploadSignature(claimId, req.file, req.user);
  return res.status(200).json(successResponse('Signature captured successfully', result));
};

const submitInspection = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.submitInspection(claimId, req.user);
  return res.status(200).json(successResponse('Inspection submitted successfully', result));
};

const startReview = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.startReview(claimId, req.user);
  return res.status(200).json(successResponse('Review started successfully', result));
};

const requestCorrection = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.requestCorrection(claimId, req.body, req.user);
  return res.status(200).json(successResponse('Correction requested successfully', result));
};

/**
 * POST /api/v1/claims/:claimId/decision
 * Makes a decision (APPROVED/REJECTED) on a claim. Authorized: CLAIMS_OFFICER, ADMIN.
 */
const decideClaim = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.decideClaim(claimId, req.body, req.user);
  return res.status(200).json(successResponse('Decision recorded successfully', result));
};

/**
 * POST /api/v1/claims/:claimId/close
 * Closes an approved claim. Authorized: ADMIN.
 */
const closeClaim = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.closeClaim(claimId, req.body, req.user);
  return res.status(200).json(successResponse('Claim closed', result));
};

/**
 * GET /api/v1/claims/stats
 * Aggregates KPI statistics for the dashboard.
 * Authorized: CLAIMS_OFFICER, FIELD_ADJUSTER, ADMIN.
 */
const getClaimStats = async (req, res) => {
  const stats = await claimService.getClaimStats(req.user, req.query);
  return res.status(200).json(successResponse('Claim statistics retrieved successfully', stats));
};

/**
 * GET /api/v1/claims/:claimId/report
 * Generates and downloads the final claim PDF report.
 * Authorized: CLAIMS_OFFICER, ADMIN.
 */
const getClaimReport = async (req, res) => {
  const { claimId } = req.params;
  const { buffer, claimNumber } = await claimService.getClaimReport(claimId, req.user);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${claimNumber}-report.pdf"`);
  return res.status(200).send(buffer);
};


const createEstimate = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.createEstimate(claimId, req.body, req.user);
  return res.status(201).json(successResponse('Estimate created successfully', result));
};

const getEstimates = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.getEstimates(claimId, req.user);
  return res.status(200).json(successResponse('Estimates retrieved successfully', result));
};

const compareEstimates = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.compareEstimates(claimId, req.query, req.user);
  return res.status(200).json(successResponse('Estimates comparison retrieved successfully', result));
};

const approveEstimate = async (req, res) => {
  const { claimId, version } = req.params;
  const result = await claimService.approveEstimate(claimId, version, req.user);
  return res.status(200).json(successResponse('Estimate approved successfully', result));
};

const createRepairOrder = async (req, res) => {
  const { claimId } = req.params;
  const order = await claimService.createRepairOrder(claimId, req.body, req.user);
  return res.status(201).json(successResponse('Repair order created successfully', order));
};

const updateRepairOrderStatus = async (req, res) => {
  const { claimId, orderNumber } = req.params;
  const order = await claimService.updateRepairOrderStatus(claimId, orderNumber, req.body, req.user);
  return res.status(200).json(successResponse('Repair order status updated successfully', order));
};

const getRepairOrders = async (req, res) => {
  const { claimId } = req.params;
  const orders = await claimService.getRepairOrders(claimId, req.user);
  return res.status(200).json(successResponse('Repair orders retrieved successfully', orders));
};

const adjustReserve = async (req, res) => {
  const { claimId } = req.params;
  const reserve = await claimService.adjustReserve(claimId, req.body, req.user);
  return res.status(200).json(successResponse('Reserve adjusted successfully', reserve));
};

const getClaimReserve = async (req, res) => {
  const { claimId } = req.params;
  const reserve = await claimService.getClaimReserve(claimId, req.user);
  return res.status(200).json(successResponse('Claim reserve retrieved successfully', reserve));
};

const createDischarge = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.createDischarge(claimId, req.user);
  return res.status(201).json(successResponse('Discharge created successfully', result));
};

const signDischarge = async (req, res) => {
  const { claimId, dischargeNumber } = req.params;
  const result = await claimService.signDischarge(claimId, dischargeNumber, req.file, req.user);
  return res.status(200).json(successResponse('Discharge signed successfully', result));
};

const getDischarges = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.getDischarges(claimId, req.user);
  return res.status(200).json(successResponse('Discharges retrieved successfully', result));
};

const getDischargePdf = async (req, res) => {
  const { claimId, dischargeNumber } = req.params;
  const { buffer } = await claimService.getDischargePdf(claimId, dischargeNumber, req.user);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${dischargeNumber}.pdf"`);
  return res.status(200).send(buffer);
};


const recordPayment = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.recordPayment(claimId, req.body, req.user);
  return res.status(201).json(successResponse('Payment recorded successfully', result));
};

const reversePayment = async (req, res) => {
  const { claimId, paymentNumber } = req.params;
  const result = await claimService.reversePayment(claimId, paymentNumber, req.body, req.user);
  return res.status(200).json(successResponse('Payment reversed successfully', result));
};

const getPayments = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.getPayments(claimId, req.user);
  return res.status(200).json(successResponse('Payments retrieved successfully', result));
};

const rotateTrackingToken = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.rotateTrackingToken(claimId, req.body, req.user);
  return res.status(200).json(successResponse('Tracking token rotated successfully', result));
};

module.exports = {
  createClaim: asyncWrapper(createClaim),
  assignClaim: asyncWrapper(assignClaim),
  acceptAssignment: asyncWrapper(acceptAssignment),
  declineAssignment: asyncWrapper(declineAssignment),
  getClaims: asyncWrapper(getClaims),
  getClaimById: asyncWrapper(getClaimById),
  startInspection: asyncWrapper(startInspection),
  updateVehicle: asyncWrapper(updateVehicle),
  updateAccident: asyncWrapper(updateAccident),
  updateLocation: asyncWrapper(updateLocation),
  uploadEvidence: asyncWrapper(uploadEvidence),
  uploadSignature: asyncWrapper(uploadSignature),
  submitInspection: asyncWrapper(submitInspection),
  startReview: asyncWrapper(startReview),
  requestCorrection: asyncWrapper(requestCorrection),
  decideClaim: asyncWrapper(decideClaim),
  closeClaim: asyncWrapper(closeClaim),
  getClaimStats: asyncWrapper(getClaimStats),
  getClaimReport: asyncWrapper(getClaimReport),
  createEstimate: asyncWrapper(createEstimate),
  getEstimates: asyncWrapper(getEstimates),
  compareEstimates: asyncWrapper(compareEstimates),
  approveEstimate: asyncWrapper(approveEstimate),
  createRepairOrder: asyncWrapper(createRepairOrder),
  updateRepairOrderStatus: asyncWrapper(updateRepairOrderStatus),
  getRepairOrders: asyncWrapper(getRepairOrders),
  adjustReserve: asyncWrapper(adjustReserve),
  getClaimReserve: asyncWrapper(getClaimReserve),
  createDischarge: asyncWrapper(createDischarge),
  signDischarge: asyncWrapper(signDischarge),
  getDischarges: asyncWrapper(getDischarges),
  getDischargePdf: asyncWrapper(getDischargePdf),
  recordPayment: asyncWrapper(recordPayment),
  reversePayment: asyncWrapper(reversePayment),
  getPayments: asyncWrapper(getPayments),
  rotateTrackingToken: asyncWrapper(rotateTrackingToken),
};


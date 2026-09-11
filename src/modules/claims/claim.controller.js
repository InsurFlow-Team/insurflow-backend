const claimService = require('./claim.service');
const { successResponse } = require('../../utils/apiResponse');
const asyncWrapper = require('../../utils/asyncWrapper');

/**
 * POST /api/v1/claims
 * Creates a new claim. Authorized: CLAIMS_OFFICER only.
 */
const createClaim = async (req, res) => {
  const result = await claimService.createClaim(req.body, req.user);
  return res.status(201).json(successResponse('Claim created successfully', result));
};

/**
 * POST /api/v1/claims/:claimId/assign
 * Assigns a claim to a Field Adjuster. Authorized: CLAIMS_OFFICER only.
 */
const assignClaim = async (req, res) => {
  const { claimId } = req.params;
  const result = await claimService.assignClaim(claimId, req.body, req.user);
  return res.status(200).json(successResponse('Claim assigned successfully', result));
};

/**
 * GET /api/v1/claims
 * Returns claims visible to the authenticated user (role-filtered).
 * Authorized: CLAIMS_OFFICER, FIELD_ADJUSTER, ADMIN.
 */
const getClaims = async (req, res) => {
  const { status, page, limit } = req.query;
  const { claims, pagination } = await claimService.getClaims(req.user, status, { page, limit });

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

module.exports = {
  createClaim: asyncWrapper(createClaim),
  assignClaim: asyncWrapper(assignClaim),
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
};

const claimService = require('./claim.service');
const { successResponse } = require('../../utils/apiResponse');

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
  const { status } = req.query;
  const claims = await claimService.getClaims(req.user, status);
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

module.exports = {
  createClaim,
  assignClaim,
  getClaims,
  getClaimById,
  updateVehicle,
  updateAccident,
  updateLocation,
  submitInspection,
  startReview,
};

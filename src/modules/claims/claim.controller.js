const claimService = require('./claim.service');
const {
  createClaimSchema,
  assignClaimSchema,
  updateVehicleSchema,
  updateAccidentSchema,
  updateLocationSchema,
} = require('./claim.validation');
const { successResponse, errorResponse } = require('../../utils/apiResponse');

/**
 * POST /api/v1/claims
 * Creates a new claim. Authorized: CLAIMS_OFFICER only.
 */
const createClaim = async (req, res) => {
  const { error, value } = createClaimSchema.validate(req.body, { abortEarly: false });
  if (error) {
    const validationErrors = error.details.map((e) => ({
      code: 'VALIDATION_ERROR',
      details: e.message,
    }));
    return res.status(400).json(errorResponse('Validation Error', validationErrors));
  }

  const result = await claimService.createClaim(value, req.user);
  return res.status(201).json(successResponse('Claim created successfully', result));
};

/**
 * POST /api/v1/claims/:claimId/assign
 * Assigns a claim to a Field Adjuster. Authorized: CLAIMS_OFFICER only.
 */
const assignClaim = async (req, res) => {
  const { claimId } = req.params;
  const { error, value } = assignClaimSchema.validate(req.body, { abortEarly: false });
  if (error) {
    const validationErrors = error.details.map((e) => ({
      code: 'VALIDATION_ERROR',
      details: e.message,
    }));
    return res.status(400).json(errorResponse('Validation Error', validationErrors));
  }

  const result = await claimService.assignClaim(claimId, value, req.user);
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
  const { error, value } = updateVehicleSchema.validate(req.body, { abortEarly: false });
  if (error) {
    const validationErrors = error.details.map((e) => ({
      code: 'VALIDATION_ERROR',
      details: e.message,
    }));
    return res.status(400).json(errorResponse('Validation Error', validationErrors));
  }

  const result = await claimService.updateVehicle(claimId, value, req.user);
  return res.status(200).json(successResponse('Vehicle updated successfully', result));
};

const updateAccident = async (req, res) => {
  const { claimId } = req.params;
  const { error, value } = updateAccidentSchema.validate(req.body, { abortEarly: false });
  if (error) {
    const validationErrors = error.details.map((e) => ({
      code: 'VALIDATION_ERROR',
      details: e.message,
    }));
    return res.status(400).json(errorResponse('Validation Error', validationErrors));
  }

  const result = await claimService.updateAccident(claimId, value, req.user);
  return res.status(200).json(successResponse('Accident updated successfully', result));
};

const updateLocation = async (req, res) => {
  const { claimId } = req.params;
  const { error, value } = updateLocationSchema.validate(req.body, { abortEarly: false });
  if (error) {
    const validationErrors = error.details.map((e) => ({
      code: 'VALIDATION_ERROR',
      details: e.message,
    }));
    return res.status(400).json(errorResponse('Validation Error', validationErrors));
  }

  const result = await claimService.updateLocation(claimId, value, req.user);
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

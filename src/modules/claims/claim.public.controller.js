const claimService = require('./claim.service');
const { successResponse } = require('../../utils/apiResponse');
const asyncWrapper = require('../../utils/asyncWrapper');
const AppError = require('../../utils/appError');

/**
 * GET /api/v1/public/claims/track/:trackingToken
 * Returns the public-facing status and progress of a claim.
 * No authentication required. Token is the sole authorization.
 */
const getPublicClaimStatus = async (req, res) => {
  // Prevent browser/CDN caching and search engine indexing on public responses
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.set('X-Robots-Tag', 'noindex, nofollow');

  const { trackingToken } = req.params;

  // Validate token format: reject malformed tokens before querying the database
  if (!trackingToken || !/^[0-9a-f]{64}$/.test(trackingToken)) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  const data = await claimService.getPublicClaimStatus(trackingToken);
  if (!data) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  return res.status(200).json(successResponse('Claim status retrieved successfully', data));
};

module.exports = {
  getPublicClaimStatus: asyncWrapper(getPublicClaimStatus),
};

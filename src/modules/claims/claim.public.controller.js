const claimService = require('./claim.service');
const { successResponse } = require('../../utils/apiResponse');
const asyncWrapper = require('../../utils/asyncWrapper');

/**
 * GET /api/v1/public/claims/track/:trackingToken
 * Returns the public-facing status and progress of a claim.
 * No authentication required. Token is the sole authorization.
 */
const getPublicClaimStatus = async (req, res) => {
  // Prevent browser/CDN caching on all public responses (success, not found, or invalid)
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');

  const { trackingToken } = req.params;

  // Validate token format: must be exactly 64 lowercase hex characters
  if (!trackingToken || !/^[0-9a-f]{64}$/.test(trackingToken)) {
    return res.status(404).json({
      success: false,
      message: 'Claim not found',
    });
  }

  const data = await claimService.getPublicClaimStatus(trackingToken);
  if (!data) {
    return res.status(404).json({
      success: false,
      message: 'Claim not found',
    });
  }

  return res.status(200).json(successResponse('Claim status retrieved successfully', data));
};

module.exports = {
  getPublicClaimStatus: asyncWrapper(getPublicClaimStatus),
};

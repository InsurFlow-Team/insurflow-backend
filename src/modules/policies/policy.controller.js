const policyService = require('./policy.service');
const { successResponse } = require('../../utils/apiResponse');
const asyncWrapper = require('../../utils/asyncWrapper');

/**
 * POST /api/v1/policies/verify
 * Verify policy eligibility before claim intake.
 */
const verifyPolicy = async (req, res) => {
  const result = await policyService.verifyPolicy(req.body, req.user);
  return res.status(200).json(successResponse('Policy verified successfully', result));
};

module.exports = {
  verifyPolicy: asyncWrapper(verifyPolicy),
};

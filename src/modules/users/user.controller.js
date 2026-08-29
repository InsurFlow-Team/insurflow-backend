const userService = require('./user.service');
const { successResponse } = require('../../utils/apiResponse');

/**
 * GET /api/v1/users/adjusters
 * Returns adjusters belonging to the authenticated user's organization.
 */
const getAdjusters = async (req, res) => {
  const { status } = req.query;
  const { organizationId } = req.user;

  const adjusters = await userService.getAdjusters(organizationId, status);
  return res.status(200).json(successResponse('Adjusters retrieved successfully', adjusters));
};

const asyncWrapper = require('../../utils/asyncWrapper');

module.exports = {
  getAdjusters: asyncWrapper(getAdjusters),
};

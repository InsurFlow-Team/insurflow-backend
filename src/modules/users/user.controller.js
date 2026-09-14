const userService = require('./user.service');
const { successResponse } = require('../../utils/apiResponse');
const asyncWrapper = require('../../utils/asyncWrapper');

/**
 * GET /api/v1/users/adjusters
 * Returns adjusters belonging to the authenticated user's organization.
 */
const getAdjusters = async (req, res) => {
  const { organizationId } = req.user;

  const adjusters = await userService.getAdjusters(organizationId, req.query);
  return res.status(200).json(successResponse('Adjusters retrieved successfully', adjusters));
};

const createUser = async (req, res) => {
  const user = await userService.createUser(req.body, req.user);
  return res.status(201).json(successResponse('User created successfully', user));
};

const listUsers = async (req, res) => {
  const { role, page, limit } = req.query;
  const { users, pagination } = await userService.listUsers(req.user, role, { page, limit });

  res.set('X-Total-Count', String(pagination.totalCount));
  res.set('X-Page', String(pagination.page));
  res.set('X-Limit', String(pagination.limit));
  res.set('X-Total-Pages', String(pagination.totalPages));

  return res.status(200).json(successResponse('Users retrieved successfully', users));
};


const updateUser = async (req, res) => {
  const { userId } = req.params;
  const updatedUser = await userService.updateUser(userId, req.body, req.user);
  return res.status(200).json(successResponse('User updated successfully', updatedUser));
};

const updateUserStatus = async (req, res) => {
  const { userId } = req.params;
  const updatedUser = await userService.updateUserStatus(userId, req.body.status, req.user);
  return res.status(200).json(successResponse('User status updated successfully', updatedUser));
};

const resetUserPassword = async (req, res) => {
  const { userId } = req.params;
  const result = await userService.resetUserPassword(userId, req.body.newPassword, req.user);
  return res.status(200).json(successResponse('User password reset successfully', result));
};

module.exports = {
  getAdjusters: asyncWrapper(getAdjusters),
  createUser: asyncWrapper(createUser),
  listUsers: asyncWrapper(listUsers),
  updateUser: asyncWrapper(updateUser),
  updateUserStatus: asyncWrapper(updateUserStatus),
  resetUserPassword: asyncWrapper(resetUserPassword),
};

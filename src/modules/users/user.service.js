const userRepository = require('./user.repository');
const claimRepository = require('../claims/claim.repository');


const getAdjusters = async (organizationId, statusFilter) => {
  const adjusters = await userRepository.findAdjustersByOrganization(organizationId);

  const adjustersWithAvailability = await Promise.all(
    adjusters.map(async (adjuster) => {
      // Compute active tasks count
      const activeTasksCount = await claimRepository.countActiveClaimsByAssignee(adjuster._id);

      // Availability logic for Sprint 1
      const isAvailable = adjuster.status === 'ACTIVE' && activeTasksCount === 0;

      return {
        id: adjuster._id,
        name: adjuster.name,
        employeeCode: adjuster.employeeCode,
        role: adjuster.role,
        status: adjuster.status,
        availability: isAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
        activeTasksCount,
      };
    })
  );

  if (statusFilter === 'available') {
    return adjustersWithAvailability.filter((a) => a.availability === 'AVAILABLE');
  }

  return adjustersWithAvailability;
};

const AppError = require('../../utils/appError');

const createUser = async (body, authUser) => {
  try {
    const newUser = await userRepository.create({
      ...body,
      organizationId: authUser.organizationId,
      status: 'ACTIVE',
    });
    return {
      id: newUser._id,
      name: newUser.name,
      employeeCode: newUser.employeeCode,
      role: newUser.role,
      status: newUser.status,
      createdAt: newUser.createdAt,
    };
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError('An employee with this code already exists in your organization', 409, 'EMPLOYEE_CODE_TAKEN');
    }
    throw err;
  }
};

const listUsers = async (authUser, role) => {
  return await userRepository.findAllByOrganization(authUser.organizationId, role);
};

const updateUserStatus = async (userId, status, authUser) => {
  const updated = await userRepository.updateStatus(userId, authUser.organizationId, status);
  if (!updated) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }
  return { id: updated._id, status: updated.status };
};

const resetUserPassword = async (userId, newPassword, authUser) => {
  const updated = await userRepository.resetPassword(userId, authUser.organizationId, newPassword);
  if (!updated) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }
  return { id: updated._id, message: 'Password reset successfully' };
};

module.exports = {
  getAdjusters,
  createUser,
  listUsers,
  updateUserStatus,
  resetUserPassword,
};

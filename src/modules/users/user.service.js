const userRepository = require('./user.repository');

const getAdjusters = async (organizationId, statusFilter) => {
  return await userRepository.findAdjustersWithWorkload(organizationId, statusFilter);
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

const listUsers = async (authUser, role, pagination = {}) => {
  const { page = 1, limit = 50 } = pagination;
  const { totalCount, users } = await userRepository.findAllByOrganization(
    authUser.organizationId,
    role,
    { page, limit }
  );
  const totalPages = Math.ceil(totalCount / limit);

  return {
    users,
    pagination: {
      totalCount,
      page,
      limit,
      totalPages,
    },
  };
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

const updateUser = async (userId, updateData, authUser) => {
  try {
    const updated = await userRepository.updateUser(userId, authUser.organizationId, updateData);
    if (!updated) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }
    return {
      id: updated._id,
      name: updated.name,
      employeeCode: updated.employeeCode,
      role: updated.role,
      status: updated.status,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError('An employee with this code already exists in your organization', 409, 'EMPLOYEE_CODE_TAKEN');
    }
    throw err;
  }
};

module.exports = {
  getAdjusters,
  createUser,
  listUsers,
  updateUser,
  updateUserStatus,
  resetUserPassword,
};

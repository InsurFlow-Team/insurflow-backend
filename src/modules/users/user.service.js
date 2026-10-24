const userRepository = require('./user.repository');
const claimRepository = require('../claims/claim.repository');
const { calculateHaversineDistance } = require('../../utils/geo.utils');
const AppError = require('../../utils/appError');
const { getLicenseState, LICENSE_STATE } = require('../../utils/surveyorLicense');

const getAdjusters = async (organizationId, options = {}) => {
  const query = typeof options === 'string' ? { status: options } : options;
  const { status, claimId, latitude, longitude } = query;

  const adjusters = await userRepository.findAdjustersWithWorkload(organizationId, status, {
    onlyValidLicense: true,
  });

  let refLat = null;
  let refLon = null;

  if (typeof latitude === 'number' && typeof longitude === 'number') {
    refLat = latitude;
    refLon = longitude;
  } else if (claimId) {
    const claim = await claimRepository.findByIdAndOrganization(claimId, organizationId);
    if (!claim) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }
    if (
      claim.incidentCoordinates &&
      typeof claim.incidentCoordinates.latitude === 'number' &&
      typeof claim.incidentCoordinates.longitude === 'number'
    ) {
      refLat = claim.incidentCoordinates.latitude;
      refLon = claim.incidentCoordinates.longitude;
    }
  }

  const adjustersWithDistance = adjusters.map((adj) => {
    let distanceKm = null;
    if (
      refLat !== null &&
      refLon !== null &&
      adj.location &&
      typeof adj.location.latitude === 'number' &&
      typeof adj.location.longitude === 'number'
    ) {
      distanceKm = calculateHaversineDistance(
        refLat,
        refLon,
        adj.location.latitude,
        adj.location.longitude
      );
    }
    return {
      ...adj,
      latitude: adj.location && typeof adj.location.latitude === 'number' ? adj.location.latitude : null,
      longitude: adj.location && typeof adj.location.longitude === 'number' ? adj.location.longitude : null,
      distanceKm,
      surveyorLicenseExpiry: adj.surveyorLicenseExpiry || null,
      licenseExpiringSoon: getLicenseState(adj) === LICENSE_STATE.EXPIRING_SOON,
    };
  });

  if (refLat !== null && refLon !== null) {
    adjustersWithDistance.sort((a, b) => {
      if (a.distanceKm === null && b.distanceKm === null) return 0;
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });
  }

  return adjustersWithDistance;
};

const createUser = async (body, authUser) => {
  try {
    if (body.role === 'FIELD_ADJUSTER') {
      const licenseState = getLicenseState(body);
      if (licenseState === LICENSE_STATE.EXPIRED) {
        throw new AppError('Surveyor license is expired', 422, 'SURVEYOR_LICENSE_EXPIRED', 'LICENSE_EXPIRED');
      }
    }

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
      surveyorLicenseNumber: newUser.surveyorLicenseNumber || null,
      surveyorLicenseExpiry: newUser.surveyorLicenseExpiry || null,
      licenseState: newUser.role === 'FIELD_ADJUSTER' ? getLicenseState(newUser) : null,
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

  const formattedUsers = users.map((u) => ({
    ...u,
    surveyorLicenseNumber: u.role === 'FIELD_ADJUSTER' ? (u.surveyorLicenseNumber || null) : null,
    surveyorLicenseExpiry: u.role === 'FIELD_ADJUSTER' ? (u.surveyorLicenseExpiry || null) : null,
    licenseState: u.role === 'FIELD_ADJUSTER' ? getLicenseState(u) : null,
  }));

  return {
    users: formattedUsers,
    pagination: {
      totalCount,
      page,
      limit,
      totalPages,
    },
  };
};

const updateUserStatus = async (userId, status, authUser) => {
  if (status === 'ACTIVE') {
    const updated = await userRepository.updateStatusToActiveWithLicenseCheck(
      userId,
      authUser.organizationId
    );
    if (!updated) {
      const existing = await userRepository.findByIdAndOrganization(
        userId,
        authUser.organizationId
      );
      if (!existing) {
        throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      }
      const state = getLicenseState(existing);
      if (state === LICENSE_STATE.MISSING) {
        throw new AppError(
          'Surveyor license is missing',
          422,
          'SURVEYOR_LICENSE_EXPIRED',
          'LICENSE_MISSING'
        );
      }
      throw new AppError(
        'Surveyor license is expired',
        422,
        'SURVEYOR_LICENSE_EXPIRED',
        'LICENSE_EXPIRED'
      );
    }
    return { id: updated._id, status: updated.status };
  }

  const updated = await userRepository.updateStatus(
    userId,
    authUser.organizationId,
    status
  );
  if (!updated) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }
  return { id: updated._id, status: updated.status };
};

const updateSurveyorLicense = async (userId, body, authUser) => {
  const updated = await userRepository.updateSurveyorLicense(
    userId,
    authUser.organizationId,
    body
  );

  if (!updated) {
    const existing = await userRepository.findByIdAndOrganization(
      userId,
      authUser.organizationId
    );
    if (!existing) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }
    if (existing.role !== 'FIELD_ADJUSTER') {
      throw new AppError('User is not a field adjuster', 422, 'NOT_A_FIELD_ADJUSTER');
    }
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  return {
    id: updated._id,
    surveyorLicenseNumber: updated.surveyorLicenseNumber,
    surveyorLicenseExpiry: updated.surveyorLicenseExpiry,
    licenseState: getLicenseState(updated),
  };
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

const updateFcmToken = async (fcmToken, authUser) => {
  const userId = authUser.userId;
  const updated = await userRepository.updateFcmToken(userId, authUser.organizationId, fcmToken);
  if (!updated) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }
  return {
    id: updated._id,
    fcmToken: updated.fcmToken,
  };
};

module.exports = {
  getAdjusters,
  createUser,
  listUsers,
  updateUser,
  updateUserStatus,
  updateSurveyorLicense,
  resetUserPassword,
  updateFcmToken,
};

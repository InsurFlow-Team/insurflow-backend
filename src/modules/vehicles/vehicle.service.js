const vehicleRepository = require('./vehicle.repository');
const AppError = require('../../utils/appError');
const { maskPhone } = require('../../utils/maskPii');

/**
 * Lookup a vehicle by plate number.
 * Normalizes the plate number and enforces organization isolation.
 *
 * @param {string} plateNumber
 * @param {object} authUser
 * @returns {Promise<object>}
 */
const lookupVehicle = async (plateNumber, authUser) => {
  const { organizationId } = authUser;
  
  // Normalize plate number (e.g., uppercase and trim)
  const normalizedPlate = plateNumber.trim().toUpperCase();

  const vehicle = await vehicleRepository.findByPlateAndOrganization(normalizedPlate, organizationId);

  if (!vehicle) {
    throw new AppError('Vehicle not found', 404, 'VEHICLE_NOT_FOUND');
  }

  const formatPolicy = (p) =>
    p
      ? {
          id: p._id,
          policyNumber: p.policyNumber,
          policyKind: p.policyKind,
          status: p.status,
          startDate: p.startDate ? p.startDate.toISOString().split('T')[0] : null,
          expiryDate: p.expiryDate ? p.expiryDate.toISOString().split('T')[0] : null,
        }
      : null;

  const policies = {
    compulsory: formatPolicy(vehicle.compulsoryPolicyId),
    complementary: formatPolicy(vehicle.complementaryPolicyId),
  };

  const warnings = [];
  if (vehicle.compulsoryPolicyId && vehicle.compulsoryPolicyId.status === 'EXPIRED') {
    warnings.push({
      code: 'POLICY_EXPIRED',
      policyKind: vehicle.compulsoryPolicyId.policyKind,
      details: 'This policy has expired. The inspection may continue, but flag this claim for review.',
    });
  }
  if (vehicle.complementaryPolicyId && vehicle.complementaryPolicyId.status === 'EXPIRED') {
    warnings.push({
      code: 'POLICY_EXPIRED',
      policyKind: vehicle.complementaryPolicyId.policyKind,
      details: 'This policy has expired. The inspection may continue, but flag this claim for review.',
    });
  }

  const response = {
    vehicle: {
      id: vehicle._id,
      plateNumber: vehicle.plateNumber,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      color: vehicle.color,
    },
    customer: vehicle.customerId
      ? {
          id: vehicle.customerId._id,
          fullName: vehicle.customerId.fullName,
          phone:
            authUser.role === 'FIELD_ADJUSTER'
              ? maskPhone(vehicle.customerId.phone)
              : vehicle.customerId.phone,
        }
      : null,
    policies,
    warnings,
  };

  return response;
};

module.exports = {
  lookupVehicle,
};

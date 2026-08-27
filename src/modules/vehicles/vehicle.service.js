const vehicleRepository = require('./vehicle.repository');
const AppError = require('../../utils/appError');

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

  // Format response to exactly match the Mobile contract
  return {
    vehicle: {
      id: vehicle._id,
      plate_number: vehicle.plateNumber,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      color: vehicle.color,
    },
    customer: vehicle.customerId
      ? {
          id: vehicle.customerId._id,
          full_name: vehicle.customerId.fullName,
          phone: vehicle.customerId.phone,
        }
      : null,
    policy: vehicle.policyId
      ? {
          id: vehicle.policyId._id,
          policy_number: vehicle.policyId.policyNumber,
          status: vehicle.policyId.status,
          start_date: vehicle.policyId.startDate ? vehicle.policyId.startDate.toISOString().split('T')[0] : null,
          expiry_date: vehicle.policyId.expiryDate ? vehicle.policyId.expiryDate.toISOString().split('T')[0] : null,
        }
      : null,
  };
};

module.exports = {
  lookupVehicle,
};

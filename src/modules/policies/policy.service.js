const policyRepository = require('./policy.repository');
const vehicleRepository = require('../vehicles/vehicle.repository');
const AppError = require('../../utils/appError');

/**
 * Verify policy eligibility before claim intake.
 *
 * Business rules enforced:
 *  1. Either policyNumber or plateNumber must be provided (or both).
 *  2. Policy must exist within the caller's organization (tenant isolation).
 *  3. Policy status must be ACTIVE (not EXPIRED or CANCELLED).
 *  4. Current date must not exceed expiryDate if no incidentDate is provided.
 *  5. If incidentDate is provided:
 *     - Cannot be in the future.
 *     - Must fall within [startDate, expiryDate].
 *  6. If plateNumber is provided:
 *     - When verified alongside policyNumber, a vehicle must exist and plate must match.
 *     - When verified by plateNumber alone, vehicle must have an active policy.
 *
 * @param {object} body - { policyNumber?, plateNumber?, incidentDate? }
 * @param {object} authUser - Authenticated user context from JWT
 * @returns {Promise<object>} Verified policy, vehicle, and customer data
 */
const verifyPolicy = async (body, authUser) => {
  const { policyNumber, plateNumber, incidentDate } = body;
  const { organizationId } = authUser;

  let policy = null;
  let vehicle = null;

  // 1. Resolve Policy and Vehicle
  if (policyNumber) {
    policy = await policyRepository.findByPolicyNumberAndOrganization(policyNumber, organizationId);

    if (!policy) {
      throw new AppError('Policy not found in your insurance company', 404, 'POLICY_NOT_FOUND');
    }

    const vehicles = await vehicleRepository.findAllByPolicyAndOrganization(policy._id, organizationId);

    // Cross-match plate if provided
    if (plateNumber) {
      if (!vehicles || vehicles.length === 0) {
        throw new AppError(
          'Vehicle plate number does not match this policy',
          422,
          'VEHICLE_MISMATCH'
        );
      }

      const normalizedInput = plateNumber.trim().toUpperCase();
      vehicle = vehicles.find(
        (v) => v.plateNumber.trim().toUpperCase() === normalizedInput
      );

      if (!vehicle) {
        throw new AppError(
          'Vehicle plate number does not match this policy',
          422,
          'VEHICLE_MISMATCH'
        );
      }
    } else {
      // No plate provided — use first vehicle if any exist
      vehicle = vehicles.length > 0 ? vehicles[0] : null;
    }
  } else if (plateNumber) {
    // Lookup primarily by plate number
    const normalizedPlate = plateNumber.trim().toUpperCase();
    vehicle = await vehicleRepository.findByPlateAndOrganization(normalizedPlate, organizationId);

    if (!vehicle) {
      throw new AppError('Vehicle not found with the provided plate number', 404, 'VEHICLE_NOT_FOUND');
    }

    if (!vehicle.policyId) {
      throw new AppError('No insurance policy is linked to this vehicle', 404, 'POLICY_NOT_FOUND');
    }

    policy = vehicle.policyId;
  }

  // 2. Check policy status
  if (policy.status === 'CANCELLED') {
    throw new AppError('Policy has been cancelled', 422, 'POLICY_CANCELLED');
  }

  if (policy.status === 'EXPIRED') {
    throw new AppError('Policy has expired', 422, 'POLICY_EXPIRED');
  }

  // 3. Date validity checks
  const now = new Date();

  if (incidentDate) {
    const incident = new Date(incidentDate + 'T00:00:00.000Z');

    // Invariant: incident cannot be in the future
    if (incident > now) {
      throw new AppError('Incident date cannot be in the future', 400, 'INVALID_INCIDENT_DATE');
    }

    const start = new Date(policy.startDate);
    const expiry = new Date(policy.expiryDate);

    // Set start to beginning of day and expiry to end of day for inclusive comparison
    start.setUTCHours(0, 0, 0, 0);
    expiry.setUTCHours(23, 59, 59, 999);

    if (incident < start || incident > expiry) {
      throw new AppError(
        'Policy was not active on the incident date',
        422,
        'POLICY_NOT_ACTIVE_ON_DATE'
      );
    }
  } else {
    // If no incidentDate provided, check if calendar expiry date has elapsed
    if (policy.expiryDate && new Date(policy.expiryDate) < now) {
      throw new AppError('Policy has expired', 422, 'POLICY_EXPIRED');
    }
  }

  // 4. Build standardized response
  const result = {
    isEligible: true,
    policy: {
      id: policy._id,
      policyNumber: policy.policyNumber,
      status: policy.status,
      startDate: policy.startDate ? new Date(policy.startDate).toISOString().split('T')[0] : null,
      expiryDate: policy.expiryDate ? new Date(policy.expiryDate).toISOString().split('T')[0] : null,
    },
    vehicle: vehicle
      ? {
          id: vehicle._id,
          plateNumber: vehicle.plateNumber,
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
          color: vehicle.color,
        }
      : null,
    customer: vehicle && vehicle.customerId
      ? {
          id: vehicle.customerId._id,
          fullName: vehicle.customerId.fullName,
          phone: vehicle.customerId.phone,
        }
      : null,
  };

  return result;
};

module.exports = {
  verifyPolicy,
};

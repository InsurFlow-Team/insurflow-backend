const Policy = require('./policy.model');
const policyRepository = require('./policy.repository');
const vehicleRepository = require('../vehicles/vehicle.repository');
const AppError = require('../../utils/appError');
const computeEligibilityHint = require('../../utils/computeEligibilityHint');

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
 *  7. Coverage Snapshot & Eligibility Hint:
 *     - policyType, coveredPerils, and deductibleAmount returned in policy snapshot.
 *     - If incidentType is supplied on an ACTIVE, unexpired policy:
 *         * ELIGIBLE_FOR_REVIEW if incidentType in coveredPerils.
 *         * NOT_COVERED_BY_POLICY_TYPE if incidentType not in coveredPerils.
 *         * COVERAGE_UNKNOWN if policyType is undefined/null (legacy document).
 *     - If incidentType is not supplied: eligibilityHint is null.
 *
 * @param {object} body - { policyNumber?, plateNumber?, incidentDate?, incidentType? }
 * @param {object} authUser - Authenticated user context from JWT
 * @returns {Promise<object>} Verified policy, vehicle, and customer data
 */
const verifyPolicy = async (body, authUser) => {
  const { policyNumber, plateNumber, incidentDate, incidentType } = body;
  const { organizationId } = authUser;

  let policy = null;
  let vehicle = null;

  // 1. Resolve Policy and Vehicle
  if (policyNumber) {
    policy = await policyRepository.findByPolicyNumberAndOrganization(policyNumber, organizationId);

    if (!policy) {
      throw new AppError('Policy not found in your insurance company', 404, 'POLICY_NOT_FOUND');
    }

    const vehicles = await vehicleRepository.findAllByPolicyAndOrganization(policy._id, organizationId, policy.policyKind);

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
      if (vehicles && vehicles.length > 1) {
        throw new AppError(
          'Policy has multiple vehicles. Please specify plateNumber.',
          422,
          'AMBIGUOUS_VEHICLE_SELECTION'
        );
      }
      // No plate provided — use single vehicle if exists
      vehicle = vehicles.length > 0 ? vehicles[0] : null;
    }
  } else if (plateNumber) {
    // Lookup primarily by plate number
    const normalizedPlate = plateNumber.trim().toUpperCase();
    vehicle = await vehicleRepository.findByPlateAndOrganization(normalizedPlate, organizationId);

    if (!vehicle) {
      throw new AppError('Vehicle not found with the provided plate number', 404, 'VEHICLE_NOT_FOUND');
    }

    if (body.policyKind) {
      policy =
        body.policyKind === 'UNIFIED_COMPULSORY'
          ? vehicle.compulsoryPolicyId
          : vehicle.complementaryPolicyId;

      if (!policy) {
        throw new AppError('No insurance policy is linked to this vehicle', 404, 'POLICY_NOT_FOUND');
      }
    } else {
      if (vehicle.compulsoryPolicyId && vehicle.complementaryPolicyId) {
        throw new AppError(
          'Vehicle has multiple policies. Please specify policyKind.',
          422,
          'AMBIGUOUS_POLICY_SELECTION'
        );
      }
      policy = vehicle.compulsoryPolicyId || vehicle.complementaryPolicyId;
      if (!policy) {
        throw new AppError('No insurance policy is linked to this vehicle', 404, 'POLICY_NOT_FOUND');
      }
    }
  }

  // 2. Check policy status - cancelled policies trigger a hard block
  if (policy.status === 'CANCELLED') {
    throw new AppError('Policy has been cancelled', 422, 'POLICY_CANCELLED');
  }

  // 3. Date validity checks - future incident dates are invalid
  const now = new Date();

  if (incidentDate) {
    const incident = new Date(incidentDate + 'T00:00:00.000Z');

    // Invariant: incident cannot be in the future
    if (incident > now) {
      throw new AppError('Incident date cannot be in the future', 400, 'INVALID_INCIDENT_DATE');
    }
  }

  // 4. Compute eligibility hint using the centralized utility
  const eligibilityHint = computeEligibilityHint({
    policy,
    incidentType,
    incidentDate,
    now,
  });

  // 5. Build coverage object (null for legacy policies without policyKind)
  let coverage = null;

  if (policy.policyKind) {
    const policyPerils = Array.isArray(policy.coveredPerils) ? policy.coveredPerils : [];
    const incidents =
      policy.policyKind === 'COMPLEMENTARY' && policy.policyType
        ? Policy.COVERED_PERILS.map((peril) => ({
            code: peril,
            covered: policyPerils.includes(peril),
          }))
        : [];

    coverage = {
      policyKind: policy.policyKind,
      policyType: policy.policyType ?? null,
      effectiveFrom: policy.startDate ? new Date(policy.startDate).toISOString().split('T')[0] : null,
      effectiveTo: policy.expiryDate ? new Date(policy.expiryDate).toISOString().split('T')[0] : null,
      deductible:
        policy.deductibleAmount !== undefined && policy.deductibleAmount !== null
          ? policy.deductibleAmount
          : null,
      incidents,
    };

    if (policy.currency) {
      coverage.currency = policy.currency;
    }
  }

  // 6. Build standardized response
  const result = {
    isEligible: true,
    eligibilityHint,
    policy: {
      id: policy._id,
      policyNumber: policy.policyNumber,
      policyKind: policy.policyKind ?? null,
      status: policy.status,
      startDate: policy.startDate ? new Date(policy.startDate).toISOString().split('T')[0] : null,
      expiryDate: policy.expiryDate ? new Date(policy.expiryDate).toISOString().split('T')[0] : null,
      policyType: policy.policyType ?? null,
      coveredPerils: policy.coveredPerils ?? [],
      deductibleAmount:
        policy.deductibleAmount !== undefined && policy.deductibleAmount !== null
          ? policy.deductibleAmount
          : null,
      sumInsured: policy.sumInsured ?? null,
      propertyDamageLimit: policy.propertyDamageLimit ?? null,
      vehicleUse: policy.vehicleUse ?? null,
    },
    coverage,
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

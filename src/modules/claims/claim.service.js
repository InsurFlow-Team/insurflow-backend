const claimRepository = require('./claim.repository');
const userRepository = require('../users/user.repository');
const vehicleRepository = require('../vehicles/vehicle.repository');
const policyRepository = require('../policies/policy.repository');
const customerRepository = require('../customers/customer.repository');
const AppError = require('../../utils/appError');


const createClaim = async (body, authUser) => {
  const { customerName, customerPhone, initialPlateNumber, incidentType, incidentLocation } = body;

  const claimData = {
    // ── Multi-tenancy & Ownership (from JWT — never from client) ──
    organizationId: authUser.organizationId,
    createdBy: authUser.userId,

    // ── Status is always NEW on creation ──
    status: 'NEW',

    // ── Client-provided fields ──
    customer: {
      name: customerName,
      phone: customerPhone,
    },
    vehicle: {
      plateNumber: initialPlateNumber,
    },
    incidentType,
    incidentLocation,

    // ── Seed the timeline with the creation event ──
    timeline: [
      {
        action: 'Claim Created',
        performedBy: authUser.userId,
        role: authUser.role,
        timestamp: new Date(),
      },
    ],
  };

  const claim = await claimRepository.create(claimData);

  // Return minimal response as per API contract Section 8
  return {
    id: claim._id,
    claimNumber: claim.claimNumber,
    status: claim.status,
    createdAt: claim.createdAt,
  };
};

/**
 * Retrieve claims visible to the authenticated user.
 * Applies role-based filtering — same endpoint, different query per role.
 *
 * @param {object} authUser - The authenticated user context from req.user.
 * @returns {Promise<object[]>}
 */
const getClaims = async (authUser, status) => {
  const { userId, role, organizationId } = authUser;
  let claims;

  // FIELD_ADJUSTER: sees only claims assigned to them
  if (role === 'FIELD_ADJUSTER') {
    claims = await claimRepository.findByAssignee(organizationId, userId, status);
  } else {
    // CLAIMS_OFFICER & ADMIN: see all claims in their organization
    claims = await claimRepository.findByOrganization(organizationId, status);
  }

  return claims.map((claim) => ({
    id: claim._id,
    claimNumber: claim.claimNumber,
    status: claim.status,
    customerName: claim.customer.name,
    initialPlateNumber: claim.vehicle.plateNumber,
    createdAt: claim.createdAt,
  }));
};

/**
 * Retrieve a single claim's full details.
 * Enforces: organization isolation + assignment ownership for FIELD_ADJUSTER.
 *
 * @param {string} claimId
 * @param {object} authUser - The authenticated user context from req.user.
 * @returns {Promise<object>}
 */
const getClaimById = async (claimId, authUser) => {
  const { userId, role, organizationId } = authUser;

  const claim = await claimRepository.findByIdAndOrganization(claimId, organizationId);

  if (!claim) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  // FIELD_ADJUSTER: can only see claims assigned to them
  if (role === 'FIELD_ADJUSTER') {
    const assignedToId = claim.assignedTo?._id?.toString() ?? claim.assignedTo?.toString();
    if (assignedToId !== userId.toString()) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }
  }

  return {
    id: claim._id,
    claimNumber: claim.claimNumber,
    status: claim.status,
    customer: claim.customer,
    vehicle: claim.vehicle,
    incidentType: claim.incidentType,
    incidentLocation: claim.incidentLocation,
    assignment: {
      assignedTo: claim.assignedTo,
      assignedBy: claim.assignedBy,
      assignedAt: claim.assignedAt,
      priority: claim.priority,
      assignmentNotes: claim.assignmentNotes,
    },
    accident: claim.accident,
    location: claim.location,
    timeline: claim.timeline,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
  };
};

/**
 * Assign a claim to a Field Adjuster.
 *
 * @param {string} claimId
 * @param {object} body - Validated request body (requires adjusterId).
 * @param {object} authUser - The authenticated user context.
 * @returns {Promise<object>}
 */
const assignClaim = async (claimId, body, authUser) => {
  const { adjusterId, priority, notes } = body;
  const { userId, role, organizationId } = authUser;

  // 1. Find claim and verify it exists within this org
  const claim = await claimRepository.findByIdAndOrganization(claimId, organizationId);
  if (!claim) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  // 2. Verify claim is in NEW state
  if (claim.status !== 'NEW') {
    throw new AppError('Claim is not in NEW state', 409, 'INVALID_STATUS_TRANSITION');
  }

  // 3. Find the adjuster and verify existence, role, and status
  const adjuster = await userRepository.findByIdAndOrganization(adjusterId, organizationId);
  if (!adjuster || adjuster.role !== 'FIELD_ADJUSTER' || adjuster.status !== 'ACTIVE') {
    throw new AppError('Adjuster not found', 404, 'ADJUSTER_NOT_FOUND');
  }

  // 4. Verify adjuster availability (no active claims)
  const activeTasksCount = await claimRepository.countActiveClaimsByAssignee(adjusterId);
  if (activeTasksCount > 0) {
    throw new AppError('Adjuster is currently unavailable', 409, 'ADJUSTER_UNAVAILABLE');
  }

  // 6. Assign the claim
  const timelineEvent = {
    action: 'Claim Assigned',
    performedBy: userId,
    role,
    timestamp: new Date(),
  };

  const updateData = {
    assignedTo: adjusterId,
    assignedBy: userId,
    assignedAt: new Date(),
    status: 'ASSIGNED',
    priority,
    assignmentNotes: notes,
    timelineEvent,
  };

  const updatedClaim = await claimRepository.assignClaim(claimId, updateData);

  return {
    id: updatedClaim._id,
    claimNumber: updatedClaim.claimNumber,
    status: updatedClaim.status,
    priority: updatedClaim.priority,
    assignedTo: updatedClaim.assignedTo,
    assignedBy: updatedClaim.assignedBy,
    assignedAt: updatedClaim.assignedAt,
  };
};

const getOwnedAssignedClaim = async (claimId, authUser) => {
  const claim = await claimRepository.findByIdAndOrganization(claimId, authUser.organizationId);

  if (!claim) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  const assignedToId = claim.assignedTo?._id?.toString() ?? claim.assignedTo?.toString();
  if (assignedToId !== authUser.userId.toString()) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  if (claim.status !== 'ASSIGNED') {
    throw new AppError('Claim is not in ASSIGNED status', 409, 'INVALID_STATUS_TRANSITION');
  }

  return claim;
};

const updateVehicle = async (claimId, body, authUser) => {
  await getOwnedAssignedClaim(claimId, authUser);

  const vehicle = await vehicleRepository.findByIdAndOrganization(body.vehicleId, authUser.organizationId);
  if (!vehicle) throw new AppError('Vehicle not found', 404, 'VEHICLE_NOT_FOUND');

  const policy = await policyRepository.findByIdAndOrganization(body.policyId, authUser.organizationId);
  if (!policy) throw new AppError('Policy not found', 404, 'POLICY_NOT_FOUND');

  const customer = await customerRepository.findByIdAndOrganization(body.customerId, authUser.organizationId);
  if (!customer) throw new AppError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');

  const vehicleData = {
    plateNumber: vehicle.plateNumber,
    vehicleId: vehicle._id,
    policyId: policy._id,
    customerId: customer._id,
  };

  const updatedClaim = await claimRepository.updateVehicle(claimId, vehicleData, {
    action: 'Vehicle Confirmed',
    performedBy: authUser.userId,
    role: authUser.role,
    timestamp: new Date(),
  });

  return { status: updatedClaim.status, vehicle: updatedClaim.vehicle };
};

const updateAccident = async (claimId, body, authUser) => {
  await getOwnedAssignedClaim(claimId, authUser);

  const updatedClaim = await claimRepository.updateAccident(claimId, body, {
    action: 'Accident Details Recorded',
    performedBy: authUser.userId,
    role: authUser.role,
    timestamp: new Date(),
  });

  return { status: updatedClaim.status, accident: updatedClaim.accident };
};

const updateLocation = async (claimId, body, authUser) => {
  await getOwnedAssignedClaim(claimId, authUser);

  const updatedClaim = await claimRepository.updateLocation(claimId, body, {
    action: 'Location Captured',
    performedBy: authUser.userId,
    role: authUser.role,
    timestamp: new Date(),
  });

  return { status: updatedClaim.status, location: updatedClaim.location };
};

const submitInspection = async (claimId, authUser) => {
  const claim = await getOwnedAssignedClaim(claimId, authUser);

  const missing = [];
  if (claim.vehicle?.vehicleId == null) missing.push('vehicle');
  if (claim.accident?.accidentType == null) missing.push('accident');
  if (claim.location?.latitude == null || claim.location?.longitude == null) missing.push('location');

  if (missing.length > 0) {
    throw new AppError(
      `Inspection incomplete. Missing: ${missing.join(', ')}`,
      422,
      'INSPECTION_INCOMPLETE'
    );
  }

  const updatedClaim = await claimRepository.submitInspection(claimId, {
    action: 'Inspection Submitted',
    performedBy: authUser.userId,
    role: authUser.role,
    timestamp: new Date(),
  });

  return { status: updatedClaim.status };
};

const startReview = async (claimId, authUser) => {
  const claim = await claimRepository.findByIdAndOrganization(claimId, authUser.organizationId);

  if (!claim) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  if (claim.status !== 'SUBMITTED') {
    throw new AppError('Claim is not in SUBMITTED status', 409, 'INVALID_STATUS_TRANSITION');
  }

  const updatedClaim = await claimRepository.startReview(claimId, {
    action: 'Review Started',
    performedBy: authUser.userId,
    role: authUser.role,
    timestamp: new Date(),
  });

  return { status: updatedClaim.status };
};

module.exports = {
  createClaim,
  getClaims,
  getClaimById,
  assignClaim,
  updateVehicle,
  updateAccident,
  updateLocation,
  submitInspection,
  startReview,
};

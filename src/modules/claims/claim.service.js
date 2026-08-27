const claimRepository = require('./claim.repository');
const userRepository = require('../users/user.repository');
const AppError = require('../../utils/appError');

/**
 * Business Logic Layer — enforces all business rules for the Claims module.
 */

/**
 * Create a new claim.
 * Enforces: organizationId and createdBy come from req.user, never from the client.
 *
 * @param {object} body - Validated request body.
 * @param {object} authUser - The authenticated user context from req.user.
 * @returns {Promise<object>} The newly created claim (minimal response per API contract).
 */
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
const getClaims = async (authUser) => {
  const { userId, role, organizationId } = authUser;

  // FIELD_ADJUSTER: sees only claims assigned to them
  if (role === 'FIELD_ADJUSTER') {
    return await claimRepository.findByAssignee(organizationId, userId);
  }

  // CLAIMS_OFFICER & ADMIN: see all claims in their organization
  return await claimRepository.findByOrganization(organizationId);
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

  return claim;
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

module.exports = {
  createClaim,
  getClaims,
  getClaimById,
  assignClaim,
};

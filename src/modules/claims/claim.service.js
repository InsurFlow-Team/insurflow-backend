const claimRepository = require('./claim.repository');
const userRepository = require('../users/user.repository');
const vehicleRepository = require('../vehicles/vehicle.repository');
const policyRepository = require('../policies/policy.repository');
const customerRepository = require('../customers/customer.repository');
const Claim = require('./claim.model');
const Organization = require('../organizations/organization.model');
const AppError = require('../../utils/appError');
const uploadToCloudinary = require('../../utils/uploadToCloudinary');
const { generateClaimReportPdf } = require('./claim.report.builder');


const createClaim = async (body, authUser) => {
  const {
    customerName,
    customerPhone,
    initialPlateNumber,
    incidentType,
    incidentLocation,
    latitude,
    longitude,
  } = body;

  let incidentCoordinatesObj = null;
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    incidentCoordinatesObj = {
      latitude,
      longitude,
      capturedAt: new Date(),
    };
  }

  const claimData = {
    organizationId: authUser.organizationId,
    createdBy: authUser.userId,
    status: 'NEW',

    customer: {
      name: customerName,
      phone: customerPhone,
    },
    vehicle: {
      plateNumber: initialPlateNumber,
    },
    incidentType,
    incidentLocation,
    incidentCoordinates: incidentCoordinatesObj,

    timeline: [
      {
        action: 'Claim Created',
        previousStatus: null,
        newStatus: null,
        notes: null,
        performedBy: authUser.userId,
        role: authUser.role,
        timestamp: new Date(),
      },
    ],
  };

  const claim = await claimRepository.create(claimData);

  return {
    id: claim._id,
    claimNumber: claim.claimNumber,
    status: claim.status,
    createdAt: claim.createdAt,
  };
};


const getClaims = async (authUser, filter = {}, pagination = {}) => {
  const { userId, role, organizationId } = authUser;
  const { page = 1, limit = 50 } = pagination;

  // Support both legacy string status and filter object: { status, adjusterId }
  const status = typeof filter === 'string' ? filter : filter?.status;
  const adjusterId = typeof filter === 'object' ? (filter?.adjusterId || filter?.assignedTo) : undefined;

  let result;

  // FIELD_ADJUSTER: sees only claims assigned to them
  if (role === 'FIELD_ADJUSTER') {
    result = await claimRepository.findByAssignee(organizationId, userId, status, { page, limit });
  } else {
    // CLAIMS_OFFICER & ADMIN: see claims in their organization (optionally filtered by status and/or adjuster)
    result = await claimRepository.findByOrganization(organizationId, { status, adjusterId }, { page, limit });
  }

  const { totalCount, claims } = result;
  const totalPages = Math.ceil(totalCount / limit);

  const formattedClaims = claims.map((claim) => {
    let assignedAdjuster = null;
    if (claim.assignedTo) {
      const id = claim.assignedTo._id ? claim.assignedTo._id.toString() : claim.assignedTo.toString();
      assignedAdjuster = {
        id,
        name: claim.assignedTo.name || null,
      };
    }

    return {
      id: claim._id,
      claimNumber: claim.claimNumber,
      status: claim.status,
      customerName: claim.customer.name,
      initialPlateNumber: claim.vehicle.plateNumber,
      createdAt: claim.createdAt,
      assignedTo: assignedAdjuster,
      fieldAdjuster: assignedAdjuster,
    };
  });

  return {
    claims: formattedClaims,
    pagination: {
      totalCount,
      page,
      limit,
      totalPages,
    },
  };
};



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
    incidentCoordinates: claim.incidentCoordinates ?? null,
    assignment: {
      assignedTo: claim.assignedTo,
      assignedBy: claim.assignedBy,
      assignedAt: claim.assignedAt,
      priority: claim.priority,
      assignmentNotes: claim.assignmentNotes,
    },
    accident: claim.accident,
    location: claim.location,
    evidence: claim.evidence,
    signature: claim.signature,
    timeline: claim.timeline,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
  };
};


const assignClaim = async (claimId, body, authUser) => {
  const { adjusterId, priority, notes, overrideCapacity } = body;
  const { userId, role, organizationId } = authUser;

  // 1. Find the adjuster and verify existence, role, and status
  const adjuster = await userRepository.findByIdAndOrganization(adjusterId, organizationId);
  if (!adjuster || adjuster.role !== 'FIELD_ADJUSTER' || adjuster.status !== 'ACTIVE') {
    throw new AppError('Adjuster not found', 404, 'ADJUSTER_NOT_FOUND');
  }

  // 2. Verify adjuster availability (active claims <= 3 is AVAILABLE, > 3 is UNAVAILABLE unless overrideCapacity is true)
  const activeTasksCount = await claimRepository.countActiveClaimsByAssignee(adjusterId);
  const maxActiveClaims = Claim.MAX_ACTIVE_CLAIMS_PER_ADJUSTER ?? 3;
  if (activeTasksCount > maxActiveClaims && !overrideCapacity) {
    throw new AppError('Adjuster is currently unavailable', 409, 'ADJUSTER_UNAVAILABLE');
  }

  let assignmentNotes = notes || null;
  if (activeTasksCount > maxActiveClaims && overrideCapacity) {
    const overridePrefix = `[CAPACITY OVERRIDE] Assigned while adjuster had ${activeTasksCount} active tasks (max: ${maxActiveClaims})`;
    assignmentNotes = notes ? `${overridePrefix} | ${notes}` : overridePrefix;
  }

  // 3. Atomically assign the claim (query checks org + status:'NEW')
  const timelineEvent = {
    action: 'Claim Assigned',
    previousStatus: 'NEW',
    newStatus: 'ASSIGNED',
    notes: assignmentNotes,
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
    assignmentNotes,
    timelineEvent,
  };

  const updatedClaim = await claimRepository.assignClaim(claimId, organizationId, updateData);

  if (!updatedClaim) {
    // Atomic query failed: claim not found, wrong org, or status was not 'NEW' (race lost)
    // Check if claim exists to give a more specific error
    const existing = await claimRepository.findByIdAndOrganization(claimId, organizationId);
    if (!existing) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }
    throw new AppError('Claim is not in NEW state', 409, 'INVALID_STATUS_TRANSITION');
  }

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

const declineAssignment = async (claimId, reason, authUser) => {
  const { userId, role, organizationId } = authUser;

  // Retrieve adjuster's employeeCode for timeline note
  const adjusterUser = await userRepository.findByIdAndOrganization(userId, organizationId);
  const employeeCode = adjusterUser?.employeeCode || 'UNKNOWN';

  const timelineEvent = {
    action: 'Assignment Declined',
    previousStatus: 'ASSIGNED',
    newStatus: 'NEW',
    notes: `[ASSIGNMENT DECLINED] by ${employeeCode} — ${reason}`,
    performedBy: userId,
    role,
    timestamp: new Date(),
  };

  const updatedClaim = await claimRepository.declineAssignment(
    claimId,
    organizationId,
    userId,
    timelineEvent
  );

  if (!updatedClaim) {
    // Atomic update failed: claim doesn't exist, wrong org, not assigned to this adjuster, or not in ASSIGNED status
    const existing = await claimRepository.findByIdAndOrganization(claimId, organizationId);
    if (!existing) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }

    const assignedToId = existing.assignedTo?._id?.toString() ?? existing.assignedTo?.toString();
    if (assignedToId !== userId.toString()) {
      // Stealth tenancy: any other adjuster gets 404 CLAIM_NOT_FOUND (not 403)
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }

    if (existing.status !== 'ASSIGNED') {
      throw new AppError('Claim is not in ASSIGNED status', 409, 'INVALID_STATUS_TRANSITION');
    }

    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  return {
    id: updatedClaim._id,
    claimNumber: updatedClaim.claimNumber,
    status: updatedClaim.status,
    assignedTo: updatedClaim.assignedTo,
    assignedBy: updatedClaim.assignedBy,
    assignedAt: updatedClaim.assignedAt,
  };
};

const startInspection = async (claimId, authUser) => {
  const { userId, role, organizationId } = authUser;

  const claim = await claimRepository.findByIdAndOrganization(claimId, organizationId);
  if (!claim) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  const assignedToId = claim.assignedTo?._id?.toString() ?? claim.assignedTo?.toString();
  if (assignedToId !== userId.toString()) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  if (!['ASSIGNED', 'CORRECTION_REQUIRED'].includes(claim.status)) {
    throw new AppError('Claim is not in ASSIGNED or CORRECTION_REQUIRED status', 409, 'INVALID_STATUS_TRANSITION');
  }

  const isCorrection = claim.status === 'CORRECTION_REQUIRED';
  const action = isCorrection ? 'Inspection Resumed' : 'Inspection Started';
  const previousStatus = claim.status;

  const timelineEvent = {
    action,
    previousStatus,
    newStatus: 'IN_PROGRESS',
    notes: null,
    performedBy: userId,
    role,
    timestamp: new Date(),
  };

  const updatedClaim = await claimRepository.startInspection(claimId, organizationId, userId, timelineEvent);
  if (!updatedClaim) {
    const existing = await claimRepository.findByIdAndOrganization(claimId, organizationId);
    if (!existing) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }
    throw new AppError('Claim is not in ASSIGNED or CORRECTION_REQUIRED status', 409, 'INVALID_STATUS_TRANSITION');
  }

  return { status: updatedClaim.status };
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

  if (claim.status !== 'IN_PROGRESS') {
    throw new AppError('Claim is not in IN_PROGRESS status', 409, 'INVALID_STATUS_TRANSITION');
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

  const updatedClaim = await claimRepository.updateVehicle(claimId, authUser.organizationId, authUser.userId, vehicleData, {
    action: 'Vehicle Confirmed',
    previousStatus: null,
    newStatus: null,
    notes: null,
    performedBy: authUser.userId,
    role: authUser.role,
    timestamp: new Date(),
  });

  if (!updatedClaim) {
    throw new AppError('Claim is not in IN_PROGRESS status or not assigned to you', 409, 'INVALID_STATUS_TRANSITION');
  }

  return { status: updatedClaim.status, vehicle: updatedClaim.vehicle };
};

const updateAccident = async (claimId, body, authUser) => {
  await getOwnedAssignedClaim(claimId, authUser);

  const updatedClaim = await claimRepository.updateAccident(claimId, authUser.organizationId, authUser.userId, body, {
    action: 'Accident Details Recorded',
    previousStatus: null,
    newStatus: null,
    notes: null,
    performedBy: authUser.userId,
    role: authUser.role,
    timestamp: new Date(),
  });

  if (!updatedClaim) {
    throw new AppError('Claim is not in IN_PROGRESS status or not assigned to you', 409, 'INVALID_STATUS_TRANSITION');
  }

  return { status: updatedClaim.status, accident: updatedClaim.accident };
};

const updateLocation = async (claimId, body, authUser) => {
  await getOwnedAssignedClaim(claimId, authUser);

  const updatedClaim = await claimRepository.updateLocation(claimId, authUser.organizationId, authUser.userId, body, {
    action: 'Location Captured',
    previousStatus: null,
    newStatus: null,
    notes: null,
    performedBy: authUser.userId,
    role: authUser.role,
    timestamp: new Date(),
  });

  if (!updatedClaim) {
    throw new AppError('Claim is not in IN_PROGRESS status or not assigned to you', 409, 'INVALID_STATUS_TRANSITION');
  }

  return { status: updatedClaim.status, location: updatedClaim.location };
};

const uploadEvidence = async (claimId, imageType, file, authUser) => {
  await getOwnedAssignedClaim(claimId, authUser);

  if (!file) {
    throw new AppError('An image file is required', 400, 'VALIDATION_ERROR');
  }

  const folder = `insurflow/${authUser.organizationId}/evidence`;
  const uploadResult = await uploadToCloudinary(file.buffer, folder);

  const evidenceItem = {
    imageType,
    url: uploadResult.url,
    publicId: uploadResult.publicId,
    uploadedBy: authUser.userId,
    uploadedAt: new Date(),
  };

  const timelineEvent = {
    action: 'Evidence Uploaded',
    previousStatus: null,
    newStatus: null,
    notes: imageType,
    performedBy: authUser.userId,
    role: authUser.role,
    timestamp: new Date(),
  };

  const updatedClaim = await claimRepository.addEvidence(
    claimId,
    authUser.organizationId,
    authUser.userId,
    evidenceItem,
    timelineEvent
  );

  if (!updatedClaim) {
    throw new AppError('Claim is not in IN_PROGRESS status or not assigned to you', 409, 'INVALID_STATUS_TRANSITION');
  }

  return { status: updatedClaim.status, evidence: updatedClaim.evidence };
};

const uploadSignature = async (claimId, file, authUser) => {
  await getOwnedAssignedClaim(claimId, authUser);

  if (!file) {
    throw new AppError('An image file is required', 400, 'VALIDATION_ERROR');
  }

  const folder = `insurflow/${authUser.organizationId}/signatures`;
  const uploadResult = await uploadToCloudinary(file.buffer, folder);

  const signatureData = {
    url: uploadResult.url,
    publicId: uploadResult.publicId,
    capturedBy: authUser.userId,
    capturedAt: new Date(),
  };

  const timelineEvent = {
    action: 'Signature Captured',
    previousStatus: null,
    newStatus: null,
    notes: null,
    performedBy: authUser.userId,
    role: authUser.role,
    timestamp: new Date(),
  };

  const updatedClaim = await claimRepository.setSignature(
    claimId,
    authUser.organizationId,
    authUser.userId,
    signatureData,
    timelineEvent
  );

  if (!updatedClaim) {
    throw new AppError('Claim is not in IN_PROGRESS status or not assigned to you', 409, 'INVALID_STATUS_TRANSITION');
  }

  return { status: updatedClaim.status, signature: updatedClaim.signature };
};

const submitInspection = async (claimId, authUser) => {
  const claim = await getOwnedAssignedClaim(claimId, authUser);

  const missing = [];
  if (claim.vehicle?.vehicleId == null) missing.push('vehicle');
  if (claim.accident?.accidentType == null) missing.push('accident');
  if (claim.location?.latitude == null || claim.location?.longitude == null) missing.push('location');
  if (!claim.evidence || claim.evidence.length === 0) missing.push('evidence');
  if (!claim.signature || claim.signature.url == null) missing.push('signature');

  if (missing.length > 0) {
    throw new AppError(
      `Inspection incomplete. Missing: ${missing.join(', ')}`,
      422,
      'INSPECTION_INCOMPLETE'
    );
  }

  const updatedClaim = await claimRepository.submitInspection(claimId, authUser.organizationId, authUser.userId, {
    action: 'Inspection Submitted',
    previousStatus: 'IN_PROGRESS',
    newStatus: 'SUBMITTED',
    notes: null,
    performedBy: authUser.userId,
    role: authUser.role,
    timestamp: new Date(),
  });

  if (!updatedClaim) {
    throw new AppError('Claim is not in IN_PROGRESS status or not assigned to you', 409, 'INVALID_STATUS_TRANSITION');
  }

  return { status: updatedClaim.status };
};

const startReview = async (claimId, authUser) => {
  const updatedClaim = await claimRepository.startReview(claimId, authUser.organizationId, {
    action: 'Review Started',
    previousStatus: 'SUBMITTED',
    newStatus: 'UNDER_REVIEW',
    notes: null,
    performedBy: authUser.userId,
    role: authUser.role,
    timestamp: new Date(),
  });

  if (!updatedClaim) {
    // Atomic query failed: check if claim exists to give specific error
    const existing = await claimRepository.findByIdAndOrganization(claimId, authUser.organizationId);
    if (!existing) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }
    throw new AppError('Claim is not in SUBMITTED status', 409, 'INVALID_STATUS_TRANSITION');
  }

  return { status: updatedClaim.status };
};

const requestCorrection = async (claimId, body, authUser) => {
  const { notes } = body;
  const { userId, role, organizationId } = authUser;

  const timelineEvent = {
    action: 'Correction Requested',
    previousStatus: 'UNDER_REVIEW',
    newStatus: 'CORRECTION_REQUIRED',
    notes,
    performedBy: userId,
    role,
    timestamp: new Date(),
  };

  const updatedClaim = await claimRepository.requestCorrection(claimId, organizationId, timelineEvent);

  if (!updatedClaim) {
    // Atomic query failed: check if claim exists to give specific error
    const existing = await claimRepository.findByIdAndOrganization(claimId, organizationId);
    if (!existing) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }
    throw new AppError('Claim is not in UNDER_REVIEW status', 409, 'INVALID_STATUS_TRANSITION');
  }

  return { status: updatedClaim.status };
};

const decideClaim = async (claimId, body, authUser) => {
  const { decision, notes } = body;
  const { userId, role, organizationId } = authUser;

  const timelineEvent = {
    action: decision === 'APPROVED' ? 'Claim Approved' : 'Claim Rejected',
    previousStatus: 'UNDER_REVIEW',
    newStatus: decision,
    notes: notes || null,
    performedBy: userId,
    role,
    timestamp: new Date(),
  };

  const updatedClaim = await claimRepository.makeDecision(
    claimId,
    organizationId,
    decision,
    notes || null,
    timelineEvent
  );

  if (!updatedClaim) {
    // Atomic query failed: check if claim exists to give specific error
    const existing = await claimRepository.findByIdAndOrganization(claimId, organizationId);
    if (!existing) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }
    throw new AppError('Claim is not in UNDER_REVIEW status', 409, 'INVALID_STATUS_TRANSITION');
  }

  return {
    id: updatedClaim._id,
    claimNumber: updatedClaim.claimNumber,
    status: updatedClaim.status,
    decisionNotes: updatedClaim.decisionNotes,
  };
};

const closeClaim = async (claimId, body, authUser) => {
  const { closingNotes } = body || {};
  const { userId, role, organizationId } = authUser;

  const timelineEvent = {
    action: 'Claim Closed',
    previousStatus: 'APPROVED',
    newStatus: 'CLOSED',
    notes: closingNotes || null,
    performedBy: userId,
    role,
    timestamp: new Date(),
  };

  const updatedClaim = await claimRepository.closeClaim(
    claimId,
    organizationId,
    userId,
    closingNotes || null,
    timelineEvent
  );

  if (!updatedClaim) {
    // Atomic query failed: check if claim exists to give specific error
    const existing = await claimRepository.findByIdAndOrganization(claimId, organizationId);
    if (!existing) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }
    throw new AppError('Claim is not in APPROVED status', 409, 'INVALID_STATUS_TRANSITION');
  }

  return {
    id: updatedClaim._id,
    claimNumber: updatedClaim.claimNumber,
    status: updatedClaim.status,
    closedBy: updatedClaim.closedBy,
    closedAt: updatedClaim.closedAt,
    closingNotes: updatedClaim.closingNotes,
  };
};

/**
 * GET /api/v1/claims/stats
 * Aggregates KPI statistics for the dashboard.
 * Scoped strictly by tenant (organizationId) and role.
 * - ADMIN / CLAIMS_OFFICER: Organization-wide stats + adjustersWorkload
 * - FIELD_ADJUSTER: Self-assigned stats + capacity (no adjustersWorkload)
 */
const getClaimStats = async (authUser, query = {}) => {
  const { organizationId, userId, role } = authUser;
  const { from: fromDate, to: toDate } = query;

  const buildByStatus = (statusCounts) => {
    const byStatus = {
      NEW: 0,
      ASSIGNED: 0,
      IN_PROGRESS: 0,
      SUBMITTED: 0,
      UNDER_REVIEW: 0,
      CORRECTION_REQUIRED: 0,
      APPROVED: 0,
      REJECTED: 0,
      CLOSED: 0,
    };

    let total = 0;
    for (const item of statusCounts) {
      if (byStatus.hasOwnProperty(item._id)) {
        byStatus[item._id] = item.count;
        total += item.count;
      }
    }

    return { byStatus, totalClaims: total };
  };

  if (role === 'FIELD_ADJUSTER') {
    // Field Adjuster: single aggregation query scoped to their own assigned claims
    // adjustersWorkload query is skipped entirely
    const statusCounts = await claimRepository.getClaimStats({
      organizationId,
      assignedTo: userId,
      fromDate,
      toDate,
    });

    const { byStatus, totalClaims } = buildByStatus(statusCounts);
    const pendingActionCount = byStatus.ASSIGNED + byStatus.IN_PROGRESS + byStatus.CORRECTION_REQUIRED;

    return {
      scope: 'ASSIGNED',
      totalClaims,
      byStatus,
      pendingActionCount,
      actionableBreakdown: {
        toStart: byStatus.ASSIGNED,
        inProgress: byStatus.IN_PROGRESS,
        needsCorrection: byStatus.CORRECTION_REQUIRED,
      },
      capacity: {
        active: pendingActionCount,
        max: Claim.MAX_ACTIVE_CLAIMS_PER_ADJUSTER ?? 3,
      },
    };
  }

  // ADMIN / CLAIMS_OFFICER: Organization-wide claims aggregation and adjusters workload query run concurrently
  const [statusCounts, adjusters] = await Promise.all([
    claimRepository.getClaimStats({
      organizationId,
      fromDate,
      toDate,
    }),
    userRepository.findAdjustersWithWorkload(organizationId),
  ]);


  const { byStatus, totalClaims } = buildByStatus(statusCounts);
  const pendingActionCount = byStatus.NEW + byStatus.SUBMITTED + byStatus.UNDER_REVIEW;

  let totalActive = 0;
  let available = 0;
  let nearCapacity = 0;
  let atCapacity = 0;

  const maxWorkload = Claim.MAX_ACTIVE_CLAIMS_PER_ADJUSTER ?? 3;

  for (const adj of adjusters) {
    if (adj.status === 'ACTIVE') {
      totalActive++;
      if (adj.availability === 'AVAILABLE') {
        available++;
      }
      const activeCount = adj.activeTasksCount || 0;
      if (activeCount === maxWorkload - 1) {
        nearCapacity++;
      }
      if (activeCount >= maxWorkload) {
        atCapacity++;
      }
    }
  }

  return {
    scope: 'ORGANIZATION',
    totalClaims,
    byStatus,
    pendingActionCount,
    actionableBreakdown: {
      unassigned: byStatus.NEW,
      readyForReview: byStatus.SUBMITTED + byStatus.UNDER_REVIEW,
    },
    adjustersWorkload: {
      totalActive,
      available,
      nearCapacity,
      atCapacity,
    },
  };
};

/**
 * GET /api/v1/claims/:claimId/report
 * Generates and returns an in-memory PDF buffer of the final claim report.
 * Scoped strictly by tenant (organizationId).
 * Preconditions:
 * - Role must be ADMIN or CLAIMS_OFFICER (FIELD_ADJUSTER is 403)
 * - Claim must exist in caller's organization (404 checked before 409)
 * - Claim status must be in ['APPROVED', 'REJECTED', 'CLOSED'] (otherwise 409 INVALID_STATUS_TRANSITION)
 */
const getClaimReport = async (claimId, authUser) => {
  const { organizationId, role } = authUser;

  // 1. Role verification (defense in depth; route middleware restricts to ADMIN / CLAIMS_OFFICER)
  if (!['ADMIN', 'CLAIMS_OFFICER'].includes(role)) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN_RESOURCE');
  }

  // 2. Tenant-scoped claim lookup (404-before-409 convention)
  const claim = await claimRepository.findForReport(claimId, organizationId);
  if (!claim) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  // 3. Status precondition check
  const TERMINAL_STATUSES = ['APPROVED', 'REJECTED', 'CLOSED'];
  if (!TERMINAL_STATUSES.includes(claim.status)) {
    throw new AppError(
      'Report is only available for claims with a final decision (APPROVED, REJECTED, or CLOSED).',
      409,
      'INVALID_STATUS_TRANSITION'
    );
  }

  // 4. Full domain hydration: Vehicle, Policy, Organization
  let vehicle = null;
  if (claim.vehicle?.vehicleId) {
    vehicle = await vehicleRepository.findByIdAndOrganization(claim.vehicle.vehicleId, organizationId);
  }

  let policy = null;
  if (claim.vehicle?.policyId) {
    policy = await policyRepository.findByIdAndOrganization(claim.vehicle.policyId, organizationId);
  }

  const organization = await Organization.findById(organizationId).lean();

  // 5. Generate PDF in-memory buffer
  const buffer = await generateClaimReportPdf({
    claim,
    organization,
    vehicle,
    policy,
  });

  return {
    buffer,
    claimNumber: claim.claimNumber,
  };
};

module.exports = {
  createClaim,
  getClaims,
  getClaimById,
  assignClaim,
  declineAssignment,
  startInspection,
  updateVehicle,
  updateAccident,
  updateLocation,
  uploadEvidence,
  uploadSignature,
  submitInspection,
  startReview,
  requestCorrection,
  decideClaim,
  closeClaim,
  getClaimStats,
  getClaimReport,
};


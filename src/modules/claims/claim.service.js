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
const { createAndSendNotification } = require('../notifications/notification.service');


const createClaim = async (body, authUser) => {
  const {
    policyId,
    plateNumber: requestedPlate,
    incidentType,
    incidentLocation,
    incidentDate,
    latitude,
    longitude,
  } = body;

  // ── 1. Policy existence & tenant isolation ──────────────────────
  const policy = await policyRepository.findByIdAndOrganization(policyId, authUser.organizationId);
  if (!policy) {
    throw new AppError('Policy not found', 404, 'POLICY_NOT_FOUND');
  }

  // ── 2. Policy status gate ──────────────────────────────────────
  if (policy.status === 'CANCELLED') {
    throw new AppError('Policy has been cancelled', 422, 'POLICY_CANCELLED');
  }
  if (policy.status === 'EXPIRED') {
    throw new AppError('Policy has expired', 422, 'POLICY_EXPIRED');
  }

  // ── 3. Calendar expiry check ───────────────────────────────────
  const now = new Date();

  if (incidentDate) {
    const incident = new Date(incidentDate + 'T00:00:00.000Z');

    // Incident cannot be in the future
    if (incident > now) {
      throw new AppError('Incident date cannot be in the future', 400, 'INVALID_INCIDENT_DATE');
    }

    const start = new Date(policy.startDate);
    const expiry = new Date(policy.expiryDate);
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
    // No incidentDate — check current calendar expiry
    if (policy.expiryDate && new Date(policy.expiryDate) < now) {
      throw new AppError('Policy has expired', 422, 'POLICY_EXPIRED');
    }
  }

  // ── 4. Resolve vehicle & customer from policy ──────────────────
  const vehicles = await vehicleRepository.findAllByPolicyAndOrganization(policy._id, authUser.organizationId);

  if (!vehicles || vehicles.length === 0) {
    throw new AppError('No vehicle is registered under this policy', 422, 'NO_VEHICLE_ON_POLICY');
  }

  let vehicle = null;
  if (requestedPlate) {
    const normalizedInput = requestedPlate.trim().toUpperCase();
    vehicle = vehicles.find((v) => v.plateNumber.trim().toUpperCase() === normalizedInput);
    if (!vehicle) {
      throw new AppError('Vehicle plate number does not match this policy', 422, 'VEHICLE_MISMATCH');
    }
  } else {
    vehicle = vehicles[0];
  }

  const customerName = vehicle?.customerId?.fullName || 'Unknown';
  const customerPhone = vehicle?.customerId?.phone || 'Unknown';
  const plateNumber = vehicle?.plateNumber;

  // ── 5. Build claim data ────────────────────────────────────────
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
    policyId: policy._id,
    status: 'NEW',

    customer: {
      name: customerName,
      phone: customerPhone,
    },
    vehicle: {
      plateNumber,
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
      incidentCoordinates: claim.incidentCoordinates ?? null,
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

  // ── Format populated user ref → { id, name, employeeCode } ──────
  const formatUser = (u) => {
    if (!u || !u._id) return null;
    return { id: u._id, name: u.name ?? null, employeeCode: u.employeeCode ?? null };
  };

  return {
    // ── 1. Claim Information ─────────────────────────────────────
    id: claim._id,
    claimNumber: claim.claimNumber,
    status: claim.status,
    incidentType: claim.incidentType,
    incidentLocation: claim.incidentLocation,
    incidentCoordinates: claim.incidentCoordinates ?? null,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,

    // ── 2. Customer Information ──────────────────────────────────
    customer: {
      name: claim.customer?.name ?? null,
      phone: claim.customer?.phone ?? null,
    },

    // ── 3. Vehicle Information ───────────────────────────────────
    vehicle: {
      plateNumber: claim.vehicle?.plateNumber ?? null,
      make: claim.vehicle?.vehicleId?.make ?? null,
      model: claim.vehicle?.vehicleId?.model ?? null,
      year: claim.vehicle?.vehicleId?.year ?? null,
      color: claim.vehicle?.vehicleId?.color ?? null,
    },

    // ── 4. Policy Information ────────────────────────────────────
    policy: claim.policyId?._id
      ? {
          id: claim.policyId._id,
          policyNumber: claim.policyId.policyNumber ?? null,
          status: claim.policyId.status ?? null,
          startDate: claim.policyId.startDate ?? null,
          expiryDate: claim.policyId.expiryDate ?? null,
        }
      : null,

    // ── 5. Assignment & Field Adjuster ───────────────────────────
    assignment: {
      assignedTo: formatUser(claim.assignedTo),
      assignedBy: formatUser(claim.assignedBy),
      assignedAt: claim.assignedAt ?? null,
      priority: claim.priority ?? null,
      assignmentNotes: claim.assignmentNotes ?? null,
    },

    // ── 6. Accident Details (from mobile inspection) ─────────────
    accident: claim.accident ?? null,

    // ── 7. Location (GPS from mobile inspection) ─────────────────
    location: claim.location ?? null,

    // ── 8. Evidence (from mobile inspection) ─────────────────────
    evidence: (claim.evidence ?? []).map((e) => ({
      imageType: e.imageType,
      url: e.url,
      uploadedBy: formatUser(e.uploadedBy),
      uploadedAt: e.uploadedAt,
    })),

    // ── 9. Signature ─────────────────────────────────────────────
    signature: claim.signature?.url
      ? {
          url: claim.signature.url,
          capturedBy: claim.signature.capturedBy ?? null,
          capturedAt: claim.signature.capturedAt ?? null,
        }
      : null,

    // ── 10. Decision & Closure ───────────────────────────────────
    decisionNotes: claim.decisionNotes ?? null,
    closedBy: claim.closedBy ?? null,
    closedAt: claim.closedAt ?? null,
    closingNotes: claim.closingNotes ?? null,

    // ── 11. Audit Timeline ───────────────────────────────────────
    timeline: (claim.timeline ?? []).map((t) => ({
      action: t.action,
      previousStatus: t.previousStatus,
      newStatus: t.newStatus,
      notes: t.notes,
      performedBy: t.performedBy
        ? { id: t.performedBy._id, name: t.performedBy.name, employeeCode: t.performedBy.employeeCode, role: t.performedBy.role }
        : null,
      role: t.role,
      timestamp: t.timestamp,
    })),

    // ── 12. Created By ───────────────────────────────────────────
    createdBy: formatUser(claim.createdBy),
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
    action: 'Assignment Pending Acceptance',
    previousStatus: 'NEW',
    newStatus: 'PENDING_ACCEPTANCE',
    notes: assignmentNotes,
    performedBy: userId,
    role,
    timestamp: new Date(),
  };

  const updateData = {
    assignedTo: adjusterId,
    assignedBy: userId,
    assignedAt: new Date(),
    status: 'PENDING_ACCEPTANCE',
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

  try {
    await createAndSendNotification({
      recipientId: updatedClaim.assignedTo,
      organizationId: updatedClaim.organizationId,
      type: 'PENDING_ACCEPTANCE',
      relatedClaimId: updatedClaim._id,
      title: 'New Assignment Pending',
      body: `You have a new claim assignment pending your acceptance: ${updatedClaim.claimNumber}.`,
    });
  } catch (err) {
    console.error('Failed to send notification for claim assignment:', err);
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

const acceptAssignment = async (claimId, authUser) => {
  const { userId, role, organizationId } = authUser;

  // Retrieve adjuster's employeeCode for timeline
  const adjusterUser = await userRepository.findByIdAndOrganization(userId, organizationId);
  const employeeCode = adjusterUser?.employeeCode || 'UNKNOWN';

  const timelineEvent = {
    action: 'Assignment Accepted',
    previousStatus: 'PENDING_ACCEPTANCE',
    newStatus: 'ASSIGNED',
    notes: `[ASSIGNMENT ACCEPTED] by ${employeeCode}`,
    performedBy: userId,
    role,
    timestamp: new Date(),
  };

  const updatedClaim = await claimRepository.acceptAssignment(
    claimId,
    organizationId,
    userId,
    timelineEvent
  );

  if (!updatedClaim) {
    const existing = await claimRepository.findByIdAndOrganization(claimId, organizationId);
    if (!existing) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }

    const assignedToId = existing.assignedTo?._id?.toString() ?? existing.assignedTo?.toString();
    if (assignedToId !== userId.toString()) {
      // Stealth tenancy: any other adjuster gets 404 CLAIM_NOT_FOUND (matching declineAssignment)
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }

    if (existing.status !== 'PENDING_ACCEPTANCE') {
      throw new AppError('Claim is not in PENDING_ACCEPTANCE status', 409, 'INVALID_STATUS_TRANSITION');
    }

    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  // Send notification to the officer who assigned it (optional, fire-and-forget)
  try {
    await createAndSendNotification({
      recipientId: updatedClaim.assignedBy,
      organizationId: updatedClaim.organizationId,
      type: 'ASSIGNED',
      relatedClaimId: updatedClaim._id,
      title: 'Assignment Accepted',
      body: `${employeeCode} accepted claim ${updatedClaim.claimNumber}.`,
    });
  } catch (err) {
    console.error('Failed to send notification for assignment acceptance:', err);
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

const declineAssignment = async (claimId, reason, authUser) => {
  const { userId, role, organizationId } = authUser;

  // Retrieve adjuster's employeeCode for timeline note
  const adjusterUser = await userRepository.findByIdAndOrganization(userId, organizationId);
  const employeeCode = adjusterUser?.employeeCode || 'UNKNOWN';

  const timelineEvent = {
    action: 'Assignment Declined',
    previousStatus: 'PENDING_ACCEPTANCE',
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
    // Atomic update failed: claim doesn't exist, wrong org, not assigned to this adjuster, or not in PENDING_ACCEPTANCE status
    const existing = await claimRepository.findByIdAndOrganization(claimId, organizationId);
    if (!existing) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }

    const assignedToId = existing.assignedTo?._id?.toString() ?? existing.assignedTo?.toString();
    if (assignedToId !== userId.toString()) {
      // Stealth tenancy: any other adjuster gets 404 CLAIM_NOT_FOUND (not 403)
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }

    if (existing.status !== 'PENDING_ACCEPTANCE') {
      throw new AppError('Claim is not in PENDING_ACCEPTANCE status', 409, 'INVALID_STATUS_TRANSITION');
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

  try {
    await createAndSendNotification({
      recipientId: updatedClaim.assignedTo,
      organizationId: updatedClaim.organizationId,
      type: 'CORRECTION_REQUIRED',
      relatedClaimId: updatedClaim._id,
      title: 'Correction Requested',
      body: `Claim ${updatedClaim.claimNumber} needs correction. Reason: ${notes}`,
    });
  } catch (err) {
    console.error('Failed to send notification for correction request:', err);
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

  if (decision === 'APPROVED') {
    try {
      await createAndSendNotification({
        recipientId: updatedClaim.assignedTo,
        organizationId: updatedClaim.organizationId,
        type: 'APPROVED',
        relatedClaimId: updatedClaim._id,
        title: 'Claim Approved',
        body: `Claim ${updatedClaim.claimNumber} has been approved.`,
      });
    } catch (err) {
      console.error('Failed to send notification for claim approval:', err);
    }
  } else if (decision === 'REJECTED') {
    try {
      await createAndSendNotification({
        recipientId: updatedClaim.assignedTo,
        organizationId: updatedClaim.organizationId,
        type: 'REJECTED',
        relatedClaimId: updatedClaim._id,
        title: 'Claim Rejected',
        body: `Claim ${updatedClaim.claimNumber} has been rejected.`,
      });
    } catch (err) {
      console.error('Failed to send notification for claim rejection:', err);
    }
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
      PENDING_ACCEPTANCE: 0,
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
  const pendingActionCount = byStatus.NEW + byStatus.PENDING_ACCEPTANCE + byStatus.SUBMITTED + byStatus.UNDER_REVIEW;

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
      pendingAcceptance: byStatus.PENDING_ACCEPTANCE,
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
  acceptAssignment,
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


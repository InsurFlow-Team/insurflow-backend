const claimRepository = require('./claim.repository');
const userRepository = require('../users/user.repository');
const vehicleRepository = require('../vehicles/vehicle.repository');
const policyRepository = require('../policies/policy.repository');
const customerRepository = require('../customers/customer.repository');
const Claim = require('./claim.model');
const AppError = require('../../utils/appError');
const uploadToCloudinary = require('../../utils/uploadToCloudinary');


const createClaim = async (body, authUser) => {
  const { customerName, customerPhone, initialPlateNumber, incidentType, incidentLocation } = body;

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


const getClaims = async (authUser, status, pagination = {}) => {
  const { userId, role, organizationId } = authUser;
  const { page = 1, limit = 50 } = pagination;

  let result;

  // FIELD_ADJUSTER: sees only claims assigned to them
  if (role === 'FIELD_ADJUSTER') {
    result = await claimRepository.findByAssignee(organizationId, userId, status, { page, limit });
  } else {
    // CLAIMS_OFFICER & ADMIN: see all claims in their organization
    result = await claimRepository.findByOrganization(organizationId, status, { page, limit });
  }

  const { totalCount, claims } = result;
  const totalPages = Math.ceil(totalCount / limit);

  const formattedClaims = claims.map((claim) => ({
    id: claim._id,
    claimNumber: claim.claimNumber,
    status: claim.status,
    customerName: claim.customer.name,
    initialPlateNumber: claim.vehicle.plateNumber,
    createdAt: claim.createdAt,
  }));

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
  const { adjusterId, priority, notes } = body;
  const { userId, role, organizationId } = authUser;

  // 1. Find the adjuster and verify existence, role, and status
  const adjuster = await userRepository.findByIdAndOrganization(adjusterId, organizationId);
  if (!adjuster || adjuster.role !== 'FIELD_ADJUSTER' || adjuster.status !== 'ACTIVE') {
    throw new AppError('Adjuster not found', 404, 'ADJUSTER_NOT_FOUND');
  }

  // 2. Verify adjuster availability (active claims <= 3 is AVAILABLE, > 3 is UNAVAILABLE)
  const activeTasksCount = await claimRepository.countActiveClaimsByAssignee(adjusterId);
  const maxActiveClaims = Claim.MAX_ACTIVE_CLAIMS_PER_ADJUSTER ?? 3;
  if (activeTasksCount > maxActiveClaims) {
    throw new AppError('Adjuster is currently unavailable', 409, 'ADJUSTER_UNAVAILABLE');
  }

  // 3. Atomically assign the claim (query checks org + status:'NEW')
  const timelineEvent = {
    action: 'Claim Assigned',
    previousStatus: 'NEW',
    newStatus: 'ASSIGNED',
    notes: notes || null,
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

module.exports = {
  createClaim,
  getClaims,
  getClaimById,
  assignClaim,
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
};

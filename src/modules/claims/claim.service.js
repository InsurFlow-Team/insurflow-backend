const { getLicenseState, LICENSE_STATE } = require('../../utils/surveyorLicense');
const { getPolicyPeriodViolation } = require('../../utils/policyPeriod');
const crypto = require('crypto');
const claimRepository = require('./claim.repository');
const incidentRepository = require('../incidents/incident.repository');
const userRepository = require('../users/user.repository');
const vehicleRepository = require('../vehicles/vehicle.repository');
const policyRepository = require('../policies/policy.repository');
const customerRepository = require('../customers/customer.repository');
const Claim = require('./claim.model');
const Organization = require('../organizations/organization.model');
const AppError = require('../../utils/appError');
const uploadToCloudinary = require('../../utils/uploadToCloudinary');
const maskPlateNumber = require('../../utils/maskPlateNumber');
const { maskIdNumber } = require('../../utils/maskPii');
const { PUBLIC_STATUS_MAP, PUBLIC_STATUS_RANK, PUBLIC_TIMELINE_TEXT } = require('./claim.public.constants');
const { generateClaimReportPdf } = require('./claim.report.builder');
const { createAndSendNotification, sendToOrganization } = require('../notifications/notification.service');
const config = require('../../config/env');
const { toMinor, fromMinor } = require('../../utils/money');
const garageRepository = require('../garages/garage.repository');
const { calculateEstimate, formatEstimate } = require('./estimate.calculator');
const computeEligibilityHint = require('../../utils/computeEligibilityHint');
const { toHebronDate } = require('../../utils/hebronDate');
const Counter = require('../../utils/counter.model');

const buildTrackingUrl = (token) => {
  if (!token || !config.publicFrontendUrl) {
    return null;
  }
  const baseUrl = config.publicFrontendUrl.replace(/\/+$/, '');
  return `${baseUrl}/track/${token}`;
};

const getEligibleClaimantParties = (parties, subjectRef) => {
  if (!Array.isArray(parties) || !subjectRef) return [];
  const targetRef = subjectRef.toString();
  return parties.filter(
    (p) =>
      ['POLICYHOLDER', 'AUTHORIZED_REPRESENTATIVE'].includes(p.role) &&
      p.vehicleRef &&
      p.vehicleRef.toString() === targetRef
  );
};

const assertPolicyCoverage = ({ policy, claimType = 'OWN_DAMAGE', incidentAt, incidentDate }) => {
  if (claimType === 'OWN_DAMAGE') {
    if (!policy.policyKind) {
      throw new AppError('Policy kind is missing', 422, 'COVERAGE_NOT_APPLICABLE', 'POLICY_KIND_MISSING');
    }
    if (policy.policyKind === 'UNIFIED_COMPULSORY') {
      throw new AppError('Own damage claim requires a complementary policy', 422, 'COVERAGE_NOT_APPLICABLE', 'WRONG_POLICY_KIND');
    }
  }

  const violation = getPolicyPeriodViolation({ policy, incidentAt, incidentDate });
  if (violation) {
    const message =
      violation === 'BEFORE_POLICY_START'
        ? 'Incident occurred before policy start date'
        : 'Incident occurred after policy expiry date';
    throw new AppError(message, 422, 'COVERAGE_NOT_APPLICABLE', violation);
  }
};

const resolveClaimData = async (
  { policyId, plateNumber: requestedPlate, incidentType, incidentDate, incidentAt, claimType = 'OWN_DAMAGE' },
  authUser
) => {
  // ── 1. Policy existence & tenant isolation ──────────────────────
  const policy = await policyRepository.findByIdAndOrganization(policyId, authUser.organizationId);
  if (!policy) {
    throw new AppError('Policy not found', 404, 'POLICY_NOT_FOUND');
  }

  // ── 2. Policy status gate ──────────────────────────────────────
  if (policy.status === 'CANCELLED') {
    throw new AppError('Policy has been cancelled', 422, 'POLICY_CANCELLED');
  }

  // ── 3. Coverage & Period gate (A3) ────────────────────────────
  assertPolicyCoverage({ policy, claimType, incidentAt, incidentDate });

  // ── 4. Resolve vehicle & customer from policy ──────────────────
  const vehicles = await vehicleRepository.findAllByPolicyAndOrganization(policy._id, authUser.organizationId, policy.policyKind);

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
    if (vehicles.length > 1) {
      throw new AppError(
        'Policy has multiple vehicles. Please specify plateNumber.',
        422,
        'AMBIGUOUS_VEHICLE_SELECTION'
      );
    }
    vehicle = vehicles[0];
  }

  const now = new Date();
  const eligibilityHint = computeEligibilityHint({
    policy,
    incidentType,
    incidentDate,
    now,
  });

  let coverageSnapshot = null;
  if (
    policy.policyType &&
    policy.deductibleAmount !== undefined &&
    policy.deductibleAmount !== null
  ) {
    // Both policy and coverageSnapshot store monetary amounts in minor units
    coverageSnapshot = {
      policyKind: policy.policyKind ?? null,
      policyType: policy.policyType,
      coveredPerils: Array.isArray(policy.coveredPerils) ? [...policy.coveredPerils] : [],
      deductibleAmount: policy.deductibleAmount,
      sumInsured: policy.sumInsured ?? null,
      capturedAt: new Date(),
    };
  }

  const customerName = vehicle?.customerId?.fullName || 'Unknown';
  const customerPhone = vehicle?.customerId?.phone || 'Unknown';
  const plateNumber = vehicle?.plateNumber;

  const claimFields = {
    policy,
    vehicle,
    customerName,
    customerPhone,
    plateNumber,
    eligibilityHint,
    coverageSnapshot,
  };

  return { policy, vehicle, claimFields };
};

const insertClaim = async (claimFields, incident, claimType = 'OWN_DAMAGE', authUser, subClaimRefs = {}) => {
  const claimData = {
    incidentId: incident._id,
    incidentNumber: incident.incidentNumber,
    claimantPartyId: subClaimRefs.claimantPartyId || null,
    subjectRef: subClaimRefs.subjectRef || null,
    claimType,
    organizationId: authUser.organizationId,
    createdBy: authUser.userId,
    policyId: claimFields.policy._id,
    coverageSnapshot: claimFields.coverageSnapshot,
    status: 'NEW',
    trackingToken: crypto.randomBytes(32).toString('hex'),

    customer: {
      name: claimFields.customerName,
      phone: claimFields.customerPhone,
    },
    vehicle: {
      plateNumber: claimFields.plateNumber,
      vehicleId: claimFields.vehicle?._id || null,
      policyId: claimFields.policy._id,
      customerId: claimFields.vehicle?.customerId?._id || claimFields.vehicle?.customerId || null,
    },
    incidentDate: incident.incidentDate || null,
    incidentDescription: incident.incidentDescription || null,
    incidentType: incident.incidentType,
    eligibilityHint: claimFields.eligibilityHint,
    incidentLocation: incident.incidentLocation,
    incidentCoordinates: incident.incidentCoordinates || null,

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

  let claim;
  try {
    claim = await claimRepository.create(claimData);
  } catch (claimErr) {
    if (
      claimErr.code === 11000 &&
      claimErr.keyPattern &&
      claimErr.keyPattern['vehicle.vehicleId']
    ) {
      throw new AppError(
        'A claim for this vehicle already exists in this incident',
        409,
        'DUPLICATE_SUB_CLAIM'
      );
    }
    throw claimErr;
  }

  try {
    if (typeof sendToOrganization === 'function') {
      await sendToOrganization({
        organizationId: authUser.organizationId,
        type: 'NEW_CLAIM',
        relatedClaimId: claim._id,
        title: 'New Claim Created',
        body: `New claim ${claim.claimNumber} has been created.`,
        excludeUserId: authUser.userId,
      });
    }
  } catch (err) {
    console.error('Failed to send notification for claim creation:', err);
  }

  return {
    id: claim._id,
    claimNumber: claim.claimNumber,
    incidentId: claim.incidentId ?? null,
    incidentNumber: claim.incidentNumber ?? null,
    claimType: claim.claimType ?? 'OWN_DAMAGE',
    status: claim.status,
    trackingToken: claim.trackingToken,
    trackingUrl: buildTrackingUrl(claim.trackingToken),
    eligibilityHint: claim.eligibilityHint ?? null,
    coverageSnapshot: claim.coverageSnapshot
      ? {
          policyKind: claim.coverageSnapshot.policyKind ?? null,
          policyType: claim.coverageSnapshot.policyType,
          coveredPerils: claim.coverageSnapshot.coveredPerils,
          deductibleAmount: claim.coverageSnapshot.deductibleAmount != null ? fromMinor(claim.coverageSnapshot.deductibleAmount, config.currency) : null,
          sumInsured: claim.coverageSnapshot.sumInsured != null ? fromMinor(claim.coverageSnapshot.sumInsured, config.currency) : null,
          capturedAt: claim.coverageSnapshot.capturedAt,
        }
      : null,
    createdAt: claim.createdAt,
    ...(subClaimRefs.claimantPartyId && subClaimRefs.subjectRef && {
      claimantPartyId: claim.claimantPartyId,
      subjectRef: claim.subjectRef,
    }),
  };
};

const createClaim = async (body, authUser) => {
  const {
    policyId,
    plateNumber: requestedPlate,
    incidentType,
    incidentLocation,
    incidentDate,
    description,
    latitude,
    longitude,
  } = body;

  const now = new Date();
  if (incidentDate) {
    const incident = new Date(incidentDate + 'T00:00:00.000Z');
    if (incident > now) {
      throw new AppError('Incident date cannot be in the future', 400, 'INVALID_INCIDENT_DATE');
    }
  }

  const { claimFields } = await resolveClaimData(
    { policyId, plateNumber: requestedPlate, incidentType, incidentDate, incidentAt: null, claimType: 'OWN_DAMAGE' },
    authUser
  );

  let incidentCoordinatesObj = null;
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    incidentCoordinatesObj = {
      latitude,
      longitude,
      capturedAt: new Date(),
    };
  }

  const incident = await incidentRepository.create({
    organizationId: authUser.organizationId,
    incidentDate,
    incidentType,
    incidentLocation,
    incidentDescription: description || null,
    incidentCoordinates: incidentCoordinatesObj,
    createdBy: authUser.userId,
  });

  try {
    return await insertClaim(claimFields, incident, 'OWN_DAMAGE', authUser);
  } catch (claimErr) {
    try {
      await incidentRepository.deleteByIdAndOrganization(incident._id, authUser.organizationId);
    } catch (deleteErr) {
      console.error('Failed to rollback incident after claim creation failure:', deleteErr);
    }
    throw claimErr;
  }
};

const createSubClaim = async (incidentId, body, authUser) => {
  const { claimType, policyId, plateNumber, claimantPartyId, subjectRef } = body;

  const incident = await incidentRepository.findByIdAndOrganization(incidentId, authUser.organizationId);
  if (!incident) {
    throw new AppError('Incident not found', 404, 'INCIDENT_NOT_FOUND');
  }

  if (claimType === 'THIRD_PARTY_PD') {
    throw new AppError('Claim type THIRD_PARTY_PD is not supported yet', 422, 'CLAIM_TYPE_NOT_SUPPORTED');
  }

  // 1. subjectRef is an incident vehicle with vehicleRole INSURED, else 422 INVALID_SUBJECT_VEHICLE
  const subjectVehicle = (incident.vehicles || []).find(
    (v) => v._id.toString() === subjectRef.toString()
  );
  if (!subjectVehicle || subjectVehicle.vehicleRole !== 'INSURED') {
    throw new AppError('Invalid subject vehicle', 422, 'INVALID_SUBJECT_VEHICLE');
  }

  // 2. claimantPartyId is an incident party with role POLICYHOLDER or AUTHORIZED_REPRESENTATIVE and vehicleRef equal to subjectRef, else 422 INVALID_CLAIMANT
  const eligibleClaimants = getEligibleClaimantParties(incident.parties, subjectRef);
  const claimantParty = eligibleClaimants.find(
    (p) => p._id.toString() === claimantPartyId.toString()
  );
  if (!claimantParty) {
    throw new AppError('Invalid claimant', 422, 'INVALID_CLAIMANT');
  }

  // 3. resolveClaimData as today
  const { claimFields, vehicle: resolvedVehicle } = await resolveClaimData(
    {
      policyId,
      plateNumber,
      incidentType: incident.incidentType,
      incidentDate: incident.incidentDate,
      incidentAt: incident.incidentAt,
      claimType: claimType || 'OWN_DAMAGE',
    },
    authUser
  );

  // 4. subject vehicle vehicleId is non-null and equals the resolved vehicle _id, else 422 SUBJECT_VEHICLE_MISMATCH
  if (
    !subjectVehicle.vehicleId ||
    !resolvedVehicle?._id ||
    subjectVehicle.vehicleId.toString() !== resolvedVehicle._id.toString()
  ) {
    throw new AppError(
      'Subject vehicle does not match the policy vehicle',
      422,
      'SUBJECT_VEHICLE_MISMATCH'
    );
  }

  // 5. insertClaim stores claimantPartyId and subjectRef
  return await insertClaim(claimFields, incident, claimType, authUser, {
    claimantPartyId,
    subjectRef,
  });
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

  let claimant = null;
  if (claim.claimantPartyId && claim.incidentId) {
    const incident = await incidentRepository.findByIdAndOrganization(
      claim.incidentId,
      organizationId
    );
    const party = (incident?.parties || []).find(
      (p) => p._id.toString() === claim.claimantPartyId.toString()
    );
    if (party) {
      const isAdjuster = role === 'FIELD_ADJUSTER';
      claimant = {
        id: party._id,
        role: party.role,
        partyType: party.partyType,
        fullName: party.fullName,
        idType: party.idType ?? null,
        idNumber:
          isAdjuster && party.partyType === 'PERSON'
            ? maskIdNumber(party.idNumber)
            : (party.idNumber ?? null),
        phone: party.phone ?? null,
      };
    }
  }

  return {
    // ── 1. Claim Information ─────────────────────────────────────
    id: claim._id,
    claimNumber: claim.claimNumber,
    incidentId: claim.incidentId ?? null,
    incidentNumber: claim.incidentNumber ?? null,
    claimantPartyId: claim.claimantPartyId ?? null,
    subjectRef: claim.subjectRef ?? null,
    claimant,
    claimType: claim.claimType ?? 'OWN_DAMAGE',
    status: claim.status,
    // Expose tracking tokens and URLs exclusively to claims officers and administrators
    ...((role === 'CLAIMS_OFFICER' || role === 'ADMIN') && {
      trackingToken: claim.trackingToken ?? null,
      trackingUrl: buildTrackingUrl(claim.trackingToken),
    }),
    eligibilityHint: claim.eligibilityHint ?? null,
    incidentDate: claim.incidentDate ?? null,
    incidentDescription: claim.incidentDescription ?? null,
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

    // ── 13. Coverage Snapshot (captured at intake) ───────────────
    coverageSnapshot: claim.coverageSnapshot
      ? {
          policyKind: claim.coverageSnapshot.policyKind ?? null,
          policyType: claim.coverageSnapshot.policyType ?? null,
          coveredPerils: claim.coverageSnapshot.coveredPerils ?? [],
          deductibleAmount: claim.coverageSnapshot.deductibleAmount != null ? fromMinor(claim.coverageSnapshot.deductibleAmount, config.currency) : null,
          sumInsured: claim.coverageSnapshot.sumInsured != null ? fromMinor(claim.coverageSnapshot.sumInsured, config.currency) : null,
          capturedAt: claim.coverageSnapshot.capturedAt ?? null,
        }
      : null,

    // ── 14. Loss Assessment (financial adjudication) ─────────────
    lossAssessment: claim.lossAssessment
      ? {
          estimatedPartsCost: claim.lossAssessment.estimatedPartsCost != null ? fromMinor(claim.lossAssessment.estimatedPartsCost, config.currency) : null,
          laborCost: claim.lossAssessment.laborCost != null ? fromMinor(claim.lossAssessment.laborCost, config.currency) : null,
          totalDamage: claim.lossAssessment.totalDamage != null ? fromMinor(claim.lossAssessment.totalDamage, config.currency) : null,
          policyDeductible: claim.lossAssessment.policyDeductible != null ? fromMinor(claim.lossAssessment.policyDeductible, config.currency) : null,
          deductibleApplied: claim.lossAssessment.deductibleApplied != null ? fromMinor(claim.lossAssessment.deductibleApplied, config.currency) : null,
          deductibleOverridden: claim.lossAssessment.deductibleOverridden ?? false,
          deductibleOverrideReason: claim.lossAssessment.deductibleOverrideReason ?? null,
          netApprovedPayout: claim.lossAssessment.netApprovedPayout != null ? fromMinor(claim.lossAssessment.netApprovedPayout, config.currency) : null,
          currency: config.currency,
          assessedAt: claim.lossAssessment.assessedAt,
          assessedBy: formatUser(claim.lossAssessment.assessedBy),
        }
      : null,
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

  const licenseState = getLicenseState(adjuster);
  if (licenseState === LICENSE_STATE.MISSING) {
    throw new AppError('Surveyor license is missing', 422, 'SURVEYOR_LICENSE_EXPIRED', 'LICENSE_MISSING');
  }
  if (licenseState === LICENSE_STATE.EXPIRED) {
    throw new AppError('Surveyor license is expired', 422, 'SURVEYOR_LICENSE_EXPIRED', 'LICENSE_EXPIRED');
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

  const licenseState = getLicenseState(adjusterUser);
  if (licenseState === LICENSE_STATE.MISSING) {
    throw new AppError('Surveyor license is missing', 422, 'SURVEYOR_LICENSE_EXPIRED', 'LICENSE_MISSING');
  }
  if (licenseState === LICENSE_STATE.EXPIRED) {
    throw new AppError('Surveyor license is expired', 422, 'SURVEYOR_LICENSE_EXPIRED', 'LICENSE_EXPIRED');
  }

  const timelineEvent = {
    // NOTE: 'Assignment Accepted' is referenced by PUBLIC_TIMELINE_MAP for public tracking. Do not modify without updating PUBLIC_TIMELINE_MAP.
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

  try {
    if (typeof sendToOrganization === 'function') {
      await sendToOrganization({
        organizationId: authUser.organizationId,
        type: 'ASSIGNMENT_DECLINED',
        relatedClaimId: updatedClaim._id,
        title: 'Assignment Declined',
        body: `${employeeCode} declined claim ${updatedClaim.claimNumber}. Reason: ${reason}`,
      });
    }
  } catch (err) {
    console.error('Failed to send notification for assignment decline:', err);
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
  // NOTE: 'Inspection Started' and 'Inspection Resumed' are referenced by PUBLIC_TIMELINE_MAP for public tracking. Do not modify without updating PUBLIC_TIMELINE_MAP.
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
  const claim = await getOwnedAssignedClaim(claimId, authUser);

  const vehicle = await vehicleRepository.findByIdAndOrganization(body.vehicleId, authUser.organizationId);
  if (!vehicle) throw new AppError('Vehicle not found', 404, 'VEHICLE_NOT_FOUND');

  const policy = await policyRepository.findByIdAndOrganization(body.policyId, authUser.organizationId);
  if (!policy) throw new AppError('Policy not found', 404, 'POLICY_NOT_FOUND');

  const customer = await customerRepository.findByIdAndOrganization(body.customerId, authUser.organizationId);
  if (!customer) throw new AppError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');

  const claimPolicyId = claim.policyId?._id ?? claim.policyId;

  if (!claimPolicyId || !claimPolicyId.equals(policy._id)) {
    throw new AppError('Policy does not match the claim policy', 422, 'POLICY_MISMATCH');
  }

  const matchesPolicy =
    (vehicle.compulsoryPolicyId && claimPolicyId.equals(vehicle.compulsoryPolicyId)) ||
    (vehicle.complementaryPolicyId && claimPolicyId.equals(vehicle.complementaryPolicyId));

  if (!matchesPolicy) {
    throw new AppError('Vehicle is not registered under the claim policy', 422, 'VEHICLE_NOT_ON_CLAIM_POLICY');
  }

  if (!vehicle.customerId || !customer._id.equals(vehicle.customerId)) {
    throw new AppError('Customer is not the registered owner of this vehicle', 422, 'CUSTOMER_NOT_ON_VEHICLE');
  }

  const vehicleData = {
    plateNumber: vehicle.plateNumber,
    vehicleId: vehicle._id,
    policyId: claimPolicyId,
    customerId: customer._id,
  };

  const updatedClaim = await claimRepository.updateVehicle(
    claimId,
    authUser.organizationId,
    authUser.userId,
    claimPolicyId,
    vehicleData,
    {
      action: 'Vehicle Confirmed',
      previousStatus: null,
      newStatus: null,
      notes: null,
      performedBy: authUser.userId,
      role: authUser.role,
      timestamp: new Date(),
    }
  );

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
    // NOTE: 'Inspection Submitted' is referenced by PUBLIC_TIMELINE_MAP for public tracking. Do not modify without updating PUBLIC_TIMELINE_MAP.
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

  try {
    if (typeof sendToOrganization === 'function') {
      await sendToOrganization({
        organizationId: authUser.organizationId,
        type: 'INSPECTION_COMPLETED',
        relatedClaimId: updatedClaim._id,
        title: 'Inspection Completed',
        body: `Inspection completed for claim ${updatedClaim.claimNumber}.`,
      });
    }
  } catch (err) {
    console.error('Failed to send notification for inspection completion:', err);
  }

  return { status: updatedClaim.status };
};

const startReview = async (claimId, authUser) => {
  const updatedClaim = await claimRepository.startReview(claimId, authUser.organizationId, {
    // NOTE: 'Review Started' is referenced by PUBLIC_TIMELINE_MAP for public tracking. Do not modify without updating PUBLIC_TIMELINE_MAP.
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

const handleClaimNotFoundOrStateError = async (claimId, organizationId) => {
  const existing = await claimRepository.findByIdAndOrganization(claimId, organizationId);
  if (!existing) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }
  if (existing.status !== 'UNDER_REVIEW') {
    throw new AppError('Claim is not in UNDER_REVIEW status', 409, 'INVALID_STATUS_TRANSITION');
  }
  return existing;
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
    await handleClaimNotFoundOrStateError(claimId, organizationId);
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
  const { decision, notes, lossAssessment } = body;
  const { userId, role, organizationId } = authUser;

  // ── REJECTED Branch: zero pre-read, atomic update directly ─────────
  if (decision === 'REJECTED') {
    const timelineEvent = {
      // NOTE: 'Claim Rejected' is referenced by PUBLIC_TIMELINE_MAP for public tracking. Do not modify without updating PUBLIC_TIMELINE_MAP.
      action: 'Claim Rejected',
      previousStatus: 'UNDER_REVIEW',
      newStatus: 'REJECTED',
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
      await handleClaimNotFoundOrStateError(claimId, organizationId);
    }

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

    return {
      id: updatedClaim._id,
      claimNumber: updatedClaim.claimNumber,
      status: updatedClaim.status,
      decisionNotes: updatedClaim.decisionNotes,
    };
  }

  // ── APPROVED Branch: pre-read claim scoped to organization ─────────
  const existingClaim = await handleClaimNotFoundOrStateError(claimId, organizationId);

  let lossAssessmentDoc = null;
  const approvedVersion = existingClaim.approvedEstimateVersion;
  const approvedEstimate = approvedVersion != null
    ? (existingClaim.estimates || []).find((e) => e.version === approvedVersion)
    : null;

  let partsMinor;
  let laborMinor;

  if (approvedEstimate) {
    partsMinor = approvedEstimate.mapped.estimatedPartsCost;
    laborMinor = approvedEstimate.mapped.laborCost;

    if (lossAssessment) {
      const bodyPartsMinor = toMinor(lossAssessment.estimatedPartsCost, config.currency);
      const bodyLaborMinor = toMinor(lossAssessment.laborCost, config.currency);

      if (bodyPartsMinor !== partsMinor || bodyLaborMinor !== laborMinor) {
        throw new AppError(
          'Loss assessment does not match approved estimate',
          422,
          'LOSS_ASSESSMENT_MISMATCH'
        );
      }
    }
  } else {
    if (!lossAssessment) {
      throw new AppError('lossAssessment is required when decision is APPROVED', 400, 'VALIDATION_ERROR');
    }
    partsMinor = toMinor(lossAssessment.estimatedPartsCost, config.currency);
    laborMinor = toMinor(lossAssessment.laborCost, config.currency);
  }

  // Deductible resolution hierarchy:
  // 1. Snapshot deductible if defined
  // 2. Fallback to live policy query ONLY if snapshot is null / deductible missing
  // Note: Live-policy fallback serves claims created before coverageSnapshot existed and is removed after the legacy claims are deleted.
  // 3. 0 if policy or deductible not found
  let policyDeductible = 0;
  if (existingClaim.coverageSnapshot && existingClaim.coverageSnapshot.deductibleAmount != null) {
    policyDeductible = existingClaim.coverageSnapshot.deductibleAmount;
  } else {
    const livePolicy = await policyRepository.findByIdAndOrganization(existingClaim.policyId, organizationId);
    policyDeductible = livePolicy?.deductibleAmount ?? 0;
  }

  const totalDamageMinor = partsMinor + laborMinor;

  let appliedMinor;
  let deductibleOverrideReason = null;

  if (lossAssessment && lossAssessment.deductibleApplied !== undefined && lossAssessment.deductibleApplied !== null) {
    appliedMinor = toMinor(lossAssessment.deductibleApplied, config.currency);
  } else {
    appliedMinor = policyDeductible;
  }

  const overridden = appliedMinor !== policyDeductible;
  const rawReason = lossAssessment?.deductibleOverrideReason;
  const trimmedReason = typeof rawReason === 'string' ? rawReason.trim() : '';

  if (overridden) {
    if (!trimmedReason || trimmedReason.length < 10 || trimmedReason.length > 300) {
      throw new AppError(
        'deductibleOverrideReason is required (between 10 and 300 characters) when deductible is overridden',
        422,
        'OVERRIDE_REASON_REQUIRED'
      );
    }
    deductibleOverrideReason = trimmedReason;
  } else {
    if (trimmedReason.length > 0) {
      throw new AppError(
        'deductibleOverrideReason is not allowed when deductible matches policy',
        422,
        'OVERRIDE_REASON_NOT_ALLOWED'
      );
    }
    deductibleOverrideReason = null;
  }

  // Pre-condition: total damage must be strictly positive
  if (totalDamageMinor <= 0) {
    throw new AppError('totalDamage must be greater than zero', 400, 'VALIDATION_ERROR');
  }

  // Pre-condition: total damage must exceed applied deductible
  if (totalDamageMinor <= appliedMinor) {
    throw new AppError('Total damage must be greater than the applied deductible', 422, 'DAMAGE_BELOW_DEDUCTIBLE');
  }

  const netPayoutMinor = totalDamageMinor - appliedMinor;

  lossAssessmentDoc = {
    estimatedPartsCost: partsMinor,
    laborCost: laborMinor,
    totalDamage: totalDamageMinor,
    policyDeductible,
    deductibleApplied: appliedMinor,
    deductibleOverridden: overridden,
    deductibleOverrideReason,
    netApprovedPayout: netPayoutMinor,
    assessedAt: new Date(),
    assessedBy: userId,
  };

  let timelineNotes = notes || null;
  if (lossAssessmentDoc && lossAssessmentDoc.deductibleOverridden) {
    const majorPolicyDeductible = fromMinor(lossAssessmentDoc.policyDeductible, config.currency);
    const majorAppliedDeductible = fromMinor(lossAssessmentDoc.deductibleApplied, config.currency);
    const overrideNote = `[DEDUCTIBLE OVERRIDE] policy deductible ${majorPolicyDeductible}, applied ${majorAppliedDeductible}. Reason: ${lossAssessmentDoc.deductibleOverrideReason}`;
    timelineNotes = timelineNotes ? `${timelineNotes} ${overrideNote}` : overrideNote;
  }

  const timelineEvent = {
    // NOTE: 'Claim Approved' is referenced by PUBLIC_TIMELINE_MAP for public tracking. Do not modify without updating PUBLIC_TIMELINE_MAP.
    action: 'Claim Approved',
    previousStatus: 'UNDER_REVIEW',
    newStatus: 'APPROVED',
    notes: timelineNotes,
    performedBy: userId,
    role,
    timestamp: new Date(),
  };

  const updatedClaim = await claimRepository.makeDecision(
    claimId,
    organizationId,
    decision,
    notes || null,
    timelineEvent,
    lossAssessmentDoc
  );

  if (!updatedClaim) {
    // Atomic update failed (concurrency race lost)
    await handleClaimNotFoundOrStateError(claimId, organizationId);
  }

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

  return {
    id: updatedClaim._id,
    claimNumber: updatedClaim.claimNumber,
    status: updatedClaim.status,
    decisionNotes: updatedClaim.decisionNotes,
    lossAssessment: updatedClaim.lossAssessment
      ? {
          estimatedPartsCost: updatedClaim.lossAssessment.estimatedPartsCost != null ? fromMinor(updatedClaim.lossAssessment.estimatedPartsCost, config.currency) : null,
          laborCost: updatedClaim.lossAssessment.laborCost != null ? fromMinor(updatedClaim.lossAssessment.laborCost, config.currency) : null,
          totalDamage: updatedClaim.lossAssessment.totalDamage != null ? fromMinor(updatedClaim.lossAssessment.totalDamage, config.currency) : null,
          policyDeductible: updatedClaim.lossAssessment.policyDeductible != null ? fromMinor(updatedClaim.lossAssessment.policyDeductible, config.currency) : null,
          deductibleApplied: updatedClaim.lossAssessment.deductibleApplied != null ? fromMinor(updatedClaim.lossAssessment.deductibleApplied, config.currency) : null,
          deductibleOverridden: updatedClaim.lossAssessment.deductibleOverridden ?? false,
          deductibleOverrideReason: updatedClaim.lossAssessment.deductibleOverrideReason ?? null,
          netApprovedPayout: updatedClaim.lossAssessment.netApprovedPayout != null ? fromMinor(updatedClaim.lossAssessment.netApprovedPayout, config.currency) : null,
          currency: config.currency,
          assessedAt: updatedClaim.lossAssessment.assessedAt,
          assessedBy: updatedClaim.lossAssessment.assessedBy,
        }
      : null,
  };
};

const closeClaim = async (claimId, body, authUser) => {
  const { closingNotes } = body || {};
  const { userId, role, organizationId } = authUser;

  const timelineEvent = {
    // NOTE: 'Claim Closed' is referenced by PUBLIC_TIMELINE_MAP for public tracking. Do not modify without updating PUBLIC_TIMELINE_MAP.
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
  const [statusCounts, adjusters, totalIncidents] = await Promise.all([
    claimRepository.getClaimStats({
      organizationId,
      fromDate,
      toDate,
    }),
    userRepository.findAdjustersWithWorkload(organizationId),
    incidentRepository.countByOrganization(organizationId, { fromDate, toDate }),
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
    totalIncidents,
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

// ─── Public Claim Tracking ────────────────────────────────────────────────────

/**
 * Retrieves the public-facing status and progress of a claim by its tracking token.
 * Returns a sanitized DTO containing only customer-facing status, masked vehicle, and timeline.
 *
 * @param {string} trackingToken - The 64-char hex tracking token
 * @returns {object|null} Public claim status DTO, or null if claim not found
 */
const getPublicClaimStatus = async (trackingToken) => {
  const claim = await claimRepository.findByTrackingToken(trackingToken);
  if (!claim) {
    return null;
  }

  const publicStatus = PUBLIC_STATUS_MAP[claim.status] || {
    status: claim.status,
    statusDescription: '',
  };

  let vehicle = null;
  const populatedVehicle = claim.vehicle?.vehicleId;
  const rawPlate = populatedVehicle?.plateNumber || claim.vehicle?.plateNumber || null;
  if (populatedVehicle || rawPlate) {
    vehicle = {
      plateNumber: maskPlateNumber(rawPlate),
      make: populatedVehicle?.make || null,
      model: populatedVehicle?.model || null,
      year: populatedVehicle?.year ?? null,
    };
  }

  // Derive forward-only public timeline by tracking milestone progress in strict ascending rank order
  const events = Array.isArray(claim.timeline) ? claim.timeline : [];
  const createdEvent = events.find((e) => e.action === 'Claim Created');
  const initialTimestamp = createdEvent?.timestamp || claim.createdAt;
  const initialText = PUBLIC_TIMELINE_TEXT.RECEIVED || {};

  const publicTimeline = [
    {
      status: 'RECEIVED',
      title: initialText.title,
      description: initialText.description,
      timestamp: initialTimestamp,
    },
  ];

  let highestRank = PUBLIC_STATUS_RANK.RECEIVED;

  for (const event of events) {
    if (!event.newStatus) {
      continue;
    }
    const mapped = PUBLIC_STATUS_MAP[event.newStatus];
    if (!mapped) {
      continue;
    }
    const publicStatusKey = mapped.status;
    const rank = PUBLIC_STATUS_RANK[publicStatusKey];
    if (rank && rank > highestRank) {
      highestRank = rank;
      const text = PUBLIC_TIMELINE_TEXT[publicStatusKey] || {};
      publicTimeline.push({
        status: publicStatusKey,
        title: text.title,
        description: text.description,
        timestamp: event.timestamp,
      });
    }
  }

  return {
    claimNumber: claim.claimNumber,
    status: publicStatus.status,
    statusDescription: publicStatus.statusDescription,
    vehicle,
    timeline: publicTimeline,
  };
};


// ─── PB-08: Estimate & Quote Services ─────────────────────────────────────────

const createEstimate = async (claimId, body, authUser) => {
  const { userId, role, organizationId } = authUser;
  const { source, garageId, vatApplied, lines } = body;

  // C5: Role check for SURVEYOR
  if (source === 'SURVEYOR') {
    if (role !== 'FIELD_ADJUSTER') {
      throw new AppError('Forbidden: Insufficient permissions', 403, 'FORBIDDEN');
    }
  }

  // Garage check
  if (source === 'GARAGE') {
    if (!garageId) {
      throw new AppError('garageId is required when source is GARAGE', 400, 'VALIDATION_ERROR');
    }
    const garage = await garageRepository.findByIdAndOrganization(garageId, organizationId, { approved: true });
    if (!garage) {
      throw new AppError('Garage not found', 404, 'GARAGE_NOT_FOUND');
    }
  }

  // D1: Own-damage scope check
  if (lines.some((l) => l.lineType === 'DIMINISHED_VALUE' || l.lineType === 'LOSS_OF_USE')) {
    throw new AppError('Line type not allowed in own-damage claim', 422, 'LINE_TYPE_NOT_ALLOWED');
  }

  // Tenant-scoped claim lookup
  const existingClaim = await claimRepository.findByIdAndOrganization(claimId, organizationId);
  if (!existingClaim) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  // Ownership & Status checks per R2, R10, R11
  const TERMINAL_STATUSES = ['APPROVED', 'REJECTED', 'CLOSED'];
  if (TERMINAL_STATUSES.includes(existingClaim.status)) {
    throw new AppError('Claim is in terminal status', 409, 'INVALID_STATUS_TRANSITION');
  }

  if (role === 'FIELD_ADJUSTER') {
    const assignedId = existingClaim.assignedTo?._id?.toString() ?? existingClaim.assignedTo?.toString();
    if (assignedId !== userId.toString()) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }
    if (existingClaim.status !== 'IN_PROGRESS') {
      throw new AppError('Claim is not in IN_PROGRESS status', 409, 'INVALID_STATUS_TRANSITION');
    }
  } else {
    // CLAIMS_OFFICER or ADMIN
    const allowedStatuses = ['IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW'];
    if (!allowedStatuses.includes(existingClaim.status)) {
      throw new AppError('Claim is not in an allowed status for garage quote', 409, 'INVALID_STATUS_TRANSITION');
    }
  }

  // Resolve VAT rate from Organization settings
  const org = await Organization.findById(organizationId).lean();
  const vatRatePercent = org?.settings?.vatRatePercent ?? 16;

  // Pure estimate calculation
  const calculated = calculateEstimate(lines, vatApplied !== false, vatRatePercent, config.currency);

  const allowedStatuses = source === 'SURVEYOR'
    ? ['IN_PROGRESS']
    : (role === 'FIELD_ADJUSTER' ? ['IN_PROGRESS'] : ['IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW']);

  const buildFilter = (cnt) => ({
    _id: claimId,
    organizationId,
    status: { $in: allowedStatuses },
    ...(cnt === 0 ? { estimatesCount: { $in: [0, null] } } : { estimatesCount: cnt }),
    ...(role === 'FIELD_ADJUSTER' && { assignedTo: userId }),
  });

  const currentCount = existingClaim.estimatesCount || 0;
  const version = currentCount + 1;

  const estimateDoc = {
    version,
    source,
    garageId: source === 'GARAGE' ? garageId : null,
    vatApplied: vatApplied !== false,
    vatRatePercent,
    lines: calculated.lines,
    totals: calculated.totals,
    mapped: calculated.mapped,
    createdBy: userId,
    createdByRole: role,
    createdAt: new Date(),
  };

  const timelineEvent = {
    action: 'Estimate Added',
    previousStatus: existingClaim.status,
    newStatus: existingClaim.status,
    notes: `Estimate version ${version} (${source})`,
    performedBy: userId,
    role,
    timestamp: new Date(),
  };

  const updateDoc = {
    $push: { estimates: estimateDoc, timeline: timelineEvent },
    $inc: { estimatesCount: 1 },
  };

  let updatedClaim = await claimRepository.addEstimate(buildFilter(currentCount), updateDoc);

  if (!updatedClaim) {
    // Retry once (A1)
    const retryClaim = await claimRepository.findByIdAndOrganization(claimId, organizationId);
    if (!retryClaim) throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    if (!allowedStatuses.includes(retryClaim.status)) {
      throw new AppError('Claim is not in an allowed status', 409, 'INVALID_STATUS_TRANSITION');
    }
    if (role === 'FIELD_ADJUSTER') {
      const assignedId = retryClaim.assignedTo?._id?.toString() ?? retryClaim.assignedTo?.toString();
      if (assignedId !== userId.toString()) throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }

    const retryCount = retryClaim.estimatesCount || 0;
    estimateDoc.version = retryCount + 1;
    timelineEvent.notes = `Estimate version ${estimateDoc.version} (${source})`;

    updatedClaim = await claimRepository.addEstimate(buildFilter(retryCount), updateDoc);
    if (!updatedClaim) {
      throw new AppError('Estimate version conflict due to concurrent submission', 409, 'ESTIMATE_VERSION_CONFLICT');
    }
  }

  const savedEstimate = (updatedClaim.estimates || []).find((e) => e.version === estimateDoc.version);
  return formatEstimate(savedEstimate || estimateDoc, config.currency);
};

const getEstimates = async (claimId, authUser) => {
  const { userId, role, organizationId } = authUser;

  const claim = await claimRepository.findByIdAndOrganization(claimId, organizationId);
  if (!claim) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  if (role === 'FIELD_ADJUSTER') {
    const assignedId = claim.assignedTo?._id?.toString() ?? claim.assignedTo?.toString();
    if (assignedId !== userId.toString()) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }
  }

  const sortedEstimates = [...(claim.estimates || [])].sort((a, b) => b.version - a.version);
  const formatted = sortedEstimates.map((e) => formatEstimate(e, config.currency));

  return {
    approvedEstimateVersion: claim.approvedEstimateVersion ?? null,
    estimates: formatted,
  };
};

const compareEstimates = async (claimId, query, authUser) => {
  const { userId, role, organizationId } = authUser;

  const claim = await claimRepository.findByIdAndOrganization(claimId, organizationId);
  if (!claim) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  if (role === 'FIELD_ADJUSTER') {
    const assignedId = claim.assignedTo?._id?.toString() ?? claim.assignedTo?.toString();
    if (assignedId !== userId.toString()) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }
  }

  const estimates = claim.estimates || [];

  let surveyor;
  if (query.surveyorVersion) {
    surveyor = estimates.find((e) => e.source === 'SURVEYOR' && e.version === Number(query.surveyorVersion));
  } else {
    surveyor = estimates.filter((e) => e.source === 'SURVEYOR').sort((a, b) => b.version - a.version)[0];
  }

  if (!surveyor) {
    throw new AppError('Surveyor estimate not found', 404, 'ESTIMATE_NOT_FOUND');
  }

  let garage;
  if (query.garageVersion) {
    garage = estimates.find((e) => e.source === 'GARAGE' && e.version === Number(query.garageVersion));
  } else {
    garage = estimates.filter((e) => e.source === 'GARAGE').sort((a, b) => b.version - a.version)[0];
  }

  if (!garage) {
    throw new AppError('Garage quote not found', 404, 'ESTIMATE_NOT_FOUND');
  }

  const formattedSurveyor = formatEstimate(surveyor, config.currency);
  const formattedGarage = formatEstimate(garage, config.currency);

  const diffMinor = (field) => (garage.totals[field] || 0) - (surveyor.totals[field] || 0);

  const difference = {
    partsNet: fromMinor(diffMinor('partsNet'), config.currency),
    labor: fromMinor(diffMinor('labor'), config.currency),
    paint: fromMinor(diffMinor('paint'), config.currency),
    surveyorFee: fromMinor(diffMinor('surveyorFee'), config.currency),
    towing: fromMinor(diffMinor('towing'), config.currency),
    repairSubtotal: fromMinor(diffMinor('repairSubtotal'), config.currency),
    vat: fromMinor(diffMinor('vat'), config.currency),
    repairTotal: fromMinor(diffMinor('repairTotal'), config.currency),
    expenses: fromMinor(diffMinor('expenses'), config.currency),
  };

  const surveyorRepairTotalMinor = surveyor.totals.repairTotal || 0;
  const garageRepairTotalMinor = garage.totals.repairTotal || 0;
  let differencePercent = 0;
  if (surveyorRepairTotalMinor !== 0) {
    const pct = ((garageRepairTotalMinor - surveyorRepairTotalMinor) / surveyorRepairTotalMinor) * 100;
    differencePercent = Math.round(pct * 100) / 100;
  }

  return {
    surveyor: {
      version: formattedSurveyor.version,
      totals: formattedSurveyor.totals,
    },
    garage: {
      version: formattedGarage.version,
      totals: formattedGarage.totals,
    },
    difference,
    differencePercent,
  };
};

const approveEstimate = async (claimId, version, authUser) => {
  const { userId, role, organizationId } = authUser;

  if (!['CLAIMS_OFFICER', 'ADMIN'].includes(role)) {
    throw new AppError('Forbidden: Insufficient permissions', 403, 'FORBIDDEN');
  }

  const timelineEvent = {
    action: 'Estimate Approved',
    previousStatus: 'UNDER_REVIEW',
    newStatus: 'UNDER_REVIEW',
    notes: `Approved estimate version ${version}`,
    performedBy: userId,
    role,
    timestamp: new Date(),
  };

  const updatedClaim = await claimRepository.approveEstimate(
    claimId,
    organizationId,
    Number(version),
    timelineEvent
  );

  if (!updatedClaim) {
    const existing = await claimRepository.findByIdAndOrganization(claimId, organizationId);
    if (!existing) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }
    if (existing.status !== 'UNDER_REVIEW') {
      throw new AppError('Claim is not in UNDER_REVIEW status', 409, 'INVALID_STATUS_TRANSITION');
    }
    const exists = (existing.estimates || []).some((e) => e.version === Number(version));
    if (!exists) {
      throw new AppError('Estimate not found', 404, 'ESTIMATE_NOT_FOUND');
    }
    throw new AppError('Invalid status transition', 409, 'INVALID_STATUS_TRANSITION');
  }

  return {
    claimId: updatedClaim._id,
    approvedEstimateVersion: updatedClaim.approvedEstimateVersion,
  };
};

/**
 * ─── PB-10 Repair Orders Implementation ──────────────────────────────────────
 */

const REPAIR_ORDER_TRANSITIONS = Object.freeze({
  AUTHORIZED: ['IN_REPAIR', 'CANCELLED'],
  IN_REPAIR: ['SUPPLEMENT_REQUESTED', 'READY', 'CANCELLED'],
  SUPPLEMENT_REQUESTED: ['IN_REPAIR', 'CANCELLED'],
  READY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
});

const getNextRepairOrderNumber = async (organizationId, orgCode, createdAt) => {
  const issueDateStr = toHebronDate(createdAt);
  const year = issueDateStr.split('-')[0];

  const counter = await Counter.findOneAndUpdate(
    { _id: `repair-order:${organizationId}:${year}` },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );

  const seqPadded = String(counter.seq).padStart(4, '0');
  return `RO-${orgCode}-${year}-${seqPadded}`;
};

const formatRepairOrder = (ro, currency = config.currency) => {
  return {
    orderNumber: ro.orderNumber,
    garageId: ro.garageId?._id ? ro.garageId._id.toString() : ro.garageId?.toString(),
    garage: {
      name: ro.garage?.name,
      city: ro.garage?.city,
      phone: ro.garage?.phone,
    },
    authorizedAmount: fromMinor(ro.authorizedAmount, currency),
    deductibleToCollect: fromMinor(ro.deductibleToCollect, currency),
    repairTotal: fromMinor(ro.repairTotal, currency),
    status: ro.status,
    statusHistory: (ro.statusHistory || []).map((h) => ({
      from: h.from,
      to: h.to,
      notes: h.notes,
      performedBy: h.performedBy?._id ? h.performedBy._id.toString() : h.performedBy?.toString(),
      role: h.role,
      at: h.at,
    })),
    createdBy: ro.createdBy?._id ? ro.createdBy._id.toString() : ro.createdBy?.toString(),
    createdAt: ro.createdAt,
  };
};

const createRepairOrder = async (claimId, body, authUser) => {
  const { organizationId, role, userId } = authUser;

  // 1. Claim existence & tenancy
  const claim = await Claim.findOne({ _id: claimId, organizationId }).lean();
  if (!claim) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  // 2. Claim status gate: must be APPROVED with lossAssessment
  if (claim.status !== 'APPROVED' || !claim.lossAssessment || claim.lossAssessment.netApprovedPayout == null) {
    throw new AppError(
      'Repair order is only available for APPROVED claims with loss assessment',
      409,
      'INVALID_STATUS_TRANSITION'
    );
  }

  // 3. Existing active or delivered order gate
  const hasBlockingOrder = (claim.repairOrders || []).some((o) =>
    ['AUTHORIZED', 'IN_REPAIR', 'SUPPLEMENT_REQUESTED', 'READY', 'DELIVERED'].includes(o.status)
  );
  if (hasBlockingOrder) {
    throw new AppError(
      'An active or delivered repair order already exists on this claim',
      409,
      'REPAIR_ORDER_EXISTS'
    );
  }

  // 4. Resolve garage
  let targetGarageId = body.garageId;
  if (!targetGarageId) {
    const garageEstimates = (claim.estimates || [])
      .filter((e) => e.source === 'GARAGE')
      .sort((a, b) => b.version - a.version);

    if (garageEstimates.length === 0 || !garageEstimates[0].garageId) {
      throw new AppError('garageId is required when the claim has no garage quote', 400, 'VALIDATION_ERROR');
    }
    targetGarageId = garageEstimates[0].garageId;
  }

  const garage = await garageRepository.findByIdAndOrganization(targetGarageId, organizationId, { approved: true });
  if (!garage) {
    throw new AppError('Garage not found', 404, 'GARAGE_NOT_FOUND');
  }

  // 5. Build order and timeline documents
  const org = await Organization.findById(organizationId).lean();
  const orgCode = org?.code || 'ORG';
  const now = new Date();

  const orderNumber = await getNextRepairOrderNumber(organizationId, orgCode, now);

  const orderDoc = {
    orderNumber,
    garageId: garage._id,
    garage: {
      name: garage.name,
      city: garage.city,
      phone: garage.phone,
    },
    authorizedAmount: claim.lossAssessment.netApprovedPayout,
    deductibleToCollect: claim.lossAssessment.deductibleApplied,
    repairTotal: claim.lossAssessment.totalDamage,
    status: 'AUTHORIZED',
    statusHistory: [],
    createdBy: userId,
    createdAt: now,
  };

  const timelineEvent = {
    action: 'Repair Order Created',
    performedBy: userId,
    role,
    timestamp: now,
    previousStatus: 'APPROVED',
    newStatus: 'APPROVED',
    notes: body.notes || null,
  };

  // 6. Atomic create filter
  const createFilter = {
    _id: claimId,
    organizationId,
    status: 'APPROVED',
    'lossAssessment.netApprovedPayout': { $exists: true },
    repairOrders: {
      $not: {
        $elemMatch: {
          status: { $in: ['AUTHORIZED', 'IN_REPAIR', 'SUPPLEMENT_REQUESTED', 'READY', 'DELIVERED'] },
        },
      },
    },
  };

  const updatedClaim = await claimRepository.atomicCreateRepairOrder(createFilter, orderDoc, timelineEvent);
  if (!updatedClaim) {
    // C1: Re-read claim scoped to organizationId to explain miss
    const retryClaim = await Claim.findOne({ _id: claimId, organizationId }).lean();
    if (!retryClaim) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }
    if (retryClaim.status !== 'APPROVED' || !retryClaim.lossAssessment || retryClaim.lossAssessment.netApprovedPayout == null) {
      throw new AppError('Claim is not in APPROVED status with loss assessment', 409, 'INVALID_STATUS_TRANSITION');
    }
    const blocking = (retryClaim.repairOrders || []).some((o) =>
      ['AUTHORIZED', 'IN_REPAIR', 'SUPPLEMENT_REQUESTED', 'READY', 'DELIVERED'].includes(o.status)
    );
    if (blocking) {
      throw new AppError('An active or delivered repair order already exists on this claim', 409, 'REPAIR_ORDER_EXISTS');
    }
    throw new AppError('Invalid status transition', 409, 'INVALID_STATUS_TRANSITION');
  }

  return formatRepairOrder(orderDoc);
};

const updateRepairOrderStatus = async (claimId, orderNumber, body, authUser) => {
  const { organizationId, role, userId } = authUser;

  // 1. Claim existence & tenancy
  const claim = await Claim.findOne({ _id: claimId, organizationId }).lean();
  if (!claim) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  // 2. C2 Check order for FIELD_ADJUSTER: assignment first, then allowed target statuses
  if (role === 'FIELD_ADJUSTER') {
    const assignedId = claim.assignedTo?._id?.toString() ?? claim.assignedTo?.toString();
    if (assignedId !== userId.toString()) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }
    if (!['IN_REPAIR', 'SUPPLEMENT_REQUESTED', 'READY'].includes(body.status)) {
      throw new AppError('Forbidden: Insufficient permissions', 403, 'FORBIDDEN');
    }
  }

  // 3. Find order on claim
  const order = (claim.repairOrders || []).find((o) => o.orderNumber === orderNumber);
  if (!order) {
    throw new AppError('Repair order not found', 404, 'REPAIR_ORDER_NOT_FOUND');
  }

  // 4. State transition table check
  if (claim.status !== 'APPROVED') {
    throw new AppError('Claim is not in APPROVED status', 409, 'INVALID_STATUS_TRANSITION');
  }

  const allowedTransitions = REPAIR_ORDER_TRANSITIONS[order.status] || [];
  if (!allowedTransitions.includes(body.status)) {
    throw new AppError('Invalid status transition', 409, 'INVALID_STATUS_TRANSITION');
  }

  // 5. Atomic transition update
  const now = new Date();
  const transitionFilter = {
    _id: claimId,
    organizationId,
    status: 'APPROVED',
    repairOrders: {
      $elemMatch: {
        orderNumber,
        status: order.status,
      },
    },
  };

  const transitionUpdate = {
    $set: {
      'repairOrders.$.status': body.status,
    },
    $push: {
      'repairOrders.$.statusHistory': {
        from: order.status,
        to: body.status,
        notes: body.notes || null,
        performedBy: userId,
        role,
        at: now,
      },
      timeline: {
        action: `Repair Order ${body.status}`,
        performedBy: userId,
        role,
        timestamp: now,
        previousStatus: 'APPROVED',
        newStatus: 'APPROVED',
        notes: body.notes || null,
      },
    },
  };

  const updatedClaim = await claimRepository.atomicUpdateRepairOrderStatus(transitionFilter, transitionUpdate);
  if (!updatedClaim) {
    // C1: Re-read claim scoped to organizationId to explain miss
    const retryClaim = await Claim.findOne({ _id: claimId, organizationId }).lean();
    if (!retryClaim) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }
    const retryOrder = (retryClaim.repairOrders || []).find((o) => o.orderNumber === orderNumber);
    if (!retryOrder) {
      throw new AppError('Repair order not found', 404, 'REPAIR_ORDER_NOT_FOUND');
    }
    throw new AppError('Invalid status transition', 409, 'INVALID_STATUS_TRANSITION');
  }

  const updatedOrder = (updatedClaim.repairOrders || []).find((o) => o.orderNumber === orderNumber);
  return formatRepairOrder(updatedOrder);
};

const getRepairOrders = async (claimId, authUser) => {
  const { organizationId, role, userId } = authUser;

  const claim = await Claim.findOne({ _id: claimId, organizationId }).lean();
  if (!claim) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  if (role === 'FIELD_ADJUSTER') {
    const assignedId = claim.assignedTo?._id?.toString() ?? claim.assignedTo?.toString();
    if (assignedId !== userId.toString()) {
      throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }
  }

  const orders = [...(claim.repairOrders || [])];
  orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return orders.map((o) => formatRepairOrder(o));
};

module.exports = {
  assertPolicyCoverage,
  getEligibleClaimantParties,
  buildTrackingUrl,
  resolveClaimData,
  insertClaim,
  createClaim,
  createSubClaim,
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
  getPublicClaimStatus,
  createEstimate,
  getEstimates,
  compareEstimates,
  approveEstimate,
  createRepairOrder,
  updateRepairOrderStatus,
  getRepairOrders,
  getNextRepairOrderNumber,
  formatRepairOrder,
  REPAIR_ORDER_TRANSITIONS,
};

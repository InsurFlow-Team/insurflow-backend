const mongoose = require('mongoose');
const incidentService = require('../../modules/incidents/incident.service');
const { createIncidentSchema, createSubClaimSchema } = require('../../modules/incidents/incident.validation');
const claimService = require('../../modules/claims/claim.service');
const claimRepository = require('../../modules/claims/claim.repository');
const {
  assignClaimSchema,
  acceptAssignmentSchema,
  updateAccidentSchema,
  updateLocationSchema,
  createEstimateSchema,
  approveEstimateParamsSchema,
  decisionSchema,
  createRepairOrderSchema,
  updateRepairOrderStatusSchema,
  recordPaymentSchema,
  closeClaimSchema,
} = require('../../modules/claims/claim.validation');
const letterService = require('../../modules/letters/letter.service');
const { issueLetterSchema } = require('../../modules/letters/letter.validation');
const { validateBody, validateParams } = require('./validateBody');
const { generateFakePalestinianId, generateFakePhone } = require('./fakeIdentity');
const { DEMO_ASSET_URLS } = require('./demoAssets');
const { toHebronDate } = require('../../utils/hebronDate');
const { fromMinor } = require('../../utils/money');
const Customer = require('../../modules/customers/customer.model');
const Vehicle = require('../../modules/vehicles/vehicle.model');
const Garage = require('../../modules/garages/garage.model');
const Organization = require('../../modules/organizations/organization.model');

/**
 * Resolves staff and constructs strongly typed auth context objects.
 */
const resolveStaff = (refData, org) => {
  const staffByCode = refData.staffByCode || {};
  const users = Array.isArray(refData.users) ? refData.users : [];

  const getUser = (code, fallback) => {
    if (staffByCode[code]) return staffByCode[code];
    const fromUsers = users.find((u) => u.employeeCode === code);
    if (fromUsers) return fromUsers;
    return fallback;
  };

  const adminUser = getUser('DM-AD-001', refData.admin);
  const officer1User = getUser('DM-CO-001', refData.officer1);
  const adjuster1User = getUser('DM-FA-001', refData.adjuster1);
  const adjuster2User = getUser('DM-FA-002', refData.adjuster2);
  const adjuster4User = getUser('DM-FA-004', refData.adjuster4);

  if (!adminUser || !officer1User || !adjuster1User || !adjuster2User || !adjuster4User) {
    throw new Error('resolveStaff: Required demo staff members could not be resolved from refData');
  }

  const orgId = org._id;

  return {
    adminAuth: {
      userId: adminUser._id.toString(),
      role: 'ADMIN',
      organizationId: orgId,
    },
    officer1Auth: {
      userId: officer1User._id.toString(),
      role: 'CLAIMS_OFFICER',
      organizationId: orgId,
      canRecordPayments: true,
    },
    adjuster1Auth: {
      userId: adjuster1User._id.toString(),
      role: 'FIELD_ADJUSTER',
      organizationId: orgId,
    },
    adjuster2Auth: {
      userId: adjuster2User._id.toString(),
      role: 'FIELD_ADJUSTER',
      organizationId: orgId,
    },
    adjuster4Auth: {
      userId: adjuster4User._id.toString(),
      role: 'FIELD_ADJUSTER',
      organizationId: orgId,
    },
  };
};

/**
 * Resolves vehicle by index or plate number.
 */
const resolveVehicle = async (vehIndex, refData, orgId) => {
  const targetPlate = `1-100${vehIndex}-H`;
  if (Array.isArray(refData.vehicles)) {
    const byPlate = refData.vehicles.find((v) => v.plateNumber === targetPlate);
    if (byPlate) return byPlate;
    if (refData.vehicles[vehIndex]) return refData.vehicles[vehIndex];
  }
  const found = await Vehicle.findOne({ organizationId: orgId, plateNumber: targetPlate })
    .populate('compulsoryPolicyId complementaryPolicyId')
    .lean();
  if (!found) {
    throw new Error(`resolveVehicle: Vehicle ${targetPlate} not found for scenario`);
  }
  return found;
};

/**
 * Resolves customer associated with vehicle.
 */
const resolveCustomer = async (vehicle, refData, orgId) => {
  const custId = vehicle.customerId?._id || vehicle.customerId;
  if (vehicle.customerId && vehicle.customerId.fullName) {
    return vehicle.customerId;
  }
  if (Array.isArray(refData.customers)) {
    const found = refData.customers.find((c) => c._id.toString() === custId.toString());
    if (found) return found;
  }
  const found = await Customer.findOne({ _id: custId, organizationId: orgId }).lean();
  if (!found) {
    throw new Error(`resolveCustomer: Customer ${custId} not found for vehicle ${vehicle.plateNumber}`);
  }
  return found;
};

/**
 * Pushes 6 evidence photos directly to an IN_PROGRESS claim matching lines 1060-1084.
 */
const writeEvidencePhotos = async (claimId, adjusterAuth, assets) => {
  const photos = [
    { imageType: 'VEHICLE_FRONT', asset: assets.damageFront },
    { imageType: 'VEHICLE_REAR', asset: assets.damageRear },
    { imageType: 'VEHICLE_SIDE', asset: assets.damageSide },
    { imageType: 'DAMAGE_CLOSEUP', asset: assets.damageCloseup1 },
    { imageType: 'DAMAGE_CLOSEUP', asset: assets.damageCloseup2 },
    { imageType: 'DAMAGE_CLOSEUP', asset: assets.damageCloseup3 },
  ];

  for (const photo of photos) {
    const evidenceItem = {
      imageType: photo.imageType,
      url: photo.asset.url,
      publicId: photo.asset.publicId,
      uploadedBy: adjusterAuth.userId,
      uploadedAt: new Date(),
    };

    const timelineEvent = {
      action: 'Evidence Uploaded',
      previousStatus: null,
      newStatus: null,
      notes: photo.imageType,
      performedBy: adjusterAuth.userId,
      role: adjusterAuth.role,
      timestamp: new Date(),
    };

    await claimRepository.addEvidence(
      claimId,
      adjusterAuth.organizationId,
      adjusterAuth.userId,
      evidenceItem,
      timelineEvent
    );
  }
};

/**
 * Directly writes adjuster signature matching lines 1103-1125.
 */
const writeSignature = async (claimId, adjusterAuth, assets) => {
  const signatureData = {
    url: assets.signature.url,
    publicId: assets.signature.publicId,
    capturedBy: adjusterAuth.userId,
    capturedAt: new Date(),
  };

  const timelineEvent = {
    action: 'Signature Captured',
    previousStatus: null,
    newStatus: null,
    notes: null,
    performedBy: adjusterAuth.userId,
    role: adjusterAuth.role,
    timestamp: new Date(),
  };

  await claimRepository.setSignature(
    claimId,
    adjusterAuth.organizationId,
    adjusterAuth.userId,
    signatureData,
    timelineEvent
  );
};

/**
 * Directly writes signed discharge scan matching lines 2773-2810.
 */
const writeSignedDischarge = async (claimId, dischargeNumber, officerAuth, assets) => {
  const signedAt = new Date();
  const performedBy = new mongoose.Types.ObjectId(officerAuth.userId);

  const filter = {
    _id: claimId,
    organizationId: officerAuth.organizationId,
    status: 'APPROVED',
    discharges: {
      $elemMatch: {
        dischargeNumber,
        status: 'DRAFT',
      },
    },
  };

  const updateDoc = {
    $set: {
      'discharges.$.status': 'SIGNED',
      'discharges.$.signedScan': {
        url: assets.dischargeScan.url,
        publicId: assets.dischargeScan.publicId,
        uploadedBy: performedBy,
        uploadedAt: signedAt,
      },
      'discharges.$.signedAt': signedAt,
    },
    $push: {
      timeline: {
        action: 'Discharge Signed',
        previousStatus: 'APPROVED',
        newStatus: 'APPROVED',
        notes: dischargeNumber,
        performedBy,
        role: officerAuth.role,
        timestamp: signedAt,
      },
    },
  };

  const updated = await claimRepository.atomicSignDischarge(filter, updateDoc);
  if (!updated) {
    throw new Error(`writeSignedDischarge: Failed to sign discharge ${dischargeNumber} on claim ${claimId}`);
  }
};

/**
 * Builds the 9 Scenario 1 Claims (S1 to S9) covering complete claim lifecycle states.
 */
const buildScenario = async ({ refData = {}, assets = DEMO_ASSET_URLS, rndHelpers, now = new Date() }) => {
  let org = refData.organization || refData.org;
  if (!org) {
    org = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    if (!org) {
      throw new Error('buildScenario: SAWN-DEMO organization not found');
    }
  }

  const staff = resolveStaff(refData, org);

  let approvedGarages = (refData.garages || []).filter((g) => g.approved);
  if (approvedGarages.length === 0) {
    approvedGarages = await Garage.find({ organizationId: org._id, approved: true }).lean();
  }
  if (approvedGarages.length === 0) {
    throw new Error('buildScenario: At least one approved garage is required');
  }
  const approvedGarage0 = approvedGarages[0];

  const incidentAt = new Date(now.getTime() - 2 * 86400000).toISOString();
  const incidentDate = toHebronDate(new Date(incidentAt));

  /**
   * Helper: createScenarioIncidentAndSubClaim
   */
  const createScenarioIncidentAndSubClaim = async (vehIndex) => {
    const vehicle = await resolveVehicle(vehIndex, refData, org._id);
    const customer = await resolveCustomer(vehicle, refData, org._id);

    const rawIncidentBody = {
      incidentType: 'COLLISION',
      incidentLocation: 'شارع الإرسال، رام الله',
      incidentAt,
      governorate: 'RAMALLAH_AL_BIREH',
      reportSource: 'AGREED_STATEMENT',
      injuriesReported: false,
      accidentArea: 'PALESTINIAN_AREA',
      description: 'حادث تصادم على شارع الإرسال',
      vehicles: [
        {
          vehicleRole: 'INSURED',
          plateRegion: 'PALESTINIAN',
          plateNumber: vehicle.plateNumber,
          vehicleId: vehicle._id.toString(),
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
        },
      ],
      parties: [
        {
          partyType: 'PERSON',
          role: 'POLICYHOLDER',
          fullName: customer.fullName,
          idType: 'PALESTINIAN_ID',
          idNumber: generateFakePalestinianId(100 + vehIndex),
          phone: (customer.phone && /^\+97050000\d{4}$/.test(customer.phone))
            ? customer.phone
            : generateFakePhone(100 + vehIndex),
          vehicleIndex: 0,
        },
      ],
    };

    const validatedIncident = validateBody(createIncidentSchema, rawIncidentBody);
    const createdIncident = await incidentService.createIncident(validatedIncident, staff.officer1Auth);

    const compPolicyId = (vehicle.complementaryPolicyId?._id || vehicle.complementaryPolicyId).toString();
    const claimantPartyId = (createdIncident.parties[0].id || createdIncident.parties[0]._id).toString();
    const subjectRef = (createdIncident.vehicles[0].id || createdIncident.vehicles[0]._id).toString();

    const rawSubClaimBody = {
      claimType: 'OWN_DAMAGE',
      policyId: compPolicyId,
      plateNumber: vehicle.plateNumber,
      claimantPartyId,
      subjectRef,
    };

    const validatedSubClaim = validateBody(createSubClaimSchema, rawSubClaimBody);
    const createdClaim = await claimService.createSubClaim(
      createdIncident.id || createdIncident._id,
      validatedSubClaim,
      staff.officer1Auth
    );

    const claimId = (createdClaim.id || createdClaim._id).toString();

    return {
      incident: createdIncident,
      claim: createdClaim,
      claimId,
      vehicle,
      customer,
    };
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // S1 (vehicle 1): Stop at NEW
  // ─────────────────────────────────────────────────────────────────────────────
  const { claimId: s1Id } = await createScenarioIncidentAndSubClaim(1);
  const s1 = await claimRepository.findByIdAndOrganization(s1Id, org._id);

  // ─────────────────────────────────────────────────────────────────────────────
  // S2 (vehicle 2): assignClaim to DM-FA-001, acceptAssignment by FA-001. Stop at ASSIGNED
  // ─────────────────────────────────────────────────────────────────────────────
  const { claimId: s2Id } = await createScenarioIncidentAndSubClaim(2);
  const assignS2Body = validateBody(assignClaimSchema, {
    adjusterId: staff.adjuster1Auth.userId,
    priority: 'MEDIUM',
    notes: 'تعيين المعاين أحمد البديري لمعاينة المركبة',
  });
  await claimService.assignClaim(s2Id, assignS2Body, staff.officer1Auth);
  validateBody(acceptAssignmentSchema, {});
  await claimService.acceptAssignment(s2Id, staff.adjuster1Auth);
  const s2 = await claimRepository.findByIdAndOrganization(s2Id, org._id);

  // ─────────────────────────────────────────────────────────────────────────────
  // S3 (vehicle 3): S2 steps with DM-FA-002, startInspection by FA-002, 6 photos. Stop at IN_PROGRESS
  // ─────────────────────────────────────────────────────────────────────────────
  const { claimId: s3Id } = await createScenarioIncidentAndSubClaim(3);
  const assignS3Body = validateBody(assignClaimSchema, {
    adjusterId: staff.adjuster2Auth.userId,
    priority: 'MEDIUM',
    notes: 'تعيين المعاين محمود الرجبي لمعاينة المركبة',
  });
  await claimService.assignClaim(s3Id, assignS3Body, staff.officer1Auth);
  validateBody(acceptAssignmentSchema, {});
  await claimService.acceptAssignment(s3Id, staff.adjuster2Auth);
  await claimService.startInspection(s3Id, staff.adjuster2Auth);
  await writeEvidencePhotos(s3Id, staff.adjuster2Auth, assets);
  const s3 = await claimRepository.findByIdAndOrganization(s3Id, org._id);

  // ─────────────────────────────────────────────────────────────────────────────
  // S4 (vehicle 4): S3 steps with DM-FA-004, updateAccident, updateLocation, signature, submitInspection. Stop at SUBMITTED
  // ─────────────────────────────────────────────────────────────────────────────
  const { claimId: s4Id } = await createScenarioIncidentAndSubClaim(4);
  const assignS4Body = validateBody(assignClaimSchema, {
    adjusterId: staff.adjuster4Auth.userId,
    priority: 'MEDIUM',
    notes: 'تعيين المعاين زياد الخطيب',
  });
  await claimService.assignClaim(s4Id, assignS4Body, staff.officer1Auth);
  validateBody(acceptAssignmentSchema, {});
  await claimService.acceptAssignment(s4Id, staff.adjuster4Auth);
  await claimService.startInspection(s4Id, staff.adjuster4Auth);
  await writeEvidencePhotos(s4Id, staff.adjuster4Auth, assets);

  const s4AccidentBody = validateBody(updateAccidentSchema, {
    accidentType: 'COLLISION',
    accidentDate: incidentDate,
    accidentTime: '14:30',
    description: 'حادث تصادم على شارع الإرسال أثناء التوقف على الإشارة الضوئية',
    damageDescription: 'أضرار جسيمة في الصدام الأمامي والشبك والمصابيح الأمامية',
  });
  await claimService.updateAccident(s4Id, s4AccidentBody, staff.adjuster4Auth);

  const s4LocationBody = validateBody(updateLocationSchema, {
    latitude: 31.9038,
    longitude: 35.2034,
    address: 'شارع الإرسال، رام الله',
    capturedAt: incidentAt,
  });
  await claimService.updateLocation(s4Id, s4LocationBody, staff.adjuster4Auth);
  await writeSignature(s4Id, staff.adjuster4Auth, assets);
  await claimService.submitInspection(s4Id, staff.adjuster4Auth);
  const s4 = await claimRepository.findByIdAndOrganization(s4Id, org._id);

  // ─────────────────────────────────────────────────────────────────────────────
  // S5 (vehicle 5): S4 steps with DM-FA-004, surveyor estimate, submitInspection, startReview, garage quote. Stop at UNDER_REVIEW
  // ─────────────────────────────────────────────────────────────────────────────
  const { claimId: s5Id } = await createScenarioIncidentAndSubClaim(5);
  const assignS5Body = validateBody(assignClaimSchema, {
    adjusterId: staff.adjuster4Auth.userId,
    priority: 'MEDIUM',
    notes: 'تعيين المعاين زياد الخطيب',
  });
  await claimService.assignClaim(s5Id, assignS5Body, staff.officer1Auth);
  validateBody(acceptAssignmentSchema, {});
  await claimService.acceptAssignment(s5Id, staff.adjuster4Auth);
  await claimService.startInspection(s5Id, staff.adjuster4Auth);
  await writeEvidencePhotos(s5Id, staff.adjuster4Auth, assets);

  const s5AccidentBody = validateBody(updateAccidentSchema, {
    accidentType: 'COLLISION',
    accidentDate: incidentDate,
    accidentTime: '15:00',
    description: 'حادث تصادم على شارع الإرسال',
    damageDescription: 'أضرار في الواجهة والصدام الأمامي',
  });
  await claimService.updateAccident(s5Id, s5AccidentBody, staff.adjuster4Auth);

  const s5LocationBody = validateBody(updateLocationSchema, {
    latitude: 31.9038,
    longitude: 35.2034,
    address: 'شارع الإرسال، رام الله',
    capturedAt: incidentAt,
  });
  await claimService.updateLocation(s5Id, s5LocationBody, staff.adjuster4Auth);
  await writeSignature(s5Id, staff.adjuster4Auth, assets);

  // Surveyor estimate created while IN_PROGRESS
  const s5SurveyorEstimateBody = validateBody(createEstimateSchema, {
    source: 'SURVEYOR',
    vatApplied: true,
    lines: [
      {
        lineType: 'PART',
        description: 'صدام أمامي جديد أصلي',
        quantity: 1,
        unitPrice: 1500.0,
        partCondition: 'NEW_ORIGINAL',
        depreciationPercent: 0,
      },
      {
        lineType: 'LABOR',
        description: 'أجور فك وتركيب وتعديل الصدام',
        quantity: 3.0,
        unitPrice: 100.0,
      },
      {
        lineType: 'PAINT',
        description: 'دهان حراري للصدام والواجهة',
        quantity: 1,
        unitPrice: 400.0,
      },
    ],
  });
  await claimService.createEstimate(s5Id, s5SurveyorEstimateBody, staff.adjuster4Auth);

  await claimService.submitInspection(s5Id, staff.adjuster4Auth);
  await claimService.startReview(s5Id, staff.officer1Auth);

  // Garage quote created while UNDER_REVIEW
  const s5GarageQuoteBody = validateBody(createEstimateSchema, {
    source: 'GARAGE',
    garageId: approvedGarage0._id.toString(),
    vatApplied: true,
    lines: [
      {
        lineType: 'PART',
        description: 'صدام أمامي تجاري معتمد',
        quantity: 1,
        unitPrice: 1600.0,
        partCondition: 'NEW_AFTERMARKET',
        depreciationPercent: 0,
      },
      {
        lineType: 'LABOR',
        description: 'أجور سمكرة وتجليس ودهان الورشة',
        quantity: 4.0,
        unitPrice: 100.0,
      },
    ],
  });
  await claimService.createEstimate(s5Id, s5GarageQuoteBody, staff.officer1Auth);
  const s5 = await claimRepository.findByIdAndOrganization(s5Id, org._id);

  // ─────────────────────────────────────────────────────────────────────────────
  // S6 (vehicle 6): S5 steps with DM-FA-004, approveEstimate v1, decideClaim APPROVED, issueLetter APPROVAL, createRepairOrder AUTHORIZED. Stop at APPROVED with RO AUTHORIZED
  // ─────────────────────────────────────────────────────────────────────────────
  const { claimId: s6Id } = await createScenarioIncidentAndSubClaim(6);
  const assignS6Body = validateBody(assignClaimSchema, {
    adjusterId: staff.adjuster4Auth.userId,
    priority: 'MEDIUM',
    notes: 'تعيين زياد الخطيب للمطالبة S6',
  });
  await claimService.assignClaim(s6Id, assignS6Body, staff.officer1Auth);
  validateBody(acceptAssignmentSchema, {});
  await claimService.acceptAssignment(s6Id, staff.adjuster4Auth);
  await claimService.startInspection(s6Id, staff.adjuster4Auth);
  await writeEvidencePhotos(s6Id, staff.adjuster4Auth, assets);

  const s6AccidentBody = validateBody(updateAccidentSchema, {
    accidentType: 'COLLISION',
    accidentDate: incidentDate,
    accidentTime: '15:15',
    description: 'حادث تصادم على شارع الإرسال',
    damageDescription: 'أضرار في الواجهة والصدام الأمامي',
  });
  await claimService.updateAccident(s6Id, s6AccidentBody, staff.adjuster4Auth);

  const s6LocationBody = validateBody(updateLocationSchema, {
    latitude: 31.9038,
    longitude: 35.2034,
    address: 'شارع الإرسال، رام الله',
    capturedAt: incidentAt,
  });
  await claimService.updateLocation(s6Id, s6LocationBody, staff.adjuster4Auth);
  await writeSignature(s6Id, staff.adjuster4Auth, assets);

  const s6SurveyorEstimateBody = validateBody(createEstimateSchema, {
    source: 'SURVEYOR',
    vatApplied: true,
    lines: [
      {
        lineType: 'PART',
        description: 'صدام أمامي جديد أصلي',
        quantity: 1,
        unitPrice: 1500.0,
        partCondition: 'NEW_ORIGINAL',
        depreciationPercent: 0,
      },
      {
        lineType: 'LABOR',
        description: 'أجور فك وتركيب وتعديل الصدام',
        quantity: 3.0,
        unitPrice: 100.0,
      },
      {
        lineType: 'PAINT',
        description: 'دهان حراري للصدام والواجهة',
        quantity: 1,
        unitPrice: 400.0,
      },
    ],
  });
  await claimService.createEstimate(s6Id, s6SurveyorEstimateBody, staff.adjuster4Auth);

  await claimService.submitInspection(s6Id, staff.adjuster4Auth);
  await claimService.startReview(s6Id, staff.officer1Auth);

  const s6GarageQuoteBody = validateBody(createEstimateSchema, {
    source: 'GARAGE',
    garageId: approvedGarage0._id.toString(),
    vatApplied: true,
    lines: [
      {
        lineType: 'PART',
        description: 'صدام أمامي تجاري معتمد',
        quantity: 1,
        unitPrice: 1600.0,
        partCondition: 'NEW_AFTERMARKET',
        depreciationPercent: 0,
      },
      {
        lineType: 'LABOR',
        description: 'أجور سمكرة وتجليس ودهان الورشة',
        quantity: 4.0,
        unitPrice: 100.0,
      },
    ],
  });
  await claimService.createEstimate(s6Id, s6GarageQuoteBody, staff.officer1Auth);

  validateParams(approveEstimateParamsSchema, { claimId: s6Id, version: 1 });
  await claimService.approveEstimate(s6Id, 1, staff.officer1Auth);

  const s6DecisionBody = validateBody(decisionSchema, {
    decision: 'APPROVED',
    notes: 'تمت الموافقة على تقرير المعاينة والتقدير للمطالبة',
  });
  await claimService.decideClaim(s6Id, s6DecisionBody, staff.officer1Auth);

  const s6LetterBody = validateBody(issueLetterSchema, { type: 'APPROVAL' });
  await letterService.issueLetter(s6Id, s6LetterBody, staff.officer1Auth);

  const s6RepairOrderBody = validateBody(createRepairOrderSchema, {
    garageId: approvedGarage0._id.toString(),
  });
  await claimService.createRepairOrder(s6Id, s6RepairOrderBody, staff.officer1Auth);
  const s6 = await claimRepository.findByIdAndOrganization(s6Id, org._id);

  // ─────────────────────────────────────────────────────────────────────────────
  // S7 (vehicle 7): S6 steps, updateRepairOrderStatus IN_REPAIR -> READY -> DELIVERED, createDischarge, signDischarge. Stop at APPROVED with RO DELIVERED & SIGNED discharge
  // ─────────────────────────────────────────────────────────────────────────────
  const { claimId: s7Id } = await createScenarioIncidentAndSubClaim(7);
  const assignS7Body = validateBody(assignClaimSchema, {
    adjusterId: staff.adjuster4Auth.userId,
    priority: 'MEDIUM',
    notes: 'تعيين زياد الخطيب للمطالبة S7',
  });
  await claimService.assignClaim(s7Id, assignS7Body, staff.officer1Auth);
  validateBody(acceptAssignmentSchema, {});
  await claimService.acceptAssignment(s7Id, staff.adjuster4Auth);
  await claimService.startInspection(s7Id, staff.adjuster4Auth);
  await writeEvidencePhotos(s7Id, staff.adjuster4Auth, assets);

  const s7AccidentBody = validateBody(updateAccidentSchema, {
    accidentType: 'COLLISION',
    accidentDate: incidentDate,
    accidentTime: '15:30',
    description: 'حادث تصادم على شارع الإرسال',
    damageDescription: 'أضرار في الواجهة والصدام الأمامي',
  });
  await claimService.updateAccident(s7Id, s7AccidentBody, staff.adjuster4Auth);

  const s7LocationBody = validateBody(updateLocationSchema, {
    latitude: 31.9038,
    longitude: 35.2034,
    address: 'شارع الإرسال، رام الله',
    capturedAt: incidentAt,
  });
  await claimService.updateLocation(s7Id, s7LocationBody, staff.adjuster4Auth);
  await writeSignature(s7Id, staff.adjuster4Auth, assets);

  const s7SurveyorEstimateBody = validateBody(createEstimateSchema, {
    source: 'SURVEYOR',
    vatApplied: true,
    lines: [
      {
        lineType: 'PART',
        description: 'صدام أمامي جديد أصلي',
        quantity: 1,
        unitPrice: 1500.0,
        partCondition: 'NEW_ORIGINAL',
        depreciationPercent: 0,
      },
      {
        lineType: 'LABOR',
        description: 'أجور فك وتركيب وتعديل الصدام',
        quantity: 3.0,
        unitPrice: 100.0,
      },
      {
        lineType: 'PAINT',
        description: 'دهان حراري للصدام والواجهة',
        quantity: 1,
        unitPrice: 400.0,
      },
    ],
  });
  await claimService.createEstimate(s7Id, s7SurveyorEstimateBody, staff.adjuster4Auth);

  await claimService.submitInspection(s7Id, staff.adjuster4Auth);
  await claimService.startReview(s7Id, staff.officer1Auth);

  const s7GarageQuoteBody = validateBody(createEstimateSchema, {
    source: 'GARAGE',
    garageId: approvedGarage0._id.toString(),
    vatApplied: true,
    lines: [
      {
        lineType: 'PART',
        description: 'صدام أمامي تجاري معتمد',
        quantity: 1,
        unitPrice: 1600.0,
        partCondition: 'NEW_AFTERMARKET',
        depreciationPercent: 0,
      },
      {
        lineType: 'LABOR',
        description: 'أجور سمكرة وتجليس ودهان الورشة',
        quantity: 4.0,
        unitPrice: 100.0,
      },
    ],
  });
  await claimService.createEstimate(s7Id, s7GarageQuoteBody, staff.officer1Auth);

  validateParams(approveEstimateParamsSchema, { claimId: s7Id, version: 1 });
  await claimService.approveEstimate(s7Id, 1, staff.officer1Auth);

  const s7DecisionBody = validateBody(decisionSchema, {
    decision: 'APPROVED',
    notes: 'تمت الموافقة على تقرير المعاينة والتقدير للمطالبة',
  });
  await claimService.decideClaim(s7Id, s7DecisionBody, staff.officer1Auth);

  const s7LetterBody = validateBody(issueLetterSchema, { type: 'APPROVAL' });
  await letterService.issueLetter(s7Id, s7LetterBody, staff.officer1Auth);

  const s7RepairOrderBody = validateBody(createRepairOrderSchema, {
    garageId: approvedGarage0._id.toString(),
  });
  const createdRO7 = await claimService.createRepairOrder(s7Id, s7RepairOrderBody, staff.officer1Auth);
  const roNumber7 = createdRO7.orderNumber;

  const inRepairBody = validateBody(updateRepairOrderStatusSchema, { status: 'IN_REPAIR' });
  await claimService.updateRepairOrderStatus(s7Id, roNumber7, inRepairBody, staff.officer1Auth);

  const readyBody = validateBody(updateRepairOrderStatusSchema, { status: 'READY' });
  await claimService.updateRepairOrderStatus(s7Id, roNumber7, readyBody, staff.officer1Auth);

  const deliveredBody = validateBody(updateRepairOrderStatusSchema, { status: 'DELIVERED' });
  await claimService.updateRepairOrderStatus(s7Id, roNumber7, deliveredBody, staff.officer1Auth);

  const discharge7 = await claimService.createDischarge(s7Id, staff.officer1Auth);
  await writeSignedDischarge(s7Id, discharge7.dischargeNumber, staff.officer1Auth, assets);
  const s7 = await claimRepository.findByIdAndOrganization(s7Id, org._id);

  // ─────────────────────────────────────────────────────────────────────────────
  // S8 (vehicle 8): S7 steps, recordPayment partial amount (1000.00 ILS). Derived payment status is PARTIALLY_PAID
  // ─────────────────────────────────────────────────────────────────────────────
  const { claimId: s8Id, customer: s8Customer } = await createScenarioIncidentAndSubClaim(8);
  const assignS8Body = validateBody(assignClaimSchema, {
    adjusterId: staff.adjuster4Auth.userId,
    priority: 'MEDIUM',
    notes: 'تعيين زياد الخطيب للمطالبة S8',
  });
  await claimService.assignClaim(s8Id, assignS8Body, staff.officer1Auth);
  validateBody(acceptAssignmentSchema, {});
  await claimService.acceptAssignment(s8Id, staff.adjuster4Auth);
  await claimService.startInspection(s8Id, staff.adjuster4Auth);
  await writeEvidencePhotos(s8Id, staff.adjuster4Auth, assets);

  const s8AccidentBody = validateBody(updateAccidentSchema, {
    accidentType: 'COLLISION',
    accidentDate: incidentDate,
    accidentTime: '15:45',
    description: 'حادث تصادم على شارع الإرسال',
    damageDescription: 'أضرار في الواجهة والصدام الأمامي',
  });
  await claimService.updateAccident(s8Id, s8AccidentBody, staff.adjuster4Auth);

  const s8LocationBody = validateBody(updateLocationSchema, {
    latitude: 31.9038,
    longitude: 35.2034,
    address: 'شارع الإرسال، رام الله',
    capturedAt: incidentAt,
  });
  await claimService.updateLocation(s8Id, s8LocationBody, staff.adjuster4Auth);
  await writeSignature(s8Id, staff.adjuster4Auth, assets);

  const s8SurveyorEstimateBody = validateBody(createEstimateSchema, {
    source: 'SURVEYOR',
    vatApplied: true,
    lines: [
      {
        lineType: 'PART',
        description: 'صدام أمامي جديد أصلي',
        quantity: 1,
        unitPrice: 1500.0,
        partCondition: 'NEW_ORIGINAL',
        depreciationPercent: 0,
      },
      {
        lineType: 'LABOR',
        description: 'أجور فك وتركيب وتعديل الصدام',
        quantity: 3.0,
        unitPrice: 100.0,
      },
      {
        lineType: 'PAINT',
        description: 'دهان حراري للصدام والواجهة',
        quantity: 1,
        unitPrice: 400.0,
      },
    ],
  });
  await claimService.createEstimate(s8Id, s8SurveyorEstimateBody, staff.adjuster4Auth);

  await claimService.submitInspection(s8Id, staff.adjuster4Auth);
  await claimService.startReview(s8Id, staff.officer1Auth);

  const s8GarageQuoteBody = validateBody(createEstimateSchema, {
    source: 'GARAGE',
    garageId: approvedGarage0._id.toString(),
    vatApplied: true,
    lines: [
      {
        lineType: 'PART',
        description: 'صدام أمامي تجاري معتمد',
        quantity: 1,
        unitPrice: 1600.0,
        partCondition: 'NEW_AFTERMARKET',
        depreciationPercent: 0,
      },
      {
        lineType: 'LABOR',
        description: 'أجور سمكرة وتجليس ودهان الورشة',
        quantity: 4.0,
        unitPrice: 100.0,
      },
    ],
  });
  await claimService.createEstimate(s8Id, s8GarageQuoteBody, staff.officer1Auth);

  validateParams(approveEstimateParamsSchema, { claimId: s8Id, version: 1 });
  await claimService.approveEstimate(s8Id, 1, staff.officer1Auth);

  const s8DecisionBody = validateBody(decisionSchema, {
    decision: 'APPROVED',
    notes: 'تمت الموافقة على تقرير المعاينة والتقدير للمطالبة',
  });
  await claimService.decideClaim(s8Id, s8DecisionBody, staff.officer1Auth);

  const s8LetterBody = validateBody(issueLetterSchema, { type: 'APPROVAL' });
  await letterService.issueLetter(s8Id, s8LetterBody, staff.officer1Auth);

  const s8RepairOrderBody = validateBody(createRepairOrderSchema, {
    garageId: approvedGarage0._id.toString(),
  });
  const createdRO8 = await claimService.createRepairOrder(s8Id, s8RepairOrderBody, staff.officer1Auth);
  const roNumber8 = createdRO8.orderNumber;

  await claimService.updateRepairOrderStatus(
    s8Id,
    roNumber8,
    validateBody(updateRepairOrderStatusSchema, { status: 'IN_REPAIR' }),
    staff.officer1Auth
  );
  await claimService.updateRepairOrderStatus(
    s8Id,
    roNumber8,
    validateBody(updateRepairOrderStatusSchema, { status: 'READY' }),
    staff.officer1Auth
  );
  await claimService.updateRepairOrderStatus(
    s8Id,
    roNumber8,
    validateBody(updateRepairOrderStatusSchema, { status: 'DELIVERED' }),
    staff.officer1Auth
  );

  const discharge8 = await claimService.createDischarge(s8Id, staff.officer1Auth);
  await writeSignedDischarge(s8Id, discharge8.dischargeNumber, staff.officer1Auth, assets);

  const s8PaidAt = toHebronDate(now > new Date() ? new Date() : now);
  const s8PaymentBody = validateBody(recordPaymentSchema, {
    category: 'INDEMNITY',
    payeeType: 'INSURED',
    payeeName: s8Customer.fullName,
    amount: 1000.0,
    currency: 'ILS',
    method: 'BANK_TRANSFER',
    reference: 'TXN-PARTIAL-001',
    paidAt: s8PaidAt,
  });
  await claimService.recordPayment(s8Id, s8PaymentBody, staff.officer1Auth);
  const s8 = await claimRepository.findByIdAndOrganization(s8Id, org._id);

  // ─────────────────────────────────────────────────────────────────────────────
  // S9 (vehicle 9): S7 steps, recordPayment for full amount, closeClaim by adminAuth. Closed, reserve zeroed.
  // ─────────────────────────────────────────────────────────────────────────────
  const { claimId: s9Id, customer: s9Customer } = await createScenarioIncidentAndSubClaim(9);
  const assignS9Body = validateBody(assignClaimSchema, {
    adjusterId: staff.adjuster4Auth.userId,
    priority: 'MEDIUM',
    notes: 'تعيين زياد الخطيب للمطالبة S9',
  });
  await claimService.assignClaim(s9Id, assignS9Body, staff.officer1Auth);
  validateBody(acceptAssignmentSchema, {});
  await claimService.acceptAssignment(s9Id, staff.adjuster4Auth);
  await claimService.startInspection(s9Id, staff.adjuster4Auth);
  await writeEvidencePhotos(s9Id, staff.adjuster4Auth, assets);

  const s9AccidentBody = validateBody(updateAccidentSchema, {
    accidentType: 'COLLISION',
    accidentDate: incidentDate,
    accidentTime: '16:00',
    description: 'حادث تصادم على شارع الإرسال',
    damageDescription: 'أضرار في الواجهة والصدام الأمامي',
  });
  await claimService.updateAccident(s9Id, s9AccidentBody, staff.adjuster4Auth);

  const s9LocationBody = validateBody(updateLocationSchema, {
    latitude: 31.9038,
    longitude: 35.2034,
    address: 'شارع الإرسال، رام الله',
    capturedAt: incidentAt,
  });
  await claimService.updateLocation(s9Id, s9LocationBody, staff.adjuster4Auth);
  await writeSignature(s9Id, staff.adjuster4Auth, assets);

  const s9SurveyorEstimateBody = validateBody(createEstimateSchema, {
    source: 'SURVEYOR',
    vatApplied: true,
    lines: [
      {
        lineType: 'PART',
        description: 'صدام أمامي جديد أصلي',
        quantity: 1,
        unitPrice: 1500.0,
        partCondition: 'NEW_ORIGINAL',
        depreciationPercent: 0,
      },
      {
        lineType: 'LABOR',
        description: 'أجور فك وتركيب وتعديل الصدام',
        quantity: 3.0,
        unitPrice: 100.0,
      },
      {
        lineType: 'PAINT',
        description: 'دهان حراري للصدام والواجهة',
        quantity: 1,
        unitPrice: 400.0,
      },
    ],
  });
  await claimService.createEstimate(s9Id, s9SurveyorEstimateBody, staff.adjuster4Auth);

  await claimService.submitInspection(s9Id, staff.adjuster4Auth);
  await claimService.startReview(s9Id, staff.officer1Auth);

  const s9GarageQuoteBody = validateBody(createEstimateSchema, {
    source: 'GARAGE',
    garageId: approvedGarage0._id.toString(),
    vatApplied: true,
    lines: [
      {
        lineType: 'PART',
        description: 'صدام أمامي تجاري معتمد',
        quantity: 1,
        unitPrice: 1600.0,
        partCondition: 'NEW_AFTERMARKET',
        depreciationPercent: 0,
      },
      {
        lineType: 'LABOR',
        description: 'أجور سمكرة وتجليس ودهان الورشة',
        quantity: 4.0,
        unitPrice: 100.0,
      },
    ],
  });
  await claimService.createEstimate(s9Id, s9GarageQuoteBody, staff.officer1Auth);

  validateParams(approveEstimateParamsSchema, { claimId: s9Id, version: 1 });
  await claimService.approveEstimate(s9Id, 1, staff.officer1Auth);

  const s9DecisionBody = validateBody(decisionSchema, {
    decision: 'APPROVED',
    notes: 'تمت الموافقة على تقرير المعاينة والتقدير للمطالبة',
  });
  await claimService.decideClaim(s9Id, s9DecisionBody, staff.officer1Auth);

  const s9LetterBody = validateBody(issueLetterSchema, { type: 'APPROVAL' });
  await letterService.issueLetter(s9Id, s9LetterBody, staff.officer1Auth);

  const s9RepairOrderBody = validateBody(createRepairOrderSchema, {
    garageId: approvedGarage0._id.toString(),
  });
  const createdRO9 = await claimService.createRepairOrder(s9Id, s9RepairOrderBody, staff.officer1Auth);
  const roNumber9 = createdRO9.orderNumber;

  await claimService.updateRepairOrderStatus(
    s9Id,
    roNumber9,
    validateBody(updateRepairOrderStatusSchema, { status: 'IN_REPAIR' }),
    staff.officer1Auth
  );
  await claimService.updateRepairOrderStatus(
    s9Id,
    roNumber9,
    validateBody(updateRepairOrderStatusSchema, { status: 'READY' }),
    staff.officer1Auth
  );
  await claimService.updateRepairOrderStatus(
    s9Id,
    roNumber9,
    validateBody(updateRepairOrderStatusSchema, { status: 'DELIVERED' }),
    staff.officer1Auth
  );

  const discharge9 = await claimService.createDischarge(s9Id, staff.officer1Auth);
  await writeSignedDischarge(s9Id, discharge9.dischargeNumber, staff.officer1Auth, assets);

  const s9ClaimPrePay = await claimRepository.findByIdAndOrganization(s9Id, org._id);
  const s9FullPayoutMajor = fromMinor(s9ClaimPrePay.lossAssessment.netApprovedPayout, 'ILS');

  const s9PaidAt = toHebronDate(now > new Date() ? new Date() : now);
  const s9PaymentBody = validateBody(recordPaymentSchema, {
    category: 'INDEMNITY',
    payeeType: 'INSURED',
    payeeName: s9Customer.fullName,
    amount: s9FullPayoutMajor,
    currency: 'ILS',
    method: 'BANK_TRANSFER',
    reference: 'TXN-FULL-001',
    paidAt: s9PaidAt,
  });
  await claimService.recordPayment(s9Id, s9PaymentBody, staff.officer1Auth);

  const s9CloseBody = validateBody(closeClaimSchema, {
    closingNotes: 'سداد التعويض بالكامل وإغلاق المطالبة',
  });
  await claimService.closeClaim(s9Id, s9CloseBody, staff.adminAuth);
  const s9 = await claimRepository.findByIdAndOrganization(s9Id, org._id);

  return { s1, s2, s3, s4, s5, s6, s7, s8, s9 };
};

buildScenario.buildScenario = buildScenario;

module.exports = buildScenario;

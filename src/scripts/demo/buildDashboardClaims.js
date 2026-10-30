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
  requestCorrectionSchema,
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
  const adjuster3User = getUser('DM-FA-003', refData.adjuster3);
  const adjuster4User = getUser('DM-FA-004', refData.adjuster4);

  if (!adminUser || !officer1User || !adjuster1User || !adjuster2User || !adjuster3User || !adjuster4User) {
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
    adjuster3Auth: {
      userId: adjuster3User._id.toString(),
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
 * Resolves vehicle by index (vehicles 10 to 39).
 */
const resolveVehicle = async (vehIndex, refData, orgId) => {
  const targetPlate = `1-10${vehIndex}-H`;
  if (Array.isArray(refData.vehicles)) {
    const byPlate = refData.vehicles.find((v) => v.plateNumber === targetPlate);
    if (byPlate) return byPlate;
    if (refData.vehicles[vehIndex]) return refData.vehicles[vehIndex];
  }
  const found = await Vehicle.findOne({ organizationId: orgId, plateNumber: targetPlate })
    .populate('compulsoryPolicyId complementaryPolicyId')
    .lean();
  if (!found) {
    throw new Error(`resolveVehicle: Vehicle ${targetPlate} not found for dashboard claims`);
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
 * Builds exactly 30 dashboard claims: exactly 3 in each of the 10 statuses.
 */
const buildDashboardClaims = async ({ refData = {}, assets = DEMO_ASSET_URLS, rndHelpers, now = new Date() }) => {
  let org = refData.organization || refData.org;
  if (!org) {
    org = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    if (!org) {
      throw new Error('buildDashboardClaims: SAWN-DEMO organization not found');
    }
  }

  const staff = resolveStaff(refData, org);

  let approvedGarages = (refData.garages || []).filter((g) => g.approved);
  if (approvedGarages.length === 0) {
    approvedGarages = await Garage.find({ organizationId: org._id, approved: true }).lean();
  }
  if (approvedGarages.length === 0) {
    throw new Error('buildDashboardClaims: At least one approved garage is required');
  }
  const approvedGarage0 = approvedGarages[0];

  const dashboardClaims = [];

  // Street names for diverse Palestinian incident locations
  const STREET_NAMES = ['شارع الإرسال', 'شارع القدس', 'شارع الماصيون', 'شارع الطيرة', 'عين منجد', 'شارع النهضة'];

  /**
   * Helper: createDashboardIncidentAndSubClaim
   */
  const createDashboardIncidentAndSubClaim = async (i) => {
    const vehIndex = 10 + i;
    const vehicle = await resolveVehicle(vehIndex, refData, org._id);
    const customer = await resolveCustomer(vehicle, refData, org._id);

    // Spread dates over last 60 days
    const incidentAt = new Date(now.getTime() - (((i * 17) % 58) + 1) * 86400000).toISOString();
    const incidentDate = toHebronDate(new Date(incidentAt));
    const streetName = STREET_NAMES[i % STREET_NAMES.length];

    const incidentVehicles = [
      {
        vehicleRole: 'INSURED',
        plateRegion: 'PALESTINIAN',
        plateNumber: vehicle.plateNumber,
        vehicleId: vehicle._id.toString(),
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
      },
    ];

    // C7: At least 6 dashboard incidents have a THIRD_PARTY vehicle with plateRegion: 'ISRAELI'
    if (i < 8) {
      incidentVehicles.push({
        vehicleRole: 'THIRD_PARTY',
        plateRegion: 'ISRAELI',
        plateNumber: `${120 + i}-45-${670 + i}`,
        make: 'Toyota',
        model: 'Corolla',
        year: 2021,
      });
    }

    const rawIncidentBody = {
      incidentType: 'COLLISION',
      incidentLocation: `${streetName}، رام الله`,
      incidentAt,
      governorate: 'RAMALLAH_AL_BIREH',
      reportSource: 'AGREED_STATEMENT',
      injuriesReported: false,
      accidentArea: 'PALESTINIAN_AREA',
      description: `حادث مروري تجريبي - مطالبة لوحة التحكم رقم ${i + 1}`,
      vehicles: incidentVehicles,
      parties: [
        {
          partyType: 'PERSON',
          role: 'POLICYHOLDER',
          fullName: customer.fullName,
          idType: 'PALESTINIAN_ID',
          idNumber: generateFakePalestinianId(200 + i),
          phone: (customer.phone && /^\+97050000\d{4}$/.test(customer.phone))
            ? customer.phone
            : generateFakePhone(200 + i),
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
      incidentAt,
      incidentDate,
      streetName,
    };
  };

  /**
   * Helper: completeInspectionWorkflow
   */
  const completeInspectionWorkflow = async (claimId, adjusterAuth, incidentAt, incidentDate, streetName) => {
    await writeEvidencePhotos(claimId, adjusterAuth, assets);

    const accidentBody = validateBody(updateAccidentSchema, {
      accidentType: 'COLLISION',
      accidentDate: incidentDate,
      accidentTime: '11:30',
      description: `حادث تصادم على ${streetName}`,
      damageDescription: 'أضرار صدم متوسطة في الصدام والرفرف الأمامي',
    });
    await claimService.updateAccident(claimId, accidentBody, adjusterAuth);

    const locationBody = validateBody(updateLocationSchema, {
      latitude: 31.9038,
      longitude: 35.2034,
      address: `${streetName}، رام الله`,
      capturedAt: incidentAt,
    });
    await claimService.updateLocation(claimId, locationBody, adjusterAuth);
    await writeSignature(claimId, adjusterAuth, assets);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. NEW (3 claims): i = 0, 1, 2 (vehicles 10, 11, 12)
  // ─────────────────────────────────────────────────────────────────────────────
  for (let i = 0; i < 3; i++) {
    const { claimId } = await createDashboardIncidentAndSubClaim(i);
    const saved = await claimRepository.findByIdAndOrganization(claimId, org._id);
    dashboardClaims.push(saved);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. PENDING_ACCEPTANCE (3 claims): i = 3, 4, 5 (vehicles 13, 14, 15)
  // Assigned to DM-FA-004, NOT accepted.
  // ─────────────────────────────────────────────────────────────────────────────
  for (let i = 3; i < 6; i++) {
    const { claimId } = await createDashboardIncidentAndSubClaim(i);
    const assignBody = validateBody(assignClaimSchema, {
      adjusterId: staff.adjuster4Auth.userId,
      priority: 'MEDIUM',
      notes: `إسناد للمعاينة - مطالبة لوحة التحكم ${i + 1}`,
    });
    await claimService.assignClaim(claimId, assignBody, staff.officer1Auth);
    const saved = await claimRepository.findByIdAndOrganization(claimId, org._id);
    dashboardClaims.push(saved);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. ASSIGNED (3 claims): i = 6, 7, 8 (vehicles 16, 17, 18)
  // 1 to DM-FA-001, 1 to DM-FA-003, 1 to DM-FA-004.
  // ─────────────────────────────────────────────────────────────────────────────
  const assignedAdjusters = [staff.adjuster1Auth, staff.adjuster3Auth, staff.adjuster4Auth];
  for (let j = 0; j < 3; j++) {
    const i = 6 + j;
    const adjAuth = assignedAdjusters[j];
    const { claimId } = await createDashboardIncidentAndSubClaim(i);
    const assignBody = validateBody(assignClaimSchema, {
      adjusterId: adjAuth.userId,
      priority: 'MEDIUM',
      notes: `إسناد وقبول - مطالبة لوحة التحكم ${i + 1}`,
    });
    await claimService.assignClaim(claimId, assignBody, staff.officer1Auth);
    validateBody(acceptAssignmentSchema, {});
    await claimService.acceptAssignment(claimId, adjAuth);
    const saved = await claimRepository.findByIdAndOrganization(claimId, org._id);
    dashboardClaims.push(saved);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. IN_PROGRESS (3 claims): i = 9, 10, 11 (vehicles 19, 20, 21)
  // 1 to DM-FA-002, 1 to DM-FA-003, 1 to DM-FA-004.
  // ─────────────────────────────────────────────────────────────────────────────
  const inProgressAdjusters = [staff.adjuster2Auth, staff.adjuster3Auth, staff.adjuster4Auth];
  for (let j = 0; j < 3; j++) {
    const i = 9 + j;
    const adjAuth = inProgressAdjusters[j];
    const { claimId } = await createDashboardIncidentAndSubClaim(i);
    const assignBody = validateBody(assignClaimSchema, {
      adjusterId: adjAuth.userId,
      priority: 'MEDIUM',
      notes: `إسناد وبدء معاينة - مطالبة لوحة التحكم ${i + 1}`,
    });
    await claimService.assignClaim(claimId, assignBody, staff.officer1Auth);
    validateBody(acceptAssignmentSchema, {});
    await claimService.acceptAssignment(claimId, adjAuth);
    await claimService.startInspection(claimId, adjAuth);
    await writeEvidencePhotos(claimId, adjAuth, assets);
    const saved = await claimRepository.findByIdAndOrganization(claimId, org._id);
    dashboardClaims.push(saved);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. CORRECTION_REQUIRED (3 claims): i = 12, 13, 14 (vehicles 22, 23, 24)
  // 1 for DM-FA-001, 1 for DM-FA-002, 1 for DM-FA-003.
  // Advance to UNDER_REVIEW, then requestCorrection.
  // ─────────────────────────────────────────────────────────────────────────────
  const correctionAdjusters = [staff.adjuster1Auth, staff.adjuster2Auth, staff.adjuster3Auth];
  for (let j = 0; j < 3; j++) {
    const i = 12 + j;
    const adjAuth = correctionAdjusters[j];
    const { claimId, incidentAt, incidentDate, streetName } = await createDashboardIncidentAndSubClaim(i);
    const assignBody = validateBody(assignClaimSchema, {
      adjusterId: adjAuth.userId,
      priority: 'MEDIUM',
      notes: `طلب تصحيح لاحق - مطالبة لوحة التحكم ${i + 1}`,
    });
    await claimService.assignClaim(claimId, assignBody, staff.officer1Auth);
    validateBody(acceptAssignmentSchema, {});
    await claimService.acceptAssignment(claimId, adjAuth);
    await claimService.startInspection(claimId, adjAuth);
    await completeInspectionWorkflow(claimId, adjAuth, incidentAt, incidentDate, streetName);
    await claimService.submitInspection(claimId, adjAuth);
    await claimService.startReview(claimId, staff.officer1Auth);

    const correctionBody = validateBody(requestCorrectionSchema, {
      notes: 'يرجى إعادة التقاط صور الصدام بوضوح',
    });
    await claimService.requestCorrection(claimId, correctionBody, staff.officer1Auth);
    const saved = await claimRepository.findByIdAndOrganization(claimId, org._id);
    dashboardClaims.push(saved);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. SUBMITTED (3 claims): i = 15, 16, 17 (vehicles 25, 26, 27)
  // Processed one at a time using DM-FA-004.
  // ─────────────────────────────────────────────────────────────────────────────
  for (let i = 15; i < 18; i++) {
    const { claimId, incidentAt, incidentDate, streetName } = await createDashboardIncidentAndSubClaim(i);
    const assignBody = validateBody(assignClaimSchema, {
      adjusterId: staff.adjuster4Auth.userId,
      priority: 'MEDIUM',
      notes: `معاينة مقدمة - مطالبة لوحة التحكم ${i + 1}`,
    });
    await claimService.assignClaim(claimId, assignBody, staff.officer1Auth);
    validateBody(acceptAssignmentSchema, {});
    await claimService.acceptAssignment(claimId, staff.adjuster4Auth);
    await claimService.startInspection(claimId, staff.adjuster4Auth);
    await completeInspectionWorkflow(claimId, staff.adjuster4Auth, incidentAt, incidentDate, streetName);
    await claimService.submitInspection(claimId, staff.adjuster4Auth);
    const saved = await claimRepository.findByIdAndOrganization(claimId, org._id);
    dashboardClaims.push(saved);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. UNDER_REVIEW (3 claims): i = 18, 19, 20 (vehicles 28, 29, 30)
  // Processed one at a time using DM-FA-004.
  // ─────────────────────────────────────────────────────────────────────────────
  for (let i = 18; i < 21; i++) {
    const { claimId, incidentAt, incidentDate, streetName } = await createDashboardIncidentAndSubClaim(i);
    const assignBody = validateBody(assignClaimSchema, {
      adjusterId: staff.adjuster4Auth.userId,
      priority: 'MEDIUM',
      notes: `قيد التدقيق - مطالبة لوحة التحكم ${i + 1}`,
    });
    await claimService.assignClaim(claimId, assignBody, staff.officer1Auth);
    validateBody(acceptAssignmentSchema, {});
    await claimService.acceptAssignment(claimId, staff.adjuster4Auth);
    await claimService.startInspection(claimId, staff.adjuster4Auth);
    await completeInspectionWorkflow(claimId, staff.adjuster4Auth, incidentAt, incidentDate, streetName);
    await claimService.submitInspection(claimId, staff.adjuster4Auth);
    await claimService.startReview(claimId, staff.officer1Auth);
    const saved = await claimRepository.findByIdAndOrganization(claimId, org._id);
    dashboardClaims.push(saved);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. APPROVED (3 claims): i = 21, 22, 23 (vehicles 31, 32, 33)
  // Processed one at a time using DM-FA-004.
  // ─────────────────────────────────────────────────────────────────────────────
  for (let i = 21; i < 24; i++) {
    const { claimId, incidentAt, incidentDate, streetName } = await createDashboardIncidentAndSubClaim(i);
    const assignBody = validateBody(assignClaimSchema, {
      adjusterId: staff.adjuster4Auth.userId,
      priority: 'MEDIUM',
      notes: `موافقة - مطالبة لوحة التحكم ${i + 1}`,
    });
    await claimService.assignClaim(claimId, assignBody, staff.officer1Auth);
    validateBody(acceptAssignmentSchema, {});
    await claimService.acceptAssignment(claimId, staff.adjuster4Auth);
    await claimService.startInspection(claimId, staff.adjuster4Auth);
    await completeInspectionWorkflow(claimId, staff.adjuster4Auth, incidentAt, incidentDate, streetName);

    const surveyorEstimateBody = validateBody(createEstimateSchema, {
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
          description: 'أجور فك وتركيب',
          quantity: 3.0,
          unitPrice: 100.0,
        },
        {
          lineType: 'PAINT',
          description: 'دهان حراري للصدام',
          quantity: 1,
          unitPrice: 400.0,
        },
      ],
    });
    await claimService.createEstimate(claimId, surveyorEstimateBody, staff.adjuster4Auth);

    await claimService.submitInspection(claimId, staff.adjuster4Auth);
    await claimService.startReview(claimId, staff.officer1Auth);

    const garageQuoteBody = validateBody(createEstimateSchema, {
      source: 'GARAGE',
      garageId: approvedGarage0._id.toString(),
      vatApplied: true,
      lines: [
        {
          lineType: 'PART',
          description: 'صدام أمامي بديل',
          quantity: 1,
          unitPrice: 1600.0,
          partCondition: 'NEW_AFTERMARKET',
          depreciationPercent: 0,
        },
        {
          lineType: 'LABOR',
          description: 'أجور صيانة وتجليس',
          quantity: 4.0,
          unitPrice: 100.0,
        },
      ],
    });
    await claimService.createEstimate(claimId, garageQuoteBody, staff.officer1Auth);

    validateParams(approveEstimateParamsSchema, { claimId: claimId.toString(), version: 1 });
    await claimService.approveEstimate(claimId, 1, staff.officer1Auth);

    const approveBody = validateBody(decisionSchema, {
      decision: 'APPROVED',
      notes: 'تمت الموافقة على تقرير المعاينة والتقدير',
    });
    await claimService.decideClaim(claimId, approveBody, staff.officer1Auth);
    const saved = await claimRepository.findByIdAndOrganization(claimId, org._id);
    dashboardClaims.push(saved);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. REJECTED (3 claims): i = 24, 25, 26 (vehicles 34, 35, 36)
  // Processed one at a time using DM-FA-004. At least 1 has rejection letter.
  // ─────────────────────────────────────────────────────────────────────────────
  for (let i = 24; i < 27; i++) {
    const { claimId, incidentAt, incidentDate, streetName } = await createDashboardIncidentAndSubClaim(i);
    const assignBody = validateBody(assignClaimSchema, {
      adjusterId: staff.adjuster4Auth.userId,
      priority: 'MEDIUM',
      notes: `رفض - مطالبة لوحة التحكم ${i + 1}`,
    });
    await claimService.assignClaim(claimId, assignBody, staff.officer1Auth);
    validateBody(acceptAssignmentSchema, {});
    await claimService.acceptAssignment(claimId, staff.adjuster4Auth);
    await claimService.startInspection(claimId, staff.adjuster4Auth);
    await completeInspectionWorkflow(claimId, staff.adjuster4Auth, incidentAt, incidentDate, streetName);
    await claimService.submitInspection(claimId, staff.adjuster4Auth);
    await claimService.startReview(claimId, staff.officer1Auth);

    const rejectBody = validateBody(decisionSchema, {
      decision: 'REJECTED',
      notes: 'الأضرار المطالب بها غير مشمولة في وثيقة التأمين',
    });
    await claimService.decideClaim(claimId, rejectBody, staff.officer1Auth);

    // Issue rejection letter for the first rejected claim (i = 24)
    if (i === 24) {
      const rejectLetterBody = validateBody(issueLetterSchema, {
        type: 'REJECTION',
        reason: 'الأضرار المطالب بها لا تقع ضمن التغطية التأمينية المعتمدة في وثيقة التأمين',
      });
      await letterService.issueLetter(claimId, rejectLetterBody, staff.officer1Auth);
    }

    const saved = await claimRepository.findByIdAndOrganization(claimId, org._id);
    dashboardClaims.push(saved);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. CLOSED (3 claims): i = 27, 28, 29 (vehicles 37, 38, 39)
  // Processed one at a time using DM-FA-004. Full lifecycle to CLOSED.
  // ─────────────────────────────────────────────────────────────────────────────
  for (let i = 27; i < 30; i++) {
    const { claimId, customer, incidentAt, incidentDate, streetName } = await createDashboardIncidentAndSubClaim(i);
    const assignBody = validateBody(assignClaimSchema, {
      adjusterId: staff.adjuster4Auth.userId,
      priority: 'MEDIUM',
      notes: `إغلاق - مطالبة لوحة التحكم ${i + 1}`,
    });
    await claimService.assignClaim(claimId, assignBody, staff.officer1Auth);
    validateBody(acceptAssignmentSchema, {});
    await claimService.acceptAssignment(claimId, staff.adjuster4Auth);
    await claimService.startInspection(claimId, staff.adjuster4Auth);
    await completeInspectionWorkflow(claimId, staff.adjuster4Auth, incidentAt, incidentDate, streetName);

    const surveyorEstimateBody = validateBody(createEstimateSchema, {
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
          description: 'أجور فك وتركيب',
          quantity: 3.0,
          unitPrice: 100.0,
        },
        {
          lineType: 'PAINT',
          description: 'دهان حراري للصدام',
          quantity: 1,
          unitPrice: 400.0,
        },
      ],
    });
    await claimService.createEstimate(claimId, surveyorEstimateBody, staff.adjuster4Auth);

    await claimService.submitInspection(claimId, staff.adjuster4Auth);
    await claimService.startReview(claimId, staff.officer1Auth);

    const garageQuoteBody = validateBody(createEstimateSchema, {
      source: 'GARAGE',
      garageId: approvedGarage0._id.toString(),
      vatApplied: true,
      lines: [
        {
          lineType: 'PART',
          description: 'صدام أمامي بديل',
          quantity: 1,
          unitPrice: 1600.0,
          partCondition: 'NEW_AFTERMARKET',
          depreciationPercent: 0,
        },
        {
          lineType: 'LABOR',
          description: 'أجور صيانة وتجليس',
          quantity: 4.0,
          unitPrice: 100.0,
        },
      ],
    });
    await claimService.createEstimate(claimId, garageQuoteBody, staff.officer1Auth);

    validateParams(approveEstimateParamsSchema, { claimId: claimId.toString(), version: 1 });
    await claimService.approveEstimate(claimId, 1, staff.officer1Auth);

    const approveBody = validateBody(decisionSchema, {
      decision: 'APPROVED',
      notes: 'تمت الموافقة على تقرير المعاينة والتقدير للمطالبة',
    });
    await claimService.decideClaim(claimId, approveBody, staff.officer1Auth);

    const roBody = validateBody(createRepairOrderSchema, {
      garageId: approvedGarage0._id.toString(),
    });
    const createdRO = await claimService.createRepairOrder(claimId, roBody, staff.officer1Auth);
    const roNumber = createdRO.orderNumber;

    await claimService.updateRepairOrderStatus(
      claimId,
      roNumber,
      validateBody(updateRepairOrderStatusSchema, { status: 'IN_REPAIR' }),
      staff.officer1Auth
    );
    await claimService.updateRepairOrderStatus(
      claimId,
      roNumber,
      validateBody(updateRepairOrderStatusSchema, { status: 'READY' }),
      staff.officer1Auth
    );
    await claimService.updateRepairOrderStatus(
      claimId,
      roNumber,
      validateBody(updateRepairOrderStatusSchema, { status: 'DELIVERED' }),
      staff.officer1Auth
    );

    const discharge = await claimService.createDischarge(claimId, staff.officer1Auth);
    await writeSignedDischarge(claimId, discharge.dischargeNumber, staff.officer1Auth, assets);

    const claimPrePay = await claimRepository.findByIdAndOrganization(claimId, org._id);
    const fullPayoutMajor = fromMinor(claimPrePay.lossAssessment.netApprovedPayout, 'ILS');

    const paidAtDate = toHebronDate(now > new Date() ? new Date() : now);
    const paymentBody = validateBody(recordPaymentSchema, {
      category: 'INDEMNITY',
      payeeType: 'INSURED',
      payeeName: customer.fullName,
      amount: fullPayoutMajor,
      currency: 'ILS',
      method: 'BANK_TRANSFER',
      reference: `TXN-FULL-DASH-${i + 1}`,
      paidAt: paidAtDate,
    });
    await claimService.recordPayment(claimId, paymentBody, staff.officer1Auth);

    const closeBody = validateBody(closeClaimSchema, {
      closingNotes: 'سداد التعويض بالكامل وإغلاق المطالبة',
    });
    await claimService.closeClaim(claimId, closeBody, staff.adminAuth);
    const saved = await claimRepository.findByIdAndOrganization(claimId, org._id);
    dashboardClaims.push(saved);
  }

  return dashboardClaims;
};

buildDashboardClaims.buildDashboardClaims = buildDashboardClaims;

module.exports = buildDashboardClaims;

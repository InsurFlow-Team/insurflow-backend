const mongoose = require('mongoose');
const incidentRepository = require('./incident.repository');
const claimRepository = require('../claims/claim.repository');
const vehicleRepository = require('../vehicles/vehicle.repository');
const policyRepository = require('../policies/policy.repository');
const { assertPolicyCoverage, getEligibleClaimantParties } = require('../claims/claim.service');
const { getPolicyPeriodViolation } = require('../../utils/policyPeriod');
const AppError = require('../../utils/appError');
const { toHebronDate, deriveIncidentDate } = require('../../utils/hebronDate');
const { calculateHaversineDistance } = require('../../utils/geo.utils');

const DUPLICATE_CHECK_MAX_RESULTS = 20;
const DUPLICATE_CHECK_MAX_CANDIDATES = 500;

const getHebronMidnight = (dateStr) => {
  let low = new Date(`${dateStr}T00:00:00Z`).getTime() - 4 * 3600000;
  let high = new Date(`${dateStr}T00:00:00Z`).getTime();
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (toHebronDate(new Date(mid)) < dateStr) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
};

const formatVehicle = (v) => ({
  id: v._id,
  vehicleRole: v.vehicleRole,
  plateRegion: v.plateRegion,
  plateNumber: v.plateNumber ?? null,
  vehicleId: v.vehicleId ?? null,
  make: v.make ?? null,
  model: v.model ?? null,
  year: v.year ?? null,
  insurerName: v.insurerName ?? null,
  vehicleUse: v.vehicleUse ?? null,
  lienholderBank: v.lienholderBank ?? null,
});

const formatParty = (p) => ({
  id: p._id,
  role: p.role,
  partyType: p.partyType,
  fullName: p.fullName,
  idType: p.idType ?? null,
  idNumber: p.idNumber ?? null,
  phone: p.phone ?? null,
  licenseClass: p.licenseClass ?? null,
  licenseExpiry: p.licenseExpiry ?? null,
  vehicleRef: p.vehicleRef ?? null,
});

const formatDamagedItem = (d) => ({
  id: d._id,
  itemType: d.itemType,
  description: d.description,
});

const formatReporter = (r) => {
  if (!r || !r.partyRef || !r.capacity) return null;
  return {
    partyRef: r.partyRef,
    capacity: r.capacity,
  };
};

const assertReporterCapacityMatch = (capacity, party, vehicles) => {
  const role = party.role;
  let matches = false;

  switch (capacity) {
    case 'POLICYHOLDER':
      matches = role === 'POLICYHOLDER' || role === 'AUTHORIZED_REPRESENTATIVE';
      break;
    case 'DRIVER_AT_TIME':
      matches = role === 'INSURED_DRIVER';
      break;
    case 'OTHER_PARTY':
      if (['THIRD_PARTY_DRIVER', 'PASSENGER', 'PEDESTRIAN'].includes(role)) {
        matches = true;
      } else if (role === 'OWNER') {
        const vehicle =
          party.vehicleIndex !== undefined && party.vehicleIndex !== null
            ? vehicles[party.vehicleIndex]
            : null;
        if (vehicle && ['THIRD_PARTY', 'OTHER'].includes(vehicle.vehicleRole)) {
          matches = true;
        }
      }
      break;
    case 'EYEWITNESS':
      matches = role === 'WITNESS';
      break;
    default:
      matches = false;
  }

  if (!matches) {
    throw new AppError('Reporter capacity does not match party role', 422, 'REPORTER_CAPACITY_MISMATCH');
  }
};

const createIncident = async (body, authUser) => {
  const {
    incidentType,
    incidentLocation,
    incidentAt,
    governorate,
    reportSource,
    eKrokaReference,
    policeReportNumber,
    injuriesReported,
    accidentArea = null,
    description,
    latitude,
    longitude,
    vehicles,
    parties,
    damagedItems = [],
    reporter,
  } = body;

  const incidentAtDate = new Date(incidentAt);
  const maxAllowedFuture = Date.now() + 5 * 60 * 1000;
  if (incidentAtDate.getTime() > maxAllowedFuture) {
    throw new AppError('Incident date cannot be in the future', 400, 'INVALID_INCIDENT_DATE');
  }

  const incidentDate = deriveIncidentDate(incidentAtDate);

  for (const p of parties) {
    if (p.vehicleIndex !== undefined && p.vehicleIndex !== null) {
      if (p.vehicleIndex < 0 || p.vehicleIndex >= vehicles.length) {
        throw new AppError('Invalid vehicle reference', 422, 'INVALID_VEHICLE_REF');
      }
    }
  }

  if (
    !reporter ||
    typeof reporter.partyIndex !== 'number' ||
    reporter.partyIndex < 0 ||
    reporter.partyIndex >= parties.length
  ) {
    throw new AppError('Invalid reporter reference', 422, 'INVALID_REPORTER_REF');
  }

  const reporterParty = parties[reporter.partyIndex];
  assertReporterCapacityMatch(reporter.capacity, reporterParty, vehicles);

  for (const v of vehicles) {
    if (v.vehicleId) {
      const foundVehicle = await vehicleRepository.findByIdAndOrganization(
        v.vehicleId,
        authUser.organizationId
      );
      if (!foundVehicle) {
        throw new AppError('Vehicle not found', 404, 'VEHICLE_NOT_FOUND');
      }
    }
  }

  const preparedVehicles = vehicles.map((v) => ({
    _id: new mongoose.Types.ObjectId(),
    vehicleRole: v.vehicleRole,
    plateRegion: v.plateRegion,
    plateNumber: v.plateRegion === 'UNKNOWN' ? null : v.plateNumber,
    vehicleId: v.vehicleId || null,
    make: v.make || null,
    model: v.model || null,
    year: v.year || null,
    insurerName: v.insurerName || null,
    vehicleUse: v.vehicleUse || null,
    lienholderBank: v.lienholderBank || null,
  }));

  const preparedParties = parties.map((p) => {
    let vehicleRef = null;
    if (p.vehicleIndex !== undefined && p.vehicleIndex !== null) {
      vehicleRef = preparedVehicles[p.vehicleIndex]._id;
    }
    return {
      _id: new mongoose.Types.ObjectId(),
      role: p.role,
      partyType: p.partyType,
      fullName: p.fullName,
      idType: p.idType || null,
      idNumber: p.idNumber || null,
      phone: p.phone || null,
      licenseClass: p.licenseClass || null,
      licenseExpiry: p.licenseExpiry || null,
      vehicleRef,
    };
  });

  const preparedReporter = {
    partyRef: preparedParties[reporter.partyIndex]._id,
    capacity: reporter.capacity,
  };

  const preparedDamagedItems = (damagedItems || []).map((d) => ({
    _id: new mongoose.Types.ObjectId(),
    itemType: d.itemType,
    description: d.description,
  }));

  let incidentCoordinates = null;
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    incidentCoordinates = {
      latitude,
      longitude,
      capturedAt: new Date(),
    };
  }

  const incident = await incidentRepository.create({
    organizationId: authUser.organizationId,
    incidentDate,
    incidentAt: incidentAtDate,
    reportedAt: new Date(),
    incidentType,
    incidentLocation,
    incidentDescription: description || null,
    incidentCoordinates,
    governorate,
    reportSource,
    eKrokaReference: eKrokaReference || null,
    policeReportNumber: policeReportNumber || null,
    injuriesReported,
    accidentArea: accidentArea ?? null,
    vehicles: preparedVehicles,
    parties: preparedParties,
    damagedItems: preparedDamagedItems,
    reporter: preparedReporter,
    createdBy: authUser.userId,
  });

  return {
    id: incident._id,
    incidentNumber: incident.incidentNumber,
    incidentDate: incident.incidentDate,
    incidentAt: incident.incidentAt,
    reportedAt: incident.reportedAt,
    incidentType: incident.incidentType,
    incidentLocation: incident.incidentLocation,
    incidentDescription: incident.incidentDescription ?? null,
    incidentCoordinates: incident.incidentCoordinates ?? null,
    governorate: incident.governorate ?? null,
    reportSource: incident.reportSource ?? null,
    eKrokaReference: incident.eKrokaReference ?? null,
    policeReportNumber: incident.policeReportNumber ?? null,
    injuriesReported: incident.injuriesReported ?? null,
    accidentArea: incident.accidentArea ?? null,
    vehicles: incident.vehicles.map(formatVehicle),
    parties: incident.parties.map(formatParty),
    damagedItems: incident.damagedItems.map(formatDamagedItem),
    reporter: formatReporter(incident.reporter),
    createdAt: incident.createdAt,
  };
};

const getIncidents = async (authUser, filter = {}, pagination = {}) => {
  const { page = 1, limit = 50 } = pagination;
  const { totalCount, incidents } = await incidentRepository.findByOrganization(
    authUser.organizationId,
    filter,
    { page, limit }
  );

  const totalPages = Math.ceil(totalCount / limit);

  const formattedIncidents = incidents.map((inc) => ({
    id: inc._id,
    incidentNumber: inc.incidentNumber,
    incidentDate: inc.incidentDate,
    incidentAt: inc.incidentAt ?? null,
    incidentType: inc.incidentType,
    incidentLocation: inc.incidentLocation,
    governorate: inc.governorate ?? null,
    reportSource: inc.reportSource ?? null,
    injuriesReported: inc.injuriesReported ?? null,
    vehiclesCount: Array.isArray(inc.vehicles) ? inc.vehicles.length : 0,
    partiesCount: Array.isArray(inc.parties) ? inc.parties.length : 0,
    createdAt: inc.createdAt,
  }));

  return {
    incidents: formattedIncidents,
    pagination: {
      totalCount,
      page,
      limit,
      totalPages,
    },
  };
};

const getIncidentById = async (incidentId, authUser) => {
  const incident = await incidentRepository.findByIdAndOrganization(incidentId, authUser.organizationId);
  if (!incident) {
    throw new AppError('Incident not found', 404, 'INCIDENT_NOT_FOUND');
  }

  const claims = await claimRepository.findByIncidentId(authUser.organizationId, incidentId);

  const formattedClaims = claims.map((c) => ({
    id: c._id,
    claimNumber: c.claimNumber,
    claimType: c.claimType,
    status: c.status,
    plateNumber: c.vehicle?.plateNumber ?? null,
  }));

  return {
    id: incident._id,
    incidentNumber: incident.incidentNumber,
    incidentDate: incident.incidentDate,
    incidentAt: incident.incidentAt ?? null,
    reportedAt: incident.reportedAt ?? null,
    incidentType: incident.incidentType,
    incidentLocation: incident.incidentLocation,
    incidentDescription: incident.incidentDescription ?? null,
    incidentCoordinates: incident.incidentCoordinates ?? null,
    governorate: incident.governorate ?? null,
    reportSource: incident.reportSource ?? null,
    eKrokaReference: incident.eKrokaReference ?? null,
    policeReportNumber: incident.policeReportNumber ?? null,
    injuriesReported: incident.injuriesReported ?? null,
    accidentArea: incident.accidentArea ?? null,
    vehicles: (incident.vehicles ?? []).map(formatVehicle),
    parties: (incident.parties ?? []).map(formatParty),
    damagedItems: (incident.damagedItems ?? []).map(formatDamagedItem),
    reporter: formatReporter(incident.reporter),
    createdAt: incident.createdAt,
    claims: formattedClaims,
  };
};

const addVehicle = async (incidentId, body, authUser) => {
  if (body.vehicleId) {
    const foundVehicle = await vehicleRepository.findByIdAndOrganization(
      body.vehicleId,
      authUser.organizationId
    );
    if (!foundVehicle) {
      throw new AppError('Vehicle not found', 404, 'VEHICLE_NOT_FOUND');
    }
  }

  const vehicleData = {
    _id: new mongoose.Types.ObjectId(),
    vehicleRole: body.vehicleRole,
    plateRegion: body.plateRegion,
    plateNumber: body.plateRegion === 'UNKNOWN' ? null : body.plateNumber,
    vehicleId: body.vehicleId || null,
    make: body.make || null,
    model: body.model || null,
    year: body.year || null,
    insurerName: body.insurerName || null,
    vehicleUse: body.vehicleUse || null,
    lienholderBank: body.lienholderBank || null,
  };

  const updated = await incidentRepository.pushVehicle(
    incidentId,
    authUser.organizationId,
    vehicleData
  );

  if (!updated) {
    const existing = await incidentRepository.findByIdAndOrganization(
      incidentId,
      authUser.organizationId
    );
    if (!existing) {
      throw new AppError('Incident not found', 404, 'INCIDENT_NOT_FOUND');
    }
    if (existing.vehicles && existing.vehicles.length >= 10) {
      throw new AppError('Incident vehicles limit reached', 422, 'INCIDENT_LIMIT_REACHED');
    }
    throw new AppError('Incident changed, retry', 409, 'CONFLICT_RETRY');
  }

  return formatVehicle(vehicleData);
};

const addParty = async (incidentId, body, authUser) => {
  const partyData = {
    _id: new mongoose.Types.ObjectId(),
    role: body.role,
    partyType: body.partyType,
    fullName: body.fullName,
    idType: body.idType || null,
    idNumber: body.idNumber || null,
    phone: body.phone || null,
    licenseClass: body.licenseClass || null,
    licenseExpiry: body.licenseExpiry || null,
    vehicleRef: body.vehicleRef || null,
  };

  const updated = await incidentRepository.pushParty(
    incidentId,
    authUser.organizationId,
    partyData
  );

  if (!updated) {
    const existing = await incidentRepository.findByIdAndOrganization(
      incidentId,
      authUser.organizationId
    );
    if (!existing) {
      throw new AppError('Incident not found', 404, 'INCIDENT_NOT_FOUND');
    }
    if (existing.parties && existing.parties.length >= 30) {
      throw new AppError('Incident parties limit reached', 422, 'INCIDENT_LIMIT_REACHED');
    }
    if (partyData.vehicleRef) {
      const hasVehicle =
        existing.vehicles &&
        existing.vehicles.some((v) => v._id.toString() === partyData.vehicleRef.toString());
      if (!hasVehicle) {
        throw new AppError('Invalid vehicle reference', 422, 'INVALID_VEHICLE_REF');
      }
    }
    throw new AppError('Incident changed, retry', 409, 'CONFLICT_RETRY');
  }

  return formatParty(partyData);
};

const addDamagedItem = async (incidentId, body, authUser) => {
  const itemData = {
    _id: new mongoose.Types.ObjectId(),
    itemType: body.itemType,
    description: body.description,
  };

  const updated = await incidentRepository.pushDamagedItem(
    incidentId,
    authUser.organizationId,
    itemData
  );

  if (!updated) {
    const existing = await incidentRepository.findByIdAndOrganization(
      incidentId,
      authUser.organizationId
    );
    if (!existing) {
      throw new AppError('Incident not found', 404, 'INCIDENT_NOT_FOUND');
    }
    if (existing.damagedItems && existing.damagedItems.length >= 20) {
      throw new AppError('Incident damaged items limit reached', 422, 'INCIDENT_LIMIT_REACHED');
    }
    throw new AppError('Incident changed, retry', 409, 'CONFLICT_RETRY');
  }

  return formatDamagedItem(itemData);
};

const patchReport = async (incidentId, body, authUser) => {
  const updated = await incidentRepository.fillReportFields(
    incidentId,
    authUser.organizationId,
    body
  );

  if (!updated) {
    const existing = await incidentRepository.findByIdAndOrganization(
      incidentId,
      authUser.organizationId
    );
    if (!existing) {
      throw new AppError('Incident not found', 404, 'INCIDENT_NOT_FOUND');
    }
    if (body.reportSource !== undefined && existing.reportSource !== null && existing.reportSource !== 'NONE') {
      throw new AppError('Report field already set', 409, 'REPORT_FIELD_ALREADY_SET');
    }
    if (body.eKrokaReference !== undefined) {
      if (existing.eKrokaReference !== null) {
        throw new AppError('Report field already set', 409, 'REPORT_FIELD_ALREADY_SET');
      }
      const effectiveSource = body.reportSource || existing.reportSource;
      if (effectiveSource !== 'PALESTINIAN_POLICE_EKROKA') {
        throw new AppError(
          'eKrokaReference requires reportSource PALESTINIAN_POLICE_EKROKA',
          400,
          'VALIDATION_ERROR'
        );
      }
    }
    if (body.policeReportNumber !== undefined) {
      if (existing.policeReportNumber !== null) {
        throw new AppError('Report field already set', 409, 'REPORT_FIELD_ALREADY_SET');
      }
      const effectiveSource = body.reportSource || existing.reportSource;
      if (!['PALESTINIAN_POLICE_PAPER', 'ISRAELI_POLICE'].includes(effectiveSource)) {
        throw new AppError(
          'policeReportNumber requires police reportSource',
          400,
          'VALIDATION_ERROR'
        );
      }
    }
    if (body.injuriesReported !== undefined && existing.injuriesReported === true) {
      throw new AppError('Report field already set', 409, 'REPORT_FIELD_ALREADY_SET');
    }
    if (
      body.accidentArea !== undefined &&
      existing.accidentArea !== null &&
      existing.accidentArea !== 'UNKNOWN'
    ) {
      throw new AppError('Report field already set', 409, 'REPORT_FIELD_ALREADY_SET');
    }
    throw new AppError('Incident changed, retry', 409, 'CONFLICT_RETRY');
  }

  return {
    reportSource: updated.reportSource,
    eKrokaReference: updated.eKrokaReference ?? null,
    policeReportNumber: updated.policeReportNumber ?? null,
    injuriesReported: updated.injuriesReported ?? null,
    accidentArea: updated.accidentArea ?? null,
  };
};


const getCoverageSuggestions = async (incidentId, authUser) => {
  const incident = await incidentRepository.findByIdAndOrganization(
    incidentId,
    authUser.organizationId
  );
  if (!incident) {
    throw new AppError('Incident not found', 404, 'INCIDENT_NOT_FOUND');
  }

  const insuredVehicles = (incident.vehicles || []).filter(
    (v) => v.vehicleRole === 'INSURED' && v.vehicleId
  );
  const vehicleIds = insuredVehicles.map((v) => v.vehicleId);

  const [vehiclesInBook, existingClaims] = await Promise.all([
    vehicleIds.length > 0
      ? vehicleRepository.findByIdsAndOrganization(vehicleIds, authUser.organizationId)
      : [],
    claimRepository.findByIncidentId(authUser.organizationId, incidentId),
  ]);

  const vehicleMap = new Map();
  for (const v of vehiclesInBook) {
    vehicleMap.set(v._id.toString(), v);
  }

  const policyIds = [];
  for (const v of vehiclesInBook) {
    if (v.compulsoryPolicyId) policyIds.push(v.compulsoryPolicyId);
    if (v.complementaryPolicyId) policyIds.push(v.complementaryPolicyId);
  }

  const policies =
    policyIds.length > 0
      ? await policyRepository.findByIdsAndOrganization(policyIds, authUser.organizationId)
      : [];

  const policyMap = new Map();
  for (const p of policies) {
    policyMap.set(p._id.toString(), p);
  }

  const evaluateSlot = (policyId) => {
    if (!policyId) return null;
    const pidStr = policyId.toString();
    const policy = policyMap.get(pidStr);
    if (!policy) {
      return {
        id: pidStr,
        policyNumber: null,
        policyKind: null,
        status: null,
        check: 'POLICY_NOT_FOUND',
      };
    }

    let check;
    if (policy.status === 'CANCELLED') {
      check = 'POLICY_CANCELLED';
    } else if (!policy.policyKind) {
      check = 'POLICY_KIND_MISSING';
    } else {
      const violation = getPolicyPeriodViolation({
        policy,
        incidentAt: incident.incidentAt,
        incidentDate: incident.incidentDate,
      });
      check = violation || 'VALID';
    }

    return {
      id: policy._id.toString(),
      policyNumber: policy.policyNumber ?? null,
      policyKind: policy.policyKind ?? null,
      status: policy.status ?? null,
      check,
    };
  };

  const vehiclesResult = (incident.vehicles || []).map((v) => {
    const isInsured = v.vehicleRole === 'INSURED';
    const vehicleDoc = isInsured && v.vehicleId ? vehicleMap.get(v.vehicleId.toString()) : null;
    const inOurBook = Boolean(vehicleDoc);

    const compulsorySlot = inOurBook ? evaluateSlot(vehicleDoc.compulsoryPolicyId) : null;
    const complementarySlot = inOurBook ? evaluateSlot(vehicleDoc.complementaryPolicyId) : null;

    let suggestions = [];
    if (isInsured) {
      let ownDamageResult;
      let ownDamageReason = null;
      let ownDamagePolicyId = null;
      let claimantPartyIds = [];
      let warnings = [];

      if (!inOurBook) {
        ownDamageResult = 'NOT_APPLICABLE';
        ownDamageReason = 'NOT_IN_OUR_BOOK';
      } else if (!vehicleDoc.complementaryPolicyId) {
        ownDamageResult = 'NOT_APPLICABLE';
        ownDamageReason = 'NO_COMPLEMENTARY_POLICY';
      } else if (!policyMap.has(vehicleDoc.complementaryPolicyId.toString())) {
        ownDamageResult = 'NOT_APPLICABLE';
        ownDamageReason = 'POLICY_NOT_FOUND';
        ownDamagePolicyId = vehicleDoc.complementaryPolicyId.toString();
      } else {
        const compPolicy = policyMap.get(vehicleDoc.complementaryPolicyId.toString());
        ownDamagePolicyId = compPolicy._id.toString();

        if (compPolicy.status === 'CANCELLED') {
          ownDamageResult = 'NOT_APPLICABLE';
          ownDamageReason = 'POLICY_CANCELLED';
        } else {
          try {
            assertPolicyCoverage({
              policy: compPolicy,
              claimType: 'OWN_DAMAGE',
              incidentAt: incident.incidentAt,
              incidentDate: incident.incidentDate,
            });

            const eligibleParties = getEligibleClaimantParties(incident.parties, v._id);
            claimantPartyIds = eligibleParties.map((p) => p._id.toString());
            if (claimantPartyIds.length === 0) {
              ownDamageResult = 'BLOCKED';
              ownDamageReason = 'NO_ELIGIBLE_CLAIMANT';
            } else {
              const isDuplicate = existingClaims.some(
                (c) =>
                  (c.claimType || 'OWN_DAMAGE') === 'OWN_DAMAGE' &&
                  c.vehicle?.vehicleId &&
                  c.vehicle.vehicleId.toString() === vehicleDoc._id.toString()
              );
              if (isDuplicate) {
                ownDamageResult = 'ALREADY_OPEN';
                ownDamageReason = 'DUPLICATE_SUB_CLAIM';
              } else {
                ownDamageResult = 'ALLOWED';
                ownDamageReason = null;
                if (incident.accidentArea === 'ISRAEL') {
                  warnings.push('COMPLEMENTARY_TERRITORY_CHECK');
                }
              }
            }
          } catch (err) {
            if (err instanceof AppError && err.code === 'COVERAGE_NOT_APPLICABLE') {
              ownDamageResult = 'NOT_APPLICABLE';
              ownDamageReason = err.reason;
            } else {
              throw err;
            }
          }
        }
      }

      suggestions.push({
        claimType: 'OWN_DAMAGE',
        result: ownDamageResult,
        reason: ownDamageReason,
        policyId: ownDamagePolicyId,
        claimantPartyIds,
        warnings,
      });

      if (inOurBook) {
        suggestions.push({
          claimType: 'THIRD_PARTY_PD',
          result: 'NOT_SUPPORTED',
          reason: 'CLAIM_TYPE_NOT_SUPPORTED',
          policyId: vehicleDoc.compulsoryPolicyId
            ? vehicleDoc.compulsoryPolicyId.toString()
            : null,
          dependsOnLiability: true,
        });
      }
    }

    let bodilyInjury;
    if (!inOurBook) {
      bodilyInjury = {
        cover: 'OUTSIDE_OUR_BOOK',
        policyId: null,
        dependsOnFault: false,
        fundMayApply: false,
      };
    } else if (!vehicleDoc.compulsoryPolicyId) {
      bodilyInjury = {
        cover: 'NO_COMPULSORY_WITH_US',
        policyId: null,
        dependsOnFault: false,
        fundMayApply: false,
      };
    } else {
      const isCompulsoryValid = compulsorySlot && compulsorySlot.check === 'VALID';
      bodilyInjury = {
        cover: isCompulsoryValid ? 'OUR_COMPULSORY' : 'OUR_COMPULSORY_NOT_VALID',
        policyId: vehicleDoc.compulsoryPolicyId.toString(),
        dependsOnFault: false,
        fundMayApply: !isCompulsoryValid,
      };
    }

    return {
      vehicleRef: v._id.toString(),
      vehicleRole: v.vehicleRole,
      plateRegion: v.plateRegion,
      plateNumber: v.plateNumber ?? null,
      vehicleId: v.vehicleId ? v.vehicleId.toString() : null,
      insurerName: v.insurerName ?? null,
      inOurBook,
      policies: {
        compulsory: compulsorySlot,
        complementary: complementarySlot,
      },
      suggestions,
      bodilyInjury,
    };
  });

  const flags = [];
  if (incident.accidentArea === 'ISRAEL') {
    flags.push({
      code: 'ACCIDENT_IN_ISRAEL',
      details:
        'The accident side compensates bodily injury under its own law (Paris Protocol Article 76); confirm with the insurer.',
    });
  }
  if (!incident.accidentArea || incident.accidentArea === 'UNKNOWN') {
    flags.push({
      code: 'ACCIDENT_AREA_UNKNOWN',
      details:
        'Accident area is unknown; geographic coverage and governing compensation law cannot be confirmed.',
    });
  }
  if (incident.governorate === 'JERUSALEM') {
    flags.push({
      code: 'JERUSALEM_COVERAGE_UNCONFIRMED',
      details:
        'Accident occurred in Jerusalem governorate; verify whether Palestinian or Israeli jurisdiction applies.',
    });
  }
  const hasIsraeliVehicle = (incident.vehicles || []).some(
    (v) => v.plateRegion === 'ISRAELI'
  );
  if (hasIsraeliVehicle) {
    flags.push({
      code: 'ISRAELI_VEHICLE_INVOLVED',
      details:
        'An Israeli-registered vehicle is involved; verify cross-border liability and insurance coverage.',
    });
  }

  return {
    incidentId: incident._id.toString(),
    incidentNumber: incident.incidentNumber,
    incidentAt: incident.incidentAt ?? null,
    incidentDate: incident.incidentDate,
    accidentArea: incident.accidentArea ?? null,
    governorate: incident.governorate ?? null,
    injuriesReported: incident.injuriesReported ?? null,
    flags,
    vehicles: vehiclesResult,
  };
};

const checkDuplicates = async (body, authUser) => {
  const {
    incidentAt,
    plateNumbers,
    latitude,
    longitude,
    excludeIncidentId,
  } = body;

  const reqDate = new Date(incidentAt);
  const reqMs = reqDate.getTime();

  const startWindow = new Date(reqMs - 24 * 60 * 60 * 1000);
  const endWindow = new Date(reqMs + 24 * 60 * 60 * 1000);

  const startDateStr = toHebronDate(startWindow);
  const midDateStr = toHebronDate(reqDate);
  const endDateStr = toHebronDate(endWindow);
  const dateSet = Array.from(new Set([startDateStr, midDateStr, endDateStr])).sort();

  const normalizedPlates = Array.from(
    new Set(plateNumbers.map((p) => p.trim().toUpperCase()))
  );
  const normalizedSet = new Set(normalizedPlates);

  const candidates = await incidentRepository.findDuplicateCandidates(
    authUser.organizationId,
    {
      normalizedPlates,
      startWindow,
      endWindow,
      dateSet,
      excludeIncidentId,
      limit: DUPLICATE_CHECK_MAX_CANDIDATES,
    }
  );

  const truncated = candidates.length > DUPLICATE_CHECK_MAX_RESULTS;

  if (candidates.length === 0) {
    return {
      windowHours: 24,
      checkedAt: new Date().toISOString(),
      matches: [],
      truncated: false,
    };
  }

  const candidateIds = candidates.map((c) => c._id);
  const claimCounts = await claimRepository.countClaimsByIncidentIds(
    authUser.organizationId,
    candidateIds
  );

  const claimCountMap = new Map();
  for (const item of claimCounts) {
    claimCountMap.set(item._id.toString(), item.count);
  }

  const processed = candidates.map((c) => {
    const isExact = c.incidentAt !== null && c.incidentAt !== undefined;
    const timeBasis = isExact ? 'EXACT' : 'DATE_ONLY';

    let timeDistanceMs;
    if (isExact) {
      timeDistanceMs = Math.abs(new Date(c.incidentAt).getTime() - reqMs);
    } else {
      if (c.incidentDate === midDateStr) {
        timeDistanceMs = 0;
      } else if (c.incidentDate < midDateStr) {
        timeDistanceMs = reqMs - getHebronMidnight(midDateStr);
      } else {
        timeDistanceMs = getHebronMidnight(c.incidentDate) - reqMs;
      }
    }

    const matchedPlates = [];
    if (Array.isArray(c.vehicles)) {
      for (const v of c.vehicles) {
        if (v.plateNumber) {
          const upperPlate = v.plateNumber.trim().toUpperCase();
          if (normalizedSet.has(upperPlate)) {
            matchedPlates.push({
              plateNumber: v.plateNumber,
              vehicleRole: v.vehicleRole,
            });
          }
        }
      }
    }

    let distanceKm = null;
    if (
      typeof latitude === 'number' &&
      typeof longitude === 'number' &&
      c.incidentCoordinates &&
      typeof c.incidentCoordinates.latitude === 'number' &&
      typeof c.incidentCoordinates.longitude === 'number'
    ) {
      distanceKm = calculateHaversineDistance(
        latitude,
        longitude,
        c.incidentCoordinates.latitude,
        c.incidentCoordinates.longitude
      );
    }

    const claimsCount = claimCountMap.get(c._id.toString()) || 0;

    return {
      incidentId: c._id.toString(),
      incidentNumber: c.incidentNumber,
      incidentAt: c.incidentAt ? new Date(c.incidentAt).toISOString() : null,
      incidentDate: c.incidentDate,
      timeBasis,
      governorate: c.governorate ?? null,
      matchedPlates,
      distanceKm,
      claimsCount,
      timeDistanceMs,
      timeBasisPriority: isExact ? 0 : 1,
      rawIncidentAtMs: isExact ? new Date(c.incidentAt).getTime() : 0,
    };
  });

  processed.sort((a, b) => {
    if (a.timeDistanceMs !== b.timeDistanceMs) {
      return a.timeDistanceMs - b.timeDistanceMs;
    }
    if (a.timeBasisPriority !== b.timeBasisPriority) {
      return a.timeBasisPriority - b.timeBasisPriority;
    }
    if (a.timeBasis === 'EXACT' && a.rawIncidentAtMs !== b.rawIncidentAtMs) {
      return a.rawIncidentAtMs - b.rawIncidentAtMs;
    }
    return (a.incidentNumber || '').localeCompare(b.incidentNumber || '');
  });

  const matches = processed.slice(0, DUPLICATE_CHECK_MAX_RESULTS).map((m) => ({
    incidentId: m.incidentId,
    incidentNumber: m.incidentNumber,
    incidentAt: m.incidentAt,
    incidentDate: m.incidentDate,
    timeBasis: m.timeBasis,
    governorate: m.governorate,
    matchedPlates: m.matchedPlates,
    distanceKm: m.distanceKm,
    claimsCount: m.claimsCount,
  }));

  return {
    windowHours: 24,
    checkedAt: new Date().toISOString(),
    matches,
    truncated,
  };
};

module.exports = {
  deriveIncidentDate,
  formatVehicle,
  formatParty,
  formatDamagedItem,
  createIncident,
  getIncidents,
  getIncidentById,
  addVehicle,
  addParty,
  addDamagedItem,
  patchReport,
  getCoverageSuggestions,
  checkDuplicates,
};

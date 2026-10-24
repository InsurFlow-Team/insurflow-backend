const mongoose = require('mongoose');
const incidentRepository = require('./incident.repository');
const claimRepository = require('../claims/claim.repository');
const vehicleRepository = require('../vehicles/vehicle.repository');
const policyRepository = require('../policies/policy.repository');
const { assertPolicyCoverage, getEligibleClaimantParties } = require('../claims/claim.service');
const { getPolicyPeriodViolation } = require('../../utils/policyPeriod');
const AppError = require('../../utils/appError');

const { deriveIncidentDate } = require('../../utils/hebronDate');

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
};

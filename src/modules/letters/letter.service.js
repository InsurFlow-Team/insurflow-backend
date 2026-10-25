const Letter = require('./letter.model');
const letterRepository = require('./letter.repository');
const { generateLetterPdf } = require('./letter.pdf');
const Claim = require('../claims/claim.model');
const Organization = require('../organizations/organization.model');
const Customer = require('../customers/customer.model');
const Vehicle = require('../vehicles/vehicle.model');
const incidentRepository = require('../incidents/incident.repository');
const Counter = require('../../utils/counter.model');
const AppError = require('../../utils/appError');
const config = require('../../config/env');
const { toHebronDate } = require('../../utils/hebronDate');

/**
 * Resolves the addressee name for a letter per approved fallback order (Q1):
 * 1. Incident claimant party (when claimantPartyId resolves)
 * 2. Vehicle customer (from claim.vehicle.customerId)
 * 3. Vehicle's customer (from vehicle.vehicleId lookup)
 * 4. Claim customer name string (claim.customer.name)
 * 5. Throws 422 ADDRESSEE_NOT_FOUND if unresolved.
 */
const resolveAddressee = async (claim, organizationId) => {
  let addresseeName = null;

  // 1. Claimant party on incident
  if (claim.claimantPartyId && claim.incidentId) {
    const incident = await incidentRepository.findByIdAndOrganization(claim.incidentId, organizationId);
    const party = (incident?.parties || []).find(
      (p) => p._id.toString() === claim.claimantPartyId.toString()
    );
    if (party && party.fullName) {
      addresseeName = party.fullName;
    }
  }

  // 2. Vehicle customer from claim
  if (!addresseeName && claim.vehicle?.customerId) {
    const customer = await Customer.findOne({
      _id: claim.vehicle.customerId,
      organizationId,
    }).lean();
    if (customer && customer.fullName) {
      addresseeName = customer.fullName;
    }
  }

  // 3. Vehicle record customer lookup
  if (!addresseeName && claim.vehicle?.vehicleId) {
    const vehicle = await Vehicle.findOne({
      _id: claim.vehicle.vehicleId,
      organizationId,
    }).lean();
    if (vehicle && vehicle.customerId) {
      const custId = vehicle.customerId._id || vehicle.customerId;
      const customer = await Customer.findOne({
        _id: custId,
        organizationId,
      }).lean();
      if (customer && customer.fullName) {
        addresseeName = customer.fullName;
      }
    }
  }

  // 4. Fallback to claim.customer.name string
  if (!addresseeName && claim.customer?.name) {
    addresseeName = claim.customer.name;
  }

  if (!addresseeName) {
    throw new AppError('Addressee not found for letter issuance', 422, 'ADDRESSEE_NOT_FOUND');
  }

  return addresseeName;
};

/**
 * Resolves the incident date per Assumption A3:
 * Incident's incidentDate, falling back to claim's incidentDate.
 */
const resolveIncidentDate = async (claim, organizationId) => {
  let incidentDate = null;
  if (claim.incidentId) {
    const incident = await incidentRepository.findByIdAndOrganization(claim.incidentId, organizationId);
    if (incident?.incidentDate) {
      incidentDate = incident.incidentDate;
    }
  }
  if (!incidentDate) {
    incidentDate = claim.incidentDate || claim.accident?.accidentDate || null;
  }
  if (incidentDate && incidentDate instanceof Date) {
    incidentDate = toHebronDate(incidentDate);
  }
  return incidentDate || 'N/A';
};

/**
 * Generates an atomic sequential letter number per organization per year.
 */
const getNextLetterNumber = async (organizationId, orgCode, issuedAt) => {
  const issueDateStr = toHebronDate(issuedAt);
  const year = issueDateStr.split('-')[0];

  const counter = await Counter.findOneAndUpdate(
    { _id: `letter:${organizationId}:${year}` },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );

  const seqPadded = String(counter.seq).padStart(4, '0');
  return {
    letterNumber: `LTR-${orgCode}-${year}-${seqPadded}`,
    issueDate: issueDateStr,
  };
};

/**
 * Issues an official letter (APPROVAL or REJECTION) for a claim.
 */
const issueLetter = async (claimId, body, authUser) => {
  const { organizationId, role, userId } = authUser;

  // 1. Role verification (defense in depth)
  if (!['ADMIN', 'CLAIMS_OFFICER'].includes(role)) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN_RESOURCE');
  }

  // 2. Tenant-scoped claim lookup
  const claim = await Claim.findOne({ _id: claimId, organizationId }).lean();
  if (!claim) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  // 3. Preconditions (Rule R5)
  if (body.type === 'APPROVAL') {
    if (!['APPROVED', 'CLOSED'].includes(claim.status) || !claim.lossAssessment) {
      throw new AppError(
        'Approval letter is only available for APPROVED or CLOSED claims with loss assessment.',
        409,
        'INVALID_STATUS_TRANSITION'
      );
    }
  } else if (body.type === 'REJECTION') {
    if (claim.status !== 'REJECTED') {
      throw new AppError(
        'Rejection letter is only available for REJECTED claims.',
        409,
        'INVALID_STATUS_TRANSITION'
      );
    }
  }

  // 4. Supersede validation (Rule R4, Assumption A5)
  let supersedesLetterId = null;
  if (body.supersedesLetterNumber) {
    const priorLetter = await letterRepository.findByNumber(
      organizationId,
      claimId,
      body.supersedesLetterNumber
    );

    if (!priorLetter) {
      throw new AppError('Letter to supersede not found on this claim', 422, 'SUPERSEDE_INVALID');
    }

    if (priorLetter.type !== body.type) {
      throw new AppError('Cannot supersede letter of a different type', 422, 'SUPERSEDE_INVALID');
    }

    const alreadySuperseded = await letterRepository.isSuperseded(organizationId, priorLetter._id);
    if (alreadySuperseded) {
      throw new AppError('The target letter has already been superseded', 422, 'SUPERSEDE_INVALID');
    }

    supersedesLetterId = priorLetter._id;
  }

  // 5. Domain data resolution
  const org = await Organization.findById(organizationId).lean();
  const orgCode = org?.code || 'ORG';
  const orgName = org?.name || 'InsurFlow Insurance';
  const issuedAt = new Date();

  const addresseeName = await resolveAddressee(claim, organizationId);
  const incidentDate = await resolveIncidentDate(claim, organizationId);
  const plateNumber = claim.vehicle?.plateNumber || 'N/A';

  const { letterNumber, issueDate } = await getNextLetterNumber(organizationId, orgCode, issuedAt);

  // 6. Frozen snapshot compilation (Rule R3)
  const snapshot = {
    letterhead: {
      organizationName: orgName,
      address: org?.settings?.letterhead?.address || null,
      phone: org?.settings?.letterhead?.phone || null,
    },
    letterNumber,
    issueDate,
    type: body.type,
    addresseeName,
    claimNumber: claim.claimNumber,
    plateNumber,
    incidentDate,
    financials:
      body.type === 'APPROVAL' && claim.lossAssessment
        ? {
            totalDamage: claim.lossAssessment.totalDamage,
            deductibleApplied: claim.lossAssessment.deductibleApplied,
            netApprovedPayout: claim.lossAssessment.netApprovedPayout,
          }
        : null,
    currency: config.currency,
    reason: body.type === 'REJECTION' ? body.reason : null,
    issuer: {
      name: authUser.name || (role === 'ADMIN' ? 'Admin' : 'Claims Officer'),
      role,
    },
  };

  // 7. Persist letter (with C2 unique partial index error mapping)
  try {
    const created = await letterRepository.create({
      organizationId,
      claimId,
      letterNumber,
      type: body.type,
      supersedesLetterId,
      snapshot,
      issuedBy: userId,
      issuedByRole: role,
      issuedAt,
    });

    return {
      id: created._id.toString(),
      letterNumber: created.letterNumber,
      type: created.type,
      claimId: created.claimId.toString(),
      supersedesLetterId: created.supersedesLetterId ? created.supersedesLetterId.toString() : null,
      issuedAt: created.issuedAt,
      issuedBy: created.issuedBy.toString(),
      issuedByRole: created.issuedByRole,
      snapshot: created.snapshot,
    };
  } catch (err) {
    if (err.code === 11000 && err.keyPattern?.supersedesLetterId) {
      throw new AppError('The target letter has already been superseded', 422, 'SUPERSEDE_INVALID');
    }
    throw err;
  }
};

/**
 * Lists all letters for a claim, newest first, with computed superseded flag.
 */
const getLetters = async (claimId, authUser) => {
  const { organizationId, role } = authUser;

  if (!['ADMIN', 'CLAIMS_OFFICER'].includes(role)) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN_RESOURCE');
  }

  const claim = await Claim.findOne({ _id: claimId, organizationId }).lean();
  if (!claim) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  const letters = await letterRepository.findByClaim(organizationId, claimId);

  // Compute superseded boolean for each letter
  const supersededIds = new Set(
    letters
      .map((l) => l.supersedesLetterId?.toString())
      .filter(Boolean)
  );

  return letters.map((l) => ({
    id: l._id.toString(),
    letterNumber: l.letterNumber,
    type: l.type,
    claimId: l.claimId.toString(),
    supersedesLetterId: l.supersedesLetterId ? l.supersedesLetterId.toString() : null,
    superseded: supersededIds.has(l._id.toString()),
    issuedAt: l.issuedAt,
    issuedBy: l.issuedBy.toString(),
    issuedByRole: l.issuedByRole,
    snapshot: l.snapshot,
  }));
};

/**
 * Streams the PDF rendered dynamically from the letter's frozen snapshot.
 */
const getLetterPdf = async (claimId, letterNumber, authUser) => {
  const { organizationId, role } = authUser;

  if (!['ADMIN', 'CLAIMS_OFFICER'].includes(role)) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN_RESOURCE');
  }

  const claim = await Claim.findOne({ _id: claimId, organizationId }).lean();
  if (!claim) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }

  const letter = await letterRepository.findByNumber(organizationId, claimId, letterNumber);
  if (!letter) {
    throw new AppError('Letter not found', 404, 'LETTER_NOT_FOUND');
  }

  const buffer = await generateLetterPdf(letter.snapshot);
  return {
    buffer,
    letterNumber: letter.letterNumber,
  };
};

module.exports = {
  issueLetter,
  getLetters,
  getLetterPdf,
  resolveAddressee,
  resolveIncidentDate,
  getNextLetterNumber,
};

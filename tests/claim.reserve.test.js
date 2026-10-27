const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const Policy = require('../src/modules/policies/policy.model');
const Customer = require('../src/modules/customers/customer.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Incident = require('../src/modules/incidents/incident.model');
const { buildPolicy } = require('./helpers/policyFactory');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');

jest.mock('../src/modules/notifications/notification.service', () => ({
  createAndSendNotification: jest.fn().mockResolvedValue({}),
  sendToOrganization: jest.fn().mockResolvedValue({}),
}));

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany();
  }
});

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

describe('PB-13: Outstanding Reserve per Claim, Indemnity and Expense', () => {
  let org1, org2, orgNoSettings;
  let officer1, officer2, admin1, adjuster1;
  let officer1Token, officer2Token, admin1Token, adjuster1Token;
  let policy1, customer1, vehicle1;

  beforeEach(async () => {
    org1 = await Organization.create({
      name: 'Alpha Insurance',
      code: 'ALPHA',
      settings: {
        reserveDefaults: {
          OWN_DAMAGE: { indemnity: 500000, expense: 50000 },
          THIRD_PARTY_PD: { indemnity: 500000, expense: 50000 },
        },
      },
    });

    org2 = await Organization.create({
      name: 'Beta Insurance',
      code: 'BETA',
      settings: {
        reserveDefaults: {
          OWN_DAMAGE: { indemnity: 600000, expense: 60000 },
          THIRD_PARTY_PD: { indemnity: 600000, expense: 60000 },
        },
      },
    });

    // Organization with raw unset settings for fallback testing
    const orgNoSettingsId = new mongoose.Types.ObjectId();
    await Organization.collection.insertOne({
      _id: orgNoSettingsId,
      name: 'Gamma Insurance Raw',
      code: 'GAMMA',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    orgNoSettings = await Organization.findById(orgNoSettingsId);

    officer1 = await User.create({
      name: 'Officer One',
      employeeCode: 'OFF-01',
      password: 'Password123!',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    officer1Token = generateToken(officer1);

    officer2 = await User.create({
      name: 'Officer Two',
      employeeCode: 'OFF-02',
      password: 'Password123!',
      role: 'CLAIMS_OFFICER',
      organizationId: org2._id,
      status: 'ACTIVE',
    });
    officer2Token = generateToken(officer2);

    admin1 = await User.create({
      name: 'Admin One',
      employeeCode: 'ADM-01',
      password: 'Password123!',
      role: 'ADMIN',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    admin1Token = generateToken(admin1);

    adjuster1 = await User.create({
      name: 'Adjuster One',
      employeeCode: 'ADJ-01',
      password: 'Password123!',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'DEMO-ADJ-01',
      surveyorLicenseExpiry: '2027-12-31',
    });
    adjuster1Token = generateToken(adjuster1);

    customer1 = await Customer.create({
      fullName: 'Yousef Mansour',
      phone: '+970599112233',
      organizationId: org1._id,
    });

    policy1 = await buildPolicy({
      policyNumber: 'POL-ALPHA-001',
      policyKind: 'COMPLEMENTARY',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION', 'THEFT'],
      deductibleAmount: 50000,
      sumInsured: 5000000,
      startDate: new Date('2025-01-01'),
      expiryDate: new Date('2027-12-31'),
      organizationId: org1._id,
    });

    vehicle1 = await Vehicle.create({
      plateNumber: '7788-A',
      make: 'Hyundai',
      model: 'Tucson',
      year: 2022,
      color: 'Silver',
      customerId: customer1._id,
      complementaryPolicyId: policy1._id,
      organizationId: org1._id,
    });
  });

  const createClaimWithReserve = async (orgId, creatorId, status = 'UNDER_REVIEW', initialIndemnity = 500000, initialExpense = 50000) => {
    let pol = await Policy.findOne({ organizationId: orgId });
    if (!pol) {
      pol = await buildPolicy({
        policyNumber: `POL-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        status: 'ACTIVE',
        policyKind: 'COMPLEMENTARY',
        policyType: 'COMPREHENSIVE',
        coveredPerils: ['COLLISION'],
        deductibleAmount: 50000,
        sumInsured: 5000000,
        startDate: new Date('2025-01-01'),
        expiryDate: new Date('2027-12-31'),
        organizationId: orgId,
      });
    }

    const claim = await Claim.create({
      organizationId: orgId,
      policyId: pol._id,
      createdBy: creatorId,
      status,
      customer: { name: 'Customer Test', phone: '+970599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      vehicle: { plateNumber: '1122-B' },
      reserve: {
        indemnity: initialIndemnity,
        expense: initialExpense,
        history: [
          {
            category: 'INDEMNITY',
            previousAmount: null,
            newAmount: initialIndemnity,
            source: 'INITIAL',
            reason: null,
            performedBy: creatorId,
            role: 'CLAIMS_OFFICER',
            at: new Date(),
          },
          {
            category: 'EXPENSE',
            previousAmount: null,
            newAmount: initialExpense,
            source: 'INITIAL',
            reason: null,
            performedBy: creatorId,
            role: 'CLAIMS_OFFICER',
            at: new Date(),
          },
        ],
      },
      timeline: [
        {
          action: 'Claim Created',
          previousStatus: null,
          newStatus: null,
          notes: null,
          performedBy: creatorId,
          role: 'CLAIMS_OFFICER',
          timestamp: new Date(),
        },
      ],
    });
    return claim;
  };

  it('initial reserve from organization defaults on POST /claims', async () => {
    const res = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        policyId: policy1._id.toString(),
        plateNumber: '7788-A',
        incidentDate: '2026-05-10',
        incidentType: 'COLLISION',
        incidentLocation: 'Ramallah Main St',
        description: 'Bumper collision',
      });

    expect(res.status).toBe(201);
    const createdClaim = await Claim.findById(res.body.data.id);
    expect(createdClaim.reserve).toBeDefined();
    expect(createdClaim.reserve.indemnity).toBe(500000);
    expect(createdClaim.reserve.expense).toBe(50000);
    expect(createdClaim.reserve.history).toHaveLength(2);

    const indHist = createdClaim.reserve.history.find((h) => h.category === 'INDEMNITY');
    expect(indHist.previousAmount).toBeNull();
    expect(indHist.newAmount).toBe(500000);
    expect(indHist.source).toBe('INITIAL');
    expect(indHist.performedBy.toString()).toBe(officer1._id.toString());
    expect(indHist.role).toBe('CLAIMS_OFFICER');

    const expHist = createdClaim.reserve.history.find((h) => h.category === 'EXPENSE');
    expect(expHist.previousAmount).toBeNull();
    expect(expHist.newAmount).toBe(50000);
    expect(expHist.source).toBe('INITIAL');
  });

  it('initial reserve from organization defaults on sub-claim POST /incidents/:id/claims', async () => {
    const incident = await Incident.create({
      organizationId: org1._id,
      incidentNumber: 'INC-ALPHA-0001',
      incidentDate: '2026-05-10',
      incidentType: 'COLLISION',
      incidentLocation: 'Hebron Road',
      createdBy: officer1._id,
      vehicles: [
        {
          vehicleRole: 'INSURED',
          vehicleId: vehicle1._id,
          plateNumber: '7788-A',
          plateRegion: 'PALESTINIAN',
        },
      ],
      parties: [
        {
          role: 'POLICYHOLDER',
          partyType: 'PERSON',
          fullName: 'Yousef Mansour',
          phone: '+970599112233',
          vehicleRef: null,
        },
      ],
    });

    const subjectVehicle = incident.vehicles[0];
    incident.parties[0].vehicleRef = subjectVehicle._id;
    await incident.save();
    const claimantParty = incident.parties[0];

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy1._id.toString(),
        plateNumber: '7788-A',
        claimantPartyId: claimantParty._id.toString(),
        subjectRef: subjectVehicle._id.toString(),
      });

    expect(res.status).toBe(201);
    const subClaim = await Claim.findById(res.body.data.id);
    expect(subClaim.reserve).toBeDefined();
    expect(subClaim.reserve.indemnity).toBe(500000);
    expect(subClaim.reserve.expense).toBe(50000);
    expect(subClaim.reserve.history).toHaveLength(2);
  });

  it('organization without settings falls back to the schema default', async () => {
    const rawOfficer = await User.create({
      name: 'Gamma Officer',
      employeeCode: 'GAMMA-01',
      password: 'Password123!',
      role: 'CLAIMS_OFFICER',
      organizationId: orgNoSettings._id,
      status: 'ACTIVE',
    });
    const rawToken = generateToken(rawOfficer);

    const rawPol = await buildPolicy({
      policyNumber: 'POL-GAMMA-001',
      policyKind: 'COMPLEMENTARY',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      deductibleAmount: 50000,
      sumInsured: 5000000,
      startDate: new Date('2025-01-01'),
      expiryDate: new Date('2027-12-31'),
      organizationId: orgNoSettings._id,
    });

    const rawCust = await Customer.create({
      fullName: 'Gamma Customer',
      phone: '+970599887766',
      organizationId: orgNoSettings._id,
    });

    await Vehicle.create({
      plateNumber: '9900-G',
      make: 'Kia',
      model: 'Sportage',
      year: 2023,
      customerId: rawCust._id,
      complementaryPolicyId: rawPol._id,
      organizationId: orgNoSettings._id,
    });

    const res = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${rawToken}`)
      .send({
        policyId: rawPol._id.toString(),
        plateNumber: '9900-G',
        incidentDate: '2026-05-10',
        incidentType: 'COLLISION',
        incidentLocation: 'Nablus Main St',
      });

    expect(res.status).toBe(201);
    const claim = await Claim.findById(res.body.data.id);
    expect(claim.reserve.indemnity).toBe(500000);
    expect(claim.reserve.expense).toBe(50000);
  });

  it('manual adjustment success with history entry and timeline event', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'IN_PROGRESS', 500000, 50000);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/reserve-adjustments`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        category: 'INDEMNITY',
        expectedAmount: 5000.0,
        newAmount: 6500.0,
        reason: 'Surveyor initial report indicates higher body damage',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.indemnity).toBe(6500.0);
    expect(res.body.data.expense).toBe(500.0);
    expect(res.body.data.total).toBe(7000.0);

    const dbClaim = await Claim.findById(claim._id);
    expect(dbClaim.reserve.indemnity).toBe(650000);
    expect(dbClaim.reserve.expense).toBe(50000);

    const lastHistory = dbClaim.reserve.history[dbClaim.reserve.history.length - 1];
    expect(lastHistory.category).toBe('INDEMNITY');
    expect(lastHistory.previousAmount).toBe(500000);
    expect(lastHistory.newAmount).toBe(650000);
    expect(lastHistory.source).toBe('MANUAL');
    expect(lastHistory.reason).toBe('Surveyor initial report indicates higher body damage');
    expect(lastHistory.performedBy.toString()).toBe(officer1._id.toString());
    expect(lastHistory.role).toBe('CLAIMS_OFFICER');

    const lastTimeline = dbClaim.timeline[dbClaim.timeline.length - 1];
    expect(lastTimeline.action).toBe('Reserve Adjusted');
    expect(lastTimeline.previousStatus).toBe('IN_PROGRESS');
    expect(lastTimeline.newStatus).toBe('IN_PROGRESS');
    expect(lastTimeline.notes).toBe('INDEMNITY 5000 to 6500: Surveyor initial report indicates higher body damage');
  });

  it('stale expectedAmount gives 409 RESERVE_CHANGED', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'IN_PROGRESS', 500000, 50000);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/reserve-adjustments`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        category: 'INDEMNITY',
        expectedAmount: 4000.0, // Stale: actual is 5000.0
        newAmount: 6000.0,
        reason: 'Trying to adjust with outdated expected reserve amount',
      });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('RESERVE_CHANGED');
  });

  it('concurrent adjustments give one success and one 409 RESERVE_CHANGED', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'IN_PROGRESS', 500000, 50000);

    const req1 = request(app)
      .post(`/api/v1/claims/${claim._id}/reserve-adjustments`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        category: 'INDEMNITY',
        expectedAmount: 5000.0,
        newAmount: 6000.0,
        reason: 'Concurrent adjustment one from officer',
      });

    const req2 = request(app)
      .post(`/api/v1/claims/${claim._id}/reserve-adjustments`)
      .set('Authorization', `Bearer ${admin1Token}`)
      .send({
        category: 'INDEMNITY',
        expectedAmount: 5000.0,
        newAmount: 7000.0,
        reason: 'Concurrent adjustment two from administrator',
      });

    const [res1, res2] = await Promise.all([req1, req2]);
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const failedRes = res1.status === 409 ? res1 : res2;
    expect(failedRes.body.errors[0].code).toBe('RESERVE_CHANGED');
  });

  it('newAmount equal to expectedAmount gives 400 VALIDATION_ERROR', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'IN_PROGRESS', 500000, 50000);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/reserve-adjustments`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        category: 'INDEMNITY',
        expectedAmount: 5000.0,
        newAmount: 5000.0,
        reason: 'Same amount should fail validation test',
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('negative amount gives 400 VALIDATION_ERROR', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'IN_PROGRESS', 500000, 50000);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/reserve-adjustments`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        category: 'INDEMNITY',
        expectedAmount: 5000.0,
        newAmount: -100.0,
        reason: 'Negative amount adjustment failure test',
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('amount with 3 decimal places gives 400 VALIDATION_ERROR', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'IN_PROGRESS', 500000, 50000);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/reserve-adjustments`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        category: 'INDEMNITY',
        expectedAmount: 5000.0,
        newAmount: 5500.555,
        reason: 'Three decimal places should fail validation',
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('short reason under 10 chars gives 400 VALIDATION_ERROR', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'IN_PROGRESS', 500000, 50000);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/reserve-adjustments`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        category: 'INDEMNITY',
        expectedAmount: 5000.0,
        newAmount: 6000.0,
        reason: 'short',
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('adjust on REJECTED claim gives 409 INVALID_STATUS_TRANSITION', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'REJECTED', 0, 0);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/reserve-adjustments`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        category: 'INDEMNITY',
        expectedAmount: 0.0,
        newAmount: 1000.0,
        reason: 'Attempting to adjust a rejected claim',
      });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('adjust on CLOSED claim gives 409 INVALID_STATUS_TRANSITION', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'CLOSED', 0, 0);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/reserve-adjustments`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        category: 'INDEMNITY',
        expectedAmount: 0.0,
        newAmount: 1000.0,
        reason: 'Attempting to adjust a closed claim',
      });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('FIELD_ADJUSTER receives 403 on GET /claims/:claimId/reserve', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'IN_PROGRESS', 500000, 50000);

    const res = await request(app)
      .get(`/api/v1/claims/${claim._id}/reserve`)
      .set('Authorization', `Bearer ${adjuster1Token}`);

    expect(res.status).toBe(403);
  });

  it('cross-tenant access returns 404 CLAIM_NOT_FOUND', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'IN_PROGRESS', 500000, 50000);

    // Org 2 officer tries to access Org 1 claim
    const getRes = await request(app)
      .get(`/api/v1/claims/${claim._id}/reserve`)
      .set('Authorization', `Bearer ${officer2Token}`);

    expect(getRes.status).toBe(404);
    expect(getRes.body.errors[0].code).toBe('CLAIM_NOT_FOUND');

    const postRes = await request(app)
      .post(`/api/v1/claims/${claim._id}/reserve-adjustments`)
      .set('Authorization', `Bearer ${officer2Token}`)
      .send({
        category: 'INDEMNITY',
        expectedAmount: 5000.0,
        newAmount: 6000.0,
        reason: 'Cross-tenant adjustment attempt should return 404',
      });

    expect(postRes.status).toBe(404);
    expect(postRes.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  it('legacy claim with null reserve adjusted with expectedAmount null', async () => {
    const legacyClaimId = new mongoose.Types.ObjectId();
    await Claim.collection.insertOne({
      _id: legacyClaimId,
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      status: 'IN_PROGRESS',
      customer: { name: 'Legacy Customer', phone: '+970599111111' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      vehicle: { plateNumber: '3344-L' },
      timeline: [],
    });

    // Read legacy claim reserve: should return null amounts
    const getRes = await request(app)
      .get(`/api/v1/claims/${legacyClaimId}/reserve`)
      .set('Authorization', `Bearer ${officer1Token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.indemnity).toBeNull();
    expect(getRes.body.data.expense).toBeNull();
    expect(getRes.body.data.total).toBeNull();

    // Adjust with expectedAmount null
    const adjustRes = await request(app)
      .post(`/api/v1/claims/${legacyClaimId}/reserve-adjustments`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        category: 'INDEMNITY',
        expectedAmount: null,
        newAmount: 5000.0,
        reason: 'Setting initial reserve on legacy claim without reserve',
      });

    expect(adjustRes.status).toBe(200);
    expect(adjustRes.body.data.indemnity).toBe(5000.0);

    const updated = await Claim.findById(legacyClaimId);
    expect(updated.reserve.indemnity).toBe(500000);
    expect(updated.reserve.history[0].previousAmount).toBeNull();
    expect(updated.reserve.history[0].newAmount).toBe(500000);
  });

  it('APPROVED decision sets indemnity to netApprovedPayout with a DECISION history entry', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'UNDER_REVIEW', 500000, 50000);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/decision`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        decision: 'APPROVED',
        notes: 'Approved after surveyor inspection verification',
        lossAssessment: {
          estimatedPartsCost: 2000.0,
          laborCost: 1000.0,
          deductibleApplied: 500.0,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');

    const dbClaim = await Claim.findById(claim._id);
    expect(dbClaim.reserve.indemnity).toBe(250000); // netApprovedPayout = (2000 + 1000 - 500) = 2500.00 ILS = 250000 minor
    expect(dbClaim.reserve.expense).toBe(50000); // Expense unchanged

    const decHist = dbClaim.reserve.history.find((h) => h.source === 'DECISION');
    expect(decHist).toBeDefined();
    expect(decHist.category).toBe('INDEMNITY');
    expect(decHist.previousAmount).toBe(500000);
    expect(decHist.newAmount).toBe(250000);
    expect(decHist.performedBy.toString()).toBe(officer1._id.toString());
  });

  it('REJECTED decision zeroes indemnity and expense with STATUS_ZERO history entries', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'UNDER_REVIEW', 500000, 50000);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/decision`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        decision: 'REJECTED',
        notes: 'Incident outside policy coverage terms',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REJECTED');

    const dbClaim = await Claim.findById(claim._id);
    expect(dbClaim.reserve.indemnity).toBe(0);
    expect(dbClaim.reserve.expense).toBe(0);

    const statusZeroEntries = dbClaim.reserve.history.filter((h) => h.source === 'STATUS_ZERO');
    expect(statusZeroEntries).toHaveLength(2);

    const indZero = statusZeroEntries.find((h) => h.category === 'INDEMNITY');
    expect(indZero.previousAmount).toBe(500000);
    expect(indZero.newAmount).toBe(0);

    const expZero = statusZeroEntries.find((h) => h.category === 'EXPENSE');
    expect(expZero.previousAmount).toBe(50000);
    expect(expZero.newAmount).toBe(0);
  });

  it('CLOSED claim zeroes indemnity and expense with STATUS_ZERO history entries', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'APPROVED', 250000, 50000);
    await Claim.findByIdAndUpdate(claim._id, { lossAssessment: { netApprovedPayout: 250000 }, 'paidTotals.indemnity': 250000 });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/close`)
      .set('Authorization', `Bearer ${admin1Token}`)
      .send({
        closingNotes: 'All repair work finished and claim closed by administrator',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CLOSED');

    const dbClaim = await Claim.findById(claim._id);
    expect(dbClaim.reserve.indemnity).toBe(0);
    expect(dbClaim.reserve.expense).toBe(0);

    const closeEntries = dbClaim.reserve.history.filter((h) => h.source === 'STATUS_ZERO');
    expect(closeEntries).toHaveLength(2);

    const indZero = closeEntries.find((h) => h.category === 'INDEMNITY');
    expect(indZero.previousAmount).toBe(250000);
    expect(indZero.newAmount).toBe(0);

    const expZero = closeEntries.find((h) => h.category === 'EXPENSE');
    expect(expZero.previousAmount).toBe(50000);
    expect(expZero.newAmount).toBe(0);
  });

  it('GET /claims/:claimId/reserve returns major units and history newest first for CLAIMS_OFFICER', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'IN_PROGRESS', 500000, 50000);

    // Adjust expense
    await request(app)
      .post(`/api/v1/claims/${claim._id}/reserve-adjustments`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        category: 'EXPENSE',
        expectedAmount: 500.0,
        newAmount: 800.0,
        reason: 'Towing invoice exceeds initial estimation',
      });

    const res = await request(app)
      .get(`/api/v1/claims/${claim._id}/reserve`)
      .set('Authorization', `Bearer ${officer1Token}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.indemnity).toBe(5000.0);
    expect(data.expense).toBe(800.0);
    expect(data.total).toBe(5800.0);
    expect(data.currency).toBe('ILS');

    // History newest first
    expect(data.history).toHaveLength(3);
    expect(data.history[0].source).toBe('MANUAL');
    expect(data.history[0].category).toBe('EXPENSE');
    expect(data.history[0].newAmount).toBe(800.0);
    expect(data.history[0].performedBy).toEqual({
      id: officer1._id.toString(),
      name: officer1.name,
      employeeCode: officer1.employeeCode,
    });
  });

  it('GET /claims/:claimId/reserve returns major units for ADMIN', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'IN_PROGRESS', 500000, 50000);

    const res = await request(app)
      .get(`/api/v1/claims/${claim._id}/reserve`)
      .set('Authorization', `Bearer ${admin1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.indemnity).toBe(5000.0);
    expect(res.body.data.expense).toBe(500.0);
    expect(res.body.data.total).toBe(5500.0);
  });

  it('GET /claims/stats includes outstandingReserve in major units for CLAIMS_OFFICER and ADMIN', async () => {
    // 2 open claims
    await createClaimWithReserve(org1._id, officer1._id, 'NEW', 500000, 50000);
    await createClaimWithReserve(org1._id, officer1._id, 'IN_PROGRESS', 300000, 30000);

    const res = await request(app)
      .get('/api/v1/claims/stats')
      .set('Authorization', `Bearer ${officer1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.outstandingReserve).toBeDefined();
    // 5000.00 + 3000.00 = 8000.00
    expect(res.body.data.outstandingReserve.indemnity).toBe(8000.0);
    // 500.00 + 300.00 = 800.00
    expect(res.body.data.outstandingReserve.expense).toBe(800.0);
    expect(res.body.data.outstandingReserve.total).toBe(8800.0);

    const adminRes = await request(app)
      .get('/api/v1/claims/stats')
      .set('Authorization', `Bearer ${admin1Token}`);

    expect(adminRes.status).toBe(200);
    expect(adminRes.body.data.outstandingReserve).toEqual(res.body.data.outstandingReserve);
  });

  it('GET /claims/stats excludes REJECTED and CLOSED claims from outstandingReserve', async () => {
    await createClaimWithReserve(org1._id, officer1._id, 'IN_PROGRESS', 400000, 40000);
    await createClaimWithReserve(org1._id, officer1._id, 'REJECTED', 0, 0);
    await createClaimWithReserve(org1._id, officer1._id, 'CLOSED', 0, 0);

    const res = await request(app)
      .get('/api/v1/claims/stats')
      .set('Authorization', `Bearer ${officer1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.outstandingReserve.indemnity).toBe(4000.0);
    expect(res.body.data.outstandingReserve.expense).toBe(400.0);
    expect(res.body.data.outstandingReserve.total).toBe(4400.0);
  });

  it('GET /claims/stats hides outstandingReserve from FIELD_ADJUSTER', async () => {
    await createClaimWithReserve(org1._id, officer1._id, 'IN_PROGRESS', 500000, 50000);

    const officerRes = await request(app)
      .get('/api/v1/claims/stats')
      .set('Authorization', `Bearer ${officer1Token}`);
    expect(officerRes.status).toBe(200);
    expect(officerRes.body.data.outstandingReserve).toBeDefined();

    const res = await request(app)
      .get('/api/v1/claims/stats')
      .set('Authorization', `Bearer ${adjuster1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.outstandingReserve).toBeUndefined();
  });

  it('C1, C2: a reason or notes starting with \'$\' is stored as literal text in history and timeline', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'UNDER_REVIEW', 500000, 50000);

    const dollarReason = '$status changed by financial audit team';
    const adjRes = await request(app)
      .post(`/api/v1/claims/${claim._id}/reserve-adjustments`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        category: 'INDEMNITY',
        expectedAmount: 5000.0,
        newAmount: 5800.0,
        reason: dollarReason,
      });

    expect(adjRes.status).toBe(200);
    const claimAfterAdj = await Claim.findById(claim._id);
    const lastHist = claimAfterAdj.reserve.history[claimAfterAdj.reserve.history.length - 1];
    expect(lastHist.reason).toBe(dollarReason);
    const lastTimeline = claimAfterAdj.timeline[claimAfterAdj.timeline.length - 1];
    expect(lastTimeline.notes).toContain(dollarReason);

    // Also test REJECTED pipeline with $ in notes
    const dollarNotes = '$where is the documentation? $rejected';
    const rejRes = await request(app)
      .post(`/api/v1/claims/${claim._id}/decision`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        decision: 'REJECTED',
        notes: dollarNotes,
      });

    expect(rejRes.status).toBe(200);
    const claimAfterRej = await Claim.findById(claim._id);
    expect(claimAfterRej.decisionNotes).toBe(dollarNotes);
    const rejHist = claimAfterRej.reserve.history.find((h) => h.reason === dollarNotes);
    expect(rejHist).toBeDefined();
    expect(rejHist.reason).toBe(dollarNotes);
  });

  it('C2: performedBy in decision and close history entries is stored as an ObjectId', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'UNDER_REVIEW', 500000, 50000);

    await request(app)
      .post(`/api/v1/claims/${claim._id}/decision`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        decision: 'APPROVED',
        notes: 'Verification passed',
        lossAssessment: {
          estimatedPartsCost: 2000.0,
          laborCost: 1000.0,
          deductibleApplied: 500.0,
        },
      });

    const approvedDoc = await Claim.collection.findOne({ _id: claim._id });
    const decHist = approvedDoc.reserve.history.find((h) => h.source === 'DECISION');
    expect(decHist.performedBy).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(decHist.performedBy.toString()).toBe(officer1._id.toString());

    // Close claim and check STATUS_ZERO performedBy
    await Claim.findByIdAndUpdate(claim._id, { 'paidTotals.indemnity': 250000 });
    await request(app)
      .post(`/api/v1/claims/${claim._id}/close`)
      .set('Authorization', `Bearer ${admin1Token}`)
      .send({ closingNotes: 'Done closing' });

    const closedDoc = await Claim.collection.findOne({ _id: claim._id });
    const closeHist = closedDoc.reserve.history.find((h) => h.source === 'STATUS_ZERO');
    expect(closeHist.performedBy).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(closeHist.performedBy.toString()).toBe(admin1._id.toString());
  });

  it('C2: decision and close on a legacy claim without reserve keep the timeline and add history', async () => {
    const legacyClaimId = new mongoose.Types.ObjectId();
    const existingTimelineEvent = {
      action: 'Initial Inspection Submitted',
      previousStatus: 'IN_PROGRESS',
      newStatus: 'UNDER_REVIEW',
      notes: 'Initial inspection notes preserved',
      performedBy: officer1._id,
      role: 'FIELD_ADJUSTER',
      timestamp: new Date('2026-05-01'),
    };

    await Claim.collection.insertOne({
      _id: legacyClaimId,
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      status: 'UNDER_REVIEW',
      customer: { name: 'Legacy Customer 2', phone: '+970599222222' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      vehicle: { plateNumber: '5566-L' },
      timeline: [existingTimelineEvent],
      // No reserve field!
    });

    // Reject the legacy claim
    const res = await request(app)
      .post(`/api/v1/claims/${legacyClaimId}/decision`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        decision: 'REJECTED',
        notes: 'Rejected legacy claim',
      });

    expect(res.status).toBe(200);

    const dbClaim = await Claim.findById(legacyClaimId);
    expect(dbClaim.status).toBe('REJECTED');
    expect(dbClaim.reserve.indemnity).toBe(0);
    expect(dbClaim.reserve.expense).toBe(0);

    // Verify existing timeline event was preserved and new one added
    expect(dbClaim.timeline.length).toBe(2);
    expect(dbClaim.timeline[0].action).toBe('Initial Inspection Submitted');
    expect(dbClaim.timeline[1].action).toBe('Claim Rejected');

    // Verify history added with previousAmount null
    expect(dbClaim.reserve.history.length).toBe(2);
    expect(dbClaim.reserve.history[0].previousAmount).toBeNull();
    expect(dbClaim.reserve.history[0].newAmount).toBe(0);
    expect(dbClaim.reserve.history[1].previousAmount).toBeNull();
    expect(dbClaim.reserve.history[1].newAmount).toBe(0);
  });

  it('C1: APPROVED decision stores lossAssessment.assessedBy as an ObjectId', async () => {
    const claim = await createClaimWithReserve(org1._id, officer1._id, 'UNDER_REVIEW', 500000, 50000);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/decision`)
      .set('Authorization', `Bearer ${officer1Token}`)
      .send({
        decision: 'APPROVED',
        notes: 'Verification passed',
        lossAssessment: {
          estimatedPartsCost: 2000.0,
          laborCost: 1000.0,
          deductibleApplied: 500.0,
        },
      });

    expect(res.status).toBe(200);

    const rawDoc = await mongoose.connection.db.collection('claims').findOne({ _id: claim._id });
    expect(rawDoc.lossAssessment).toBeDefined();
    expect(rawDoc.lossAssessment.assessedBy).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(rawDoc.lossAssessment.assessedBy.toString()).toBe(officer1._id.toString());
  });
});
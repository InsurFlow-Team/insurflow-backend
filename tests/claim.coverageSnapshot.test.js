const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Customer = require('../src/modules/customers/customer.model');
const Policy = require('../src/modules/policies/policy.model');
const { buildPolicy } = require('./helpers/policyFactory');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

describe('Claim Coverage Snapshot — Intake Persistence & Immutability', () => {
  let mongoServer;
  let org;
  let claimsOfficer;
  let officerToken;
  let customer;
  let comprehensivePolicy;
  let thirdPartyPolicy;
  let comprehensiveVehicle;
  let thirdPartyVehicle;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    org = await Organization.create({
      name: 'Snapshot Test Org',
      code: 'SNAP-ORG',
      domain: 'snap.com',
      status: 'ACTIVE',
    });

    claimsOfficer = await User.create({
      name: 'Snapshot Officer',
      employeeCode: 'SO-100',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    officerToken = generateToken(claimsOfficer);

    customer = await Customer.create({
      fullName: 'Ahmad Snapshot',
      phone: '+962791112233',
      organizationId: org._id,
    });

    comprehensivePolicy = await buildPolicy({
      policyNumber: 'POL-SNAP-COMP',
      status: 'ACTIVE',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
      deductibleAmount: 50000,
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2027-12-31T00:00:00Z'),
      organizationId: org._id,
    });

    thirdPartyPolicy = await buildPolicy({
      policyNumber: 'POL-SNAP-TP',
      status: 'ACTIVE',
      policyType: 'THIRD_PARTY',
      coveredPerils: [],
      deductibleAmount: 50000,
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2027-12-31T00:00:00Z'),
      organizationId: org._id,
    });

    comprehensiveVehicle = await Vehicle.create({
      plateNumber: 'COMP-1111',
      make: 'Toyota',
      model: 'RAV4',
      year: 2023,
      color: 'Silver',
      customerId: customer._id, complementaryPolicyId: comprehensivePolicy._id,
      organizationId: org._id,
    });

    thirdPartyVehicle = await Vehicle.create({
      plateNumber: 'TP-2222',
      make: 'Nissan',
      model: 'Micra',
      year: 2021,
      color: 'White',
      customerId: customer._id, compulsoryPolicyId: thirdPartyPolicy._id,
      organizationId: org._id,
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('should capture full coverageSnapshot when creating claim with COMPREHENSIVE policy', async () => {
    const res = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyId: comprehensivePolicy._id,
        plateNumber: 'COMP-1111',
        incidentType: 'COLLISION',
        incidentLocation: 'Amman - 7th Circle',
        incidentDate: '2026-06-15',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const claimId = res.body.data.id;

    // Verify persisted snapshot in database
    const claimDoc = await Claim.findById(claimId).lean();
    expect(claimDoc.coverageSnapshot).toBeDefined();
    expect(claimDoc.coverageSnapshot.policyKind).toBe('COMPLEMENTARY');
    expect(claimDoc.coverageSnapshot.policyType).toBe('COMPREHENSIVE');
    expect(claimDoc.coverageSnapshot.sumInsured).toBe(5000000);
    expect(claimDoc.coverageSnapshot.coveredPerils).toEqual([
      'COLLISION',
      'THEFT',
      'FIRE',
      'NATURAL_DISASTER',
    ]);
    expect(claimDoc.coverageSnapshot.deductibleAmount).toBe(50000);
    expect(claimDoc.coverageSnapshot.capturedAt).toBeDefined();

    // Verify GET /claims/:id response envelope
    const getRes = await request(app)
      .get(`/api/v1/claims/${claimId}`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.coverageSnapshot).toEqual({
      policyKind: 'COMPLEMENTARY',
      policyType: 'COMPREHENSIVE',
      sumInsured: 50000,
      coveredPerils: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
      deductibleAmount: 500,
      capturedAt: expect.any(String),
    });
  });

  it('rejects an OWN_DAMAGE claim on a UNIFIED_COMPULSORY policy with WRONG_POLICY_KIND', async () => {
    const res = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyId: thirdPartyPolicy._id,
        plateNumber: 'TP-2222',
        incidentType: 'COLLISION',
        incidentLocation: 'Zarqa Highway',
        incidentDate: '2026-07-01',
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('COVERAGE_NOT_APPLICABLE');
    expect(res.body.errors[0].reason).toBe('WRONG_POLICY_KIND');
  });

  it('should maintain immutable coverageSnapshot even if policy is modified after claim creation', async () => {
    // 1. Create claim under COMPREHENSIVE policy
    const createRes = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyId: comprehensivePolicy._id,
        plateNumber: 'COMP-1111',
        incidentType: 'COLLISION',
        incidentLocation: 'Queen Rania St',
        incidentDate: '2026-08-01',
      });

    expect(createRes.status).toBe(201);
    const claimId = createRes.body.data.id;

    // 2. Tamper with the policy document directly in DB
    await Policy.updateOne(
      { _id: comprehensivePolicy._id },
      { $set: { coveredPerils: ['THEFT'], deductibleAmount: 0, sumInsured: 100000 } }
    );

    // 3. Fetch claim — snapshot must remain pristine with intake conditions
    const getRes = await request(app)
      .get(`/api/v1/claims/${claimId}`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.coverageSnapshot.policyKind).toBe('COMPLEMENTARY');
    expect(getRes.body.data.coverageSnapshot.policyType).toBe('COMPREHENSIVE');
    expect(getRes.body.data.coverageSnapshot.deductibleAmount).toBe(500);
    expect(getRes.body.data.coverageSnapshot.sumInsured).toBe(50000);
    expect(getRes.body.data.coverageSnapshot.coveredPerils).toEqual([
      'COLLISION',
      'THEFT',
      'FIRE',
      'NATURAL_DISASTER',
    ]);

    // Restore policy for subsequent tests
    await Policy.updateOne(
      { _id: comprehensivePolicy._id },
      {
        $set: {
          policyType: 'COMPREHENSIVE',
          policyKind: 'COMPLEMENTARY',
          coveredPerils: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
          deductibleAmount: 50000,
          sumInsured: 5000000,
        },
      }
    );
  });

  it('rejects claim creation under a legacy policy without policyKind with POLICY_KIND_MISSING', async () => {
    const legacyPolicyId = new mongoose.Types.ObjectId();
    await Policy.collection.insertOne({
      _id: legacyPolicyId,
      policyNumber: 'POL-LEGACY-CLAIM-01',
      status: 'ACTIVE',
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2027-12-31T00:00:00Z'),
      organizationId: org._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await Vehicle.create({
      plateNumber: 'LEG-7777',
      make: 'Kia',
      model: 'Cerato',
      year: 2018,
      customerId: customer._id,
      complementaryPolicyId: legacyPolicyId,
      organizationId: org._id,
    });

    const res = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyId: legacyPolicyId.toString(),
        plateNumber: 'LEG-7777',
        incidentType: 'COLLISION',
        incidentLocation: 'Rainbow Street',
        incidentDate: '2026-05-10',
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('COVERAGE_NOT_APPLICABLE');
    expect(res.body.errors[0].reason).toBe('POLICY_KIND_MISSING');
  });

  it('should not expose coverageSnapshot in claims listing endpoint (GET /claims)', async () => {
    const res = await request(app)
      .get('/api/v1/claims')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const c of res.body.data) {
      expect(c.coverageSnapshot).toBeUndefined();
    }
  });
});

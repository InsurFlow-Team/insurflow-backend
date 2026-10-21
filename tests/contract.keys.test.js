const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Customer = require('../src/modules/customers/customer.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Claim = require('../src/modules/claims/claim.model');
const { buildPolicy } = require('./helpers/policyFactory');
const config = require('../src/config/env');

jest.mock('../src/modules/notifications/notification.service', () => ({
  createAndSendNotification: jest.fn().mockResolvedValue({}),
  sendToOrganization: jest.fn().mockResolvedValue({}),
}));

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

describe('API Contract Keys — Sorted Key Sets', () => {
  let mongoServer;
  let org, officer, officerToken, adjuster, adjusterToken;
  let customer, vehicle, eligiblePolicy, legacyPolicy;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    org = await Organization.create({
      name: 'Contract Test Org',
      code: 'CTORG',
      domain: 'ct.com',
      status: 'ACTIVE',
    });

    officer = await User.create({
      name: 'Contract Officer',
      employeeCode: 'CT-OF-01',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    officerToken = generateToken(officer);

    adjuster = await User.create({
      name: 'Contract Adjuster',
      employeeCode: 'CT-ADJ-01',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    adjusterToken = generateToken(adjuster);

    customer = await Customer.create({
      organizationId: org._id,
      fullName: 'Ahmad Contract',
      phone: '0599112233',
      nationalId: '123456789',
    });

    eligiblePolicy = await buildPolicy({
      policyNumber: 'POL-ELIGIBLE-001',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2025-01-01'),
      expiryDate: new Date('2027-12-31'),
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
      deductibleAmount: 500,
    });

    vehicle = await Vehicle.create({
      organizationId: org._id,
      policyId: eligiblePolicy._id,
      customerId: customer._id,
      plateNumber: '1234-A',
      make: 'Toyota',
      model: 'Corolla',
      year: 2022,
      color: 'White',
    });

    const Policy = require('../src/modules/policies/policy.model');
    const legacyPolicyId = new mongoose.Types.ObjectId();
    await Policy.collection.insertOne({
      _id: legacyPolicyId,
      policyNumber: 'POL-LEGACY-001',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2025-01-01'),
      expiryDate: new Date('2027-12-31'),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    legacyPolicy = await Policy.findById(legacyPolicyId);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  // 1. verify response data for an eligible policy
  it('1. verify response data key sets for an eligible policy', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyNumber: 'POL-ELIGIBLE-001',
        incidentDate: '2026-06-01',
        incidentType: 'COLLISION',
      });

    expect(res.status).toBe(200);
    const data = res.body.data;

    // data top level
    expect(Object.keys(data).sort()).toEqual(
      ['coverage', 'customer', 'eligibilityHint', 'isEligible', 'policy', 'vehicle'].sort()
    );

    // data.policy
    expect(Object.keys(data.policy).sort()).toEqual(
      ['coveredPerils', 'deductibleAmount', 'expiryDate', 'id', 'policyNumber', 'policyType', 'startDate', 'status'].sort()
    );

    // data.coverage
    expect(Object.keys(data.coverage).sort()).toEqual(
      ['deductible', 'effectiveFrom', 'effectiveTo', 'incidents', 'policyType'].sort()
    );

    // one data.coverage.incidents item
    expect(data.coverage.incidents.length).toBeGreaterThan(0);
    expect(Object.keys(data.coverage.incidents[0]).sort()).toEqual(
      ['code', 'covered'].sort()
    );

    // data.vehicle
    expect(Object.keys(data.vehicle).sort()).toEqual(
      ['color', 'id', 'make', 'model', 'plateNumber', 'year'].sort()
    );

    // data.customer
    expect(Object.keys(data.customer).sort()).toEqual(
      ['fullName', 'id', 'phone'].sort()
    );
  });

  // 2. verify response for a legacy policy (coverage is null)
  it('2. verify response for a legacy policy (coverage is null)', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyNumber: 'POL-LEGACY-001',
        incidentDate: '2026-06-01',
        incidentType: 'COLLISION',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.coverage).toBeNull();
    expect(Object.keys(res.body.data).sort()).toEqual(
      ['coverage', 'customer', 'eligibilityHint', 'isEligible', 'policy', 'vehicle'].sort()
    );
  });

  // 3. POST /claims response data
  let createdClaimId;
  let createdTrackingToken;

  it('3. POST /claims response data key set', async () => {
    const res = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyId: eligiblePolicy._id.toString(),
        plateNumber: '1234-A',
        incidentDate: '2026-06-01',
        incidentType: 'COLLISION',
        incidentLocation: 'Ramallah Main St',
        description: 'Front bumper damage',
        latitude: 31.9038,
        longitude: 35.2034,
      });

    expect(res.status).toBe(201);
    createdClaimId = res.body.data.id;
    createdTrackingToken = res.body.data.trackingToken;

    expect(Object.keys(res.body.data).sort()).toEqual(
      ['claimNumber', 'claimType', 'coverageSnapshot', 'createdAt', 'eligibilityHint', 'id', 'incidentId', 'incidentNumber', 'status', 'trackingToken', 'trackingUrl'].sort()
    );

    // coverageSnapshot sub-keys
    expect(Object.keys(res.body.data.coverageSnapshot).sort()).toEqual(
      ['capturedAt', 'coveredPerils', 'deductibleAmount', 'policyType'].sort()
    );
  });

  // 4. GET /claims/:claimId data sections as CLAIMS_OFFICER
  it('4. GET /claims/:claimId data sections as CLAIMS_OFFICER', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${createdClaimId}`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const data = res.body.data;

    // Top-level keys including trackingToken and trackingUrl for officer
    expect(Object.keys(data).sort()).toEqual(
      [
        'accident',
        'assignment',
        'claimNumber',
        'claimType',
        'closedAt',
        'closedBy',
        'closingNotes',
        'coverageSnapshot',
        'createdAt',
        'createdBy',
        'customer',
        'decisionNotes',
        'eligibilityHint',
        'evidence',
        'id',
        'incidentCoordinates',
        'incidentDate',
        'incidentDescription',
        'incidentId',
        'incidentLocation',
        'incidentNumber',
        'incidentType',
        'location',
        'lossAssessment',
        'policy',
        'signature',
        'status',
        'timeline',
        'trackingToken',
        'trackingUrl',
        'updatedAt',
        'vehicle',
      ].sort()
    );

    // customer sub-keys
    expect(Object.keys(data.customer).sort()).toEqual(['name', 'phone'].sort());

    // vehicle sub-keys
    expect(Object.keys(data.vehicle).sort()).toEqual(['color', 'make', 'model', 'plateNumber', 'year'].sort());

    // policy sub-keys
    expect(Object.keys(data.policy).sort()).toEqual(['expiryDate', 'id', 'policyNumber', 'startDate', 'status'].sort());

    // assignment sub-keys
    expect(Object.keys(data.assignment).sort()).toEqual(['assignedAt', 'assignedBy', 'assignedTo', 'assignmentNotes', 'priority'].sort());

    // coverageSnapshot sub-keys
    expect(Object.keys(data.coverageSnapshot).sort()).toEqual(['capturedAt', 'coveredPerils', 'deductibleAmount', 'policyType'].sort());
  });

  // 5. GET /claims/:claimId as FIELD_ADJUSTER (trackingToken and trackingUrl absent)
  it('5. GET /claims/:claimId as FIELD_ADJUSTER (trackingToken and trackingUrl absent)', async () => {
    // Assign claim to adjuster first so adjuster is authorized to view
    await Claim.findByIdAndUpdate(createdClaimId, { assignedTo: adjuster._id, status: 'ASSIGNED' });

    const res = await request(app)
      .get(`/api/v1/claims/${createdClaimId}`)
      .set('Authorization', `Bearer ${adjusterToken}`);

    expect(res.status).toBe(200);
    const data = res.body.data;

    expect(data.trackingToken).toBeUndefined();
    expect(data.trackingUrl).toBeUndefined();

    expect(Object.keys(data).sort()).toEqual(
      [
        'accident',
        'assignment',
        'claimNumber',
        'claimType',
        'closedAt',
        'closedBy',
        'closingNotes',
        'coverageSnapshot',
        'createdAt',
        'createdBy',
        'customer',
        'decisionNotes',
        'eligibilityHint',
        'evidence',
        'id',
        'incidentCoordinates',
        'incidentDate',
        'incidentDescription',
        'incidentId',
        'incidentLocation',
        'incidentNumber',
        'incidentType',
        'location',
        'lossAssessment',
        'policy',
        'signature',
        'status',
        'timeline',
        'updatedAt',
        'vehicle',
      ].sort()
    );
  });

  // 6. lossAssessment of an approved claim
  // 7. POST decision response for APPROVED and for REJECTED
  it('7a. POST decision response for REJECTED', async () => {
    // Set to UNDER_REVIEW
    const claimToReject = await Claim.create({
      organizationId: org._id,
      policyId: eligiblePolicy._id,
      createdBy: officer._id,
      status: 'UNDER_REVIEW',
      customer: { name: 'Reject Test', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Nablus',
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claimToReject._id}/decision`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        decision: 'REJECTED',
        notes: 'Not covered under policy conditions',
      });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(
      ['claimNumber', 'decisionNotes', 'id', 'status'].sort()
    );
  });

  it('6 & 7b. POST decision response for APPROVED & lossAssessment of approved claim', async () => {
    const claimToApprove = await Claim.create({
      organizationId: org._id,
      policyId: eligiblePolicy._id,
      createdBy: officer._id,
      status: 'UNDER_REVIEW',
      customer: { name: 'Approve Test', phone: '0599111111' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      trackingToken: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      coverageSnapshot: {
        policyType: 'COMPREHENSIVE',
        coveredPerils: ['COLLISION'],
        deductibleAmount: 500,
        capturedAt: new Date(),
      },
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claimToApprove._id}/decision`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        decision: 'APPROVED',
        notes: 'Claim verified and approved',
        lossAssessment: {
          estimatedPartsCost: 2000,
          laborCost: 1000,
        },
      });

    expect(res.status).toBe(200);

    // 7b. Decision response keys for APPROVED
    expect(Object.keys(res.body.data).sort()).toEqual(
      ['claimNumber', 'decisionNotes', 'id', 'lossAssessment', 'status'].sort()
    );

    // 6. lossAssessment of approved claim (from GET /claims/:claimId)
    const getRes = await request(app)
      .get(`/api/v1/claims/${claimToApprove._id}`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(getRes.status).toBe(200);
    const la = getRes.body.data.lossAssessment;
    expect(la).not.toBeNull();
    expect(Object.keys(la).sort()).toEqual(
      [
        'assessedAt',
        'assessedBy',
        'currency',
        'deductibleApplied',
        'deductibleOverridden',
        'deductibleOverrideReason',
        'estimatedPartsCost',
        'laborCost',
        'netApprovedPayout',
        'policyDeductible',
        'totalDamage',
      ].sort()
    );

    // Check assessedBy in GET /claims/:claimId is formatted { employeeCode, id, name }
    expect(Object.keys(la.assessedBy).sort()).toEqual(['employeeCode', 'id', 'name'].sort());
  });

  // 8. GET public tracking top level, vehicle, and one timeline item
  it('8. GET public tracking top level, vehicle, and one timeline item', async () => {
    // Put claim in a state with public tracking
    const res = await request(app)
      .get(`/api/v1/public/claims/track/${createdTrackingToken}`);

    expect(res.status).toBe(200);
    const data = res.body.data;

    // Top level
    expect(Object.keys(data).sort()).toEqual(
      ['claimNumber', 'status', 'statusDescription', 'timeline', 'vehicle'].sort()
    );

    // Vehicle
    expect(data.vehicle).not.toBeNull();
    expect(Object.keys(data.vehicle).sort()).toEqual(
      ['make', 'model', 'plateNumber', 'year'].sort()
    );

    // One timeline item
    expect(data.timeline.length).toBeGreaterThan(0);
    expect(Object.keys(data.timeline[0]).sort()).toEqual(
      ['description', 'status', 'timestamp', 'title'].sort()
    );

    // Verify absence of sensitive client-leaking keys
    expect(data.organizationId).toBeUndefined();
    expect(data._id).toBeUndefined();
    expect(data.__v).toBeUndefined();
    expect(data.customer).toBeUndefined();
    expect(data.phone).toBeUndefined();
    expect(data.userId).toBeUndefined();
  });
});

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/modules/users/user.model');
const Organization = require('../src/modules/organizations/organization.model');
const Claim = require('../src/modules/claims/claim.model');
const Policy = require('../src/modules/policies/policy.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Customer = require('../src/modules/customers/customer.model');
const jwt = require('jsonwebtoken');

const { MongoMemoryServer } = require('mongodb-memory-server');
const config = require('../src/config/env');

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret || 'test-secret',
    { expiresIn: config.jwtExpiresIn || '1h' }
  );
};

describe('Claim Read Endpoints', () => {
  let org1;
  let officer1;
  let adjuster1;
  let tokenOfficer;
  let tokenAdjuster;
  let newClaim;
  let assignedClaim;
  let mongoServer;
  let policy1;
  let customer1;
  let vehicle1;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Organization.deleteMany({});
    await User.deleteMany({});
    await Claim.deleteMany({});
    await Policy.deleteMany({});
    await Vehicle.deleteMany({});
    await Customer.deleteMany({});

    org1 = await Organization.create({
      name: 'Test Org 1',
      code: 'ORG-1',
      domain: 'test1.com',
      status: 'ACTIVE',
    });

    officer1 = await User.create({
      name: 'Test Officer',
      employeeCode: 'CO-1',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    tokenOfficer = generateToken(officer1);

    adjuster1 = await User.create({
      name: 'Test Adjuster',
      employeeCode: 'ADJ-1',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    tokenAdjuster = generateToken(adjuster1);

    // ── Policy, Customer, Vehicle fixtures ──────────────────────────
    policy1 = await Policy.create({
      policyNumber: 'POL-TEST-001',
      status: 'ACTIVE',
      startDate: new Date('2026-01-01'),
      expiryDate: new Date('2027-12-31'),
      organizationId: org1._id,
    });

    customer1 = await Customer.create({
      fullName: 'John Doe',
      phone: '0591234567',
      organizationId: org1._id,
    });

    vehicle1 = await Vehicle.create({
      plateNumber: 'ABC-123',
      make: 'Toyota',
      model: 'Camry',
      year: 2024,
      color: 'White',
      customerId: customer1._id,
      policyId: policy1._id,
      organizationId: org1._id,
    });

    newClaim = await Claim.create({
      organizationId: org1._id,
      createdBy: officer1._id,
      policyId: policy1._id,
      status: 'NEW',
      customer: { name: 'John Doe', phone: '0591234567' },
      vehicle: { plateNumber: 'ABC-123' },
      incidentType: 'COLLISION',
      incidentLocation: 'Street A',
    });

    assignedClaim = await Claim.create({
      organizationId: org1._id,
      createdBy: officer1._id,
      policyId: policy1._id,
      status: 'ASSIGNED',
      customer: { name: 'Jane Doe', phone: '456' },
      vehicle: {
        plateNumber: 'XYZ-987',
        vehicleId: vehicle1._id,
        customerId: customer1._id,
      },
      incidentType: 'OTHER',
      incidentLocation: 'Street B',
      assignedTo: adjuster1._id,
      assignedBy: officer1._id,
      assignedAt: new Date(),
      priority: 'HIGH',
      assignmentNotes: 'Please check ASAP',
    });
  });

  // ─── GET /claims (list) tests ─────────────────────────────────────

  it('GET /api/v1/claims returns flat shapes without _id or nested objects', async () => {
    const res = await request(app)
      .get('/api/v1/claims')
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const claims = res.body.data;
    expect(claims.length).toBe(2);

    for (const claim of claims) {
      expect(claim).toHaveProperty('id');
      expect(claim).not.toHaveProperty('_id');
      expect(claim).toHaveProperty('customerName');
      expect(claim).toHaveProperty('initialPlateNumber');
      expect(claim).not.toHaveProperty('customer');
      expect(claim).not.toHaveProperty('vehicle');
    }
  });

  it('GET /api/v1/claims?status=NEW only returns claims with status NEW', async () => {
    const res = await request(app)
      .get('/api/v1/claims?status=NEW')
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const claims = res.body.data;
    expect(claims.length).toBe(1);
    expect(claims[0].status).toBe('NEW');
    expect(claims[0].id).toBe(newClaim._id.toString());
  });

  it('GET /api/v1/claims?status=ASSIGNED only returns ASSIGNED claims', async () => {
    const res = await request(app)
      .get('/api/v1/claims?status=ASSIGNED')
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const claims = res.body.data;
    expect(claims.length).toBe(1);
    expect(claims[0].status).toBe('ASSIGNED');
    expect(claims[0].id).toBe(assignedClaim._id.toString());
  });

  it('GET /api/v1/claims returns assignedTo with id and name for assigned claim, and null for unassigned claim', async () => {
    const res = await request(app)
      .get('/api/v1/claims')
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const claims = res.body.data;
    expect(claims.length).toBe(2);

    const assigned = claims.find((c) => c.id === assignedClaim._id.toString());
    const unassigned = claims.find((c) => c.id === newClaim._id.toString());

    expect(assigned.assignedTo).toEqual({
      id: adjuster1._id.toString(),
      name: 'Test Adjuster',
    });
    expect(assigned.fieldAdjuster).toEqual({
      id: adjuster1._id.toString(),
      name: 'Test Adjuster',
    });

    expect(unassigned.assignedTo).toBeNull();
    expect(unassigned.fieldAdjuster).toBeNull();
  });

  it('GET /api/v1/claims?adjusterId=:id filters claims by assigned field adjuster', async () => {
    const res = await request(app)
      .get(`/api/v1/claims?adjusterId=${adjuster1._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const claims = res.body.data;
    expect(claims.length).toBe(1);
    expect(claims[0].id).toBe(assignedClaim._id.toString());
    expect(claims[0].assignedTo.id).toBe(adjuster1._id.toString());
  });

  it('GET /api/v1/claims?assignedTo=:id works as an alias to filter by assigned adjuster', async () => {
    const res = await request(app)
      .get(`/api/v1/claims?assignedTo=${adjuster1._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const claims = res.body.data;
    expect(claims.length).toBe(1);
    expect(claims[0].id).toBe(assignedClaim._id.toString());
  });

  it('GET /api/v1/claims?adjusterId=invalid-id returns 400 Bad Request with VALIDATION_ERROR', async () => {
    const res = await request(app)
      .get('/api/v1/claims?adjusterId=invalid-id')
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('GET /api/v1/claims?status=INVALID_STATUS returns 400 Bad Request with VALIDATION_ERROR', async () => {
    const res = await request(app)
      .get('/api/v1/claims?status=INVALID_STATUS')
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Validation Error');
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    expect(res.body.errors[0].details).toMatch(/status must be one of/i);
  });

  it('GET /api/v1/claims with unknown query parameter returns 400 Bad Request with VALIDATION_ERROR', async () => {
    const res = await request(app)
      .get('/api/v1/claims?unknownParam=attack')
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // ─── GET /claims/:claimId (detail) tests ──────────────────────────

  it('GET /api/v1/claims/:claimId returns structured response without _id, __v, or organizationId', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${assignedClaim._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const data = res.body.data;

    // Core identity
    expect(data).toHaveProperty('id', assignedClaim._id.toString());
    expect(data).not.toHaveProperty('_id');
    expect(data).not.toHaveProperty('organizationId');
    expect(data).not.toHaveProperty('__v');

    // Assignment section has formatted user objects
    expect(data.assignment).toBeDefined();
    expect(data.assignment.assignedTo).toEqual({
      id: adjuster1._id.toString(),
      name: 'Test Adjuster',
      employeeCode: 'ADJ-1',
    });
    expect(data.assignment.assignedBy).toEqual({
      id: officer1._id.toString(),
      name: 'Test Officer',
      employeeCode: 'CO-1',
    });
    expect(data.assignment.priority).toBe('HIGH');
    expect(data.assignment.assignmentNotes).toBe('Please check ASAP');
  });

  it('GET /api/v1/claims/:claimId returns policy information when populated', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${assignedClaim._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const data = res.body.data;

    // Policy section
    expect(data.policy).toBeDefined();
    expect(data.policy.id).toBe(policy1._id.toString());
    expect(data.policy.policyNumber).toBe('POL-TEST-001');
    expect(data.policy.status).toBe('ACTIVE');
    expect(data.policy.startDate).toBeDefined();
    expect(data.policy.expiryDate).toBeDefined();
  });

  it('GET /api/v1/claims/:claimId returns vehicle details from populated vehicleId', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${assignedClaim._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const data = res.body.data;

    // Vehicle section (merged from claim plateNumber + populated Vehicle entity)
    expect(data.vehicle).toBeDefined();
    expect(data.vehicle.plateNumber).toBe('XYZ-987');
    expect(data.vehicle.make).toBe('Toyota');
    expect(data.vehicle.model).toBe('Camry');
    expect(data.vehicle.year).toBe(2024);
    expect(data.vehicle.color).toBe('White');
  });

  it('GET /api/v1/claims/:claimId returns null vehicle details when vehicleId not yet set', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${newClaim._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const data = res.body.data;

    // NEW claim has plateNumber but no vehicleId populated yet
    expect(data.vehicle.plateNumber).toBe('ABC-123');
    expect(data.vehicle.make).toBeNull();
    expect(data.vehicle.model).toBeNull();
    expect(data.vehicle.year).toBeNull();
    expect(data.vehicle.color).toBeNull();
  });

  it('GET /api/v1/claims/:claimId returns createdBy as formatted user object', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${assignedClaim._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const data = res.body.data;

    expect(data.createdBy).toEqual({
      id: officer1._id.toString(),
      name: 'Test Officer',
      employeeCode: 'CO-1',
    });
  });

  it('GET /api/v1/claims/:claimId returns null for empty optional sections', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${newClaim._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const data = res.body.data;

    // Unassigned claim
    expect(data.assignment.assignedTo).toBeNull();
    expect(data.assignment.assignedBy).toBeNull();
    expect(data.assignment.assignedAt).toBeNull();

    // No inspection data yet
    expect(data.evidence).toEqual([]);
    expect(data.signature).toBeNull();
    expect(data.decisionNotes).toBeNull();
    expect(data.closedBy).toBeNull();
    expect(data.closedAt).toBeNull();
    expect(data.closingNotes).toBeNull();
  });

  it('GET /api/v1/claims/:claimId on an assigned claim allows the assigned adjuster', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${assignedClaim._id}`)
      .set('Authorization', `Bearer ${tokenAdjuster}`);

    expect(res.statusCode).toBe(200);
    const data = res.body.data;

    expect(data.assignment.assignedTo.id).toBe(adjuster1._id.toString());
  });

  it('GET /api/v1/claims called by FIELD_ADJUSTER returns only assigned claims with adjuster info', async () => {
    const res = await request(app)
      .get('/api/v1/claims')
      .set('Authorization', `Bearer ${tokenAdjuster}`);

    expect(res.statusCode).toBe(200);
    const claims = res.body.data;
    expect(claims.length).toBe(1);
    expect(claims[0].id).toBe(assignedClaim._id.toString());
    expect(claims[0].assignedTo).toEqual({
      id: adjuster1._id.toString(),
      name: 'Test Adjuster',
    });
    expect(claims[0].fieldAdjuster).toEqual({
      id: adjuster1._id.toString(),
      name: 'Test Adjuster',
    });
  });
});

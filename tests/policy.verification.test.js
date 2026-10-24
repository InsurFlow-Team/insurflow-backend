const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Customer = require('../src/modules/customers/customer.model');
const Policy = require('../src/modules/policies/policy.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');
const { buildPolicy, buildPolicyPayload } = require('./helpers/policyFactory');
const migrateLegacyPolicies = require('../src/scripts/migrateLegacyPolicies');

const { MongoMemoryServer } = require('mongodb-memory-server');

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

describe('Policy Verification API — POST /api/v1/policies/verify', () => {
  let mongoServer;
  let org1, org2;
  let claimsOfficer, adminUser, fieldAdjuster;
  let officerToken, adminToken, adjusterToken;
  let activePolicy, thirdPartyPolicy, expiredPolicy, cancelledPolicy, org2Policy;
  let vehicle1, vehicle2, vehicleThirdParty, vehicleOrg2;
  let customer1, customer2;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    // ── Organizations ──
    org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1', domain: 'org1.com', status: 'ACTIVE' });
    org2 = await Organization.create({ name: 'Org 2', code: 'ORG-2', domain: 'org2.com', status: 'ACTIVE' });

    // ── Users (Org 1) ──
    claimsOfficer = await User.create({
      name: 'Sara Officer', employeeCode: 'CO-200', password: 'password123',
      role: 'CLAIMS_OFFICER', organizationId: org1._id, status: 'ACTIVE',
    });
    officerToken = generateToken(claimsOfficer);

    adminUser = await User.create({
      name: 'Admin User', employeeCode: 'AD-200', password: 'password123',
      role: 'ADMIN', organizationId: org1._id, status: 'ACTIVE',
    });
    adminToken = generateToken(adminUser);

    fieldAdjuster = await User.create({
      name: 'Ahmed Adjuster', employeeCode: 'FA-200', password: 'password123',
      role: 'FIELD_ADJUSTER', organizationId: org1._id, status: 'ACTIVE',
    });
    adjusterToken = generateToken(fieldAdjuster);

    // ── Customers ──
    customer1 = await Customer.create({ fullName: 'Ahmad Ali', phone: '+962791234567', organizationId: org1._id });
    customer2 = await Customer.create({ fullName: 'Lina Hasan', phone: '+962799876543', organizationId: org1._id });

    // ── Policies (Org 1) ──
    activePolicy = await buildPolicy({
      policyNumber: 'POL-V-1000',
      status: 'ACTIVE',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
      deductibleAmount: 500,
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2026-12-31T00:00:00Z'),
      organizationId: org1._id,
    });

    thirdPartyPolicy = await buildPolicy({
      policyNumber: 'POL-V-4000',
      status: 'ACTIVE',
      policyType: 'THIRD_PARTY',
      coveredPerils: [],
      deductibleAmount: 0,
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2026-12-31T00:00:00Z'),
      organizationId: org1._id,
    });

    expiredPolicy = await buildPolicy({
      policyNumber: 'POL-V-2000',
      status: 'EXPIRED',
      policyType: 'THIRD_PARTY',
      coveredPerils: [],
      deductibleAmount: 0,
      startDate: new Date('2022-01-01T00:00:00Z'),
      expiryDate: new Date('2023-12-31T00:00:00Z'),
      organizationId: org1._id,
    });

    cancelledPolicy = await buildPolicy({
      policyNumber: 'POL-V-3000',
      status: 'CANCELLED',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      deductibleAmount: 250,
      startDate: new Date('2025-06-01T00:00:00Z'),
      expiryDate: new Date('2026-06-01T00:00:00Z'),
      organizationId: org1._id,
    });

    // ── Policy in Org 2 (cross-tenant test) ──
    org2Policy = await buildPolicy({
      policyNumber: 'POL-V-ORG2',
      status: 'ACTIVE',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      deductibleAmount: 500,
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2026-12-31T00:00:00Z'),
      organizationId: org2._id,
    });

    // ── Policy without vehicle ──
    await buildPolicy({
      policyNumber: 'POL-V-NOVEH',
      status: 'ACTIVE',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      deductibleAmount: 500,
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2026-12-31T00:00:00Z'),
      organizationId: org1._id,
    });

    // ── Policy with elapsed expiryDate but ACTIVE status ──
    await buildPolicy({
      policyNumber: 'POL-V-PASTEXP',
      status: 'ACTIVE',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      deductibleAmount: 500,
      startDate: new Date('2020-01-01T00:00:00Z'),
      expiryDate: new Date('2021-01-01T00:00:00Z'),
      organizationId: org1._id,
    });

    // ── Vehicles ──
    vehicle1 = await Vehicle.create({
      plateNumber: 'ABC-1234', make: 'Toyota', model: 'Camry', year: 2022, color: 'White',
      customerId: customer1._id, complementaryPolicyId: activePolicy._id, organizationId: org1._id,
    });

    vehicleThirdParty = await Vehicle.create({
      plateNumber: 'TPL-4000', make: 'Hyundai', model: 'Elantra', year: 2023, color: 'Silver',
      customerId: customer1._id, compulsoryPolicyId: thirdPartyPolicy._id, organizationId: org1._id,
    });

    vehicle2 = await Vehicle.create({
      plateNumber: 'XYZ-9876', make: 'Honda', model: 'Civic', year: 2019, color: 'Black',
      customerId: customer2._id, complementaryPolicyId: expiredPolicy._id, organizationId: org1._id,
    });

    vehicleOrg2 = await Vehicle.create({
      plateNumber: 'ORG2-VEH', make: 'BMW', model: 'X5', year: 2024, color: 'Blue',
      complementaryPolicyId: org2Policy._id, organizationId: org2._id,
    });

    // ── Vehicle without policy ──
    await Vehicle.create({
      plateNumber: 'NO-POL-VEH', make: 'Ford', model: 'Focus', year: 2018, color: 'Red',
      organizationId: org1._id,
    });

    // ── Policy with multiple vehicles ──
    const multiVehPolicy = await buildPolicy({
      policyNumber: 'POL-V-MULTI',
      status: 'ACTIVE',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      deductibleAmount: 500,
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2026-12-31T00:00:00Z'),
      organizationId: org1._id,
    });
    await Vehicle.create({
      plateNumber: 'MULTI-1', make: 'Hyundai', model: 'Elantra', year: 2021, color: 'Silver',
      customerId: customer1._id, complementaryPolicyId: multiVehPolicy._id, organizationId: org1._id,
    });
    await Vehicle.create({
      plateNumber: 'MULTI-2', make: 'Kia', model: 'Cerato', year: 2022, color: 'White',
      customerId: customer1._id, complementaryPolicyId: multiVehPolicy._id, organizationId: org1._id,
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  // ─────────────────────────────────────────────────────
  // ✅ SUCCESS CASES
  // ─────────────────────────────────────────────────────

  it('should verify an active policy and return full data (CLAIMS_OFFICER)', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-1000' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);

    // Policy data
    expect(res.body.data.policy.policyNumber).toBe('POL-V-1000');
    expect(res.body.data.policy.status).toBe('ACTIVE');
    expect(res.body.data.policy.startDate).toBe('2025-01-01');
    expect(res.body.data.policy.expiryDate).toBe('2026-12-31');
    expect(res.body.data.policy.policyType).toBe('COMPREHENSIVE');
    expect(res.body.data.policy.coveredPerils).toEqual([
      'COLLISION',
      'THEFT',
      'FIRE',
      'NATURAL_DISASTER',
    ]);
    expect(res.body.data.policy.deductibleAmount).toBe(500);
    expect(res.body.data.eligibilityHint).toBeNull();

    // Vehicle data
    expect(res.body.data.vehicle.plateNumber).toBe('ABC-1234');
    expect(res.body.data.vehicle.make).toBe('Toyota');

    // Customer data
    expect(res.body.data.customer.fullName).toBe('Ahmad Ali');
    expect(res.body.data.customer.phone).toBe('+962791234567');
  });

  it('should verify an active policy when called by ADMIN', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ policyNumber: 'POL-V-1000' });

    expect(res.status).toBe(200);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.policy.policyNumber).toBe('POL-V-1000');
  });

  it('should verify successfully when incidentDate is within policy period', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-1000', incidentDate: '2026-06-15' });

    expect(res.status).toBe(200);
    expect(res.body.data.isEligible).toBe(true);
  });

  it('should verify successfully when plateNumber matches the policy vehicle', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-1000', plateNumber: 'abc-1234' }); // case-insensitive

    expect(res.status).toBe(200);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.vehicle.plateNumber).toBe('ABC-1234');
  });

  // ─────────────────────────────────────────────────────
  // ❌ POLICY STATUS REJECTION CASES
  // ─────────────────────────────────────────────────────

  it('should return 200 with INCIDENT_OUTSIDE_POLICY_PERIOD for expired policy with no incidentDate', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-2000' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.eligibilityHint).toBe('INCIDENT_OUTSIDE_POLICY_PERIOD');
  });

  it('should reject cancelled policy with 422 POLICY_CANCELLED', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-3000' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('POLICY_CANCELLED');
  });

  // ─────────────────────────────────────────────────────
  // ❌ DATE AND VEHICLE MISMATCH CASES
  // ─────────────────────────────────────────────────────

  it('should return 200 with INCIDENT_OUTSIDE_POLICY_PERIOD and populated coverage when incidentDate is before startDate', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-1000', incidentDate: '2024-06-15' }); // before startDate

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.eligibilityHint).toBe('INCIDENT_OUTSIDE_POLICY_PERIOD');
    expect(res.body.data.coverage).toBeDefined();
    expect(res.body.data.coverage.policyType).toBe('COMPREHENSIVE');
  });

  it('should return 200 with INCIDENT_OUTSIDE_POLICY_PERIOD and populated coverage when incidentDate is after expiryDate', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-2000', incidentDate: '2024-06-15' }); // after expiryDate of POL-V-2000 (2023-12-31)

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.eligibilityHint).toBe('INCIDENT_OUTSIDE_POLICY_PERIOD');
    expect(res.body.data.coverage).toBeDefined();
  });

  it('should reject when plateNumber does not match policy vehicle with 422', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-1000', plateNumber: 'WRONG-PLATE' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VEHICLE_MISMATCH');
  });

  // ─────────────────────────────────────────────────────
  // ❌ NOT FOUND AND MULTI-TENANCY CASES
  // ─────────────────────────────────────────────────────

  it('should return 404 for non-existent policy', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-DOES-NOT-EXIST' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('POLICY_NOT_FOUND');
  });

  it('should return 404 for cross-tenant policy (stealth rejection)', async () => {
    // Org 2 policy should be invisible to Org 1 user
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-ORG2' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('POLICY_NOT_FOUND');
  });

  // ─────────────────────────────────────────────────────
  // ❌ RBAC AND AUTH CASES
  // ─────────────────────────────────────────────────────

  it('should reject FIELD_ADJUSTER with 403 Forbidden', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({ policyNumber: 'POL-V-1000' });

    expect(res.status).toBe(403);
  });

  it('should reject unauthenticated request with 401', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .send({ policyNumber: 'POL-V-1000' });

    expect(res.status).toBe(401);
  });

  // ─────────────────────────────────────────────────────
  // ❌ VALIDATION CASES
  // ─────────────────────────────────────────────────────

  it('should reject missing policyNumber with 400 validation error', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('should reject invalid incidentDate format with 400', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-1000', incidentDate: '15-06-2026' }); // wrong format

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // ─────────────────────────────────────────────────────
  // 🚀 ADVANCED ARCHITECTURAL & EDGE CASE TESTS
  // ─────────────────────────────────────────────────────

  it('should verify policy successfully using plateNumber only', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ plateNumber: 'ABC-1234' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.policy.policyNumber).toBe('POL-V-1000');
    expect(res.body.data.vehicle.plateNumber).toBe('ABC-1234');
    expect(res.body.data.customer.fullName).toBe('Ahmad Ali');
  });

  it('should verify policy by plateNumber only (TPL-4000) with incidentType returning NOT_COVERED_BY_POLICY_TYPE and policyType THIRD_PARTY', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ plateNumber: 'TPL-4000', incidentType: 'COLLISION' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.eligibilityHint).toBe('NOT_COVERED_BY_POLICY_TYPE');
    expect(res.body.data.policy.policyType).toBeNull();
    expect(res.body.data.policy.coveredPerils).toEqual([]);
    expect(res.body.data.policy.deductibleAmount).toBe(0);
    expect(res.body.data.vehicle.plateNumber).toBe('TPL-4000');
  });

  it('should verify policy by plateNumber only (ABC-1234) with incidentType returning ELIGIBLE_FOR_REVIEW and deductibleAmount 500', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ plateNumber: 'ABC-1234', incidentType: 'COLLISION' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.eligibilityHint).toBe('ELIGIBLE_FOR_REVIEW');
    expect(res.body.data.policy.policyType).toBe('COMPREHENSIVE');
    expect(res.body.data.policy.deductibleAmount).toBe(500);
    expect(res.body.data.policy.coveredPerils).toEqual([
      'COLLISION',
      'THEFT',
      'FIRE',
      'NATURAL_DISASTER',
    ]);
    expect(res.body.data.vehicle.plateNumber).toBe('ABC-1234');
  });

  it('should verify policy by plateNumber only with legacy policy returning COVERAGE_UNKNOWN', async () => {
    const rawLegacyPolicyId = new mongoose.Types.ObjectId();
    await Policy.collection.insertOne({
      _id: rawLegacyPolicyId,
      policyNumber: 'POL-V-LEG-PLATE',
      status: 'ACTIVE',
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2026-12-31T00:00:00Z'),
      organizationId: org1._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await Vehicle.create({
      plateNumber: 'LEG-1234',
      make: 'Nissan',
      model: 'Sunny',
      year: 2020,
      color: 'Black',
      customerId: customer1._id, complementaryPolicyId: rawLegacyPolicyId,
      organizationId: org1._id,
    });

    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ plateNumber: 'LEG-1234', incidentType: 'COLLISION' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.eligibilityHint).toBe('COVERAGE_UNKNOWN');
    expect(res.body.data.policy.policyType).toBeNull();
    expect(res.body.data.policy.coveredPerils).toEqual([]);
    expect(res.body.data.policy.deductibleAmount).toBeNull();
    expect(res.body.data.vehicle.plateNumber).toBe('LEG-1234');
  });

  it('should return 404 when verifying by non-existent plateNumber', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ plateNumber: 'NON-EXIST-999' });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('VEHICLE_NOT_FOUND');
  });

  it('should return 404 when vehicle has no linked policy', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ plateNumber: 'NO-POL-VEH' });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('POLICY_NOT_FOUND');
  });

  it('should reject with 422 VEHICLE_MISMATCH when policy has no linked vehicle', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-NOVEH', plateNumber: 'ABC-1234' });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('VEHICLE_MISMATCH');
  });

  it('should reject incidentDate in the future with 400 INVALID_INCIDENT_DATE', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-1000', incidentDate: '2099-01-01' });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('INVALID_INCIDENT_DATE');
  });

  it('should return 200 with INCIDENT_OUTSIDE_POLICY_PERIOD when expiryDate has elapsed and status is ACTIVE', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-PASTEXP' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.eligibilityHint).toBe('INCIDENT_OUTSIDE_POLICY_PERIOD');
  });

  it('should reject with 422 AMBIGUOUS_VEHICLE_SELECTION when policy has multiple vehicles and plateNumber is not provided', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-MULTI' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('AMBIGUOUS_VEHICLE_SELECTION');
  });

  it('should verify successfully when policy has multiple vehicles and plateNumber is specified', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-MULTI', plateNumber: 'MULTI-1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.vehicle.plateNumber).toBe('MULTI-1');
  });

  // ─────────────────────────────────────────────────────
  // 🛡️ COVERAGE SNAPSHOT & ELIGIBILITY HINT TESTS
  // ─────────────────────────────────────────────────────

  it('should return ELIGIBLE_FOR_REVIEW when COMPREHENSIVE policy covers incidentType', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-1000', incidentType: 'COLLISION' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.eligibilityHint).toBe('ELIGIBLE_FOR_REVIEW');
    expect(res.body.data.policy.policyType).toBe('COMPREHENSIVE');
    expect(res.body.data.policy.coveredPerils).toContain('COLLISION');
  });

  it('should return NOT_COVERED_BY_POLICY_TYPE when THIRD_PARTY policy receives own-damage incidentType', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-4000', incidentType: 'COLLISION' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.eligibilityHint).toBe('NOT_COVERED_BY_POLICY_TYPE');
    expect(res.body.data.policy.policyType).toBeNull();
    expect(res.body.data.policy.coveredPerils).toEqual([]);
    expect(res.body.data.policy.deductibleAmount).toBe(0);
  });

  it('should return null eligibilityHint when incidentType is not provided', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-4000' });

    expect(res.status).toBe(200);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.eligibilityHint).toBeNull();
  });

  it('should correctly evaluate eligibilityHint when incidentDate is provided within validity period', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyNumber: 'POL-V-1000',
        incidentDate: '2026-06-15',
        incidentType: 'COLLISION',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.eligibilityHint).toBe('ELIGIBLE_FOR_REVIEW');
  });

  // ─────────────────────────────────────────────────────
  // 🔬 SCHEMA & API VALIDATION TESTS
  // ─────────────────────────────────────────────────────

  it('should reject COMPREHENSIVE policy with empty coveredPerils array in schema validation', async () => {
    try {
      await Policy.create(
        buildPolicyPayload({
          policyNumber: 'POL-INV-COMP',
          organizationId: org1._id,
          policyType: 'COMPREHENSIVE',
          coveredPerils: [],
          deductibleAmount: 500,
        })
      );
      throw new Error('Should have failed validation');
    } catch (err) {
      expect(err.name).toBe('ValidationError');
      expect(err.errors).toBeDefined();
      expect(err.errors.coveredPerils).toBeDefined();
      expect(err.errors.coveredPerils.message).toContain('coveredPerils must be empty for THIRD_PARTY and non-empty for COMPREHENSIVE');
    }
  });

  it('should reject THIRD_PARTY policy with non-empty coveredPerils in schema validation', async () => {
    try {
      await Policy.create(
        buildPolicyPayload({
          policyNumber: 'POL-INV-TP',
          organizationId: org1._id,
          policyType: 'THIRD_PARTY',
          coveredPerils: ['COLLISION'],
          deductibleAmount: 0,
        })
      );
      throw new Error('Should have failed validation');
    } catch (err) {
      expect(err.name).toBe('ValidationError');
      expect(err.errors).toBeDefined();
      expect(err.errors.coveredPerils).toBeDefined();
      expect(err.errors.coveredPerils.message).toContain('coveredPerils must be empty for THIRD_PARTY and non-empty for COMPREHENSIVE');
    }
  });

  it('should reject invalid peril FLOOD in coveredPerils schema validation', async () => {
    try {
      await Policy.create(
        buildPolicyPayload({
          policyNumber: 'POL-INV-PERIL',
          organizationId: org1._id,
          policyType: 'COMPREHENSIVE',
          coveredPerils: ['FLOOD'],
          deductibleAmount: 500,
        })
      );
      throw new Error('Should have failed validation');
    } catch (err) {
      expect(err.name).toBe('ValidationError');
      expect(err.errors).toBeDefined();
      const coveredPerilsErr = err.errors.coveredPerils || err.errors['coveredPerils.0'];
      expect(coveredPerilsErr).toBeDefined();
      expect(coveredPerilsErr.name).toBe('ValidatorError');
    }
  });

  it('should reject invalid incidentType with 400 VALIDATION_ERROR in API request', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-1000', incidentType: 'FLOOD' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('should return NOT_COVERED_BY_POLICY_TYPE for COMPREHENSIVE policy with COLLISION-only when incidentType is THEFT', async () => {
    const collisionOnlyPolicy = await buildPolicy({
      policyNumber: 'POL-V-COLL-ONLY',
      status: 'ACTIVE',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      deductibleAmount: 500,
      organizationId: org1._id,
    });

    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: collisionOnlyPolicy.policyNumber, incidentType: 'THEFT' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.eligibilityHint).toBe('NOT_COVERED_BY_POLICY_TYPE');
    expect(res.body.data.policy.policyType).toBe('COMPREHENSIVE');
    expect(res.body.data.policy.coveredPerils).toEqual(['COLLISION']);
  });

  it('should return 200 with INCIDENT_OUTSIDE_POLICY_PERIOD when incidentDate is outside policy period even if incidentType is provided', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyNumber: 'POL-V-1000',
        incidentDate: '2024-06-15',
        incidentType: 'COLLISION',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.eligibilityHint).toBe('INCIDENT_OUTSIDE_POLICY_PERIOD');
  });

  // ─────────────────────────────────────────────────────
  // 📦 LEGACY POLICY & MIGRATION SCRIPT TESTS
  // ─────────────────────────────────────────────────────

  let legacyPolicyId;

  it('should return COVERAGE_UNKNOWN for legacy policy missing policyType and deductibleAmount inserted directly', async () => {
    legacyPolicyId = new mongoose.Types.ObjectId();
    await Policy.collection.insertOne({
      _id: legacyPolicyId,
      policyNumber: 'POL-V-LEGACY-001',
      status: 'ACTIVE',
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2026-12-31T00:00:00Z'),
      organizationId: org1._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ policyNumber: 'POL-V-LEGACY-001', incidentType: 'COLLISION' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.eligibilityHint).toBe('COVERAGE_UNKNOWN');
    expect(res.body.data.policy.policyType).toBeNull();
    expect(res.body.data.policy.coveredPerils).toEqual([]);
    expect(res.body.data.policy.deductibleAmount).toBeNull();
  });

  it('should execute migrateLegacyPolicies() with no arguments as safe dry-run by default without writing anything', async () => {
    const defaultDryRun = await migrateLegacyPolicies();

    expect(defaultDryRun.isDryRun).toBe(true);
    expect(defaultDryRun.found).toBeGreaterThanOrEqual(1);
    expect(defaultDryRun.updated).toBe(0);

    const docAfterDefaultDryRun = await Policy.collection.findOne({ _id: legacyPolicyId });
    expect(docAfterDefaultDryRun.policyType).toBeUndefined();
    expect(docAfterDefaultDryRun.deductibleAmount).toBeUndefined();
  });

  it('should execute migration script in dry-run mode without modifying legacy document', async () => {
    const dryRunResult = await migrateLegacyPolicies({ apply: false });

    expect(dryRunResult.isDryRun).toBe(true);
    expect(dryRunResult.found).toBeGreaterThanOrEqual(1);
    expect(dryRunResult.updated).toBe(0);

    const docAfterDryRun = await Policy.collection.findOne({ _id: legacyPolicyId });
    expect(docAfterDryRun.policyType).toBeUndefined();
    expect(docAfterDryRun.deductibleAmount).toBeUndefined();
  });

  it('should execute migration script with apply=true and be idempotent on second run', async () => {
    const applyResult = await migrateLegacyPolicies({ apply: true });

    expect(applyResult.isDryRun).toBe(false);
    expect(applyResult.found).toBeGreaterThanOrEqual(1);
    expect(applyResult.updated).toBeGreaterThanOrEqual(1);

    const docAfterApply = await Policy.collection.findOne({ _id: legacyPolicyId });
    expect(docAfterApply.policyType).toBe('THIRD_PARTY');
    expect(docAfterApply.coveredPerils).toEqual([]);
    expect(docAfterApply.deductibleAmount).toBe(0);

    // Second run: must find 0 legacy documents and update 0
    const secondRunResult = await migrateLegacyPolicies({ apply: true });
    expect(secondRunResult.isDryRun).toBe(false);
    expect(secondRunResult.found).toBe(0);
    expect(secondRunResult.updated).toBe(0);
  });

  // ─────────────────────────────────────────────────────
  // 🛡️ GAP-02: COVERAGE VERIFICATION & COVERAGE APPLICABILITY
  // ─────────────────────────────────────────────────────
  describe('GAP-02: Coverage Visibility & Incident Applicability in Verification Flow', () => {
    it('GAP-02 Test 1: should return full coverage object for COMPREHENSIVE policy with verified incidentDate', async () => {
      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyNumber: 'POL-V-1000',
          incidentDate: '2026-06-15',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isEligible).toBe(true);

      const { coverage } = res.body.data;
      expect(coverage).toBeDefined();
      expect(coverage.policyType).toBe('COMPREHENSIVE');
      expect(coverage.policyKind).toBe('COMPLEMENTARY');
      expect(coverage.effectiveFrom).toBe('2025-01-01');
      expect(coverage.effectiveTo).toBe('2026-12-31');
      expect(coverage.deductible).toBe(500);

      // Verify canonical perils derived from Policy.COVERED_PERILS
      expect(Array.isArray(coverage.incidents)).toBe(true);
      expect(coverage.incidents).toHaveLength(Policy.COVERED_PERILS.length);
      Policy.COVERED_PERILS.forEach((peril) => {
        const item = coverage.incidents.find((i) => i.code === peril);
        expect(item).toBeDefined();
        expect(item.covered).toBe(true);
      });

      // Crucial: no fabricated fields leak
      expect(coverage.currency).toBeUndefined();
      expect(coverage.limit).toBeUndefined();
      expect(coverage.coverageLimit).toBeUndefined();
      expect(coverage.limitType).toBeUndefined();
    });

    it('GAP-02 Test 2: should confirm incident coverage for covered incidentType (COLLISION)', async () => {
      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyNumber: 'POL-V-1000',
          incidentDate: '2026-06-15',
          incidentType: 'COLLISION',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.isEligible).toBe(true);
      expect(res.body.data.eligibilityHint).toBe('ELIGIBLE_FOR_REVIEW');

      const collisionIncident = res.body.data.coverage.incidents.find(
        (i) => i.code === 'COLLISION'
      );
      expect(collisionIncident).toEqual({ code: 'COLLISION', covered: true });
    });

    it('GAP-02 Test 3: should indicate uncovered status for excluded incidentType on partial policy', async () => {
      // POL-V-COLL-ONLY only covers COLLISION
      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyNumber: 'POL-V-COLL-ONLY',
          incidentType: 'THEFT',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.isEligible).toBe(true);
      expect(res.body.data.eligibilityHint).toBe('NOT_COVERED_BY_POLICY_TYPE');

      const { coverage } = res.body.data;
      expect(coverage.policyType).toBe('COMPREHENSIVE');
      expect(coverage.deductible).toBe(500);

      const theftIncident = coverage.incidents.find((i) => i.code === 'THEFT');
      expect(theftIncident).toEqual({ code: 'THEFT', covered: false });

      const collisionIncident = coverage.incidents.find((i) => i.code === 'COLLISION');
      expect(collisionIncident).toEqual({ code: 'COLLISION', covered: true });
    });

    it('GAP-02 Test 4: should return 200 with INCIDENT_OUTSIDE_POLICY_PERIOD and populated coverage when incidentDate is outside policy period', async () => {
      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyNumber: 'POL-V-1000',
          incidentDate: '2024-06-15',
          incidentType: 'COLLISION',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isEligible).toBe(true);
      expect(res.body.data.eligibilityHint).toBe('INCIDENT_OUTSIDE_POLICY_PERIOD');
      expect(res.body.data.coverage).toBeDefined();
      expect(res.body.data.coverage.policyType).toBe('COMPREHENSIVE');
      expect(res.body.data.coverage.incidents).toHaveLength(4);
    });

    it('GAP-02 Test 5: should return coverage: null for legacy policy missing coverage structure', async () => {
      const rawLegacyId = new mongoose.Types.ObjectId();
      await Policy.collection.insertOne({
        _id: rawLegacyId,
        policyNumber: 'POL-V-LEG-GAP02',
        status: 'ACTIVE',
        startDate: new Date('2025-01-01T00:00:00Z'),
        expiryDate: new Date('2026-12-31T00:00:00Z'),
        organizationId: org1._id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ policyNumber: 'POL-V-LEG-GAP02', incidentType: 'COLLISION' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isEligible).toBe(true);
      expect(res.body.data.coverage).toBeNull();
      expect(res.body.data.eligibilityHint).toBe('COVERAGE_UNKNOWN');
    });

    it('GAP-02 Test 6: should not fabricate currency when policy model has no currency field', async () => {
      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ policyNumber: 'POL-V-1000' });

      expect(res.status).toBe(200);
      expect(res.body.data.coverage).toBeDefined();
      expect(res.body.data.coverage.currency).toBeUndefined();
    });

    it('GAP-02 Test 7: should not fabricate coverage limits when policy model has no limit field', async () => {
      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ policyNumber: 'POL-V-1000' });

      expect(res.status).toBe(200);
      expect(res.body.data.coverage).toBeDefined();
      expect(res.body.data.coverage.limit).toBeUndefined();
      expect(res.body.data.coverage.coverageLimit).toBeUndefined();
      expect(res.body.data.coverage.limitType).toBeUndefined();
    });

    it('GAP-02 Test 8: should return coverage for THIRD_PARTY policy with deductible 0 and all incidents un-covered', async () => {
      await Policy.updateOne(
        { policyNumber: 'POL-V-4000' },
        { $set: { policyType: null, policyKind: 'UNIFIED_COMPULSORY' } }
      );

      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ policyNumber: 'POL-V-4000', incidentType: 'COLLISION' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isEligible).toBe(true);
      expect(res.body.data.eligibilityHint).toBe('NOT_COVERED_BY_POLICY_TYPE');

      const { coverage } = res.body.data;
      expect(coverage).toBeDefined();
      expect(coverage.policyKind).toBe('UNIFIED_COMPULSORY');
      expect(coverage.policyType).toBeNull();
      expect(coverage.deductible).toBe(0);
      expect(coverage.effectiveFrom).toBe('2025-01-01');
      expect(coverage.effectiveTo).toBe('2026-12-31');
      expect(coverage.incidents).toEqual([]);
    });

    it('GAP-02 Test 9: should maintain 100% backward compatibility of existing response envelope & fields', async () => {
      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ policyNumber: 'POL-V-1000' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Policy verified successfully');

      const data = res.body.data;
      expect(data).toHaveProperty('isEligible', true);
      expect(data).toHaveProperty('eligibilityHint');
      expect(data).toHaveProperty('policy');
      expect(data).toHaveProperty('coverage');
      expect(data).toHaveProperty('vehicle');
      expect(data).toHaveProperty('customer');

      // Verify policy object fields are completely unchanged
      expect(data.policy).toHaveProperty('id');
      expect(data.policy).toHaveProperty('policyNumber', 'POL-V-1000');
      expect(data.policy).toHaveProperty('status', 'ACTIVE');
      expect(data.policy).toHaveProperty('startDate', '2025-01-01');
      expect(data.policy).toHaveProperty('expiryDate', '2026-12-31');
      expect(data.policy).toHaveProperty('policyType', 'COMPREHENSIVE');
      expect(data.policy).toHaveProperty('coveredPerils');
      expect(data.policy).toHaveProperty('deductibleAmount', 500);

      // Verify vehicle object fields
      expect(data.vehicle).toHaveProperty('id');
      expect(data.vehicle).toHaveProperty('plateNumber', 'ABC-1234');
      expect(data.vehicle).toHaveProperty('make', 'Toyota');

      // Verify customer object fields
      expect(data.customer).toHaveProperty('id');
      expect(data.customer).toHaveProperty('fullName', 'Ahmad Ali');
      expect(data.customer).toHaveProperty('phone', '+962791234567');
      expect(Object.keys(data.customer)).toEqual(['id', 'fullName', 'phone']);
    });

    it('returns 200 and ELIGIBLE_FOR_REVIEW for policy status EXPIRED with incidentDate inside the period', async () => {
      const expCompId = new mongoose.Types.ObjectId();
      await Policy.collection.insertOne({
        _id: expCompId,
        policyNumber: 'POL-V-EXP-COMP',

        policyKind: 'COMPLEMENTARY',
        sumInsured: 50000,
        status: 'EXPIRED',
        startDate: new Date('2022-01-01T00:00:00Z'),
        expiryDate: new Date('2023-12-31T23:59:59Z'),
        policyType: 'COMPREHENSIVE',
        coveredPerils: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
        deductibleAmount: 500,
        organizationId: org1._id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyNumber: 'POL-V-EXP-COMP',

          incidentDate: '2023-06-15',
          incidentType: 'COLLISION',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isEligible).toBe(true);
      expect(res.body.data.eligibilityHint).toBe('ELIGIBLE_FOR_REVIEW');
      expect(res.body.data.coverage).toBeDefined();
      expect(res.body.data.coverage.policyType).toBe('COMPREHENSIVE');
    });
  });
  describe('PB-04a Policy verification extensions', () => {
    beforeEach(async () => {
      await Policy.updateOne(
        { policyNumber: 'POL-V-4000' },
        { $set: { policyType: null, policyKind: 'UNIFIED_COMPULSORY' } }
      );
    });
    it('verify by plate returns the only policy of a vehicle without policyKind', async () => {
      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ plateNumber: 'ABC-1234' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.policy.policyNumber).toBe('POL-V-1000');
      expect(res.body.data.policy.policyKind).toBe('COMPLEMENTARY');
    });

    it('verify by plate with two policies and no policyKind returns 422 AMBIGUOUS_POLICY_SELECTION', async () => {
      const compulPol = await buildPolicy({
        policyNumber: 'POL-DUAL-COMPUL',
        policyKind: 'UNIFIED_COMPULSORY',
        propertyDamageLimit: 100000,
        deductibleAmount: 0,
        organizationId: org1._id,
      });

      const complePol = await buildPolicy({
        policyNumber: 'POL-DUAL-COMPLE',
        policyKind: 'COMPLEMENTARY',
        policyType: 'COMPREHENSIVE',
        sumInsured: 50000,
        deductibleAmount: 500,
        organizationId: org1._id,
      });

      await Vehicle.create({
        plateNumber: 'DUAL-POL-VEH',
        customerId: customer1._id,
        compulsoryPolicyId: compulPol._id,
        complementaryPolicyId: complePol._id,
        organizationId: org1._id,
      });

      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ plateNumber: 'DUAL-POL-VEH' });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('AMBIGUOUS_POLICY_SELECTION');
    });

    it('verify by plate with policyKind returns that policy', async () => {
      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ plateNumber: 'DUAL-POL-VEH', policyKind: 'UNIFIED_COMPULSORY' });

      expect(res.status).toBe(200);
      expect(res.body.data.policy.policyNumber).toBe('POL-DUAL-COMPUL');
      expect(res.body.data.policy.policyKind).toBe('UNIFIED_COMPULSORY');
    });

    it('verify by plate with policyKind for an empty slot returns 404 POLICY_NOT_FOUND', async () => {
      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ plateNumber: 'ABC-1234', policyKind: 'UNIFIED_COMPULSORY' });

      expect(res.status).toBe(404);
      expect(res.body.errors[0].code).toBe('POLICY_NOT_FOUND');
    });

    it('rejects policyKind together with policyNumber with 400', async () => {
      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ policyNumber: 'POL-V-1000', policyKind: 'COMPLEMENTARY' });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('returns a coverage object and NOT_COVERED_BY_POLICY_TYPE for a UNIFIED_COMPULSORY policy with an own-damage peril', async () => {
      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ policyNumber: 'POL-V-4000', incidentType: 'COLLISION' });

      expect(res.status).toBe(200);
      expect(res.body.data.eligibilityHint).toBe('NOT_COVERED_BY_POLICY_TYPE');
      expect(res.body.data.coverage).toBeDefined();
      expect(res.body.data.coverage.policyKind).toBe('UNIFIED_COMPULSORY');
      expect(res.body.data.coverage.policyType).toBeNull();
      expect(res.body.data.coverage.incidents).toEqual([]);
    });

    it('returns policyKind, sumInsured, propertyDamageLimit and vehicleUse in the policy block', async () => {
      const customPol = await buildPolicy({
        policyNumber: 'POL-BLOCK-TEST',
        policyKind: 'COMPLEMENTARY',
        policyType: 'COMPREHENSIVE',
        sumInsured: 60000,
        vehicleUse: 'COMMERCIAL',
        deductibleAmount: 400,
        organizationId: org1._id,
      });

      const res = await request(app)
        .post('/api/v1/policies/verify')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ policyNumber: 'POL-BLOCK-TEST' });

      expect(res.status).toBe(200);
      expect(res.body.data.policy).toMatchObject({
        policyKind: 'COMPLEMENTARY',
        sumInsured: 60000,
        propertyDamageLimit: null,
        vehicleUse: 'COMMERCIAL',
      });
    });
  });
});

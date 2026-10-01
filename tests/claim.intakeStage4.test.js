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

describe('Stage 4A — Claim Intake, money, and validation (POST /api/v1/claims)', () => {
  let mongoServer;
  let org;
  let claimsOfficer;
  let adminUser;
  let officerToken;
  let adminToken;
  let customer;
  let activeCompPolicy;
  let cancelledPolicy;
  let expiredPolicy;
  let collisionOnlyPolicy;
  let legacyPolicy;
  let compVehicle;
  let cancelledVehicle;
  let expiredVehicle;
  let collisionVehicle;
  let legacyVehicle;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    org = await Organization.create({
      name: 'Intake Test Org',
      code: 'INTAKE',
      domain: 'intake.com',
      status: 'ACTIVE',
    });

    claimsOfficer = await User.create({
      name: 'Officer User',
      employeeCode: 'OF-101',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    officerToken = generateToken(claimsOfficer);

    adminUser = await User.create({
      name: 'Admin User',
      employeeCode: 'AD-101',
      password: 'password123',
      role: 'ADMIN',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    adminToken = generateToken(adminUser);

    customer = await Customer.create({
      fullName: 'Ahmad Customer',
      phone: '+962791112233',
      organizationId: org._id,
    });

    activeCompPolicy = await buildPolicy({
      policyNumber: 'POL-INTAKE-COMP',
      status: 'ACTIVE',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
      deductibleAmount: 500,
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2027-12-31T00:00:00Z'),
      organizationId: org._id,
    });

    cancelledPolicy = await buildPolicy({
      policyNumber: 'POL-INTAKE-CANC',
      status: 'CANCELLED',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      deductibleAmount: 500,
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2027-12-31T00:00:00Z'),
      organizationId: org._id,
    });

    expiredPolicy = await buildPolicy({
      policyNumber: 'POL-INTAKE-EXP',
      status: 'EXPIRED',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION', 'FIRE'],
      deductibleAmount: 500,
      startDate: new Date('2022-01-01T00:00:00Z'),
      expiryDate: new Date('2023-12-31T00:00:00Z'),
      organizationId: org._id,
    });

    compVehicle = await Vehicle.create({
      plateNumber: 'INT-1111',
      make: 'Toyota',
      model: 'Corolla',
      year: 2022,
      color: 'White',
      customerId: customer._id,
      policyId: activeCompPolicy._id,
      organizationId: org._id,
    });

    cancelledVehicle = await Vehicle.create({
      plateNumber: 'INT-2222',
      make: 'Hyundai',
      model: 'Elantra',
      year: 2021,
      color: 'Blue',
      customerId: customer._id,
      policyId: cancelledPolicy._id,
      organizationId: org._id,
    });

    expiredVehicle = await Vehicle.create({
      plateNumber: 'INT-3333',
      make: 'Kia',
      model: 'Cerato',
      year: 2020,
      color: 'Black',
      customerId: customer._id,
      policyId: expiredPolicy._id,
      organizationId: org._id,
    });

    collisionOnlyPolicy = await buildPolicy({
      policyNumber: 'POL-INTAKE-FIRE',
      status: 'ACTIVE',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['FIRE'],
      deductibleAmount: 500,
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2027-12-31T00:00:00Z'),
      organizationId: org._id,
    });

    const legacyPolicyId = new mongoose.Types.ObjectId();
    await Policy.collection.insertOne({
      _id: legacyPolicyId,
      policyNumber: 'POL-INTAKE-LEGACY',
      status: 'ACTIVE',
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2027-12-31T00:00:00Z'),
      organizationId: org._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    legacyPolicy = await Policy.findById(legacyPolicyId);

    collisionVehicle = await Vehicle.create({
      plateNumber: 'INT-4444',
      make: 'Nissan',
      model: 'Sunny',
      year: 2019,
      color: 'Silver',
      customerId: customer._id,
      policyId: collisionOnlyPolicy._id,
      organizationId: org._id,
    });

    legacyVehicle = await Vehicle.create({
      plateNumber: 'INT-5555',
      make: 'Mazda',
      model: '3',
      year: 2017,
      color: 'Red',
      customerId: customer._id,
      policyId: legacyPolicy._id,
      organizationId: org._id,
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  describe('Validation & Intake Fields (C1, C2, C4)', () => {
    it('returns 400 VALIDATION_ERROR when incidentDate is missing', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyId: activeCompPolicy._id.toString(),
          plateNumber: 'INT-1111',
          incidentType: 'COLLISION',
          incidentLocation: 'Amman - 7th Circle',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR when client sends eligibilityHint', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyId: activeCompPolicy._id.toString(),
          plateNumber: 'INT-1111',
          incidentType: 'COLLISION',
          incidentLocation: 'Amman - 7th Circle',
          incidentDate: '2026-06-15',
          eligibilityHint: 'ELIGIBLE_FOR_REVIEW',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('stores optional description as incidentDescription and returns it in GET /claims/:claimId', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyId: activeCompPolicy._id.toString(),
          plateNumber: 'INT-1111',
          incidentType: 'COLLISION',
          incidentLocation: 'Amman - 7th Circle',
          incidentDate: '2026-06-15',
          description: 'Front bumper hit another vehicle during traffic jam',
        });

      expect(res.status).toBe(201);
      const claimId = res.body.data.id;

      const getRes = await request(app)
        .get(`/api/v1/claims/${claimId}`)
        .set('Authorization', `Bearer ${officerToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.incidentDescription).toBe('Front bumper hit another vehicle during traffic jam');
    });

    it('returns null incidentDescription in GET when description is omitted', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyId: activeCompPolicy._id.toString(),
          plateNumber: 'INT-1111',
          incidentType: 'COLLISION',
          incidentLocation: 'Amman - 7th Circle',
          incidentDate: '2026-06-15',
        });

      expect(res.status).toBe(201);
      const claimId = res.body.data.id;

      const getRes = await request(app)
        .get(`/api/v1/claims/${claimId}`)
        .set('Authorization', `Bearer ${officerToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.incidentDescription).toBeNull();
    });

    it('succeeds when created by ADMIN (both roles from A4)', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          policyId: activeCompPolicy._id.toString(),
          plateNumber: 'INT-1111',
          incidentType: 'COLLISION',
          incidentLocation: 'Gardens St',
          incidentDate: '2026-06-15',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('NEW');
    });
  });

  describe('EligibilityHint Calculation & Storage (C2, C5)', () => {
    it('computes and stores eligibilityHint for ELIGIBLE_FOR_REVIEW and returns it in GET', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyId: activeCompPolicy._id.toString(),
          plateNumber: 'INT-1111',
          incidentType: 'COLLISION',
          incidentLocation: 'Amman Highway',
          incidentDate: '2026-06-15',
        });

      expect(res.status).toBe(201);

      const claimDoc = await Claim.findById(res.body.data.id).lean();
      expect(claimDoc.eligibilityHint).toBe('ELIGIBLE_FOR_REVIEW');

      const getRes = await request(app)
        .get(`/api/v1/claims/${res.body.data.id}`)
        .set('Authorization', `Bearer ${officerToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.eligibilityHint).toBe('ELIGIBLE_FOR_REVIEW');
    });

    it('computes and stores INCIDENT_OUTSIDE_POLICY_PERIOD when incidentDate is outside policy period', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyId: activeCompPolicy._id.toString(),
          plateNumber: 'INT-1111',
          incidentType: 'COLLISION',
          incidentLocation: 'Amman Highway',
          incidentDate: '2024-06-15', // before policy start 2025-01-01
        });

      expect(res.status).toBe(201);
      const claimDoc = await Claim.findById(res.body.data.id).lean();
      expect(claimDoc.eligibilityHint).toBe('INCIDENT_OUTSIDE_POLICY_PERIOD');
    });

    it('computes and stores NOT_COVERED_BY_POLICY_TYPE when peril is not covered', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyId: collisionOnlyPolicy._id.toString(),
          plateNumber: 'INT-4444',
          incidentType: 'COLLISION',
          incidentLocation: 'Amman Highway',
          incidentDate: '2026-06-15',
        });

      expect(res.status).toBe(201);
      const claimDoc = await Claim.findById(res.body.data.id).lean();
      expect(claimDoc.eligibilityHint).toBe('NOT_COVERED_BY_POLICY_TYPE');
    });

    it('computes and stores COVERAGE_UNKNOWN when policy has no policyType', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyId: legacyPolicy._id.toString(),
          plateNumber: 'INT-5555',
          incidentType: 'COLLISION',
          incidentLocation: 'Amman Highway',
          incidentDate: '2026-06-15',
        });

      expect(res.status).toBe(201);
      const claimDoc = await Claim.findById(res.body.data.id).lean();
      expect(claimDoc.eligibilityHint).toBe('COVERAGE_UNKNOWN');
    });

    it('creates claim for expired policy when incidentDate is inside the period (returns ELIGIBLE_FOR_REVIEW)', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyId: expiredPolicy._id.toString(),
          plateNumber: 'INT-3333',
          incidentType: 'COLLISION',
          incidentLocation: 'Downtown',
          incidentDate: '2023-06-15', // inside expiredPolicy period 2022-2023
        });

      expect(res.status).toBe(201);
      const claimDoc = await Claim.findById(res.body.data.id).lean();
      expect(claimDoc.eligibilityHint).toBe('ELIGIBLE_FOR_REVIEW');
    });

    it('still rejects cancelled policy with 422 POLICY_CANCELLED', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyId: cancelledPolicy._id.toString(),
          plateNumber: 'INT-2222',
          incidentType: 'COLLISION',
          incidentLocation: 'Airport Road',
          incidentDate: '2026-06-15',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('POLICY_CANCELLED');
    });
  });

  describe('Creation Response Shape: trackingUrl, eligibilityHint, coverageSnapshot (C3)', () => {
    it('returns trackingUrl, eligibilityHint, and populated coverageSnapshot on claim creation', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyId: activeCompPolicy._id.toString(),
          plateNumber: 'INT-1111',
          incidentType: 'COLLISION',
          incidentLocation: 'Amman Highway',
          incidentDate: '2026-06-15',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('claimNumber');
      expect(res.body.data.status).toBe('NEW');
      expect(res.body.data).toHaveProperty('trackingToken');
      expect(res.body.data).toHaveProperty('trackingUrl');
      expect(res.body.data.eligibilityHint).toBe('ELIGIBLE_FOR_REVIEW');
      expect(res.body.data.coverageSnapshot).toEqual({
        policyType: 'COMPREHENSIVE',
        coveredPerils: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
        deductibleAmount: 500,
        capturedAt: expect.any(String),
      });
      expect(res.body.data).toHaveProperty('createdAt');
    });

    it('returns coverageSnapshot as null when policy has no coverage details', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyId: legacyPolicy._id.toString(),
          plateNumber: 'INT-5555',
          incidentType: 'COLLISION',
          incidentLocation: 'Amman Highway',
          incidentDate: '2026-06-15',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.coverageSnapshot).toBeNull();
      expect(res.body.data.eligibilityHint).toBe('COVERAGE_UNKNOWN');
    });

    it('builds trackingUrl from config and returns null when publicFrontendUrl is unset', async () => {
      const originalUrl = config.publicFrontendUrl;
      try {
        config.publicFrontendUrl = 'https://portal.insurflow.com';
        const resWithUrl = await request(app)
          .post('/api/v1/claims')
          .set('Authorization', `Bearer ${officerToken}`)
          .send({
            policyId: activeCompPolicy._id.toString(),
            plateNumber: 'INT-1111',
            incidentType: 'COLLISION',
            incidentLocation: 'Mecca St',
            incidentDate: '2026-06-15',
          });

        expect(resWithUrl.status).toBe(201);
        expect(resWithUrl.body.data.trackingToken).toBeDefined();
        expect(resWithUrl.body.data.trackingUrl).toBe(`https://portal.insurflow.com/track/${resWithUrl.body.data.trackingToken}`);

        config.publicFrontendUrl = null;
        const resWithoutUrl = await request(app)
          .post('/api/v1/claims')
          .set('Authorization', `Bearer ${officerToken}`)
          .send({
            policyId: activeCompPolicy._id.toString(),
            plateNumber: 'INT-1111',
            incidentType: 'COLLISION',
            incidentLocation: 'Medina St',
            incidentDate: '2026-06-15',
          });

        expect(resWithoutUrl.status).toBe(201);
        expect(resWithoutUrl.body.data.trackingUrl).toBeNull();
      } finally {
        config.publicFrontendUrl = originalUrl;
      }
    });

    it('exports buildTrackingUrl helper directly from claim.service and handles URLs correctly', () => {
      const claimService = require('../src/modules/claims/claim.service');
      expect(typeof claimService.buildTrackingUrl).toBe('function');

      const originalUrl = config.publicFrontendUrl;
      try {
        config.publicFrontendUrl = 'https://portal.insurflow.com';
        expect(claimService.buildTrackingUrl('test-token-123')).toBe('https://portal.insurflow.com/track/test-token-123');
        expect(claimService.buildTrackingUrl(null)).toBeNull();
        expect(claimService.buildTrackingUrl('')).toBeNull();
        expect(claimService.buildTrackingUrl(undefined)).toBeNull();

        config.publicFrontendUrl = 'https://portal.insurflow.com///';
        expect(claimService.buildTrackingUrl('test-token-123')).toBe('https://portal.insurflow.com/track/test-token-123');

        config.publicFrontendUrl = null;
        expect(claimService.buildTrackingUrl('test-token-123')).toBeNull();
      } finally {
        config.publicFrontendUrl = originalUrl;
      }
    });

    it('ensures config.publicFrontendUrl exists on env config', () => {
      expect('publicFrontendUrl' in config).toBe(true);
    });
  });
});

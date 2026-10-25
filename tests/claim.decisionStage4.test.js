const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const Policy = require('../src/modules/policies/policy.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Customer = require('../src/modules/customers/customer.model');
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

describe('Stage 4A — Financial Adjudication & Deductible Rules (POST /claims/:claimId/decision)', () => {
  let mongoServer;
  let org;
  let officer;
  let admin;
  let adjuster;
  let officerToken;
  let adminToken;
  let customer;
  let policy500;
  let policy0;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    org = await Organization.create({
      name: 'Decision Test Org',
      code: 'DECIDE',
      domain: 'decide.com',
      status: 'ACTIVE',
    });

    officer = await User.create({
      name: 'Officer Decision',
      employeeCode: 'OF-DEC',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    officerToken = generateToken(officer);

    admin = await User.create({
      name: 'Admin Decision',
      employeeCode: 'AD-DEC',
      password: 'password123',
      role: 'ADMIN',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    adminToken = generateToken(admin);

    adjuster = await User.create({
      name: 'Adjuster Decision',
      employeeCode: 'FA-DEC',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org._id,
      status: 'ACTIVE',
    });

    customer = await Customer.create({
      fullName: 'Decision Customer',
      phone: '+962791112233',
      organizationId: org._id,
    });

    policy500 = await buildPolicy({
      policyNumber: 'POL-DEC-500',
      status: 'ACTIVE',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
      deductibleAmount: 50000,
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2027-12-31T00:00:00Z'),
      organizationId: org._id,
    });

    policy0 = await buildPolicy({
      policyNumber: 'POL-DEC-0',
      status: 'ACTIVE',
      policyKind: 'UNIFIED_COMPULSORY',
      coveredPerils: [],
      deductibleAmount: 0,
      propertyDamageLimit: 10000000,
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2027-12-31T00:00:00Z'),
      organizationId: org._id,
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  const createUnderReviewClaim = async (policy, deductibleAmount = 50000) => {
    return await Claim.create({
      organizationId: org._id,
      policyId: policy._id,
      createdBy: officer._id,
      status: 'UNDER_REVIEW',
      customer: { name: 'Test Customer', phone: '+962791112233' },
      incidentType: 'COLLISION',
      incidentLocation: 'Amman Highway',
      incidentDate: '2026-06-15',
      coverageSnapshot: {
        policyType: policy.policyType || 'COMPREHENSIVE',
        coveredPerils: policy.coveredPerils || ['COLLISION'],
        deductibleAmount: deductibleAmount === 500 ? 50000 : deductibleAmount,
        capturedAt: new Date(),
      },
    });
  };

  describe('Mandatory lossAssessment validation (D1, D2)', () => {
    it('returns 400 VALIDATION_ERROR when APPROVED decision is sent without lossAssessment', async () => {
      const claim = await createUnderReviewClaim(policy500, 500);

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          notes: 'Approval attempt without financial breakdown',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR when REJECTED decision includes lossAssessment', async () => {
      const claim = await createUnderReviewClaim(policy500, 500);

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'REJECTED',
          notes: 'Fraud detected',
          lossAssessment: {
            estimatedPartsCost: 500,
            laborCost: 300,
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR when client sends totalDamage in lossAssessment', async () => {
      const claim = await createUnderReviewClaim(policy500, 500);

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          lossAssessment: {
            estimatedPartsCost: 500,
            laborCost: 300,
            deductibleApplied: 500,
            totalDamage: 800,
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('allows zero estimatedPartsCost with positive laborCost', async () => {
      const claim = await createUnderReviewClaim(policy0, 0);

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          lossAssessment: {
            estimatedPartsCost: 0,
            laborCost: 450,
            deductibleApplied: 0,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('APPROVED');
      expect(res.body.data.lossAssessment.estimatedPartsCost).toBe(0);
      expect(res.body.data.lossAssessment.laborCost).toBe(450);
      expect(res.body.data.lossAssessment.totalDamage).toBe(450);
      expect(res.body.data.lossAssessment.netApprovedPayout).toBe(450);
    });

    it('returns 400 VALIDATION_ERROR when all three amounts are zero', async () => {
      const claim = await createUnderReviewClaim(policy0, 0);

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          lossAssessment: {
            estimatedPartsCost: 0,
            laborCost: 0,
            deductibleApplied: 0,
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
      expect(res.body.errors[0].details).toBe('totalDamage must be greater than zero');
    });
  });

  describe('Deductible override rules & audit notes (D4, D5)', () => {
    it('zero deductible against zero policy deductible works with deductibleOverridden: false', async () => {
      const claim = await createUnderReviewClaim(policy0, 0);

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          lossAssessment: {
            estimatedPartsCost: 500,
            laborCost: 300,
            deductibleApplied: 0,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.lossAssessment.deductibleApplied).toBe(0);
      expect(res.body.data.lossAssessment.policyDeductible).toBe(0);
      expect(res.body.data.lossAssessment.deductibleOverridden).toBe(false);
      expect(res.body.data.lossAssessment.deductibleOverrideReason).toBeNull();
    });

    it('zero deductible against 500 policy deductible requires reason', async () => {
      const claim = await createUnderReviewClaim(policy500, 500);

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          lossAssessment: {
            estimatedPartsCost: 500,
            laborCost: 300,
            deductibleApplied: 0,
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('OVERRIDE_REASON_REQUIRED');
    });

    it('a 9-character reason on override returns 422 OVERRIDE_REASON_REQUIRED', async () => {
      const claim = await createUnderReviewClaim(policy500, 500);

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          lossAssessment: {
            estimatedPartsCost: 500,
            laborCost: 300,
            deductibleApplied: 200,
            deductibleOverrideReason: '123456789',
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('OVERRIDE_REASON_REQUIRED');
    });

    it('a 10-character reason passes on override', async () => {
      const claim = await createUnderReviewClaim(policy500, 500);

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          lossAssessment: {
            estimatedPartsCost: 500,
            laborCost: 300,
            deductibleApplied: 200,
            deductibleOverrideReason: '1234567890',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.lossAssessment.deductibleOverridden).toBe(true);
      expect(res.body.data.lossAssessment.deductibleOverrideReason).toBe('1234567890');
    });

    it('a 301-character reason on override returns 422 OVERRIDE_REASON_REQUIRED', async () => {
      const claim = await createUnderReviewClaim(policy500, 500);

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          lossAssessment: {
            estimatedPartsCost: 500,
            laborCost: 300,
            deductibleApplied: 200,
            deductibleOverrideReason: 'A'.repeat(301),
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('OVERRIDE_REASON_REQUIRED');
    });

    it('a reason without override returns 422 OVERRIDE_REASON_NOT_ALLOWED', async () => {
      const claim = await createUnderReviewClaim(policy500, 500);

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          lossAssessment: {
            estimatedPartsCost: 500,
            laborCost: 300,
            deductibleApplied: 500,
            deductibleOverrideReason: 'Redundant reason sent',
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('OVERRIDE_REASON_NOT_ALLOWED');
    });

    it('a whitespace-only reason without override passes as no reason', async () => {
      const claim = await createUnderReviewClaim(policy500, 500);

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          lossAssessment: {
            estimatedPartsCost: 500,
            laborCost: 300,
            deductibleApplied: 500,
            deductibleOverrideReason: '   ',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.lossAssessment.deductibleOverridden).toBe(false);
      expect(res.body.data.lossAssessment.deductibleOverrideReason).toBeNull();
    });

    it('deductibleOverridden true and false persist and return in decision response and GET /claims/:claimId', async () => {
      // 1. Overridden: true
      const claimTrue = await createUnderReviewClaim(policy500, 500);
      const resTrue = await request(app)
        .post(`/api/v1/claims/${claimTrue._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          lossAssessment: {
            estimatedPartsCost: 600,
            laborCost: 400,
            deductibleApplied: 250,
            deductibleOverrideReason: 'Special commercial discount waiver',
          },
        });

      expect(resTrue.status).toBe(200);
      expect(resTrue.body.data.lossAssessment.deductibleOverridden).toBe(true);

      const dbClaimTrue = await Claim.findById(claimTrue._id);
      expect(dbClaimTrue.lossAssessment.deductibleOverridden).toBe(true);

      const getResTrue = await request(app)
        .get(`/api/v1/claims/${claimTrue._id}`)
        .set('Authorization', `Bearer ${officerToken}`);
      expect(getResTrue.status).toBe(200);
      expect(getResTrue.body.data.lossAssessment.deductibleOverridden).toBe(true);

      // 2. Overridden: false
      const claimFalse = await createUnderReviewClaim(policy500, 500);
      const resFalse = await request(app)
        .post(`/api/v1/claims/${claimFalse._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          lossAssessment: {
            estimatedPartsCost: 600,
            laborCost: 400,
            deductibleApplied: 500,
          },
        });

      expect(resFalse.status).toBe(200);
      expect(resFalse.body.data.lossAssessment.deductibleOverridden).toBe(false);

      const dbClaimFalse = await Claim.findById(claimFalse._id);
      expect(dbClaimFalse.lossAssessment.deductibleOverridden).toBe(false);

      const getResFalse = await request(app)
        .get(`/api/v1/claims/${claimFalse._id}`)
        .set('Authorization', `Bearer ${officerToken}`);
      expect(getResFalse.status).toBe(200);
      expect(getResFalse.body.data.lossAssessment.deductibleOverridden).toBe(false);
    });

    it('timeline notes carry the override marker only when overridden', async () => {
      // Overridden
      const claimOverridden = await createUnderReviewClaim(policy500, 500);
      const resOverride = await request(app)
        .post(`/api/v1/claims/${claimOverridden._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          notes: 'Standard officer check',
          lossAssessment: {
            estimatedPartsCost: 700,
            laborCost: 300,
            deductibleApplied: 200,
            deductibleOverrideReason: 'VIP client deductible reduction',
          },
        });

      expect(resOverride.status).toBe(200);
      const dbClaimOverridden = await Claim.findById(claimOverridden._id);
      const overrideEvent = dbClaimOverridden.timeline.find((t) => t.action === 'Claim Approved');
      expect(overrideEvent.notes).toContain('[DEDUCTIBLE OVERRIDE] policy deductible 500, applied 200. Reason: VIP client deductible reduction');

      // Not overridden
      const claimStandard = await createUnderReviewClaim(policy500, 500);
      const resStandard = await request(app)
        .post(`/api/v1/claims/${claimStandard._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          notes: 'Standard approval without override',
          lossAssessment: {
            estimatedPartsCost: 700,
            laborCost: 300,
            deductibleApplied: 500,
          },
        });

      expect(resStandard.status).toBe(200);
      const dbClaimStandard = await Claim.findById(claimStandard._id);
      const standardEvent = dbClaimStandard.timeline.find((t) => t.action === 'Claim Approved');
      expect(standardEvent.notes).not.toContain('[DEDUCTIBLE OVERRIDE]');
    });

    it('ADMIN and CLAIMS_OFFICER both override successfully', async () => {
      // Officer
      const claimOfficer = await createUnderReviewClaim(policy500, 500);
      const resOfficer = await request(app)
        .post(`/api/v1/claims/${claimOfficer._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          lossAssessment: {
            estimatedPartsCost: 600,
            laborCost: 200,
            deductibleApplied: 250,
            deductibleOverrideReason: 'Officer approved reduction',
          },
        });
      expect(resOfficer.status).toBe(200);
      expect(resOfficer.body.data.lossAssessment.deductibleOverridden).toBe(true);

      // Admin
      const claimAdmin = await createUnderReviewClaim(policy500, 500);
      const resAdmin = await request(app)
        .post(`/api/v1/claims/${claimAdmin._id}/decision`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          decision: 'APPROVED',
          lossAssessment: {
            estimatedPartsCost: 600,
            laborCost: 200,
            deductibleApplied: 250,
            deductibleOverrideReason: 'Admin approved reduction',
          },
        });
      expect(resAdmin.status).toBe(200);
      expect(resAdmin.body.data.lossAssessment.deductibleOverridden).toBe(true);
    });
  });
});


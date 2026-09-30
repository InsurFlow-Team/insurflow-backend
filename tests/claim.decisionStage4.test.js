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
      deductibleAmount: 500,
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2027-12-31T00:00:00Z'),
      organizationId: org._id,
    });

    policy0 = await buildPolicy({
      policyNumber: 'POL-DEC-0',
      status: 'ACTIVE',
      policyType: 'THIRD_PARTY',
      coveredPerils: [],
      deductibleAmount: 0,
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2027-12-31T00:00:00Z'),
      organizationId: org._id,
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  const createUnderReviewClaim = async (policy, deductibleAmount = 500) => {
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
        deductibleAmount,
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
  });
});

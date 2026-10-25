const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const Policy = require('../src/modules/policies/policy.model');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');
const { buildPolicy } = require('./helpers/policyFactory');

jest.mock('../src/modules/notifications/notification.service', () => ({
  createAndSendNotification: jest.fn().mockResolvedValue({}),
  sendToOrganization: jest.fn().mockResolvedValue({}),
}));

jest.setTimeout(30000);

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

describe('Claim Loss Assessment Financial Adjudication (POST /claims/:claimId/decision)', () => {
  let org1, org2;
  let officer1, officer2, admin1, adjuster1;
  let policy1, claimUnderReview;

  beforeEach(async () => {
    org1 = await Organization.create({ name: 'Alpha Org', code: 'ALP' });
    org2 = await Organization.create({ name: 'Beta Org', code: 'BET' });

    policy1 = await buildPolicy({
      policyNumber: 'POL-ALP-100',
      status: 'ACTIVE',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION', 'THEFT'],
      deductibleAmount: 50000,
      startDate: new Date('2026-01-01'),
      expiryDate: new Date('2027-12-31'),
      organizationId: org1._id,
    });

    officer1 = await User.create({
      name: 'Officer One',
      employeeCode: 'OFF-01',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
    });

    officer2 = await User.create({
      name: 'Officer Two',
      employeeCode: 'OFF-02',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org2._id,
    });

    admin1 = await User.create({
      name: 'Admin One',
      employeeCode: 'ADM-01',
      password: 'password123',
      role: 'ADMIN',
      organizationId: org1._id,
    });

    adjuster1 = await User.create({
      name: 'Adjuster One',
      employeeCode: 'ADJ-01',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    claimUnderReview = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      status: 'UNDER_REVIEW',
      customer: { name: 'Sami Ahmad', phone: '0599123456' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah Main St',
      coverageSnapshot: {
        policyType: 'COMPREHENSIVE',
        coveredPerils: ['COLLISION', 'THEFT'],
        deductibleAmount: 50000,
        capturedAt: new Date(),
      },
    });
  });

  // ─── 1. Valid Approval with lossAssessment ─────────────────────────────
  it('should approve claim and calculate totalDamage and netApprovedPayout from snapshot deductible', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        notes: 'Repair estimate confirmed by inspector',
        lossAssessment: {
          estimatedPartsCost: 1200.0,
          laborCost: 800.0,
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('APPROVED');
    expect(response.body.data.lossAssessment).toBeDefined();

    const la = response.body.data.lossAssessment;
    expect(la.estimatedPartsCost).toBe(1200);
    expect(la.laborCost).toBe(800);
    expect(la.totalDamage).toBe(2000);
    expect(la.policyDeductible).toBe(500);
    expect(la.deductibleApplied).toBe(500);
    expect(la.deductibleOverrideReason).toBeNull();
    expect(la.netApprovedPayout).toBe(1500);
    expect(la.currency).toBe('ILS');

    // DB Verification
    const dbClaim = await Claim.findById(claimUnderReview._id);
    expect(dbClaim.status).toBe('APPROVED');
    expect(dbClaim.lossAssessment.totalDamage).toBe(200000);
    expect(dbClaim.lossAssessment.netApprovedPayout).toBe(150000);
    expect(dbClaim.lossAssessment.assessedBy.toString()).toBe(officer1._id.toString());
  });

  // ─── 2. Floating-Point Cents Arithmetic Precision ───────────────────────
  it('should accurately calculate net payout for 0.10 + 0.20 avoiding floating point imprecision', async () => {
    // Override deductible to 0 for this test
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 0.1,
          laborCost: 0.2,
          deductibleApplied: 0,
          deductibleOverrideReason: 'Special executive waiver for micro test',
        },
      });

    expect(response.status).toBe(200);
    const la = response.body.data.lossAssessment;
    expect(la.totalDamage).toBe(0.3);
    expect(la.netApprovedPayout).toBe(0.3);
  });

  // ─── 3. Decimal Precision Validation (> 2 Decimals Rejected) ───────────
  it('should return 400 if financial fields exceed 2 decimal places', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 12.345,
          laborCost: 50.0,
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Validation Error');
  });

  // ─── 4. Negative and Max Amount Validation ──────────────────────────────
  it('should return 400 if financial amount is negative', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: -50,
          laborCost: 100,
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('should return 400 if financial amount exceeds maximum 1,000,000', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 1000001,
          laborCost: 100,
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  // ─── 5. Strict Type Validation (.strict() rejects string numbers) ──────
  it('should return 400 if financial fields are sent as string numbers like "12.50"', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: '12.50',
          laborCost: 100,
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Validation Error');
  });

  // ─── 6. Unknown Key Rejection (netApprovedPayout, totalDamage, etc.) ───
  it('should return 400 if client sends calculated or unknown keys in lossAssessment', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 500,
          laborCost: 300,
          netApprovedPayout: 300, // forbidden calculated key
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Validation Error');
  });

  it('should return 400 if client sends totalDamage in lossAssessment', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 500,
          laborCost: 300,
          totalDamage: 800,
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  // ─── 7. Reject lossAssessment on REJECTED ────────────────────────────────
  it('should return 400 if lossAssessment is provided when decision is REJECTED', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'REJECTED',
        notes: 'Fraudulent damage',
        lossAssessment: {
          estimatedPartsCost: 500,
          laborCost: 200,
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('should allow REJECTED decision without lossAssessment', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'REJECTED',
        notes: 'Damage does not match collision description',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('REJECTED');
  });

  // ─── 8. Damage Below or Equal to Deductible ──────────────────────────────
  it('should return 422 DAMAGE_BELOW_DEDUCTIBLE and leave claim UNDER_REVIEW when damage <= deductible', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 200,
          laborCost: 200, // Total = 400 <= deductible 500
        },
      });

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.errors[0].code).toBe('DAMAGE_BELOW_DEDUCTIBLE');

    // Confirm state has not changed in database
    const dbClaim = await Claim.findById(claimUnderReview._id);
    expect(dbClaim.status).toBe('UNDER_REVIEW');
    expect(dbClaim.lossAssessment).toBeNull();
  });

  // ─── 9. Deductible Override with Reason ──────────────────────────────────
  it('should accept deductible override with valid reason (5-300 chars)', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 1000,
          laborCost: 500,
          deductibleApplied: 250,
          deductibleOverrideReason: 'Commercial partnership goodwill discount',
        },
      });

    expect(response.status).toBe(200);
    const la = response.body.data.lossAssessment;
    expect(la.totalDamage).toBe(1500);
    expect(la.policyDeductible).toBe(500);
    expect(la.deductibleApplied).toBe(250);
    expect(la.deductibleOverrideReason).toBe('Commercial partnership goodwill discount');
    expect(la.netApprovedPayout).toBe(1250);
  });

  it('should return 400 when deductible is overridden without reason', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 1000,
          laborCost: 500,
          deductibleApplied: 250,
        },
      });

    expect(response.status).toBe(422);
    expect(response.body.errors[0].code).toBe('OVERRIDE_REASON_REQUIRED');
  });

  it('should return 422 OVERRIDE_REASON_NOT_ALLOWED if deductibleOverrideReason is sent when deductibleApplied equals policyDeductible', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 1000,
          laborCost: 500,
          deductibleApplied: 500,
          deductibleOverrideReason: 'Redundant explanation provided',
        },
      });

    expect(response.status).toBe(422);
    expect(response.body.errors[0].code).toBe('OVERRIDE_REASON_NOT_ALLOWED');
  });

  it('should store deductibleOverrideReason ONLY when deductibleApplied differs from policyDeductible', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 1000,
          laborCost: 500,
          deductibleApplied: 300,
          deductibleOverrideReason: 'Loyalty customer discount applied',
        },
      });

    expect(response.status).toBe(200);
    const la = response.body.data.lossAssessment;
    expect(la.deductibleApplied).toBe(300);
    expect(la.deductibleOverrideReason).toBe('Loyalty customer discount applied');

    const dbClaim = await Claim.findById(claimUnderReview._id);
    expect(dbClaim.lossAssessment.deductibleOverrideReason).toBe('Loyalty customer discount applied');
  });

  // ─── 9d. Exponential Notation and Precision Edge Cases ─────────────────
  it('should reject 1e-7 (exponential float that bypasses string-based checks)', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 1e-7,
          laborCost: 600,
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('should reject 0.30000000000000004 (IEEE 754 artifact)', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 0.30000000000000004,
          laborCost: 600,
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('should accept 12.5, 0.1, and 1000000 as valid financial values', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 12.5,
          laborCost: 0.1,
          deductibleApplied: 0,
          deductibleOverrideReason: 'Full waiver for valid precision test',
        },
      });

    expect(response.status).toBe(200);
    const la = response.body.data.lossAssessment;
    expect(la.estimatedPartsCost).toBe(12.5);
    expect(la.laborCost).toBe(0.1);
    expect(la.totalDamage).toBe(12.6);
  });

  // ─── 9e. Snapshot null when policy has policyType but deductibleAmount is null ──
  it('should set coverageSnapshot to null when policy policyType exists but deductibleAmount is null', async () => {
    const halfLegacyPolicyId = new mongoose.Types.ObjectId();
    await Policy.collection.insertOne({
      _id: halfLegacyPolicyId,
      policyNumber: 'POL-HALFLEG-01',
      status: 'ACTIVE',
      policyKind: 'COMPLEMENTARY',
      policyType: 'COMPREHENSIVE',
      sumInsured: 50000,
      deductibleAmount: null,
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2027-12-31T00:00:00Z'),
      organizationId: org1._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const Customer = require('../src/modules/customers/customer.model');
    const Vehicle = require('../src/modules/vehicles/vehicle.model');

    const cust = await Customer.create({
      fullName: 'Half Legacy Customer',
      phone: '+962791118899',
      organizationId: org1._id,
    });

    await Vehicle.create({
      plateNumber: 'HALF-9999',
      make: 'Kia',
      model: 'Sportage',
      year: 2022,
      customerId: cust._id,
      complementaryPolicyId: halfLegacyPolicyId,
      organizationId: org1._id,
    });

    const token = generateToken(officer1);
    const createRes = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${token}`)
      .send({
        policyId: halfLegacyPolicyId.toString(),
        plateNumber: 'HALF-9999',
        incidentType: 'COLLISION',
        incidentLocation: 'Irbid Center',
        incidentDate: '2026-06-15',
      });

    expect(createRes.status).toBe(201);
    const claimId = createRes.body.data.id;

    const dbClaim = await Claim.findById(claimId).lean();
    expect(dbClaim.coverageSnapshot).toBeNull();
  });

  // ─── 10. Fallback Deductible Hierarchy (Legacy claims without snapshot) ──
  it('should fallback to live policy deductible when claim has no coverageSnapshot', async () => {
    const legacyClaim = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      status: 'UNDER_REVIEW',
      customer: { name: 'Legacy Customer', phone: '0599000111' },
      incidentType: 'COLLISION',
      incidentLocation: 'Hebron Old City',
      coverageSnapshot: null, // Legacy claim without snapshot
    });

    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${legacyClaim._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 800,
          laborCost: 400,
        },
      });

    expect(response.status).toBe(200);
    const la = response.body.data.lossAssessment;
    expect(la.policyDeductible).toBe(500); // from policy1
    expect(la.netApprovedPayout).toBe(700); // 1200 - 500
  });

  it('should fallback to 0 deductible when policy cannot be found for legacy claim', async () => {
    const orphanPolicyId = new mongoose.Types.ObjectId();
    const legacyOrphanClaim = await Claim.create({
      organizationId: org1._id,
      policyId: orphanPolicyId,
      createdBy: officer1._id,
      status: 'UNDER_REVIEW',
      customer: { name: 'Orphan Customer', phone: '0599000222' },
      incidentType: 'COLLISION',
      incidentLocation: 'Nablus Downtown',
      coverageSnapshot: null,
    });

    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${legacyOrphanClaim._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 500,
          laborCost: 300,
        },
      });

    expect(response.status).toBe(200);
    const la = response.body.data.lossAssessment;
    expect(la.policyDeductible).toBe(0);
    expect(la.netApprovedPayout).toBe(800);
  });

  // ─── 11. Mandatory lossAssessment on Approval ──────────────────────────
  it('should enforce lossAssessment when decision is APPROVED', async () => {
    const token = generateToken(officer1);

    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        notes: 'Attempting approval without lossAssessment',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errors[0].code).toBe('VALIDATION_ERROR');
    expect(response.body.errors[0].details).toMatch(/lossAssessment is required/i);
  });

  // ─── 12. Immutability: Claim Updates Never Alter coverageSnapshot or lossAssessment ─
  it('should reject unauthorized fields like coverageSnapshot in update endpoints and keep snapshot unchanged', async () => {
    claimUnderReview.status = 'IN_PROGRESS';
    claimUnderReview.assignedTo = adjuster1._id;
    await claimUnderReview.save();

    const adjusterToken = generateToken(adjuster1);

    // 1. Attempting to inject coverageSnapshot in PUT /accident is rejected by Joi (400)
    const rejectRes = await request(app)
      .put(`/api/v1/claims/${claimUnderReview._id}/accident`)
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({
        accidentType: 'REAR_END_COLLISION',
        accidentDate: '2026-09-20',
        accidentTime: '14:30',
        description: 'Rear ended at traffic light',
        damageDescription: 'Bumper dented and cracked tail light',
        coverageSnapshot: { deductibleAmount: 0 },
      });

    expect(rejectRes.status).toBe(400);

    // 2. Normal update succeeds (200) and leaves coverageSnapshot completely untouched
    const validRes = await request(app)
      .put(`/api/v1/claims/${claimUnderReview._id}/accident`)
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({
        accidentType: 'REAR_END_COLLISION',
        accidentDate: '2026-09-20',
        accidentTime: '14:30',
        description: 'Rear ended at traffic light',
        damageDescription: 'Bumper dented and cracked tail light',
      });

    expect(validRes.status).toBe(200);

    // Verify snapshot in DB is completely untouched
    const dbClaim = await Claim.findById(claimUnderReview._id);
    expect(dbClaim.coverageSnapshot.deductibleAmount).toBe(50000);
    expect(dbClaim.coverageSnapshot.policyType).toBe('COMPREHENSIVE');
    expect(dbClaim.lossAssessment).toBeNull();
  });

  // ─── 13. Query and PDF Report Integration ────────────────────────────────
  it('should expose lossAssessment in GET /claims/:id and include financial table in report', async () => {
    const token = generateToken(officer1);

    // First approve with assessment
    await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 1500,
          laborCost: 500,
        },
      });

    // 1. Check GET /claims/:id
    const getRes = await request(app)
      .get(`/api/v1/claims/${claimUnderReview._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.lossAssessment).toBeDefined();
    expect(getRes.body.data.lossAssessment.netApprovedPayout).toBe(1500); // 2000 - 500
    expect(getRes.body.data.lossAssessment.assessedBy.name).toBe('Officer One');

    // 2. Check GET /claims/:id/report
    const reportRes = await request(app)
      .get(`/api/v1/claims/${claimUnderReview._id}/report`)
      .set('Authorization', `Bearer ${token}`);

    expect(reportRes.status).toBe(200);
    expect(reportRes.header['content-type']).toBe('application/pdf');
    expect(reportRes.body.length).toBeGreaterThan(1000);
  });
  it('stores lossAssessment as integer minor units and returns major units', async () => {
    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 1200,
          laborCost: 800,
          deductibleApplied: 500,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.lossAssessment.estimatedPartsCost).toBe(1200);
    expect(res.body.data.lossAssessment.laborCost).toBe(800);
    expect(res.body.data.lossAssessment.totalDamage).toBe(2000);
    expect(res.body.data.lossAssessment.policyDeductible).toBe(500);
    expect(res.body.data.lossAssessment.deductibleApplied).toBe(500);
    expect(res.body.data.lossAssessment.netApprovedPayout).toBe(1500);

    const dbClaim = await Claim.findById(claimUnderReview._id).lean();
    expect(dbClaim.lossAssessment.estimatedPartsCost).toBe(120000);
    expect(dbClaim.lossAssessment.laborCost).toBe(80000);
    expect(dbClaim.lossAssessment.totalDamage).toBe(200000);
    expect(dbClaim.lossAssessment.policyDeductible).toBe(50000);
    expect(dbClaim.lossAssessment.deductibleApplied).toBe(50000);
    expect(dbClaim.lossAssessment.netApprovedPayout).toBe(150000);
  });
});

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const Policy = require('../src/modules/policies/policy.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const { buildPolicy } = require('./helpers/policyFactory');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');
const { PUBLIC_STATUS_MAP } = require('../src/modules/claims/claim.service');

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

describe('Public Claim Tracking (Feature 23)', () => {
  let org1, org2;
  let officer1;
  let testPolicy, testPolicyOrg2;

  beforeEach(async () => {
    org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1' });
    org2 = await Organization.create({ name: 'Org 2', code: 'ORG-2' });

    testPolicy = await buildPolicy({
      policyNumber: 'POL-TRACK-001',
      status: 'ACTIVE',
      startDate: new Date('2025-01-01'),
      expiryDate: new Date('2027-12-31'),
      organizationId: org1._id,
    });
    testPolicyOrg2 = await buildPolicy({
      policyNumber: 'POL-TRACK-002',
      status: 'ACTIVE',
      startDate: new Date('2025-01-01'),
      expiryDate: new Date('2027-12-31'),
      organizationId: org2._id,
    });

    officer1 = await User.create({
      name: 'Officer1',
      employeeCode: 'OFC-T1',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
    });
  });

  // ─── Helper: create a claim with a tracking token ──────────────────────
  const createClaimWithToken = async (orgId, policyId, createdById, overrides = {}) => {
    const crypto = require('crypto');
    const claim = await Claim.create({
      organizationId: orgId,
      policyId: policyId,
      createdBy: createdById,
      status: 'NEW',
      trackingToken: crypto.randomBytes(32).toString('hex'),
      customer: { name: 'Ahmad Khalid', phone: '+972501234567' },
      vehicle: { plateNumber: 'ABC-123' },
      incidentType: 'COLLISION',
      incidentLocation: 'Riyadh Main Road',
      timeline: [
        {
          action: 'Claim Created',
          performedBy: createdById,
          role: 'CLAIMS_OFFICER',
          timestamp: new Date(),
        },
      ],
      ...overrides,
    });
    return claim;
  };

  // ─── Functional Tests ──────────────────────────────────────────────────

  describe('GET /api/v1/public/claims/track/:trackingToken', () => {
    it('should return claim status for a valid tracking token (no auth required)', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id);

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Claim status retrieved successfully');
      expect(res.body.data.claimNumber).toBe(claim.claimNumber);
      expect(res.body.data.status).toBe('RECEIVED'); // NEW → RECEIVED
      expect(res.body.data.statusDescription).toBe('Your claim has been received and is being processed.');
      expect(res.body.data.customerName).toBe('Ahmad Khalid');
      expect(res.body.data.incidentType).toBe('COLLISION');
      expect(res.body.data.createdAt).toBeDefined();
      expect(res.body.data.updatedAt).toBeDefined();
      expect(Array.isArray(res.body.data.timeline)).toBe(true);
    });

    it('should return 404 for an unknown tracking token with anti-cache headers and no error details', async () => {
      const unknownToken = 'a'.repeat(64);

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${unknownToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Claim not found');
      expect(res.body.errors).toBeUndefined();
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
    });

    it('should return 404 for a malformed token (too short) with identical anti-cache headers', async () => {
      const res = await request(app)
        .get('/api/v1/public/claims/track/abc123');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Claim not found');
      expect(res.body.errors).toBeUndefined();
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
    });

    it('should return 404 for a malformed token (uppercase hex)', async () => {
      const res = await request(app)
        .get(`/api/v1/public/claims/track/${'A'.repeat(64)}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toBeUndefined();
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('should return 404 for a malformed token (non-hex characters)', async () => {
      const res = await request(app)
        .get(`/api/v1/public/claims/track/${'g'.repeat(64)}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toBeUndefined();
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('should set Cache-Control: no-store header', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id);

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
    });
  });

  // ─── Customer-Friendly Status Mapping Tests ────────────────────────────

  describe('Customer-friendly status mapping', () => {
    const statusTests = [
      { internal: 'NEW', expectedPublic: 'RECEIVED' },
      { internal: 'PENDING_ACCEPTANCE', expectedPublic: 'RECEIVED' },
      { internal: 'ASSIGNED', expectedPublic: 'IN_PROGRESS' },
      { internal: 'IN_PROGRESS', expectedPublic: 'IN_PROGRESS' },
      { internal: 'SUBMITTED', expectedPublic: 'IN_REVIEW' },
      { internal: 'UNDER_REVIEW', expectedPublic: 'IN_REVIEW' },
      { internal: 'CORRECTION_REQUIRED', expectedPublic: 'IN_PROGRESS' },
      { internal: 'APPROVED', expectedPublic: 'APPROVED' },
      { internal: 'REJECTED', expectedPublic: 'REJECTED' },
      { internal: 'CLOSED', expectedPublic: 'CLOSED' },
    ];

    test.each(statusTests)(
      'should map internal $internal → public $expectedPublic',
      async ({ internal, expectedPublic }) => {
        const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
          status: internal,
        });

        const res = await request(app)
          .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe(expectedPublic);
        expect(res.body.data.statusDescription).toBe(PUBLIC_STATUS_MAP[internal].description);
      }
    );
  });

  // ─── Security Tests ───────────────────────────────────────────────────

  describe('Security: No sensitive data leakage', () => {
    it('should NOT expose internal MongoDB _id', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id);

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data._id).toBeUndefined();
      expect(res.body.data.id).toBeUndefined();
    });

    it('should NOT expose organizationId', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id);

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.body.data.organizationId).toBeUndefined();
    });

    it('should NOT expose internal user references (assignedTo, createdBy, etc.)', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        assignedTo: officer1._id,
        assignedBy: officer1._id,
      });

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.body.data.assignedTo).toBeUndefined();
      expect(res.body.data.assignedBy).toBeUndefined();
      expect(res.body.data.createdBy).toBeUndefined();
    });

    it('should NOT expose evidence, signature, notes, or financial data', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        evidence: [
          { imageType: 'DAMAGE_CLOSEUP', url: 'https://secret.com/img.jpg', publicId: 'p1', uploadedBy: officer1._id },
        ],
        signature: { url: 'https://secret.com/sig.png', publicId: 's1', capturedBy: officer1._id },
        decisionNotes: 'Internal decision notes',
        closingNotes: 'Internal closing notes',
        lossAssessment: {
          estimatedPartsCost: 5000,
          laborCost: 2000,
          totalDamage: 7000,
          policyDeductible: 500,
          deductibleApplied: 500,
          netApprovedPayout: 6500,
          assessedBy: officer1._id,
        },
      });

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.body.data.evidence).toBeUndefined();
      expect(res.body.data.signature).toBeUndefined();
      expect(res.body.data.decisionNotes).toBeUndefined();
      expect(res.body.data.closingNotes).toBeUndefined();
      expect(res.body.data.lossAssessment).toBeUndefined();
    });

    it('should NOT expose customer phone number', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id);

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.body.data.customerPhone).toBeUndefined();
      // customer.phone should not be in the response at all
      expect(res.body.data.customer).toBeUndefined();
    });

    it('should NOT expose the trackingToken itself in the response', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id);

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.body.data.trackingToken).toBeUndefined();
    });

    it('should NOT expose policy, vehicle, or location details', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        location: { latitude: 24.7, longitude: 46.7, address: 'Secret Address' },
      });

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.body.data.policyId).toBeUndefined();
      expect(res.body.data.vehicle).toBeUndefined();
      expect(res.body.data.location).toBeUndefined();
      expect(res.body.data.coverageSnapshot).toBeUndefined();
    });
  });

  // ─── Timeline Filtering Tests ──────────────────────────────────────────

  describe('Public timeline filtering', () => {
    it('should show only customer-visible timeline events', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        status: 'SUBMITTED',
        timeline: [
          { action: 'Claim Created', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-20T10:00:00Z') },
          { action: 'Claim Assigned', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-20T11:00:00Z') },
          { action: '[ASSIGNMENT ACCEPTED] by A-1', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: new Date('2026-09-20T12:00:00Z') },
          { action: 'Inspection Started', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: new Date('2026-09-21T09:00:00Z') },
          { action: 'Vehicle Updated', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: new Date('2026-09-21T09:30:00Z') },
          { action: 'Accident Updated', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: new Date('2026-09-21T10:00:00Z') },
          { action: 'Location Updated', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: new Date('2026-09-21T10:30:00Z') },
          { action: 'Evidence Uploaded', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: new Date('2026-09-21T11:00:00Z') },
          { action: 'Inspection Submitted', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: new Date('2026-09-22T14:00:00Z') },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.status).toBe(200);
      const timeline = res.body.data.timeline;

      // Should include: Claim Received, Inspector Assigned, Inspection Started, Inspection Submitted
      // Should exclude: Claim Assigned, Vehicle Updated, Accident Updated, Location Updated, Evidence Uploaded
      expect(timeline.length).toBe(4);
      expect(timeline[0].label).toBe('Claim Received');
      expect(timeline[1].label).toBe('Inspector Assigned');
      expect(timeline[2].label).toBe('Inspection Started');
      expect(timeline[3].label).toBe('Inspection Submitted');

      // Should NOT contain performedBy or role
      timeline.forEach((event) => {
        expect(event.performedBy).toBeUndefined();
        expect(event.role).toBeUndefined();
        expect(event.action).toBeUndefined();
        expect(event.notes).toBeUndefined();
      });
    });

    it('should return empty timeline when no customer-visible events exist', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        timeline: [
          { action: 'Vehicle Updated', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: new Date() },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.timeline).toEqual([]);
    });

    it('should correctly map real domain decision and resumption events (Claim Approved, Claim Rejected, Inspection Resumed)', async () => {
      const claimApproved = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        status: 'APPROVED',
        timeline: [
          { action: 'Claim Created', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-20T10:00:00Z') },
          { action: 'Inspection Resumed', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: new Date('2026-09-21T09:00:00Z') },
          { action: 'Claim Approved', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-22T10:00:00Z') },
        ],
      });

      const resApproved = await request(app)
        .get(`/api/v1/public/claims/track/${claimApproved.trackingToken}`);

      expect(resApproved.status).toBe(200);
      expect(resApproved.body.data.timeline.length).toBe(3);
      expect(resApproved.body.data.timeline[1].label).toBe('Inspection Started');
      expect(resApproved.body.data.timeline[2].label).toBe('Claim Approved');

      const claimRejected = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        status: 'REJECTED',
        timeline: [
          { action: 'Claim Created', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-20T10:00:00Z') },
          { action: 'Claim Rejected', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-22T10:00:00Z') },
        ],
      });

      const resRejected = await request(app)
        .get(`/api/v1/public/claims/track/${claimRejected.trackingToken}`);

      expect(resRejected.status).toBe(200);
      expect(resRejected.body.data.timeline.length).toBe(2);
      expect(resRejected.body.data.timeline[1].label).toBe('Claim Declined');
    });
  });

  // ─── Cross-Organization Isolation ──────────────────────────────────────

  describe('Cross-organization isolation', () => {
    it('should return org1 claim when using org1 tracking token (no org leakage)', async () => {
      const claimOrg1 = await createClaimWithToken(org1._id, testPolicy._id, officer1._id);
      const officer2 = await User.create({
        name: 'Officer2', employeeCode: 'OFC-T2', password: 'password123',
        role: 'CLAIMS_OFFICER', organizationId: org2._id,
      });
      const claimOrg2 = await createClaimWithToken(org2._id, testPolicyOrg2._id, officer2._id);

      // Access org1 claim with org1 token — should work
      const res1 = await request(app)
        .get(`/api/v1/public/claims/track/${claimOrg1.trackingToken}`);
      expect(res1.status).toBe(200);
      expect(res1.body.data.claimNumber).toBe(claimOrg1.claimNumber);

      // Access org2 claim with org2 token — should work
      const res2 = await request(app)
        .get(`/api/v1/public/claims/track/${claimOrg2.trackingToken}`);
      expect(res2.status).toBe(200);
      expect(res2.body.data.claimNumber).toBe(claimOrg2.claimNumber);

      // Neither response exposes organizationId
      expect(res1.body.data.organizationId).toBeUndefined();
      expect(res2.body.data.organizationId).toBeUndefined();
    });
  });

  // ─── Regression Tests ─────────────────────────────────────────────────

  describe('Regression: Authenticated endpoints unaffected', () => {
    it('authenticated GET /api/v1/claims/:claimId should still require authentication', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id);

      // No auth header — should fail
      const res = await request(app)
        .get(`/api/v1/claims/${claim._id}`);

      expect(res.status).toBe(401);
    });

    it('authenticated GET /api/v1/claims/:claimId should still work with valid auth', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id);
      const token = generateToken(officer1);

      const res = await request(app)
        .get(`/api/v1/claims/${claim._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.claimNumber).toBe(claim.claimNumber);
    });
  });

  // ─── createClaim Integration: trackingToken in response ────────────────

  describe('createClaim returns trackingToken', () => {
    it('should include trackingToken in POST /api/v1/claims response', async () => {
      const vehicle = await Vehicle.create({
        plateNumber: 'TRK-001',
        make: 'Toyota',
        model: 'Camry',
        year: 2023,
        organizationId: org1._id,
        policyId: testPolicy._id,
      });

      const token = generateToken(officer1);
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${token}`)
        .send({
          policyId: testPolicy._id.toString(),
          plateNumber: 'TRK-001',
          incidentType: 'COLLISION',
          incidentLocation: 'Test Location',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.trackingToken).toBeDefined();
      expect(res.body.data.trackingToken).toMatch(/^[0-9a-f]{64}$/);

      // Verify the tracking token works for public lookup
      const publicRes = await request(app)
        .get(`/api/v1/public/claims/track/${res.body.data.trackingToken}`);

      expect(publicRes.status).toBe(200);
      expect(publicRes.body.data.claimNumber).toBe(res.body.data.claimNumber);
    });
  });

  // ─── Rate Limiting ────────────────────────────────────────────────────

  describe('Rate limiting on public endpoint', () => {
    it('should apply rate limiting to public tracking endpoint', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id);

      // Make a request with the rate limit test header
      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`)
        .set('x-test-rate-limit', 'true')
        .set('x-test-rate-limit-max', '2');

      expect(res.status).toBe(200);

      // Second request
      const res2 = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`)
        .set('x-test-rate-limit', 'true')
        .set('x-test-rate-limit-max', '2');

      expect(res2.status).toBe(200);

      // Third request should be rate limited
      const res3 = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`)
        .set('x-test-rate-limit', 'true')
        .set('x-test-rate-limit-max', '2');

      expect(res3.status).toBe(429);
    });
  });

  // ─── Authenticated Claim Retrieval: trackingToken visibility ─────────

  describe('trackingToken visibility on authenticated endpoints', () => {
    it('should include trackingToken in single claim retrieval GET /api/v1/claims/:claimId for authorized staff', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id);
      const token = generateToken(officer1);

      const res = await request(app)
        .get(`/api/v1/claims/${claim._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.trackingToken).toBeDefined();
      expect(res.body.data.trackingToken).toBe(claim.trackingToken);
      expect(res.body.data.trackingToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should NOT include trackingToken in claim listing GET /api/v1/claims', async () => {
      await createClaimWithToken(org1._id, testPolicy._id, officer1._id);
      const token = generateToken(officer1);

      const res = await request(app)
        .get('/api/v1/claims')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const claims = res.body.data;
      expect(Array.isArray(claims)).toBe(true);
      expect(claims.length).toBeGreaterThan(0);
      claims.forEach((c) => {
        expect(c.trackingToken).toBeUndefined();
      });
    });
  });
});

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
const { PUBLIC_STATUS_MAP, PUBLIC_TIMELINE_TEXT } = require('../src/modules/claims/claim.public.constants');
const { buildTrackingUrl } = require('../src/modules/claims/claim.service');

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
      expect(Object.keys(res.body.data).sort()).toEqual(['claimNumber', 'status', 'statusDescription', 'timeline', 'vehicle']);
      expect(res.body.data.claimNumber).toBe(claim.claimNumber);
      expect(res.body.data.status).toBe('RECEIVED');
      expect(res.body.data.statusDescription).toBe('تم استلام بلاغك وهو قيد المعالجة');
      expect(res.body.data.customerName).toBeUndefined();
      expect(res.body.data.incidentType).toBeUndefined();
      expect(res.body.data.createdAt).toBeUndefined();
      expect(res.body.data.updatedAt).toBeUndefined();
      expect(res.body.data.vehicle).toEqual({
        plateNumber: 'ABC-xx3',
        make: null,
        model: null,
        year: null,
      });
      expect(Array.isArray(res.body.data.timeline)).toBe(true);
    });

    it('should return 404 for an unknown tracking token with CLAIM_NOT_FOUND code and security headers', async () => {
      const unknownToken = 'a'.repeat(64);

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${unknownToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Claim not found');
      expect(res.body.errors).toEqual([
        { code: 'CLAIM_NOT_FOUND', details: 'Claim not found' },
      ]);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    });

    it('should return deeply equal 404 envelope as another endpoint returning CLAIM_NOT_FOUND', async () => {
      const token = generateToken(officer1);
      const fakeClaimId = new mongoose.Types.ObjectId();

      const referenceRes = await request(app)
        .get(`/api/v1/claims/${fakeClaimId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(referenceRes.status).toBe(404);

      const publicRes = await request(app)
        .get(`/api/v1/public/claims/track/${'b'.repeat(64)}`);

      expect(publicRes.status).toBe(404);
      expect(publicRes.body).toEqual(referenceRes.body);
    });

    it('should return identical 404 envelope and headers for a malformed token (too short)', async () => {
      const res = await request(app)
        .get('/api/v1/public/claims/track/abc123');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Claim not found');
      expect(res.body.errors).toEqual([
        { code: 'CLAIM_NOT_FOUND', details: 'Claim not found' },
      ]);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    });

    it('should return identical 404 envelope and headers for a malformed token (uppercase hex)', async () => {
      const res = await request(app)
        .get(`/api/v1/public/claims/track/${'A'.repeat(64)}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toEqual([
        { code: 'CLAIM_NOT_FOUND', details: 'Claim not found' },
      ]);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    });

    it('should return identical 404 envelope and headers for a malformed token (non-hex characters)', async () => {
      const res = await request(app)
        .get(`/api/v1/public/claims/track/${'g'.repeat(64)}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toEqual([
        { code: 'CLAIM_NOT_FOUND', details: 'Claim not found' },
      ]);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    });

    it('should set Cache-Control: no-store, Pragma: no-cache, and X-Robots-Tag: noindex, nofollow headers on success', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id);

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    });
  });

  // ─── Customer-Friendly Status Mapping Tests ────────────────────────────

  describe('Customer-friendly status mapping', () => {
    it('asserts every value of the Claim status enum has an entry in PUBLIC_STATUS_MAP', () => {
      const claimStatuses = Claim.schema.path('status').enumValues;
      claimStatuses.forEach((status) => {
        expect(PUBLIC_STATUS_MAP[status]).toBeDefined();
        expect(PUBLIC_STATUS_MAP[status].status).toBeDefined();
        expect(PUBLIC_STATUS_MAP[status].statusDescription).toBeDefined();
      });
    });

    const statusTests = [
      { internal: 'NEW', expectedPublic: 'RECEIVED' },
      { internal: 'PENDING_ACCEPTANCE', expectedPublic: 'RECEIVED' },
      { internal: 'ASSIGNED', expectedPublic: 'RECEIVED' },
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
        expect(res.body.data.statusDescription).toBe(PUBLIC_STATUS_MAP[internal].statusDescription);
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

    it('should NOT expose policy, location details, or internal vehicle IDs', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        location: { latitude: 24.7, longitude: 46.7, address: 'Secret Address' },
      });

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.body.data.policyId).toBeUndefined();
      expect(res.body.data.location).toBeUndefined();
      expect(res.body.data.coverageSnapshot).toBeUndefined();
      expect(res.body.data.vehicle).toEqual({
        plateNumber: 'ABC-xx3',
        make: null,
        model: null,
        year: null,
      });
      expect(res.body.data.vehicle).not.toHaveProperty('customerId');
      expect(res.body.data.vehicle).not.toHaveProperty('vehicleId');
      expect(res.body.data.vehicle).not.toHaveProperty('_id');
    });

    it('returns vehicle as null when no vehicle data exists on claim', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        vehicle: null,
      });

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.vehicle).toBeNull();
    });
  });

  // ─── Timeline Filtering Tests ──────────────────────────────────────────

  describe('Public timeline filtering', () => {
    it('new claim returns one RECEIVED entry with exact keys', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id);

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.timeline).toHaveLength(1);
      const first = res.body.data.timeline[0];
      expect(first.status).toBe('RECEIVED');
      expect(first.title).toBe(PUBLIC_TIMELINE_TEXT.RECEIVED.title);
      expect(first.description).toBe(PUBLIC_TIMELINE_TEXT.RECEIVED.description);
      expect(new Date(first.timestamp).toISOString()).toBe(claim.timeline[0].timestamp.toISOString());

      // Exact key sets
      expect(Object.keys(res.body.data).sort()).toEqual(['claimNumber', 'status', 'statusDescription', 'timeline', 'vehicle']);
      expect(Object.keys(first).sort()).toEqual(['description', 'status', 'timestamp', 'title']);
    });

    it('uses claim.createdAt when no Claim Created action exists in timeline', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        timeline: [],
      });

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.timeline).toHaveLength(1);
      expect(new Date(res.body.data.timeline[0].timestamp).toISOString()).toBe(claim.createdAt.toISOString());
    });

    it('assigned and pending-acceptance add nothing to timeline', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        timeline: [
          { action: 'Claim Created', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-20T10:00:00Z') },
          { action: 'Assignment Pending Acceptance', newStatus: 'PENDING_ACCEPTANCE', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-20T11:00:00Z') },
          { action: 'Claim Assigned', newStatus: 'ASSIGNED', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-20T12:00:00Z') },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.timeline).toHaveLength(1);
      expect(res.body.data.timeline[0].status).toBe('RECEIVED');
    });

    it('declined assignment adds nothing to timeline', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        timeline: [
          { action: 'Claim Created', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-20T10:00:00Z') },
          { action: 'Assignment Declined', newStatus: 'NEW', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: new Date('2026-09-20T11:00:00Z') },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.timeline).toHaveLength(1);
      expect(res.body.data.timeline[0].status).toBe('RECEIVED');
    });

    it('started inspection adds IN_PROGRESS', async () => {
      const inspectionTime = new Date('2026-09-21T09:00:00Z');
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        timeline: [
          { action: 'Claim Created', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-20T10:00:00Z') },
          { action: 'Inspection Started', newStatus: 'IN_PROGRESS', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: inspectionTime },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.timeline).toHaveLength(2);
      expect(res.body.data.timeline[0].status).toBe('RECEIVED');
      expect(res.body.data.timeline[1].status).toBe('IN_PROGRESS');
      expect(res.body.data.timeline[1].title).toBe(PUBLIC_TIMELINE_TEXT.IN_PROGRESS.title);
      expect(res.body.data.timeline[1].description).toBe(PUBLIC_TIMELINE_TEXT.IN_PROGRESS.description);
      expect(new Date(res.body.data.timeline[1].timestamp).toISOString()).toBe(inspectionTime.toISOString());
    });

    it('correction loop adds no entry after the first IN_REVIEW, and status reflects the real current state', async () => {
      const tCreated = new Date('2026-09-20T10:00:00Z');
      const tStarted = new Date('2026-09-21T09:00:00Z');
      const tSubmitted = new Date('2026-09-21T14:00:00Z');
      const tCorrection = new Date('2026-09-22T08:00:00Z');
      const tResumed = new Date('2026-09-22T10:00:00Z');

      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        status: 'CORRECTION_REQUIRED',
        timeline: [
          { action: 'Claim Created', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: tCreated },
          { action: 'Inspection Started', newStatus: 'IN_PROGRESS', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: tStarted },
          { action: 'Inspection Submitted', newStatus: 'SUBMITTED', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: tSubmitted },
          { action: 'Correction Requested', newStatus: 'CORRECTION_REQUIRED', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: tCorrection },
          { action: 'Inspection Resumed', newStatus: 'IN_PROGRESS', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: tResumed },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('IN_PROGRESS');
      expect(res.body.data.statusDescription).toBe('يجري استكمال بعض المعلومات على مطالبتك');
      expect(res.body.data.timeline).toHaveLength(3);
      expect(res.body.data.timeline.map((e) => e.status)).toEqual(['RECEIVED', 'IN_PROGRESS', 'IN_REVIEW']);
      expect(new Date(res.body.data.timeline[0].timestamp).toISOString()).toBe(tCreated.toISOString());
      expect(new Date(res.body.data.timeline[1].timestamp).toISOString()).toBe(tStarted.toISOString());
      expect(new Date(res.body.data.timeline[2].timestamp).toISOString()).toBe(tSubmitted.toISOString());
    });

    it('approved, rejected, and closed claims show the full sequence', async () => {
      const claimApproved = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        status: 'APPROVED',
        timeline: [
          { action: 'Claim Created', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-20T10:00:00Z') },
          { action: 'Inspection Started', newStatus: 'IN_PROGRESS', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: new Date('2026-09-21T09:00:00Z') },
          { action: 'Inspection Submitted', newStatus: 'SUBMITTED', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: new Date('2026-09-21T14:00:00Z') },
          { action: 'Claim Approved', newStatus: 'APPROVED', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-22T10:00:00Z') },
        ],
      });

      const resApproved = await request(app)
        .get(`/api/v1/public/claims/track/${claimApproved.trackingToken}`);
      expect(resApproved.status).toBe(200);
      expect(resApproved.body.data.status).toBe('APPROVED');
      expect(resApproved.body.data.timeline.map((e) => e.status)).toEqual(['RECEIVED', 'IN_PROGRESS', 'IN_REVIEW', 'APPROVED']);

      const claimRejected = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        status: 'REJECTED',
        timeline: [
          { action: 'Claim Created', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-20T10:00:00Z') },
          { action: 'Inspection Started', newStatus: 'IN_PROGRESS', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: new Date('2026-09-21T09:00:00Z') },
          { action: 'Inspection Submitted', newStatus: 'SUBMITTED', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: new Date('2026-09-21T14:00:00Z') },
          { action: 'Claim Rejected', newStatus: 'REJECTED', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-22T10:00:00Z') },
        ],
      });

      const resRejected = await request(app)
        .get(`/api/v1/public/claims/track/${claimRejected.trackingToken}`);
      expect(resRejected.status).toBe(200);
      expect(resRejected.body.data.status).toBe('REJECTED');
      expect(resRejected.body.data.timeline.map((e) => e.status)).toEqual(['RECEIVED', 'IN_PROGRESS', 'IN_REVIEW', 'REJECTED']);

      const claimClosed = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        status: 'CLOSED',
        timeline: [
          { action: 'Claim Created', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-20T10:00:00Z') },
          { action: 'Inspection Started', newStatus: 'IN_PROGRESS', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: new Date('2026-09-21T09:00:00Z') },
          { action: 'Inspection Submitted', newStatus: 'SUBMITTED', performedBy: officer1._id, role: 'FIELD_ADJUSTER', timestamp: new Date('2026-09-21T14:00:00Z') },
          { action: 'Claim Approved', newStatus: 'APPROVED', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-22T10:00:00Z') },
          { action: 'Claim Closed', newStatus: 'CLOSED', performedBy: officer1._id, role: 'CLAIMS_OFFICER', timestamp: new Date('2026-09-23T10:00:00Z') },
        ],
      });

      const resClosed = await request(app)
        .get(`/api/v1/public/claims/track/${claimClosed.trackingToken}`);
      expect(resClosed.status).toBe(200);
      expect(resClosed.body.data.status).toBe('CLOSED');
      expect(resClosed.body.data.timeline.map((e) => e.status)).toEqual(['RECEIVED', 'IN_PROGRESS', 'IN_REVIEW', 'APPROVED', 'CLOSED']);
    });

    it('returns no internal notes, performer names, actions, or roles in any response', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        status: 'IN_PROGRESS',
        timeline: [
          { action: 'Claim Created', performedBy: officer1._id, role: 'CLAIMS_OFFICER', notes: 'Secret intake note', timestamp: new Date('2026-09-20T10:00:00Z') },
          { action: 'Inspection Started', newStatus: 'IN_PROGRESS', performedBy: officer1._id, role: 'FIELD_ADJUSTER', notes: 'Secret adjuster note', timestamp: new Date('2026-09-21T09:00:00Z') },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.status).toBe(200);
      res.body.data.timeline.forEach((item) => {
        expect(item.notes).toBeUndefined();
        expect(item.performedBy).toBeUndefined();
        expect(item.role).toBeUndefined();
        expect(item.action).toBeUndefined();
        expect(item.label).toBeUndefined();
        expect(Object.keys(item).sort()).toEqual(['description', 'status', 'timestamp', 'title']);
      });
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
          incidentDate: '2026-06-15',
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
    it('officer receives both trackingToken and trackingUrl in GET /api/v1/claims/:claimId', async () => {
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id);
      const token = generateToken(officer1);

      const res = await request(app)
        .get(`/api/v1/claims/${claim._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.trackingToken).toBe(claim.trackingToken);
      expect(res.body.data.trackingUrl).toBe(buildTrackingUrl(claim.trackingToken));
    });

    it('admin receives both trackingToken and trackingUrl in GET /api/v1/claims/:claimId', async () => {
      const admin = await User.create({
        name: 'AdminUser',
        employeeCode: 'ADM-D1',
        password: 'password123',
        role: 'ADMIN',
        organizationId: org1._id,
      });
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id);
      const token = generateToken(admin);

      const res = await request(app)
        .get(`/api/v1/claims/${claim._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.trackingToken).toBe(claim.trackingToken);
      expect(res.body.data.trackingUrl).toBe(buildTrackingUrl(claim.trackingToken));
    });

    it('FIELD_ADJUSTER receives neither trackingToken nor trackingUrl in GET /api/v1/claims/:claimId', async () => {
      const adjuster = await User.create({
        name: 'AdjusterUser',
        employeeCode: 'ADJ-D1',
        password: 'password123',
        role: 'FIELD_ADJUSTER',
        organizationId: org1._id,
      });
      const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        assignedTo: adjuster._id,
      });
      const token = generateToken(adjuster);

      const res = await request(app)
        .get(`/api/v1/claims/${claim._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.trackingToken).toBeUndefined();
      expect(res.body.data.trackingUrl).toBeUndefined();
      expect('trackingToken' in res.body.data).toBe(false);
      expect('trackingUrl' in res.body.data).toBe(false);
    });

    it('trackingUrl is null when PUBLIC_FRONTEND_URL is unset', async () => {
      const origUrl = config.publicFrontendUrl;
      config.publicFrontendUrl = null;

      try {
        const claim = await createClaimWithToken(org1._id, testPolicy._id, officer1._id);
        const token = generateToken(officer1);

        const res = await request(app)
          .get(`/api/v1/claims/${claim._id}`)
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.trackingToken).toBe(claim.trackingToken);
        expect(res.body.data.trackingUrl).toBeNull();
      } finally {
        config.publicFrontendUrl = origUrl;
      }
    });

    it('GET /claims returns neither trackingToken nor trackingUrl for any role', async () => {
      const adjuster = await User.create({
        name: 'AdjusterList',
        employeeCode: 'ADJ-D2',
        password: 'password123',
        role: 'FIELD_ADJUSTER',
        organizationId: org1._id,
      });
      const admin = await User.create({
        name: 'AdminList',
        employeeCode: 'ADM-D2',
        password: 'password123',
        role: 'ADMIN',
        organizationId: org1._id,
      });
      await createClaimWithToken(org1._id, testPolicy._id, officer1._id, {
        assignedTo: adjuster._id,
      });

      const roles = [
        { user: officer1 },
        { user: admin },
        { user: adjuster },
      ];

      for (const { user } of roles) {
        const token = generateToken(user);
        const res = await request(app)
          .get('/api/v1/claims')
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        const claims = res.body.data;
        expect(Array.isArray(claims)).toBe(true);
        expect(claims.length).toBeGreaterThan(0);
        claims.forEach((c) => {
          expect(c.trackingToken).toBeUndefined();
          expect(c.trackingUrl).toBeUndefined();
          expect('trackingToken' in c).toBe(false);
          expect('trackingUrl' in c).toBe(false);
        });
      }
    });
  });
});

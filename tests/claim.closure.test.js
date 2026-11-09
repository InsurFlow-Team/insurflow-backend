const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const Garage = require('../src/modules/garages/garage.model');
const claimRepository = require('../src/modules/claims/claim.repository');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');

const Policy = require('../src/modules/policies/policy.model');
const { buildPolicy } = require('./helpers/policyFactory');
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

describe('POST /api/v1/claims/:claimId/close', () => {
  let org1, org2;
  let admin1, admin2, officer1, adjuster1;
  let claimApproved, claimNew, claimAssigned, claimSubmitted, claimUnderReview, claimRejected, claimClosed;
  let testGarage;

  beforeEach(async () => {
    org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1' });
    global.__testPol = await buildPolicy({ policyNumber: 'POL-FIX-001', status: 'ACTIVE', startDate: new Date('2026-01-01'), expiryDate: new Date('2027-12-31'), organizationId: org1._id });
    org2 = await Organization.create({ name: 'Org 2', code: 'ORG-2' });

    admin1 = await User.create({
      name: 'Admin 1',
      employeeCode: 'ADM-1',
      password: 'password123',
      role: 'ADMIN',
      organizationId: org1._id,
    });

    admin2 = await User.create({
      name: 'Admin 2',
      employeeCode: 'ADM-2',
      password: 'password123',
      role: 'ADMIN',
      organizationId: org2._id,
    });

    officer1 = await User.create({
      name: 'Officer 1',
      employeeCode: 'OFF-1',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
    });

    adjuster1 = await User.create({
      name: 'Adjuster 1',
      employeeCode: 'ADJ-1',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    // Valid target state for closure: APPROVED
    claimApproved = await Claim.create({
      organizationId: org1._id,
      policyId: global.__testPol._id,
      createdBy: officer1._id,
      status: 'APPROVED',
      customer: { name: 'Customer A', phone: '0500000001' },
      incidentType: 'COLLISION',
      incidentLocation: 'Location A',
      decisionNotes: 'Approved by officer',
      lossAssessment: {
        estimatedPartsCost: 80000,
        laborCost: 40000,
        totalDamage: 120000,
        policyDeductible: 20000,
        deductibleApplied: 20000,
        deductibleOverridden: false,
        netApprovedPayout: 100000,
        assessedBy: officer1._id,
        assessedAt: new Date(),
      },
      paidTotals: { indemnity: 100000, expense: 0 },
    });

    // Invalid states for closure
    claimNew = await Claim.create({
      organizationId: org1._id,
      policyId: global.__testPol._id,
      createdBy: officer1._id,
      status: 'NEW',
      customer: { name: 'Customer B', phone: '0500000002' },
      incidentType: 'COLLISION',
      incidentLocation: 'Location B',
    });

    claimAssigned = await Claim.create({
      organizationId: org1._id,
      policyId: global.__testPol._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'ASSIGNED',
      customer: { name: 'Customer C', phone: '0500000003' },
      incidentType: 'COLLISION',
      incidentLocation: 'Location C',
    });

    claimSubmitted = await Claim.create({
      organizationId: org1._id,
      policyId: global.__testPol._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'SUBMITTED',
      customer: { name: 'Customer D', phone: '0500000004' },
      incidentType: 'COLLISION',
      incidentLocation: 'Location D',
    });

    claimUnderReview = await Claim.create({
      organizationId: org1._id,
      policyId: global.__testPol._id,
      createdBy: officer1._id,
      status: 'UNDER_REVIEW',
      customer: { name: 'Customer E', phone: '0500000005' },
      incidentType: 'COLLISION',
      incidentLocation: 'Location E',
    });

    claimRejected = await Claim.create({
      organizationId: org1._id,
      policyId: global.__testPol._id,
      createdBy: officer1._id,
      status: 'REJECTED',
      customer: { name: 'Customer F', phone: '0500000006' },
      incidentType: 'COLLISION',
      incidentLocation: 'Location F',
      decisionNotes: 'Rejected due to fraud',
    });

    claimClosed = await Claim.create({
      organizationId: org1._id,
      policyId: global.__testPol._id,
      createdBy: officer1._id,
      status: 'CLOSED',
      customer: { name: 'Customer G', phone: '0500000007' },
      incidentType: 'COLLISION',
      incidentLocation: 'Location G',
      closedBy: admin1._id,
      closedAt: new Date(),
      closingNotes: 'Already closed',
    });

    testGarage = await Garage.create({
      organizationId: org1._id,
      name: 'Approved Test Garage',
      normalizedName: 'approved test garage',
      governorate: 'RAMALLAH_AL_BIREH',
      city: 'Ramallah',
      phone: '022987001',
      laborRate: 10000,
      approved: true,
    });
  });

  const setupClaimOrder = async (claim, targetStatus = 'AUTHORIZED') => {
    const token = generateToken(admin1);
    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: testGarage._id.toString() });
    const orderNumber = res.body.data.orderNumber;

    if (targetStatus === 'IN_REPAIR') {
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'IN_REPAIR' });
    } else if (targetStatus === 'SUPPLEMENT_REQUESTED') {
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'IN_REPAIR' });
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'SUPPLEMENT_REQUESTED', notes: 'Additional damage found' });
    } else if (targetStatus === 'READY') {
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'IN_REPAIR' });
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'READY' });
    } else if (targetStatus === 'DELIVERED') {
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'IN_REPAIR' });
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'READY' });
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'DELIVERED' });
    } else if (targetStatus === 'CANCELLED') {
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'CANCELLED', notes: 'Order cancelled' });
    }
    return { orderNumber };
  };

  // ─── Happy Path: Close with notes ───────────────────────────────────────
  it('should successfully close an APPROVED claim with closingNotes by ADMIN', async () => {
    const token = generateToken(admin1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Payout issued and claim finalized' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Claim closed');
    expect(response.body.data.status).toBe('CLOSED');
    expect(response.body.data.closingNotes).toBe('Payout issued and claim finalized');
    expect(response.body.data.closedBy.toString()).toBe(admin1._id.toString());
    expect(response.body.data.closedAt).toBeDefined();

    // Verify database state
    const dbClaim = await Claim.findById(claimApproved._id);
    expect(dbClaim.status).toBe('CLOSED');
    expect(dbClaim.closingNotes).toBe('Payout issued and claim finalized');
    expect(dbClaim.closedBy.toString()).toBe(admin1._id.toString());
    expect(dbClaim.closedAt).toBeInstanceOf(Date);

    // Verify timeline
    const closedEvent = dbClaim.timeline.find((e) => e.action === 'Claim Closed');
    expect(closedEvent).toBeDefined();
    expect(closedEvent.performedBy.toString()).toBe(admin1._id.toString());
    expect(closedEvent.role).toBe('ADMIN');
    expect(closedEvent.timestamp).toBeInstanceOf(Date);
  });

  // ─── Happy Path: Close without notes ────────────────────────────────────
  it('should successfully close an APPROVED claim without closingNotes', async () => {
    const token = generateToken(admin1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('CLOSED');
    expect(response.body.data.closingNotes).toBeNull();

    const dbClaim = await Claim.findById(claimApproved._id);
    expect(dbClaim.status).toBe('CLOSED');
    expect(dbClaim.closingNotes).toBeNull();
  });

  // ─── RBAC: CLAIMS_OFFICER forbidden ─────────────────────────────────────
  it('should return 403 if called by a CLAIMS_OFFICER', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Officer trying to close' });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);

    // Verify claim remains unchanged in DB
    const dbClaim = await Claim.findById(claimApproved._id);
    expect(dbClaim.status).toBe('APPROVED');
    expect(dbClaim.closedBy).toBeNull();
  });

  // ─── RBAC: FIELD_ADJUSTER forbidden ─────────────────────────────────────
  it('should return 403 if called by a FIELD_ADJUSTER', async () => {
    const token = generateToken(adjuster1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Adjuster trying to close' });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);

    const dbClaim = await Claim.findById(claimApproved._id);
    expect(dbClaim.status).toBe('APPROVED');
  });

  // ─── Tenant Isolation ───────────────────────────────────────────────────
  it('should return 404 when admin attempts to close claim from another organization', async () => {
    const token = generateToken(admin2); // Org 2 admin
    const response = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`) // Org 1 claim
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Cross-tenant attempt' });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.errors[0].code).toBe('CLAIM_NOT_FOUND');

    // Confirm original claim was untouched
    const dbClaim = await Claim.findById(claimApproved._id);
    expect(dbClaim.status).toBe('APPROVED');
    expect(dbClaim.closedBy).toBeNull();
  });

  // ─── Non-existent Claim ─────────────────────────────────────────────────
  it('should return 404 if claim does not exist', async () => {
    const token = generateToken(admin1);
    const nonExistentId = new mongoose.Types.ObjectId().toString();
    const response = await request(app)
      .post(`/api/v1/claims/${nonExistentId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Does not exist' });

    expect(response.status).toBe(404);
    expect(response.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  // ─── Invalid Status Transitions (409 Conflict) ──────────────────────────
  it('should return 409 when closing a NEW claim', async () => {
    const token = generateToken(admin1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimNew._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Notes' });

    expect(response.status).toBe(409);
    expect(response.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('should return 409 when closing an ASSIGNED claim', async () => {
    const token = generateToken(admin1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimAssigned._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Notes' });

    expect(response.status).toBe(409);
    expect(response.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('should return 409 when closing a SUBMITTED claim', async () => {
    const token = generateToken(admin1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimSubmitted._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Notes' });

    expect(response.status).toBe(409);
    expect(response.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('should return 409 when closing an UNDER_REVIEW claim', async () => {
    const token = generateToken(admin1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Notes' });

    expect(response.status).toBe(409);
    expect(response.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('should return 409 when closing a REJECTED claim', async () => {
    const token = generateToken(admin1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimRejected._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Notes' });

    expect(response.status).toBe(409);
    expect(response.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('closing an already CLOSED claim returns 200 with the original closing data and writes nothing', async () => {
    const token = generateToken(admin1);
    const firstRes = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Original close note' });

    expect(firstRes.status).toBe(200);
    const originalData = firstRes.body.data;

    const dbBefore = await Claim.findById(claimApproved._id).lean();

    const replayRes = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Second close attempt notes' });

    expect(replayRes.status).toBe(200);
    expect(replayRes.body.success).toBe(true);
    expect(replayRes.body.message).toBe('Claim closed');
    expect(replayRes.body.data).toEqual(originalData);

    const dbAfter = await Claim.findById(claimApproved._id).lean();
    expect(dbAfter.status).toBe('CLOSED');
    expect(dbAfter.closingNotes).toBe(originalData.closingNotes);
    expect(dbAfter.closedBy.toString()).toBe(originalData.closedBy.toString());
    expect(new Date(dbAfter.closedAt).toISOString()).toBe(new Date(originalData.closedAt).toISOString());
    expect(dbAfter.timeline.length).toBe(dbBefore.timeline.length);
    expect((dbAfter.reserve?.history || []).length).toBe((dbBefore.reserve?.history || []).length);
  });

  it('closing an already CLOSED claim ignores the new closingNotes', async () => {
    const token = generateToken(admin1);
    const firstRes = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Initial persistent note' });

    expect(firstRes.status).toBe(200);

    const replayRes = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Ignored replacement note' });

    expect(replayRes.status).toBe(200);
    expect(replayRes.body.data.closingNotes).toBe('Initial persistent note');

    const dbClaim = await Claim.findById(claimApproved._id);
    expect(dbClaim.closingNotes).toBe('Initial persistent note');
  });

  it('already-closed replay works for a different ADMIN of the same organization', async () => {
    const admin1Alt = await User.create({
      name: 'Admin 1 Alt',
      employeeCode: 'ADM-1-ALT',
      password: 'password123',
      role: 'ADMIN',
      organizationId: org1._id,
    });

    const token1 = generateToken(admin1);
    const firstRes = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ closingNotes: 'Closed by admin 1' });

    expect(firstRes.status).toBe(200);
    const originalData = firstRes.body.data;

    const tokenAlt = generateToken(admin1Alt);
    const replayRes = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${tokenAlt}`)
      .send({ closingNotes: 'Replay by admin 1 alt' });

    expect(replayRes.status).toBe(200);
    expect(replayRes.body.data.closedBy.toString()).toBe(admin1._id.toString());
    expect(replayRes.body.data.closedAt).toBe(originalData.closedAt);
    expect(replayRes.body.data.closingNotes).toBe('Closed by admin 1');

    const dbClaim = await Claim.findById(claimApproved._id);
    expect(dbClaim.closedBy.toString()).toBe(admin1._id.toString());
  });

  it('a CLOSED claim of another organization still returns 404', async () => {
    const token1 = generateToken(admin1);
    const closeRes = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ closingNotes: 'Closed in org1' });

    expect(closeRes.status).toBe(200);

    const token2 = generateToken(admin2);
    const crossRes = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token2}`)
      .send({ closingNotes: 'Cross-tenant close attempt' });

    expect(crossRes.status).toBe(404);
    expect(crossRes.body.success).toBe(false);
    expect(crossRes.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  // ─── Validation Errors ──────────────────────────────────────────────────
  it('should return 400 when claimId is not a valid ObjectId', async () => {
    const token = generateToken(admin1);
    const response = await request(app)
      .post('/api/v1/claims/invalid-id-xyz/close')
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Test' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 if closingNotes is not a string', async () => {
    const token = generateToken(admin1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 12345 });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  // ─── Authentication ─────────────────────────────────────────────────────
  it('should return 401 if no authorization token is provided', async () => {
    const response = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .send({ closingNotes: 'Unauthenticated' });

    expect(response.status).toBe(401);
  });

  // ─── Concurrency: Race Condition ────────────────────────────────────────
  it('concurrent close requests both return 200 and the claim has exactly one Claim Closed event and two STATUS_ZERO reserve entries', async () => {
    const token = generateToken(admin1);

    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/v1/claims/${claimApproved._id}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({ closingNotes: 'First concurrent close' }),
      request(app)
        .post(`/api/v1/claims/${claimApproved._id}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({ closingNotes: 'Second concurrent close' }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.success).toBe(true);
    expect(res2.body.success).toBe(true);

    const dbClaim = await Claim.findById(claimApproved._id);
    expect(dbClaim.status).toBe('CLOSED');

    const closeEvents = dbClaim.timeline.filter((e) => e.action === 'Claim Closed');
    expect(closeEvents.length).toBe(1);

    const statusZeroEntries = (dbClaim.reserve?.history || []).filter(
      (h) => h.source === 'STATUS_ZERO'
    );
    expect(statusZeroEntries.length).toBe(2);
    const categories = statusZeroEntries.map((h) => h.category).sort();
    expect(categories).toEqual(['EXPENSE', 'INDEMNITY']);
  });

  // ─── Response Shape ─────────────────────────────────────────────────────
  it('should return the correct response shape on success', async () => {
    const token = generateToken(admin1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Final signoff' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('message', 'Claim closed');
    expect(response.body.data).toHaveProperty('id');
    expect(response.body.data).toHaveProperty('claimNumber');
    expect(response.body.data).toHaveProperty('status', 'CLOSED');
    expect(response.body.data).toHaveProperty('closedBy');
    expect(response.body.data).toHaveProperty('closedAt');
    expect(response.body.data).toHaveProperty('closingNotes', 'Final signoff');
  });

  // ─── CL-01: Repair Order Gate & Close Safety Tests ───────────────────────
  it.each(Claim.ACTIVE_REPAIR_ORDER_STATUSES)(
    'close is refused with 422 REPAIR_ORDER_ACTIVE while a repair order is %s',
    async (status) => {
      const { orderNumber } = await setupClaimOrder(claimApproved, status);
      const token = generateToken(admin1);
      const response = await request(app)
        .post(`/api/v1/claims/${claimApproved._id}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({ closingNotes: 'Attempt close with active order' });

      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe(
        `Claim cannot be closed while repair order ${orderNumber} is ${status}`
      );
      expect(response.body.errors[0].code).toBe('REPAIR_ORDER_ACTIVE');
      expect(response.body.errors[0].details).toBe(
        `Claim cannot be closed while repair order ${orderNumber} is ${status}`
      );

      const dbClaim = await Claim.findById(claimApproved._id);
      expect(dbClaim.status).toBe('APPROVED');
      expect(dbClaim.closedBy).toBeNull();
    }
  );

  it('close succeeds when the only repair order is DELIVERED', async () => {
    await setupClaimOrder(claimApproved, 'DELIVERED');
    const token = generateToken(admin1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Delivered repair order close' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('CLOSED');

    const dbClaim = await Claim.findById(claimApproved._id);
    expect(dbClaim.status).toBe('CLOSED');
  });

  it('close succeeds when the only repair order is CANCELLED', async () => {
    await setupClaimOrder(claimApproved, 'CANCELLED');
    const token = generateToken(admin1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Cancelled repair order close' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('CLOSED');

    const dbClaim = await Claim.findById(claimApproved._id);
    expect(dbClaim.status).toBe('CLOSED');
  });

  it('close succeeds on a claim document with no repairOrders key', async () => {
    await Claim.collection.updateOne(
      { _id: claimApproved._id },
      { $unset: { repairOrders: '' } }
    );
    const rawDoc = await Claim.collection.findOne({ _id: claimApproved._id });
    expect(rawDoc.repairOrders).toBeUndefined();

    const token = generateToken(admin1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'No repair orders key close' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('CLOSED');

    const dbClaim = await Claim.findById(claimApproved._id);
    expect(dbClaim.status).toBe('CLOSED');
  });

  it('a claim is never CLOSED while it holds an active repair order under concurrent close and repair-order create', async () => {
    const adminToken = generateToken(admin1);

    const [closeRes, createRes] = await Promise.all([
      request(app)
        .post(`/api/v1/claims/${claimApproved._id}/close`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ closingNotes: 'Concurrent close' }),
      request(app)
        .post(`/api/v1/claims/${claimApproved._id}/repair-orders`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ garageId: testGarage._id.toString() }),
    ]);

    const allowedPair1 = closeRes.status === 200 && createRes.status === 409;
    const allowedPair2 = closeRes.status === 422 && createRes.status === 201;
    expect(allowedPair1 || allowedPair2).toBe(true);

    const dbClaim = await Claim.findById(claimApproved._id);
    const activeOrders = (dbClaim.repairOrders || []).filter((ro) =>
      Claim.ACTIVE_REPAIR_ORDER_STATUSES.includes(ro.status)
    );

    if (dbClaim.status === 'CLOSED') {
      expect(activeOrders.length).toBe(0);
    }
    if (activeOrders.length > 0) {
      expect(dbClaim.status).toBe('APPROVED');
    }
  });

  it('when the atomic close misses but a fresh read passes, close retries once and succeeds', async () => {
    const spy = jest.spyOn(claimRepository, 'closeClaim').mockResolvedValueOnce(null);
    const token = generateToken(admin1);

    try {
      const response = await request(app)
        .post(`/api/v1/claims/${claimApproved._id}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({ closingNotes: 'Close with retry' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('CLOSED');
      expect(spy).toHaveBeenCalledTimes(2);

      const dbClaim = await Claim.findById(claimApproved._id);
      expect(dbClaim.status).toBe('CLOSED');
    } finally {
      spy.mockRestore();
    }
  });

  it('when the retry also misses with no explaining condition, close returns 409 CLOSE_CONFLICT', async () => {
    const spy = jest
      .spyOn(claimRepository, 'closeClaim')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const token = generateToken(admin1);

    try {
      const response = await request(app)
        .post(`/api/v1/claims/${claimApproved._id}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({ closingNotes: 'Double miss close' });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Close conflict detected. Please reload and retry.');
      expect(response.body.errors[0].code).toBe('CLOSE_CONFLICT');
      expect(response.body.errors[0].details).toBe('Close conflict detected. Please reload and retry.');
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('PAYMENT_INCOMPLETE takes precedence over REPAIR_ORDER_ACTIVE', async () => {
    const unpaidClaim = await Claim.create({
      organizationId: org1._id,
      policyId: global.__testPol._id,
      createdBy: officer1._id,
      status: 'APPROVED',
      customer: { name: 'Customer Unpaid', phone: '0500000099' },
      incidentType: 'COLLISION',
      incidentLocation: 'Location Unpaid',
      lossAssessment: {
        estimatedPartsCost: 80000,
        laborCost: 40000,
        totalDamage: 120000,
        policyDeductible: 20000,
        deductibleApplied: 20000,
        deductibleOverridden: false,
        netApprovedPayout: 100000,
        assessedBy: officer1._id,
        assessedAt: new Date(),
      },
      paidTotals: { indemnity: 0, expense: 0 },
    });

    await setupClaimOrder(unpaidClaim, 'AUTHORIZED');

    const token = generateToken(admin1);
    const response = await request(app)
      .post(`/api/v1/claims/${unpaidClaim._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Try close unpaid with repair order' });

    expect(response.status).toBe(422);
    expect(response.body.errors[0].code).toBe('PAYMENT_INCOMPLETE');
  });

  it('close is refused when a CANCELLED order and an active IN_REPAIR order both exist', async () => {
    await setupClaimOrder(claimApproved, 'CANCELLED');
    const { orderNumber: order2Number } = await setupClaimOrder(claimApproved, 'IN_REPAIR');

    const token = generateToken(admin1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Close with cancelled and active orders' });

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe(
      `Claim cannot be closed while repair order ${order2Number} is IN_REPAIR`
    );
    expect(response.body.errors[0].code).toBe('REPAIR_ORDER_ACTIVE');
    expect(response.body.errors[0].details).toBe(
      `Claim cannot be closed while repair order ${order2Number} is IN_REPAIR`
    );

    const dbClaim = await Claim.findById(claimApproved._id);
    expect(dbClaim.status).toBe('APPROVED');
    expect(dbClaim.closedBy).toBeNull();
  });
});

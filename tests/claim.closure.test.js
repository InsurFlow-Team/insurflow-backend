const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');

const Policy = require('../src/modules/policies/policy.model');
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

  beforeEach(async () => {
    org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1' });
    global.__testPol = await Policy.create({ policyNumber: 'POL-FIX-001', status: 'ACTIVE', startDate: new Date('2026-01-01'), expiryDate: new Date('2027-12-31'), organizationId: org1._id });
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
  });

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

  it('should return 409 when closing an already CLOSED claim', async () => {
    const token = generateToken(admin1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimClosed._id}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ closingNotes: 'Already closed' });

    expect(response.status).toBe(409);
    expect(response.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
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
  it('should handle concurrent close requests safely, allowing exactly one to succeed', async () => {
    const token = generateToken(admin1);

    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/v1/claims/${claimApproved._id}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({ closingNotes: 'First admin close' }),
      request(app)
        .post(`/api/v1/claims/${claimApproved._id}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({ closingNotes: 'Second admin close' }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const successfulRes = res1.status === 200 ? res1 : res2;
    const failedRes = res1.status === 409 ? res1 : res2;

    expect(successfulRes.body.success).toBe(true);
    expect(successfulRes.body.data.status).toBe('CLOSED');
    expect(failedRes.body.success).toBe(false);
    expect(failedRes.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');

    // Confirm database state: exactly one 'Claim Closed' timeline event
    const dbClaim = await Claim.findById(claimApproved._id);
    const closeEvents = dbClaim.timeline.filter((e) => e.action === 'Claim Closed');
    expect(closeEvents.length).toBe(1);
    expect(dbClaim.status).toBe('CLOSED');
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
});

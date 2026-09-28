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
const { buildPolicy } = require('./helpers/policyFactory');
jest.mock('../src/modules/notifications/notification.service', () => ({
  createAndSendNotification: jest.fn().mockResolvedValue({}),
}));

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

describe('POST /api/v1/claims/:claimId/decision', () => {
  let org1, org2;
  let officer1, officer2, admin1, adjuster1;
  let claimUnderReview, claimNew, claimApproved;

  beforeEach(async () => {
    org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1' });
    global.__testPol = await buildPolicy({ policyNumber: 'POL-FIX-001', status: 'ACTIVE', startDate: new Date('2026-01-01'), expiryDate: new Date('2027-12-31'), organizationId: org1._id });
    org2 = await Organization.create({ name: 'Org 2', code: 'ORG-2' });

    officer1 = await User.create({ name: 'O1', employeeCode: 'O-1', password: 'p', role: 'CLAIMS_OFFICER', organizationId: org1._id });
    officer2 = await User.create({ name: 'O2', employeeCode: 'O-2', password: 'p', role: 'CLAIMS_OFFICER', organizationId: org2._id });
    admin1 = await User.create({ name: 'A1', employeeCode: 'A-1', password: 'p', role: 'ADMIN', organizationId: org1._id });
    adjuster1 = await User.create({ name: 'FA1', employeeCode: 'FA-1', password: 'p', role: 'FIELD_ADJUSTER', organizationId: org1._id, status: 'ACTIVE' });

    // Claim in UNDER_REVIEW status (the valid source state for decision)
    claimUnderReview = await Claim.create({
      organizationId: org1._id,
      policyId: global.__testPol._id,
      createdBy: officer1._id,
      status: 'UNDER_REVIEW',
      customer: { name: 'Customer A', phone: '0500000001' },
      incidentType: 'COLLISION',
      incidentLocation: 'Location A',
    });

    // Claim in NEW status (invalid for decision)
    claimNew = await Claim.create({
      organizationId: org1._id,
      policyId: global.__testPol._id,
      createdBy: officer1._id,
      status: 'NEW',
      customer: { name: 'Customer B', phone: '0500000002' },
      incidentType: 'COLLISION',
      incidentLocation: 'Location B',
    });

    // Claim already APPROVED (invalid for decision)
    claimApproved = await Claim.create({
      organizationId: org1._id,
      policyId: global.__testPol._id,
      createdBy: officer1._id,
      status: 'APPROVED',
      customer: { name: 'Customer C', phone: '0500000003' },
      incidentType: 'COLLISION',
      incidentLocation: 'Location C',
    });
  });

  // ─── Happy Path: APPROVED ────────────────────────────────────────────────
  it('should approve an UNDER_REVIEW claim by CLAIMS_OFFICER', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED', notes: 'All documentation verified' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Decision recorded successfully');
    expect(response.body.data.status).toBe('APPROVED');
    expect(response.body.data.decisionNotes).toBe('All documentation verified');

    // Verify database state
    const dbClaim = await Claim.findById(claimUnderReview._id);
    expect(dbClaim.status).toBe('APPROVED');
    expect(dbClaim.decisionNotes).toBe('All documentation verified');
    const approvalEvent = dbClaim.timeline.find((e) => e.action === 'Claim Approved');
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent.performedBy.toString()).toBe(officer1._id.toString());
    expect(approvalEvent.role).toBe('CLAIMS_OFFICER');
  });

  // ─── Happy Path: REJECTED ───────────────────────────────────────────────
  it('should reject an UNDER_REVIEW claim by CLAIMS_OFFICER', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'REJECTED', notes: 'Fraudulent documentation detected' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('REJECTED');
    expect(response.body.data.decisionNotes).toBe('Fraudulent documentation detected');

    // Verify database state
    const dbClaim = await Claim.findById(claimUnderReview._id);
    expect(dbClaim.status).toBe('REJECTED');
    const rejectionEvent = dbClaim.timeline.find((e) => e.action === 'Claim Rejected');
    expect(rejectionEvent).toBeDefined();
    expect(rejectionEvent.performedBy.toString()).toBe(officer1._id.toString());
  });

  // ─── Happy Path: ADMIN can decide ───────────────────────────────────────
  it('should allow ADMIN to approve an UNDER_REVIEW claim', async () => {
    const token = generateToken(admin1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('APPROVED');

    // Verify timeline records ADMIN role
    const dbClaim = await Claim.findById(claimUnderReview._id);
    const approvalEvent = dbClaim.timeline.find((e) => e.action === 'Claim Approved');
    expect(approvalEvent.role).toBe('ADMIN');
  });

  // ─── Happy Path: notes are optional ─────────────────────────────────────
  it('should accept decision without notes', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('APPROVED');
    expect(response.body.data.decisionNotes).toBeNull();
  });

  // ─── RBAC: FIELD_ADJUSTER forbidden ─────────────────────────────────────
  it('should return 403 if called by a FIELD_ADJUSTER', async () => {
    const token = generateToken(adjuster1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' });

    expect(response.status).toBe(403);
  });

  // ─── Tenant Isolation ───────────────────────────────────────────────────
  it('should return 404 if claim belongs to another organization', async () => {
    const token = generateToken(officer2); // officer2 belongs to org2
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`) // claim belongs to org1
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' });

    expect(response.status).toBe(404);
    expect(response.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  // ─── Invalid Status Transitions ─────────────────────────────────────────
  it('should return 409 if claim is in NEW status (not UNDER_REVIEW)', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimNew._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' });

    expect(response.status).toBe(409);
    expect(response.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('should return 409 if claim is already APPROVED', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' });

    expect(response.status).toBe(409);
    expect(response.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  // ─── Claim Not Found ───────────────────────────────────────────────────
  it('should return 404 if claimId does not exist', async () => {
    const token = generateToken(officer1);
    const nonExistentId = new mongoose.Types.ObjectId().toString();
    const response = await request(app)
      .post(`/api/v1/claims/${nonExistentId}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' });

    expect(response.status).toBe(404);
    expect(response.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  // ─── Validation Errors ──────────────────────────────────────────────────
  it('should return 400 if decision field is missing', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'Some notes' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Validation Error');
  });

  it('should return 400 if decision is an invalid value', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'PENDING' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('should return 400 when claimId is not a valid ObjectId', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post('/api/v1/claims/invalid-id-123/decision')
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'APPROVED' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // ─── Concurrency: Race Condition ────────────────────────────────────────
  it('should handle concurrent decision race condition safely, allowing exactly one to succeed', async () => {
    const token = generateToken(officer1);

    // Two simultaneous decision calls on the same claim
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'APPROVED', notes: 'First officer' }),
      request(app)
        .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'REJECTED', notes: 'Second officer' }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const successfulRes = res1.status === 200 ? res1 : res2;
    const failedRes = res1.status === 409 ? res1 : res2;

    expect(successfulRes.body.success).toBe(true);
    expect(['APPROVED', 'REJECTED']).toContain(successfulRes.body.data.status);
    expect(failedRes.body.success).toBe(false);
    expect(failedRes.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');

    // Confirm database state: exactly one decision timeline event
    const dbClaim = await Claim.findById(claimUnderReview._id);
    const decisionEvents = dbClaim.timeline.filter(
      (e) => e.action === 'Claim Approved' || e.action === 'Claim Rejected'
    );
    expect(decisionEvents.length).toBe(1);
  });

  // ─── Authentication ─────────────────────────────────────────────────────
  it('should return 401 if no token is provided', async () => {
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .send({ decision: 'APPROVED' });

    expect(response.status).toBe(401);
  });

  // ─── Response Shape ─────────────────────────────────────────────────────
  it('should return the correct response shape on success', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'REJECTED', notes: 'Insufficient evidence' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('message', 'Decision recorded successfully');
    expect(response.body.data).toHaveProperty('id');
    expect(response.body.data).toHaveProperty('claimNumber');
    expect(response.body.data).toHaveProperty('status', 'REJECTED');
    expect(response.body.data).toHaveProperty('decisionNotes', 'Insufficient evidence');
  });
});

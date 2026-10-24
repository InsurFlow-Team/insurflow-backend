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
    const collection = collections[key];
    await collection.deleteMany();
  }
});

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

describe('POST /api/v1/claims/:claimId/assign', () => {
  let org1, org2;
  let officer1, officer2, adjusterAvailable, adjusterBusy, adjusterInactive, admin1;
  let claimOrg1, claimOrg2;

  beforeEach(async () => {
    org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1' });
    global.__testPol = await buildPolicy({ policyNumber: 'POL-FIX-001', status: 'ACTIVE', startDate: new Date('2026-01-01'), expiryDate: new Date('2027-12-31'), organizationId: org1._id });
    org2 = await Organization.create({ name: 'Org 2', code: 'ORG-2' });

    officer1 = await User.create({ name: 'O1', employeeCode: 'O-1', password: 'p', role: 'CLAIMS_OFFICER', organizationId: org1._id });
    officer2 = await User.create({ name: 'O2', employeeCode: 'O-2', password: 'p', role: 'CLAIMS_OFFICER', organizationId: org2._id });

    admin1 = await User.create({ name: 'ADM', employeeCode: 'ADM-1', password: 'p', role: 'ADMIN', organizationId: org1._id, status: 'ACTIVE' });

    adjusterAvailable = await User.create({ name: 'AA', employeeCode: 'AA-1', password: 'p', role: 'FIELD_ADJUSTER', organizationId: org1._id, status: 'ACTIVE', surveyorLicenseNumber: 'LIC-AA-1', surveyorLicenseExpiry: '2099-12-31' });
    adjusterBusy = await User.create({ name: 'AB', employeeCode: 'AB-1', password: 'p', role: 'FIELD_ADJUSTER', organizationId: org1._id, status: 'ACTIVE', surveyorLicenseNumber: 'LIC-AB-1', surveyorLicenseExpiry: '2099-12-31' });
    adjusterInactive = await User.create({ name: 'AI', employeeCode: 'AI-1', password: 'p', role: 'FIELD_ADJUSTER', organizationId: org1._id, status: 'INACTIVE' });

    claimOrg1 = await Claim.create({ organizationId: org1._id,
      policyId: global.__testPol._id, createdBy: officer1._id, status: 'NEW', customer: { name: 'C', phone: '1' }, incidentType: 'COLLISION', incidentLocation: 'L' });
    claimOrg2 = await Claim.create({ organizationId: org2._id,
      policyId: global.__testPol._id, createdBy: officer2._id, status: 'NEW', customer: { name: 'C', phone: '1' }, incidentType: 'COLLISION', incidentLocation: 'L' });

    // Make adjusterBusy actually busy (exceeds 3 active claims -> 4 claims)
    for (let i = 0; i < 4; i++) {
      await Claim.create({ organizationId: org1._id,
      policyId: global.__testPol._id, createdBy: officer1._id, status: 'ASSIGNED', assignedTo: adjusterBusy._id, customer: { name: 'C', phone: '1' }, incidentType: 'COLLISION', incidentLocation: 'L' });
    }
  });

  it('should successfully assign a NEW claim to an available adjuster with 0 active claims', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterAvailable._id });

    expect(response.status).toBe(200);
    expect(response.body.data.assignedTo).toBe(adjusterAvailable._id.toString());
    expect(response.body.data.status).toBe('PENDING_ACCEPTANCE');
  });

  it('should successfully assign to an adjuster who currently has up to 3 active claims (3 and less is available)', async () => {
    const token = generateToken(officer1);

    // Create 3 active claims for adjusterAvailable
    for (let i = 0; i < 3; i++) {
      await Claim.create({ organizationId: org1._id,
      policyId: global.__testPol._id, createdBy: officer1._id, status: 'ASSIGNED', assignedTo: adjusterAvailable._id, customer: { name: 'C', phone: '1' }, incidentType: 'COLLISION', incidentLocation: 'L' });
    }

    // Assigning the claimOrg1 should still succeed because currently activeTasksCount = 3 (<= 3)
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterAvailable._id });

    expect(response.status).toBe(200);
    expect(response.body.data.assignedTo).toBe(adjusterAvailable._id.toString());
    expect(response.body.data.status).toBe('PENDING_ACCEPTANCE');
  });

  it('should fail to assign if adjuster is busy (more than 3 active claims)', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterBusy._id });

    expect(response.status).toBe(409);
    expect(response.body.errors[0].code).toBe('ADJUSTER_UNAVAILABLE');
  });

  it('should fail to assign if adjuster is inactive', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterInactive._id });

    expect(response.status).toBe(404);
    expect(response.body.errors[0].code).toBe('ADJUSTER_NOT_FOUND');
  });

  it('should fail if claim belongs to another organization', async () => {
    const token = generateToken(officer1); // officer1 belongs to org1
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg2._id}/assign`) // claimOrg2 belongs to org2
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterAvailable._id });

    expect(response.status).toBe(404);
  });

  it('should fail if claim is already ASSIGNED (not NEW)', async () => {
    // claimOrg1 is NEW. Let's assign it first.
    await Claim.updateOne({ _id: claimOrg1._id }, { status: 'ASSIGNED' });

    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterAvailable._id });

    expect(response.status).toBe(409);
    expect(response.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('should return 403 if called by a FIELD_ADJUSTER', async () => {
    const token = generateToken(adjusterAvailable); // FIELD_ADJUSTER token
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterAvailable._id });

    expect(response.status).toBe(403);
  });

  it('should successfully assign a claim when called by an ADMIN', async () => {
    const token = generateToken(admin1); // ADMIN token
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterAvailable._id, priority: 'HIGH', notes: 'Assigned by admin' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.assignedTo).toBe(adjusterAvailable._id.toString());
    expect(response.body.data.assignedBy).toBe(admin1._id.toString());
    expect(response.body.data.status).toBe('PENDING_ACCEPTANCE');
    expect(response.body.data.priority).toBe('HIGH');

    // Verify timeline
    const dbClaim = await Claim.findById(claimOrg1._id);
    const timelineEvent = dbClaim.timeline.find((e) => e.action === 'Assignment Pending Acceptance');
    expect(timelineEvent).toBeDefined();
    expect(timelineEvent.performedBy.toString()).toBe(admin1._id.toString());
    expect(timelineEvent.role).toBe('ADMIN');
    expect(timelineEvent.notes).toBe('Assigned by admin');
  });

  it('should successfully assign with priority and notes', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterAvailable._id, priority: 'HIGH', notes: 'Please hurry' });

    expect(response.status).toBe(200);
    expect(response.body.data.assignedTo).toBe(adjusterAvailable._id.toString());
    expect(response.body.data.priority).toBe('HIGH');
  });

  it('should generate tenant-scoped sequential claim numbers (CLM-<ORG_CODE>-NNNN)', async () => {
    // claimOrg1 belongs to org1 (code: 'ORG-1'), claimOrg2 belongs to org2 (code: 'ORG-2')
    // Each org should have its own independent sequence
    expect(claimOrg1.claimNumber).toMatch(/^CLM-ORG-1-\d{4}$/);
    expect(claimOrg2.claimNumber).toMatch(/^CLM-ORG-2-\d{4}$/);

    // Extract sequence numbers (last segment after final hyphen)
    const getSeq = (cn) => parseInt(cn.split('-').pop(), 10);

    // Both orgs should start their own sequence at 0001
    expect(getSeq(claimOrg1.claimNumber)).toBe(1);
    expect(getSeq(claimOrg2.claimNumber)).toBe(1);

    // Create two more claims in org1 — they should be sequential within org1
    const c1 = await Claim.create({ organizationId: org1._id,
      policyId: global.__testPol._id, createdBy: officer1._id, status: 'NEW', customer: { name: 'C', phone: '1' }, incidentType: 'COLLISION', incidentLocation: 'L' });
    const c2 = await Claim.create({ organizationId: org1._id,
      policyId: global.__testPol._id, createdBy: officer1._id, status: 'NEW', customer: { name: 'C', phone: '1' }, incidentType: 'COLLISION', incidentLocation: 'L' });

    expect(c1.claimNumber).toMatch(/^CLM-ORG-1-\d{4}$/);
    expect(c2.claimNumber).toMatch(/^CLM-ORG-1-\d{4}$/);
    expect(getSeq(c2.claimNumber)).toBe(getSeq(c1.claimNumber) + 1);
  });

  it('should return 400 Bad Request when claimId is not a valid 24-character hex ObjectId', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post('/api/v1/claims/invalid-claim-id-123/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterAvailable._id });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Validation Error');
    expect(response.body.errors[0].code).toBe('VALIDATION_ERROR');
    expect(response.body.errors[0].details).toMatch(/Invalid ID format/i);
  });

  it('should return 400 Bad Request when adjusterId in body is not a valid 24-character hex ObjectId', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: 'invalid-hex-id-123' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Validation Error');
    expect(response.body.errors[0].code).toBe('VALIDATION_ERROR');
    expect(response.body.errors[0].details).toMatch(/Invalid ID format/i);
  });

  it('should return 404 when adjusterId is a valid 24-character hex ObjectId but does not exist in the database', async () => {
    const token = generateToken(officer1);
    const nonExistentId = new mongoose.Types.ObjectId().toString();
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: nonExistentId });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.errors[0].code).toBe('ADJUSTER_NOT_FOUND');
  });

  it('should accept a valid 24-character hex adjusterId in uppercase format', async () => {
    const token = generateToken(officer1);
    const upperAdjusterId = adjusterAvailable._id.toString().toUpperCase();
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: upperAdjusterId });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.assignedTo).toBe(adjusterAvailable._id.toString());
    expect(response.body.data.status).toBe('PENDING_ACCEPTANCE');
  });

  it('should handle concurrent assignment race condition safely, allowing exactly one to succeed and rejecting duplicate with 409', async () => {
    const adjuster2 = await User.create({
      name: 'AA2',
      employeeCode: 'AA-2',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-AA-2',
      surveyorLicenseExpiry: '2099-12-31',
    });

    const token = generateToken(officer1);

    // Trigger two simultaneous assignment calls on the same claim
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/v1/claims/${claimOrg1._id}/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({ adjusterId: adjusterAvailable._id }),
      request(app)
        .post(`/api/v1/claims/${claimOrg1._id}/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({ adjusterId: adjuster2._id }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const successfulRes = res1.status === 200 ? res1 : res2;
    const failedRes = res1.status === 409 ? res1 : res2;

    expect(successfulRes.body.success).toBe(true);
    expect(successfulRes.body.data.status).toBe('PENDING_ACCEPTANCE');
    expect(failedRes.body.success).toBe(false);
    expect(failedRes.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');

    // Confirm database state
    const dbClaim = await Claim.findById(claimOrg1._id);
    expect(dbClaim.status).toBe('PENDING_ACCEPTANCE');
    const assignmentTimelineEvents = dbClaim.timeline.filter(
      (e) => e.action === 'Assignment Pending Acceptance'
    );
    expect(assignmentTimelineEvents.length).toBe(1);
  });
});


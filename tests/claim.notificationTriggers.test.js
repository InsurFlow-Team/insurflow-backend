const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');

jest.mock('../src/modules/notifications/notification.service', () => ({
  createAndSendNotification: jest.fn().mockResolvedValue({}),
}));

const { createAndSendNotification } = require('../src/modules/notifications/notification.service');

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
  jest.clearAllMocks();
});

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

describe('Claim Notification Triggers & Isolation (Increment 3)', () => {
  let org, officer, adjuster, officerToken;

  beforeEach(async () => {
    org = await Organization.create({ name: 'Test Org', code: 'ORG-TRIGGERS' });

    officer = await User.create({
      name: 'Claims Officer',
      employeeCode: 'CO-001',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org._id,
      status: 'ACTIVE',
    });

    adjuster = await User.create({
      name: 'Field Adjuster',
      employeeCode: 'FA-001',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org._id,
      status: 'ACTIVE',
    });

    officerToken = generateToken(officer);
  });

  describe('Trigger 1: NEW -> ASSIGNED (assignClaim)', () => {
    it('should call createAndSendNotification with correct payload on claim assignment', async () => {
      const claim = await Claim.create({
        organizationId: org._id,
        createdBy: officer._id,
        status: 'NEW',
        customer: { name: 'John Doe', phone: '0501112233' },
        incidentType: 'COLLISION',
        incidentLocation: 'Main Street',
      });

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/assign`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ adjusterId: adjuster._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('PENDING_ACCEPTANCE');

      expect(createAndSendNotification).toHaveBeenCalledTimes(1);
      expect(createAndSendNotification).toHaveBeenCalledWith({
        recipientId: adjuster._id,
        organizationId: org._id,
        type: 'PENDING_ACCEPTANCE',
        relatedClaimId: claim._id,
        title: 'New Assignment Pending',
        body: `You have a new claim assignment pending your acceptance: ${claim.claimNumber}.`,
      });
    });

    it('should succeed with 200 when createAndSendNotification fails or rejects', async () => {
      createAndSendNotification.mockRejectedValueOnce(new Error('Notification DB / Push failed'));

      const claim = await Claim.create({
        organizationId: org._id,
        createdBy: officer._id,
        status: 'NEW',
        customer: { name: 'John Doe', phone: '0501112233' },
        incidentType: 'COLLISION',
        incidentLocation: 'Main Street',
      });

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/assign`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ adjusterId: adjuster._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('PENDING_ACCEPTANCE');
    });
  });

  describe('Trigger 2: UNDER_REVIEW -> CORRECTION_REQUIRED (requestCorrection)', () => {
    it('should call createAndSendNotification with correct payload on correction request', async () => {
      const claim = await Claim.create({
        organizationId: org._id,
        createdBy: officer._id,
        assignedTo: adjuster._id,
        status: 'UNDER_REVIEW',
        customer: { name: 'Jane Doe', phone: '0502223344' },
        incidentType: 'COLLISION',
        incidentLocation: 'Downtown',
      });

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/review/request-correction`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ notes: 'Please re-upload clearer vehicle photos.' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('CORRECTION_REQUIRED');

      expect(createAndSendNotification).toHaveBeenCalledTimes(1);
      expect(createAndSendNotification).toHaveBeenCalledWith({
        recipientId: adjuster._id,
        organizationId: org._id,
        type: 'CORRECTION_REQUIRED',
        relatedClaimId: claim._id,
        title: 'Correction Requested',
        body: `Claim ${claim.claimNumber} needs correction. Reason: Please re-upload clearer vehicle photos.`,
      });
    });

    it('should succeed with 200 when createAndSendNotification fails or rejects', async () => {
      createAndSendNotification.mockRejectedValueOnce(new Error('Notification DB / Push failed'));

      const claim = await Claim.create({
        organizationId: org._id,
        createdBy: officer._id,
        assignedTo: adjuster._id,
        status: 'UNDER_REVIEW',
        customer: { name: 'Jane Doe', phone: '0502223344' },
        incidentType: 'COLLISION',
        incidentLocation: 'Downtown',
      });

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/review/request-correction`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ notes: 'Missing receipt' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('CORRECTION_REQUIRED');
    });
  });

  describe('Trigger 3: UNDER_REVIEW -> APPROVED (decideClaim approve branch)', () => {
    it('should call createAndSendNotification with correct payload on claim approval', async () => {
      const claim = await Claim.create({
        organizationId: org._id,
        createdBy: officer._id,
        assignedTo: adjuster._id,
        status: 'UNDER_REVIEW',
        customer: { name: 'Alice Smith', phone: '0503334455' },
        incidentType: 'COLLISION',
        incidentLocation: 'Highway 1',
      });

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ decision: 'APPROVED', notes: 'Damage validated by report' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('APPROVED');

      expect(createAndSendNotification).toHaveBeenCalledTimes(1);
      expect(createAndSendNotification).toHaveBeenCalledWith({
        recipientId: adjuster._id,
        organizationId: org._id,
        type: 'APPROVED',
        relatedClaimId: claim._id,
        title: 'Claim Approved',
        body: `Claim ${claim.claimNumber} has been approved.`,
      });
    });

    it('should succeed with 200 when createAndSendNotification fails or rejects', async () => {
      createAndSendNotification.mockRejectedValueOnce(new Error('Notification DB / Push failed'));

      const claim = await Claim.create({
        organizationId: org._id,
        createdBy: officer._id,
        assignedTo: adjuster._id,
        status: 'UNDER_REVIEW',
        customer: { name: 'Alice Smith', phone: '0503334455' },
        incidentType: 'COLLISION',
        incidentLocation: 'Highway 1',
      });

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ decision: 'APPROVED' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('APPROVED');
    });
  });

  describe('Trigger 4: UNDER_REVIEW -> REJECTED (decideClaim reject branch)', () => {
    it('should call createAndSendNotification with correct payload on claim rejection', async () => {
      const claim = await Claim.create({
        organizationId: org._id,
        createdBy: officer._id,
        assignedTo: adjuster._id,
        status: 'UNDER_REVIEW',
        customer: { name: 'Bob Jones', phone: '0504445566' },
        incidentType: 'COLLISION',
        incidentLocation: 'Coastal Road',
      });

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ decision: 'REJECTED', notes: 'Policy does not cover flood damage' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('REJECTED');

      expect(createAndSendNotification).toHaveBeenCalledTimes(1);
      expect(createAndSendNotification).toHaveBeenCalledWith({
        recipientId: adjuster._id,
        organizationId: org._id,
        type: 'REJECTED',
        relatedClaimId: claim._id,
        title: 'Claim Rejected',
        body: `Claim ${claim.claimNumber} has been rejected.`,
      });
    });

    it('should succeed with 200 when createAndSendNotification fails or rejects', async () => {
      createAndSendNotification.mockRejectedValueOnce(new Error('Notification DB / Push failed'));

      const claim = await Claim.create({
        organizationId: org._id,
        createdBy: officer._id,
        assignedTo: adjuster._id,
        status: 'UNDER_REVIEW',
        customer: { name: 'Bob Jones', phone: '0504445566' },
        incidentType: 'COLLISION',
        incidentLocation: 'Coastal Road',
      });

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ decision: 'REJECTED', notes: 'Fraud suspected' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('REJECTED');
    });
  });
});

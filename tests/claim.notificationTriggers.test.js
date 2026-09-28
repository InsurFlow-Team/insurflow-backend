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
  sendToOrganization: jest.fn().mockResolvedValue([]),
}));

const { createAndSendNotification, sendToOrganization } = require('../src/modules/notifications/notification.service');

const Policy = require('../src/modules/policies/policy.model');
const { buildPolicy } = require('./helpers/policyFactory');
const Customer = require('../src/modules/customers/customer.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
}, 30000);

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
  let org, officer, adjuster, officerToken, adjusterToken, customer, vehicle;

  beforeEach(async () => {
    org = await Organization.create({ name: 'Test Org', code: 'ORG-TRIGGERS' });
    global.__testPol = await buildPolicy({ policyNumber: 'POL-FIX-001', status: 'ACTIVE', startDate: new Date('2026-01-01'), expiryDate: new Date('2027-12-31'), organizationId: org._id });

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
    adjusterToken = generateToken(adjuster);

    customer = await Customer.create({
      fullName: 'Test Customer',
      phone: '0501112233',
      organizationId: org._id,
    });

    vehicle = await Vehicle.create({
      plateNumber: 'ABC-123',
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
      customerId: customer._id,
      policyId: global.__testPol._id,
      organizationId: org._id,
    });
  });

  describe('Trigger 1: NEW -> ASSIGNED (assignClaim)', () => {
    it('should call createAndSendNotification with correct payload on claim assignment', async () => {
      const claim = await Claim.create({
        organizationId: org._id,
      policyId: global.__testPol._id,
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
      policyId: global.__testPol._id,
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
      policyId: global.__testPol._id,
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
      policyId: global.__testPol._id,
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
      policyId: global.__testPol._id,
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
      policyId: global.__testPol._id,
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
      policyId: global.__testPol._id,
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
      policyId: global.__testPol._id,
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

  describe('Trigger 5: Claim Creation -> NEW_CLAIM (createClaim)', () => {
    it('should call sendToOrganization with NEW_CLAIM excluding creator', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyId: global.__testPol._id.toString(),
          plateNumber: vehicle.plateNumber,
          incidentType: 'COLLISION',
          incidentLocation: 'King Abdullah Street',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      expect(sendToOrganization).toHaveBeenCalledTimes(1);
      expect(sendToOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: org._id.toString(),
          type: 'NEW_CLAIM',
          title: 'New Claim Created',
          excludeUserId: officer._id.toString(),
        })
      );
    });

    it('should succeed with 201 when sendToOrganization throws or rejects', async () => {
      sendToOrganization.mockRejectedValueOnce(new Error('Notification service failed'));

      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          policyId: global.__testPol._id.toString(),
          plateNumber: vehicle.plateNumber,
          incidentType: 'COLLISION',
          incidentLocation: 'King Abdullah Street',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Trigger 6: PENDING_ACCEPTANCE -> NEW (declineAssignment)', () => {
    it('should call sendToOrganization with ASSIGNMENT_DECLINED on assignment decline', async () => {
      const claim = await Claim.create({
        organizationId: org._id,
        policyId: global.__testPol._id,
        createdBy: officer._id,
        assignedTo: adjuster._id,
        assignedBy: officer._id,
        assignedAt: new Date(),
        status: 'PENDING_ACCEPTANCE',
        customer: { name: 'Customer 1', phone: '0501112233' },
        incidentType: 'COLLISION',
        incidentLocation: 'Street A',
      });

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decline-assignment`)
        .set('Authorization', `Bearer ${adjusterToken}`)
        .send({ reason: 'Distance is too far' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('NEW');

      expect(sendToOrganization).toHaveBeenCalledTimes(1);
      expect(sendToOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: org._id.toString(),
          type: 'ASSIGNMENT_DECLINED',
          title: 'Assignment Declined',
        })
      );
    });

    it('should succeed with 200 when sendToOrganization fails or rejects', async () => {
      sendToOrganization.mockRejectedValueOnce(new Error('Notification DB failure'));

      const claim = await Claim.create({
        organizationId: org._id,
        policyId: global.__testPol._id,
        createdBy: officer._id,
        assignedTo: adjuster._id,
        assignedBy: officer._id,
        assignedAt: new Date(),
        status: 'PENDING_ACCEPTANCE',
        customer: { name: 'Customer 1', phone: '0501112233' },
        incidentType: 'COLLISION',
        incidentLocation: 'Street A',
      });

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decline-assignment`)
        .set('Authorization', `Bearer ${adjusterToken}`)
        .send({ reason: 'Vehicle issue' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Trigger 7: IN_PROGRESS -> SUBMITTED (submitInspection)', () => {
    it('should call sendToOrganization with INSPECTION_COMPLETED on inspection submit', async () => {
      const claim = await Claim.create({
        organizationId: org._id,
        policyId: global.__testPol._id,
        createdBy: officer._id,
        assignedTo: adjuster._id,
        status: 'IN_PROGRESS',
        customer: { name: 'Customer 1', phone: '0501112233' },
        vehicle: { vehicleId: vehicle._id, plateNumber: vehicle.plateNumber },
        accident: { accidentType: 'COLLISION' },
        location: { latitude: 31.95, longitude: 35.91 },
        evidence: [{ url: 'https://cloudinary.com/test.jpg', publicId: 'ev1', imageType: 'VEHICLE_FRONT', uploadedBy: adjuster._id }],
        signature: { url: 'https://cloudinary.com/sig.png', publicId: 'sig1' },
        incidentType: 'COLLISION',
        incidentLocation: 'Street A',
      });

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/inspection/submit`)
        .set('Authorization', `Bearer ${adjusterToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUBMITTED');

      expect(sendToOrganization).toHaveBeenCalledTimes(1);
      expect(sendToOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: org._id.toString(),
          type: 'INSPECTION_COMPLETED',
          title: 'Inspection Completed',
        })
      );
    });

    it('should succeed with 200 when sendToOrganization fails or rejects', async () => {
      sendToOrganization.mockRejectedValueOnce(new Error('Notification DB failure'));

      const claim = await Claim.create({
        organizationId: org._id,
        policyId: global.__testPol._id,
        createdBy: officer._id,
        assignedTo: adjuster._id,
        status: 'IN_PROGRESS',
        customer: { name: 'Customer 1', phone: '0501112233' },
        vehicle: { vehicleId: vehicle._id, plateNumber: vehicle.plateNumber },
        accident: { accidentType: 'COLLISION' },
        location: { latitude: 31.95, longitude: 35.91 },
        evidence: [{ url: 'https://cloudinary.com/test.jpg', publicId: 'ev1', imageType: 'VEHICLE_FRONT', uploadedBy: adjuster._id }],
        signature: { url: 'https://cloudinary.com/sig.png', publicId: 'sig1' },
        incidentType: 'COLLISION',
        incidentLocation: 'Street A',
      });

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/inspection/submit`)
        .set('Authorization', `Bearer ${adjusterToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});

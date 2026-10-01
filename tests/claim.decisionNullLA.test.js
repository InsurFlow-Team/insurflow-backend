const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const { buildPolicy } = require('./helpers/policyFactory');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');

jest.mock('../src/modules/notifications/notification.service', () => ({
  createAndSendNotification: jest.fn().mockResolvedValue({}),
  sendToOrganization: jest.fn().mockResolvedValue({}),
}));

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

describe('Decision — lossAssessment null handling on REJECTED (F4)', () => {
  let mongoServer;
  let org, officer, officerToken;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    org = await Organization.create({ name: 'F4 Org', code: 'F4ORG', domain: 'f4.com', status: 'ACTIVE' });
    officer = await User.create({
      name: 'F4 Officer', employeeCode: 'F4-OF', password: 'password123',
      role: 'CLAIMS_OFFICER', organizationId: org._id, status: 'ACTIVE',
    });
    officerToken = generateToken(officer);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  const makeUnderReviewClaim = async () => {
    const policy = await buildPolicy({
      policyNumber: `POL-F4-${Date.now()}`,
      status: 'ACTIVE', organizationId: org._id,
      startDate: new Date('2025-01-01'), expiryDate: new Date('2027-12-31'),
    });
    return Claim.create({
      organizationId: org._id, policyId: policy._id, createdBy: officer._id,
      status: 'UNDER_REVIEW',
      customer: { name: 'F4 Customer', phone: '0500000001' },
      incidentType: 'COLLISION', incidentLocation: 'F4 Location',
    });
  };

  it('REJECTED with lossAssessment absent returns 200', async () => {
    const claim = await makeUnderReviewClaim();
    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/decision`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ decision: 'REJECTED', notes: 'Not eligible' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REJECTED');
  });

  it('REJECTED with lossAssessment null returns 200 and stores no lossAssessment', async () => {
    const claim = await makeUnderReviewClaim();
    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/decision`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ decision: 'REJECTED', notes: 'Not eligible', lossAssessment: null });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REJECTED');

    const dbClaim = await Claim.findById(claim._id);
    expect(dbClaim.lossAssessment == null).toBe(true);
  });

  it('REJECTED with a lossAssessment object returns 400', async () => {
    const claim = await makeUnderReviewClaim();
    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/decision`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        decision: 'REJECTED',
        lossAssessment: { estimatedPartsCost: 100, laborCost: 50 },
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('APPROVED with lossAssessment absent returns 400', async () => {
    const claim = await makeUnderReviewClaim();
    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/decision`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ decision: 'APPROVED', notes: 'Approved' });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('APPROVED with lossAssessment null returns 400', async () => {
    const claim = await makeUnderReviewClaim();
    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/decision`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ decision: 'APPROVED', lossAssessment: null });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });
});

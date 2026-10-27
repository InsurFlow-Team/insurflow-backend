const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const config = require('../src/config/env');

let mongoServer;
let org1, org2;
let admin1, adminToken1;
let admin2, adminToken2;
let officer1, officerToken1;
let adjuster1, adjusterToken1;

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany();
  }

  org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1' });
  org2 = await Organization.create({ name: 'Org 2', code: 'ORG-2' });

  admin1 = await User.create({
    name: 'Admin One',
    employeeCode: 'ADM-01',
    password: 'Password123!',
    role: 'ADMIN',
    organizationId: org1._id,
    status: 'ACTIVE',
  });
  adminToken1 = generateToken(admin1);

  admin2 = await User.create({
    name: 'Admin Two',
    employeeCode: 'ADM-02',
    password: 'Password123!',
    role: 'ADMIN',
    organizationId: org2._id,
    status: 'ACTIVE',
  });
  adminToken2 = generateToken(admin2);

  officer1 = await User.create({
    name: 'Officer One',
    employeeCode: 'OFF-01',
    password: 'Password123!',
    role: 'CLAIMS_OFFICER',
    organizationId: org1._id,
    status: 'ACTIVE',
  });
  officerToken1 = generateToken(officer1);

  adjuster1 = await User.create({
    name: 'Adjuster One',
    employeeCode: 'ADJ-01',
    password: 'Password123!',
    role: 'FIELD_ADJUSTER',
    organizationId: org1._id,
    status: 'ACTIVE',
    surveyorLicenseNumber: 'LIC-001',
    surveyorLicenseExpiry: '2028-12-31',
  });
  adjusterToken1 = generateToken(adjuster1);
});

describe('User Payment Permission (PB-16 R1)', () => {
  it('PATCH /users/:userId/payment-permission: ADMIN grants payment permission to a CLAIMS_OFFICER (200)', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${officer1._id}/payment-permission`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ canRecordPayments: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(officer1._id.toString());
    expect(res.body.data.canRecordPayments).toBe(true);

    const updated = await User.findById(officer1._id);
    expect(updated.canRecordPayments).toBe(true);
  });

  it('PATCH /users/:userId/payment-permission: ADMIN revokes payment permission from a CLAIMS_OFFICER (200)', async () => {
    await User.findByIdAndUpdate(officer1._id, { canRecordPayments: true });

    const res = await request(app)
      .patch(`/api/v1/users/${officer1._id}/payment-permission`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ canRecordPayments: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.canRecordPayments).toBe(false);

    const updated = await User.findById(officer1._id);
    expect(updated.canRecordPayments).toBe(false);
  });

  it('PATCH /users/:userId/payment-permission: ADMIN grants payment permission to another ADMIN in same organization (200)', async () => {
    const adminOther = await User.create({
      name: 'Admin Same Org',
      employeeCode: 'ADM-SAME',
      password: 'Password123!',
      role: 'ADMIN',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    const res = await request(app)
      .patch(`/api/v1/users/${adminOther._id}/payment-permission`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ canRecordPayments: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.canRecordPayments).toBe(true);

    const updated = await User.findById(adminOther._id);
    expect(updated.canRecordPayments).toBe(true);
  });

  it('PATCH /users/:userId/payment-permission: target user is a FIELD_ADJUSTER returns 422 NOT_ELIGIBLE_FOR_PAYMENT_PERMISSION', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${adjuster1._id}/payment-permission`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ canRecordPayments: true });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('NOT_ELIGIBLE_FOR_PAYMENT_PERMISSION');
  });

  it('PATCH /users/:userId/payment-permission: target user in different organization returns 404 USER_NOT_FOUND', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${admin2._id}/payment-permission`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ canRecordPayments: true });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('USER_NOT_FOUND');
  });

  it('PATCH /users/:userId/payment-permission: target user does not exist returns 404 USER_NOT_FOUND', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .patch(`/api/v1/users/${fakeId}/payment-permission`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ canRecordPayments: true });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('USER_NOT_FOUND');
  });

  it('PATCH /users/:userId/payment-permission: CLAIMS_OFFICER caller returns 403 Forbidden', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${officer1._id}/payment-permission`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({ canRecordPayments: true });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('PATCH /users/:userId/payment-permission: FIELD_ADJUSTER caller returns 403 Forbidden', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${officer1._id}/payment-permission`)
      .set('Authorization', `Bearer ${adjusterToken1}`)
      .send({ canRecordPayments: true });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('PATCH /users/:userId/payment-permission: missing or invalid canRecordPayments body returns 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${officer1._id}/payment-permission`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ canRecordPayments: 'invalid-string' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('PATCH /users/:userId/payment-permission: unauthenticated request returns 401 Unauthorized', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${officer1._id}/payment-permission`)
      .send({ canRecordPayments: true });

    expect(res.status).toBe(401);
  });
});

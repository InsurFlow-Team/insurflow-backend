const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Notification = require('../src/modules/notifications/notification.model');

let mongoServer;
let orgId1;
let orgId2;
let adminToken;
let officerToken;
let adjusterToken;
let adminUser;
let officerUser;
let adjusterUser;
let userOrg2;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  const org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1' });
  const org2 = await Organization.create({ name: 'Org 2', code: 'ORG-2' });
  orgId1 = org1._id;
  orgId2 = org2._id;

  adminUser = await User.create({
    name: 'Admin User',
    employeeCode: 'AD-001',
    password: 'Password123',
    role: 'ADMIN',
    organizationId: orgId1,
    status: 'ACTIVE',
  });

  const resAdmin = await request(app).post('/api/v1/auth/login').send({
    organizationCode: 'ORG-1',
    employeeCode: 'AD-001',
    password: 'Password123',
  });
  adminToken = resAdmin.body.data.accessToken;

  officerUser = await User.create({
    name: 'Officer User',
    employeeCode: 'CO-001',
    password: 'Password123',
    role: 'CLAIMS_OFFICER',
    organizationId: orgId1,
    status: 'ACTIVE',
  });

  const resOfficer = await request(app).post('/api/v1/auth/login').send({
    organizationCode: 'ORG-1',
    employeeCode: 'CO-001',
    password: 'Password123',
  });
  officerToken = resOfficer.body.data.accessToken;

  adjusterUser = await User.create({
    name: 'Adjuster User',
    employeeCode: 'FA-001',
    password: 'Password123',
    role: 'FIELD_ADJUSTER',
    organizationId: orgId1,
    status: 'ACTIVE',
  });

  const resAdjuster = await request(app).post('/api/v1/auth/login').send({
    organizationCode: 'ORG-1',
    employeeCode: 'FA-001',
    password: 'Password123',
  });
  adjusterToken = resAdjuster.body.data.accessToken;

  userOrg2 = await User.create({
    name: 'Org 2 User',
    employeeCode: 'FA-002',
    password: 'Password123',
    role: 'FIELD_ADJUSTER',
    organizationId: orgId2,
    status: 'ACTIVE',
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('User Device Token Registration (PATCH /api/v1/users/me/fcm-token)', () => {
  it('should allow FIELD_ADJUSTER to register/update their own FCM token', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/fcm-token')
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({ fcmToken: 'adjuster-fcm-token-123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Device token updated successfully');
    expect(res.body.data).toHaveProperty('id', adjusterUser._id.toString());
    expect(res.body.data).toHaveProperty('fcmToken', 'adjuster-fcm-token-123');

    const dbUser = await User.findById(adjusterUser._id).lean();
    expect(dbUser.fcmToken).toBe('adjuster-fcm-token-123');
  });

  it('should allow CLAIMS_OFFICER to register/update their own FCM token', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/fcm-token')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ fcmToken: 'officer-fcm-token-456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.fcmToken).toBe('officer-fcm-token-456');

    const dbUser = await User.findById(officerUser._id).lean();
    expect(dbUser.fcmToken).toBe('officer-fcm-token-456');
  });

  it('should allow ADMIN to register/update their own FCM token', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/fcm-token')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fcmToken: 'admin-fcm-token-789' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.fcmToken).toBe('admin-fcm-token-789');

    const dbUser = await User.findById(adminUser._id).lean();
    expect(dbUser.fcmToken).toBe('admin-fcm-token-789');
  });

  it('should update only the authenticated user document and not affect other users or tenants', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/fcm-token')
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({ fcmToken: 'adjuster-new-token' });

    expect(res.status).toBe(200);

    const dbAdjuster = await User.findById(adjusterUser._id).lean();
    const dbOfficer = await User.findById(officerUser._id).lean();
    const dbOrg2 = await User.findById(userOrg2._id).lean();

    expect(dbAdjuster.fcmToken).toBe('adjuster-new-token');
    expect(dbOfficer.fcmToken).toBe('officer-fcm-token-456');
    expect(dbOrg2.fcmToken).toBeNull();
  });

  it('should return 400 when fcmToken is missing in request body', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/fcm-token')
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Validation Error');
  });

  it('should return 400 when fcmToken is empty string', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/fcm-token')
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({ fcmToken: '' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 400 when fcmToken is whitespace only', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/fcm-token')
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({ fcmToken: '    ' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 400 when fcmToken is non-string (number)', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/fcm-token')
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({ fcmToken: 123456 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 401 Unauthorized when no auth token is provided', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/fcm-token')
      .send({ fcmToken: 'test-token' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('Notification Model Schema Validation', () => {
  it('should successfully create a valid notification with defaults', async () => {
    const validData = {
      recipientId: new mongoose.Types.ObjectId(),
      organizationId: new mongoose.Types.ObjectId(),
      type: 'ASSIGNED',
      relatedClaimId: new mongoose.Types.ObjectId(),
      title: 'Claim Assigned',
      body: 'You have been assigned claim CLM-ORG1-0001',
    };

    const doc = await Notification.create(validData);

    expect(doc._id).toBeDefined();
    expect(doc.recipientId).toEqual(validData.recipientId);
    expect(doc.organizationId).toEqual(validData.organizationId);
    expect(doc.type).toBe('ASSIGNED');
    expect(doc.relatedClaimId).toEqual(validData.relatedClaimId);
    expect(doc.title).toBe('Claim Assigned');
    expect(doc.body).toBe('You have been assigned claim CLM-ORG1-0001');
    expect(doc.readAt).toBeNull();
    expect(doc.createdAt).toBeInstanceOf(Date);
  });

  it('should fail validation when required fields are missing', async () => {
    const invalidDoc = new Notification({});

    let error;
    try {
      await invalidDoc.validate();
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.errors.recipientId).toBeDefined();
    expect(error.errors.organizationId).toBeDefined();
    expect(error.errors.type).toBeDefined();
    expect(error.errors.relatedClaimId).toBeDefined();
    expect(error.errors.title).toBeDefined();
    expect(error.errors.body).toBeDefined();
  });

  it('should fail validation when type is not in enum', async () => {
    const invalidTypeDoc = new Notification({
      recipientId: new mongoose.Types.ObjectId(),
      organizationId: new mongoose.Types.ObjectId(),
      type: 'INVALID_STATUS',
      relatedClaimId: new mongoose.Types.ObjectId(),
      title: 'Title',
      body: 'Body',
    });

    let error;
    try {
      await invalidTypeDoc.validate();
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.errors.type).toBeDefined();
  });

  it('should accept all four allowed notification types', async () => {
    const allowedTypes = ['ASSIGNED', 'CORRECTION_REQUIRED', 'APPROVED', 'REJECTED'];

    for (const type of allowedTypes) {
      const doc = new Notification({
        recipientId: new mongoose.Types.ObjectId(),
        organizationId: new mongoose.Types.ObjectId(),
        type,
        relatedClaimId: new mongoose.Types.ObjectId(),
        title: `Notification ${type}`,
        body: `Body for ${type}`,
      });

      await expect(doc.validate()).resolves.toBeUndefined();
    }
  });

  it('should have fcmToken defaulting to null on new User', async () => {
    const newUser = await User.create({
      name: 'Default FCM User',
      employeeCode: 'DF-001',
      password: 'Password123',
      role: 'FIELD_ADJUSTER',
      organizationId: orgId1,
    });

    expect(newUser.fcmToken).toBeNull();
  });
});

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');

describe('PUT /api/v1/auth/change-password', () => {
  let mongoServer;
  let org;

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

    org = await Organization.create({
      name: 'InsurCo Test',
      code: 'INS-TEST',
    });
  });

  const createUserAndLogin = async (role, employeeCode, password) => {
    await User.create({
      name: `Test ${role}`,
      employeeCode,
      password,
      role,
      organizationId: org._id,
      status: 'ACTIVE',
    });

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        organizationCode: 'INS-TEST',
        employeeCode,
        password,
      });

    return loginRes.body.data.accessToken;
  };

  it('FIELD_ADJUSTER: should change password with correct currentPassword, and verify re-hashing', async () => {
    const token = await createUserAndLogin('FIELD_ADJUSTER', 'FA-101', 'OldPassword123');

    // 1. Change password successfully
    const res = await request(app)
      .put('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentPassword: 'OldPassword123',
        newPassword: 'NewPassword456',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Password changed successfully');

    // 2. Logging in with old password must fail with 401 INVALID_CREDENTIALS
    const oldLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        organizationCode: 'INS-TEST',
        employeeCode: 'FA-101',
        password: 'OldPassword123',
      });

    expect(oldLoginRes.status).toBe(401);
    expect(oldLoginRes.body.success).toBe(false);
    expect(oldLoginRes.body.errors[0].code).toBe('INVALID_CREDENTIALS');

    // 3. Logging in with new password must succeed with 200
    const newLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        organizationCode: 'INS-TEST',
        employeeCode: 'FA-101',
        password: 'NewPassword456',
      });

    expect(newLoginRes.status).toBe(200);
    expect(newLoginRes.body.success).toBe(true);
    expect(newLoginRes.body.data.accessToken).toBeDefined();
  });

  it('should return 401 INVALID_CREDENTIALS for wrong currentPassword and keep old password unchanged', async () => {
    const token = await createUserAndLogin('FIELD_ADJUSTER', 'FA-102', 'OldPassword123');

    const res = await request(app)
      .put('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentPassword: 'WrongPassword999',
        newPassword: 'NewPassword456',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('INVALID_CREDENTIALS');

    // Verify old password still works
    const oldLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        organizationCode: 'INS-TEST',
        employeeCode: 'FA-102',
        password: 'OldPassword123',
      });

    expect(oldLoginRes.status).toBe(200);

    // Verify new password does not work
    const newLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        organizationCode: 'INS-TEST',
        employeeCode: 'FA-102',
        password: 'NewPassword456',
      });

    expect(newLoginRes.status).toBe(401);
  });

  it('should return 400 VALIDATION_ERROR when newPassword is identical to currentPassword', async () => {
    const token = await createUserAndLogin('FIELD_ADJUSTER', 'FA-103', 'SamePassword123');

    const res = await request(app)
      .put('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentPassword: 'SamePassword123',
        newPassword: 'SamePassword123',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    expect(res.body.errors[0].details).toBe('New password must be different from the current password');
  });

  it('should return 401 when no Authorization header is provided', async () => {
    const res = await request(app)
      .put('/api/v1/auth/change-password')
      .send({
        currentPassword: 'OldPassword123',
        newPassword: 'NewPassword456',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('CLAIMS_OFFICER: should change password without role restriction', async () => {
    const token = await createUserAndLogin('CLAIMS_OFFICER', 'CO-101', 'OfficerOldPass123');

    const res = await request(app)
      .put('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentPassword: 'OfficerOldPass123',
        newPassword: 'OfficerNewPass456',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const oldLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        organizationCode: 'INS-TEST',
        employeeCode: 'CO-101',
        password: 'OfficerOldPass123',
      });
    expect(oldLoginRes.status).toBe(401);

    const newLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        organizationCode: 'INS-TEST',
        employeeCode: 'CO-101',
        password: 'OfficerNewPass456',
      });
    expect(newLoginRes.status).toBe(200);
  });

  it('ADMIN: should change password without role restriction', async () => {
    const token = await createUserAndLogin('ADMIN', 'AD-101', 'AdminOldPass123');

    const res = await request(app)
      .put('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentPassword: 'AdminOldPass123',
        newPassword: 'AdminNewPass456',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const oldLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        organizationCode: 'INS-TEST',
        employeeCode: 'AD-101',
        password: 'AdminOldPass123',
      });
    expect(oldLoginRes.status).toBe(401);

    const newLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        organizationCode: 'INS-TEST',
        employeeCode: 'AD-101',
        password: 'AdminNewPass456',
      });
    expect(newLoginRes.status).toBe(200);
  });

  it('should return 400 VALIDATION_ERROR when input validation fails', async () => {
    const token = await createUserAndLogin('FIELD_ADJUSTER', 'FA-104', 'ValidPassword123');

    // newPassword too short (< 8 characters)
    const shortRes = await request(app)
      .put('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentPassword: 'ValidPassword123',
        newPassword: 'short',
      });

    expect(shortRes.status).toBe(400);
    expect(shortRes.body.success).toBe(false);
    expect(shortRes.body.errors[0].code).toBe('VALIDATION_ERROR');

    // missing currentPassword
    const missingRes = await request(app)
      .put('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        newPassword: 'ValidNewPassword123',
      });

    expect(missingRes.status).toBe(400);
    expect(missingRes.body.success).toBe(false);
    expect(missingRes.body.errors[0].code).toBe('VALIDATION_ERROR');
  });
});

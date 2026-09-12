const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');

let mongoServer;
let orgId1;
let orgId2;
let adminToken;
let officerToken;
let adminUserId;
let officerUserId;
let adjusterUserId;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  const org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1' });
  const org2 = await Organization.create({ name: 'Org 2', code: 'ORG-2' });
  orgId1 = org1._id;
  orgId2 = org2._id;

  const admin = await User.create({
    name: 'Admin',
    employeeCode: 'AD-001',
    password: 'Password123',
    role: 'ADMIN',
    organizationId: orgId1,
    status: 'ACTIVE',
  });
  adminUserId = admin._id;

  const resAdmin = await request(app).post('/api/v1/auth/login').send({
    organizationCode: 'ORG-1',
    employeeCode: 'AD-001',
    password: 'Password123',
  });
  adminToken = resAdmin.body.data.accessToken;

  const officer = await User.create({
    name: 'Officer',
    employeeCode: 'CO-001',
    password: 'Password123',
    role: 'CLAIMS_OFFICER',
    organizationId: orgId1,
    status: 'ACTIVE',
  });
  officerUserId = officer._id;

  const resOfficer = await request(app).post('/api/v1/auth/login').send({
    organizationCode: 'ORG-1',
    employeeCode: 'CO-001',
    password: 'Password123',
  });
  officerToken = resOfficer.body.data.accessToken;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('User Management API (ADMIN only)', () => {
  describe('POST /api/v1/users', () => {
    it('should allow ADMIN to create a CLAIMS_OFFICER', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'New Officer',
          employeeCode: 'CO-002',
          password: 'Password123',
          role: 'CLAIMS_OFFICER',
        });
      
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.name).toBe('New Officer');
      expect(res.body.data).not.toHaveProperty('password');
      expect(res.body.data.role).toBe('CLAIMS_OFFICER');
    });

    it('should allow ADMIN to create a FIELD_ADJUSTER', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'New Adjuster',
          employeeCode: 'FA-002',
          password: 'Password123',
          role: 'FIELD_ADJUSTER',
        });
      
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.role).toBe('FIELD_ADJUSTER');
      adjusterUserId = res.body.data.id;
    });

    it('should return 400 VALIDATION_ERROR when trying to create role ADMIN', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'New Admin',
          employeeCode: 'AD-002',
          password: 'Password123',
          role: 'ADMIN',
        });
      
      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 EMPLOYEE_CODE_TAKEN for duplicate employeeCode in same org', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Another Officer',
          employeeCode: 'CO-002', // Already exists in ORG-1
          password: 'Password123',
          role: 'CLAIMS_OFFICER',
        });
      
      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('EMPLOYEE_CODE_TAKEN');
    });

    it('should allow same employeeCode in different organization', async () => {
      // Create admin for org 2
      await User.create({
        name: 'Admin 2',
        employeeCode: 'AD-001', // Same employee code, different org
        password: 'Password123',
        role: 'ADMIN',
        organizationId: orgId2,
        status: 'ACTIVE',
      });
      const resAdmin2 = await request(app).post('/api/v1/auth/login').send({
        organizationCode: 'ORG-2',
        employeeCode: 'AD-001',
        password: 'Password123',
      });
      const adminToken2 = resAdmin2.body.data.accessToken;

      // Create CO-002 in org 2
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken2}`)
        .send({
          name: 'Another Officer 2',
          employeeCode: 'CO-002', // Exists in ORG-1, but should be allowed in ORG-2
          password: 'Password123',
          role: 'CLAIMS_OFFICER',
        });
      
      expect(res.status).toBe(201);
    });

    it('should return 403 FORBIDDEN for CLAIMS_OFFICER', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          name: 'No Access',
          employeeCode: 'NA-001',
          password: 'Password123',
          role: 'FIELD_ADJUSTER',
        });
      
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/users', () => {
    it('should list users in the org and omit password', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`);
      
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      
      res.body.data.forEach(user => {
        expect(user).toHaveProperty('_id');
        expect(user).toHaveProperty('role');
        expect(user).not.toHaveProperty('password');
      });
    });

    it('should return 403 for CLAIMS_OFFICER', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${officerToken}`);
      
      expect(res.status).toBe(403);
    });

    it('should filter users by role when valid role query parameter is passed', async () => {
      const res = await request(app)
        .get('/api/v1/users?role=CLAIMS_OFFICER')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      res.body.data.forEach((u) => {
        expect(u.role).toBe('CLAIMS_OFFICER');
      });
    });

    it('should return 400 Bad Request when role query parameter is invalid', async () => {
      const res = await request(app)
        .get('/api/v1/users?role=SUPER_USER')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Validation Error');
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
      expect(res.body.errors[0].details).toMatch(/role must be one of/i);
    });

    it('should return 400 Bad Request when unknown query parameter is passed', async () => {
      const res = await request(app)
        .get('/api/v1/users?unknownParam=attack')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH /api/v1/users/:userId/status', () => {
    it('should allow ADMIN to deactivate an adjuster, preventing login', async () => {
      // 1. Deactivate adjuster created in previous test
      const res = await request(app)
        .patch(`/api/v1/users/${adjusterUserId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'INACTIVE' });
      
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('INACTIVE');

      // 2. Try to login as deactivated adjuster
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        organizationCode: 'ORG-1',
        employeeCode: 'FA-002',
        password: 'Password123',
      });
      
      expect(loginRes.status).toBe(401);
      // Depending on auth service, could be different error message, but status 401 is key.
    });

    it('should allow ADMIN to deactivate their own account', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${adminUserId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'INACTIVE' });
      
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('INACTIVE');

      // Reactivate admin for subsequent tests
      await User.findByIdAndUpdate(adminUserId, { status: 'ACTIVE' });
    });

    it('should return 404 USER_NOT_FOUND when targeting a user from a different organization', async () => {
      // Get a user ID from ORG-2
      const org2User = await User.findOne({ organizationId: orgId2 });
      
      const res = await request(app)
        .patch(`/api/v1/users/${org2User._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`) // Admin from ORG-1
        .send({ status: 'INACTIVE' });
      
      expect(res.status).toBe(404);
      expect(res.body.errors[0].code).toBe('USER_NOT_FOUND');
    });

    it('should return 403 for CLAIMS_OFFICER', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${adjusterUserId}/status`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ status: 'ACTIVE' });
      
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/v1/users/:userId/reset-password', () => {
    it('should reset password, hashing it correctly', async () => {
      // 1. Reset password for officer
      const res = await request(app)
        .patch(`/api/v1/users/${officerUserId}/reset-password`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newPassword: 'NewPassword123' });
      
      expect(res.status).toBe(200);

      // 2. Old password should fail
      const loginResOld = await request(app).post('/api/v1/auth/login').send({
        organizationCode: 'ORG-1',
        employeeCode: 'CO-001',
        password: 'Password123', // Old password
      });
      expect(loginResOld.status).toBe(401);
      expect(loginResOld.body.errors[0].code).toBe('INVALID_CREDENTIALS');

      // 3. New password should succeed
      const loginResNew = await request(app).post('/api/v1/auth/login').send({
        organizationCode: 'ORG-1',
        employeeCode: 'CO-001',
        password: 'NewPassword123', // New password
      });
      expect(loginResNew.status).toBe(200);
      expect(loginResNew.body.data).toHaveProperty('accessToken');
    });

    it('should return 404 USER_NOT_FOUND for user in different org', async () => {
      const org2User = await User.findOne({ organizationId: orgId2 });
      
      const res = await request(app)
        .patch(`/api/v1/users/${org2User._id}/reset-password`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newPassword: 'NewPassword123' });
      
      expect(res.status).toBe(404);
    });

    it('should return 403 for CLAIMS_OFFICER', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${officerUserId}/reset-password`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ newPassword: 'AnotherPassword123' });
      
      expect(res.status).toBe(403);
    });

    it('should return 400 Bad Request when userId is not a valid 24-character hex ObjectId', async () => {
      const res = await request(app)
        .patch('/api/v1/users/invalid-user-id/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'INACTIVE' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Validation Error');
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
      expect(res.body.errors[0].details).toMatch(/Invalid ID format/i);
    });
  });

  describe('PATCH /api/v1/users/:userId', () => {
    it('should allow ADMIN to update both name and employeeCode', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${adjusterUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Updated Adjuster Name',
          employeeCode: 'FA-003',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('User updated successfully');
      expect(res.body.data.id).toBe(adjusterUserId.toString());
      expect(res.body.data.name).toBe('Updated Adjuster Name');
      expect(res.body.data.employeeCode).toBe('FA-003');
      expect(res.body.data.role).toBe('FIELD_ADJUSTER');
      expect(res.body.data.status).toBe('INACTIVE');
      expect(res.body.data).not.toHaveProperty('password');

      // Verify in DB
      const updatedDb = await User.findById(adjusterUserId);
      expect(updatedDb.name).toBe('Updated Adjuster Name');
      expect(updatedDb.employeeCode).toBe('FA-003');
    });

    it('should allow ADMIN to update only name', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${adjusterUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Sole Name Update',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Sole Name Update');
      expect(res.body.data.employeeCode).toBe('FA-003');
    });

    it('should allow ADMIN to update only employeeCode', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${adjusterUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeCode: 'FA-999',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Sole Name Update');
      expect(res.body.data.employeeCode).toBe('FA-999');
    });

    it('should return 400 Bad Request when empty body is provided', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${adjusterUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 Bad Request when disallowed fields are provided', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${adjusterUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Attempted Role Escalation',
          role: 'ADMIN',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 Bad Request when invalid ObjectId format is provided in URL', async () => {
      const res = await request(app)
        .patch('/api/v1/users/not-a-valid-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Test',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
      expect(res.body.errors[0].details).toMatch(/Invalid ID format/i);
    });

    it('should return 401 Unauthorized when unauthenticated', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${adjusterUserId}`)
        .send({
          name: 'Anonymous',
        });

      expect(res.status).toBe(401);
    });

    it('should return 403 Forbidden for CLAIMS_OFFICER', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${adjusterUserId}`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          name: 'Unauthorized Officer Edit',
        });

      expect(res.status).toBe(403);
    });

    it('should return 404 USER_NOT_FOUND when user does not exist', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .patch(`/api/v1/users/${nonExistentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Ghost User',
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('USER_NOT_FOUND');
    });

    it('should return 404 USER_NOT_FOUND for user belonging to different org (multi-tenant protection)', async () => {
      const org2User = await User.findOne({ organizationId: orgId2 });

      const res = await request(app)
        .patch(`/api/v1/users/${org2User._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Cross Org Update Attempt',
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('USER_NOT_FOUND');
    });

    it('should return 409 EMPLOYEE_CODE_TAKEN when employeeCode already exists in same organization', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${adjusterUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeCode: 'AD-001', // Admin's employeeCode in Org 1
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('EMPLOYEE_CODE_TAKEN');
      expect(res.body.message).toMatch(/already exists/i);
    });
  });
});

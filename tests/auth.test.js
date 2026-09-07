const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const config = require('../src/config/env');
const jwt = require('jsonwebtoken');
const { loginLimiter } = require('../src/middlewares/rateLimiter.middleware');

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
  loginLimiter.reset();
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany();
  }
});

describe('POST /api/v1/auth/login', () => {
  let org;
  let user;

  beforeEach(async () => {
    // Seed initial data
    org = await Organization.create({
      name: 'InsurCo',
      code: 'INS-A',
    });

    user = await User.create({
      name: 'Ahmed Ali',
      employeeCode: 'FA-001',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org._id,
      status: 'ACTIVE',
    });
  });

  it('should login successfully with correct credentials', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        organizationCode: 'INS-A',
        employeeCode: 'FA-001',
        password: 'password123',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.accessToken).toBeDefined();
    expect(response.body.data.user).toBeDefined();
    expect(response.body.data.user.role).toBe('FIELD_ADJUSTER');
    expect(response.body.data.user.organizationId).toBe(org._id.toString());
  });

  it('should fail with invalid organization code', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        organizationCode: 'INVALID',
        employeeCode: 'FA-001',
        password: 'password123',
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Invalid credentials');
    expect(response.body.errors[0].code).toBe('INVALID_CREDENTIALS');
  });

  it('should fail with invalid employee code', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        organizationCode: 'INS-A',
        employeeCode: 'INVALID',
        password: 'password123',
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Invalid credentials');
    expect(response.body.errors[0].code).toBe('INVALID_CREDENTIALS');
  });

  it('should fail with invalid password', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        organizationCode: 'INS-A',
        employeeCode: 'FA-001',
        password: 'wrongpassword',
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Invalid credentials');
    expect(response.body.errors[0].code).toBe('INVALID_CREDENTIALS');
  });

  it('should fail with missing fields', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        organizationCode: 'INS-A',
        // employeeCode missing
        password: 'password123',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errors).toBeDefined();
    expect(response.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('should allow same employeeCode in different organizations', async () => {
    const org2 = await Organization.create({
      name: 'OtherOrg',
      code: 'ORG-B',
    });

    await User.create({
      name: 'Another Ahmed',
      employeeCode: 'FA-001', // same code
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org2._id,
      status: 'ACTIVE',
    });
    
    // If it reaches here without throwing, the test passes
    const users = await User.find({ employeeCode: 'FA-001' });
    expect(users.length).toBe(2);
  });

  it('should prevent same employeeCode in same organization', async () => {
    await expect(
      User.create({
        name: 'Clone Ahmed',
        employeeCode: 'FA-001', // same code
        password: 'password123',
        role: 'FIELD_ADJUSTER',
        organizationId: org._id, // same org
        status: 'ACTIVE',
      })
    ).rejects.toThrow(/duplicate key error/);
  });

  describe('Rate Limiting (SEC-01)', () => {
    it('should allow normal login requests before reaching the rate limit', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          organizationCode: 'INS-A',
          employeeCode: 'FA-001',
          password: 'password123',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 429 TOO_MANY_REQUESTS when failed attempts exceed the limit', async () => {
      // Send 5 failed login attempts (configured limit is 5)
      for (let i = 0; i < 5; i++) {
        const failedRes = await request(app)
          .post('/api/v1/auth/login')
          .send({
            organizationCode: 'INS-A',
            employeeCode: 'FA-001',
            password: 'wrongpassword',
          });
        expect(failedRes.status).toBe(401);
      }

      // The 6th attempt should be blocked with 429
      const blockedRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          organizationCode: 'INS-A',
          employeeCode: 'FA-001',
          password: 'password123', // even valid credentials blocked once threshold is hit
        });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.success).toBe(false);
      expect(blockedRes.body.message).toBe('Too many login attempts. Please try again later.');
      expect(blockedRes.body.errors).toBeDefined();
      expect(blockedRes.body.errors[0].code).toBe('TOO_MANY_REQUESTS');
      expect(blockedRes.body.errors[0].details).toBe('Too many login attempts. Please try again later.');
    });

    it('should not rate limit unrelated endpoints when login is blocked', async () => {
      // Exhaust login attempts
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/v1/auth/login')
          .send({
            organizationCode: 'INS-A',
            employeeCode: 'FA-001',
            password: 'wrongpassword',
          });
      }

      // Verify login is blocked
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          organizationCode: 'INS-A',
          employeeCode: 'FA-001',
          password: 'password123',
        });
      expect(loginRes.status).toBe(429);

      // Verify health check endpoint is completely unaffected
      const healthRes = await request(app).get('/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.body.success).toBe(true);

      // Verify other auth endpoints are unaffected (e.g. change-password returns 401 for missing token, NOT 429)
      const changePasswordRes = await request(app).put('/api/v1/auth/change-password');
      expect(changePasswordRes.status).toBe(401);
      expect(changePasswordRes.body.message).toContain('Unauthorized');
    });

    it('should not penalize legitimate users who log in successfully (skipSuccessfulRequests)', async () => {
      // 3 successful logins
      for (let i = 0; i < 3; i++) {
        const successRes = await request(app)
          .post('/api/v1/auth/login')
          .send({
            organizationCode: 'INS-A',
            employeeCode: 'FA-001',
            password: 'password123',
          });
        expect(successRes.status).toBe(200);
      }

      // 4 failed logins (total attempts = 7, but only 4 failures)
      for (let i = 0; i < 4; i++) {
        const failedRes = await request(app)
          .post('/api/v1/auth/login')
          .send({
            organizationCode: 'INS-A',
            employeeCode: 'FA-001',
            password: 'wrongpassword',
          });
        expect(failedRes.status).toBe(401);
      }

      // A 5th failed login should still be processed (since failure count was 4, <= 5)
      const fifthFailed = await request(app)
        .post('/api/v1/auth/login')
        .send({
          organizationCode: 'INS-A',
          employeeCode: 'FA-001',
          password: 'wrongpassword',
        });
      expect(fifthFailed.status).toBe(401);

      // Now 5 failures have accumulated; 6th attempt is blocked
      const blockedRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          organizationCode: 'INS-A',
          employeeCode: 'FA-001',
          password: 'wrongpassword',
        });
      expect(blockedRes.status).toBe(429);
    });
  });

  describe('JWT Expiration Configuration (SEC-06)', () => {
    const originalExpiresIn = config.jwtExpiresIn;

    afterEach(() => {
      config.jwtExpiresIn = originalExpiresIn;
    });

    it('should issue access token with default 8h expiration claim', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          organizationCode: 'INS-A',
          employeeCode: 'FA-001',
          password: 'password123',
        });

      expect(response.status).toBe(200);
      const token = response.body.data.accessToken;
      const decoded = jwt.decode(token);

      expect(decoded).toBeDefined();
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();
      // 8 hours = 8 * 60 * 60 = 28800 seconds
      expect(decoded.exp - decoded.iat).toBe(28800);
    });

    it('should respect dynamic JWT_EXPIRES_IN configuration from config', async () => {
      config.jwtExpiresIn = '2h';

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          organizationCode: 'INS-A',
          employeeCode: 'FA-001',
          password: 'password123',
        });

      expect(response.status).toBe(200);
      const token = response.body.data.accessToken;
      const decoded = jwt.decode(token);

      expect(decoded).toBeDefined();
      // 2 hours = 2 * 60 * 60 = 7200 seconds
      expect(decoded.exp - decoded.iat).toBe(7200);
    });

    it('should accept API requests with a valid, unexpired token', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          organizationCode: 'INS-A',
          employeeCode: 'FA-001',
          password: 'password123',
        });

      expect(loginRes.status).toBe(200);
      const validToken = loginRes.body.data.accessToken;

      const res = await request(app)
        .get('/api/v1/claims')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject API requests with an expired token returning 401 and Token has expired message', async () => {
      const expiredToken = jwt.sign(
        { userId: user._id, role: user.role, organizationId: org._id },
        config.jwtSecret,
        { expiresIn: '-1s' }
      );

      const res = await request(app)
        .get('/api/v1/claims')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Unauthorized: Token has expired');
    });
  });
});


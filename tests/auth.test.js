const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const config = require('../src/config/env');

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
});

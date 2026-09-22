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
});

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

describe('Pagination via Headers (GET /claims & GET /users)', () => {
  let org1, org2;
  let admin1, officer1, adjuster1, adjuster2;
  let adminToken, officerToken, adjusterToken;

  beforeEach(async () => {
    org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1' });
    global.__testPol = await Policy.create({ policyNumber: 'POL-FIX-001', status: 'ACTIVE', startDate: new Date('2026-01-01'), expiryDate: new Date('2027-12-31'), organizationId: org1._id });
    org2 = await Organization.create({ name: 'Org 2', code: 'ORG-2' });

    admin1 = await User.create({
      name: 'Admin 1',
      employeeCode: 'ADM-01',
      password: 'Password123!',
      role: 'ADMIN',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    adminToken = generateToken(admin1);

    officer1 = await User.create({
      name: 'Officer 1',
      employeeCode: 'CO-01',
      password: 'Password123!',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    officerToken = generateToken(officer1);

    adjuster1 = await User.create({
      name: 'Adjuster 1',
      employeeCode: 'FA-01',
      password: 'Password123!',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    adjusterToken = generateToken(adjuster1);

    adjuster2 = await User.create({
      name: 'Adjuster 2',
      employeeCode: 'FA-02',
      password: 'Password123!',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    // Create 5 claims in Org 1 (3 NEW, 2 ASSIGNED to adjuster1)
    for (let i = 1; i <= 3; i++) {
      await Claim.create({
        organizationId: org1._id,
      policyId: global.__testPol._id,
        createdBy: officer1._id,
        status: 'NEW',
        customer: { name: `Customer New ${i}`, phone: `050000000${i}` },
        incidentType: 'COLLISION',
        incidentLocation: `Location ${i}`,
      });
    }

    for (let i = 4; i <= 5; i++) {
      await Claim.create({
        organizationId: org1._id,
      policyId: global.__testPol._id,
        createdBy: officer1._id,
        assignedTo: adjuster1._id,
        status: 'ASSIGNED',
        customer: { name: `Customer Assigned ${i}`, phone: `050000000${i}` },
        incidentType: 'COLLISION',
        incidentLocation: `Location ${i}`,
      });
    }

    // Create 1 claim in Org 2 (multi-tenant boundary test)
    await Claim.create({
      organizationId: org2._id,
      policyId: global.__testPol._id,
      createdBy: officer1._id,
      status: 'NEW',
      customer: { name: 'Org 2 Customer', phone: '0509999999' },
      incidentType: 'COLLISION',
      incidentLocation: 'Org 2 Location',
    });
  });

  // ─── GET /api/v1/claims Pagination ──────────────────────────────────────────
  describe('GET /api/v1/claims Pagination', () => {
    it('should return default pagination headers for all org claims', async () => {
      const response = await request(app)
        .get('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(response.status).toBe(200);
      expect(response.headers['x-total-count']).toBe('5');
      expect(response.headers['x-page']).toBe('1');
      expect(response.headers['x-limit']).toBe('50');
      expect(response.headers['x-total-pages']).toBe('1');
      expect(response.body.data.length).toBe(5);
    });

    it('should paginate claims across multiple pages when limit is specified', async () => {
      // Page 1 with limit 2
      const page1Res = await request(app)
        .get('/api/v1/claims?page=1&limit=2')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(page1Res.status).toBe(200);
      expect(page1Res.headers['x-total-count']).toBe('5');
      expect(page1Res.headers['x-page']).toBe('1');
      expect(page1Res.headers['x-limit']).toBe('2');
      expect(page1Res.headers['x-total-pages']).toBe('3');
      expect(page1Res.body.data.length).toBe(2);

      // Page 2 with limit 2
      const page2Res = await request(app)
        .get('/api/v1/claims?page=2&limit=2')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(page2Res.status).toBe(200);
      expect(page2Res.headers['x-page']).toBe('2');
      expect(page2Res.body.data.length).toBe(2);

      // Verify no overlap between pages
      const page1Ids = page1Res.body.data.map((c) => c.id);
      const page2Ids = page2Res.body.data.map((c) => c.id);
      const hasOverlap = page1Ids.some((id) => page2Ids.includes(id));
      expect(hasOverlap).toBe(false);

      // Page 3 with limit 2 (last page, remaining 1 claim)
      const page3Res = await request(app)
        .get('/api/v1/claims?page=3&limit=2')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(page3Res.status).toBe(200);
      expect(page3Res.headers['x-page']).toBe('3');
      expect(page3Res.body.data.length).toBe(1);
    });

    it('should accurately combine status filtering with pagination', async () => {
      const response = await request(app)
        .get('/api/v1/claims?status=NEW&page=1&limit=2')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(response.status).toBe(200);
      expect(response.headers['x-total-count']).toBe('3');
      expect(response.headers['x-page']).toBe('1');
      expect(response.headers['x-limit']).toBe('2');
      expect(response.headers['x-total-pages']).toBe('2');
      expect(response.body.data.length).toBe(2);
      response.body.data.forEach((claim) => {
        expect(claim.status).toBe('NEW');
      });
    });

    it('should scope total count to adjuster assignments for FIELD_ADJUSTER', async () => {
      const response = await request(app)
        .get('/api/v1/claims')
        .set('Authorization', `Bearer ${adjusterToken}`);

      expect(response.status).toBe(200);
      // Adjuster 1 only has 2 claims assigned
      expect(response.headers['x-total-count']).toBe('2');
      expect(response.body.data.length).toBe(2);
    });

    it('should return 400 for invalid page numbers', async () => {
      const res0 = await request(app)
        .get('/api/v1/claims?page=0')
        .set('Authorization', `Bearer ${officerToken}`);
      expect(res0.status).toBe(400);

      const resNeg = await request(app)
        .get('/api/v1/claims?page=-5')
        .set('Authorization', `Bearer ${officerToken}`);
      expect(resNeg.status).toBe(400);

      const resAlpha = await request(app)
        .get('/api/v1/claims?page=first')
        .set('Authorization', `Bearer ${officerToken}`);
      expect(resAlpha.status).toBe(400);
    });

    it('should return 400 for invalid limit values', async () => {
      const res0 = await request(app)
        .get('/api/v1/claims?limit=0')
        .set('Authorization', `Bearer ${officerToken}`);
      expect(res0.status).toBe(400);

      const resOver = await request(app)
        .get('/api/v1/claims?limit=150')
        .set('Authorization', `Bearer ${officerToken}`);
      expect(resOver.status).toBe(400);
    });
  });

  // ─── GET /api/v1/users Pagination ───────────────────────────────────────────
  describe('GET /api/v1/users Pagination', () => {
    it('should return default pagination headers for all org users', async () => {
      const response = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      // Org 1 has admin1, officer1, adjuster1, adjuster2 = 4 users
      expect(response.headers['x-total-count']).toBe('4');
      expect(response.headers['x-page']).toBe('1');
      expect(response.headers['x-limit']).toBe('50');
      expect(response.headers['x-total-pages']).toBe('1');
      expect(response.body.data.length).toBe(4);
    });

    it('should paginate users across multiple pages', async () => {
      const page1Res = await request(app)
        .get('/api/v1/users?page=1&limit=2')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(page1Res.status).toBe(200);
      expect(page1Res.headers['x-total-count']).toBe('4');
      expect(page1Res.headers['x-page']).toBe('1');
      expect(page1Res.headers['x-limit']).toBe('2');
      expect(page1Res.headers['x-total-pages']).toBe('2');
      expect(page1Res.body.data.length).toBe(2);

      const page2Res = await request(app)
        .get('/api/v1/users?page=2&limit=2')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(page2Res.status).toBe(200);
      expect(page2Res.headers['x-page']).toBe('2');
      expect(page2Res.body.data.length).toBe(2);
    });

    it('should combine role filtering with user pagination', async () => {
      const response = await request(app)
        .get('/api/v1/users?role=FIELD_ADJUSTER&page=1&limit=1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      // Org 1 has 2 adjusters
      expect(response.headers['x-total-count']).toBe('2');
      expect(response.headers['x-page']).toBe('1');
      expect(response.headers['x-limit']).toBe('1');
      expect(response.headers['x-total-pages']).toBe('2');
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].role).toBe('FIELD_ADJUSTER');
    });

    it('should return 400 for invalid page or limit query on users', async () => {
      const resPage = await request(app)
        .get('/api/v1/users?page=0')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(resPage.status).toBe(400);

      const resLimit = await request(app)
        .get('/api/v1/users?limit=200')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(resLimit.status).toBe(400);
    });
  });
});

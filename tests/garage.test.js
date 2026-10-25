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
let admin1, officer1, adjuster1;
let admin2;
let adminToken1, officerToken1, adjusterToken1;
let adminToken2;

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

const validGaragePayload = (overrides = {}) => ({
  name: 'Al-Manara Auto Repair',
  governorate: 'RAMALLAH_AL_BIREH',
  city: 'Ramallah',
  phone: '+970599111222',
  laborRate: 80,
  ...overrides,
});

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
    name: 'Admin 1',
    employeeCode: 'ADM-01',
    password: 'Password123!',
    role: 'ADMIN',
    organizationId: org1._id,
    status: 'ACTIVE',
  });
  adminToken1 = generateToken(admin1);

  officer1 = await User.create({
    name: 'Officer 1',
    employeeCode: 'OFF-01',
    password: 'Password123!',
    role: 'CLAIMS_OFFICER',
    organizationId: org1._id,
    status: 'ACTIVE',
  });
  officerToken1 = generateToken(officer1);

  adjuster1 = await User.create({
    name: 'Adjuster 1',
    employeeCode: 'ADJ-01',
    password: 'Password123!',
    role: 'FIELD_ADJUSTER',
    organizationId: org1._id,
    status: 'ACTIVE',
  });
  adjusterToken1 = generateToken(adjuster1);

  admin2 = await User.create({
    name: 'Admin 2',
    employeeCode: 'ADM-02',
    password: 'Password123!',
    role: 'ADMIN',
    organizationId: org2._id,
    status: 'ACTIVE',
  });
  adminToken2 = generateToken(admin2);
});

describe('PB-07: Garage Management API', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/v1/garages
  // ───────────────────────────────────────────────────────────────────────────
  describe('POST /api/v1/garages', () => {
    it('should allow ADMIN to create a garage with valid data and default approved=true', async () => {
      const res = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload());

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        name: 'Al-Manara Auto Repair',
        governorate: 'RAMALLAH_AL_BIREH',
        city: 'Ramallah',
        phone: '+970599111222',
        laborRate: 80,
        approved: true,
      });
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('createdAt');
      expect(res.body.data).toHaveProperty('updatedAt');
      expect(res.body.data).not.toHaveProperty('normalizedName');
    });

    it('should store laborRate in integer minor units in the database while returning major units in response', async () => {
      const res = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ laborRate: 85.5 }));

      expect(res.status).toBe(201);
      expect(res.body.data.laborRate).toBe(85.5);

      const garageInDb = await mongoose.connection
        .collection('garages')
        .findOne({ _id: new mongoose.Types.ObjectId(res.body.data.id) });

      expect(garageInDb).toBeDefined();
      expect(garageInDb.laborRate).toBe(8550);
    });

    it('should forbid CLAIMS_OFFICER from creating a garage (403)', async () => {
      const res = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${officerToken1}`)
        .send(validGaragePayload());

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should forbid FIELD_ADJUSTER from creating a garage (403)', async () => {
      const res = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adjusterToken1}`)
        .send(validGaragePayload());

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should return 401 Unauthorized when creating a garage without authentication token', async () => {
      const res = await request(app)
        .post('/api/v1/garages')
        .send(validGaragePayload());

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 VALIDATION_ERROR when required fields are missing (name, governorate, city, phone, laborRate)', async () => {
      const res = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 VALIDATION_ERROR for invalid governorate outside the official 16', async () => {
      const res = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ governorate: 'AMMAN' }));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 VALIDATION_ERROR for invalid phone format', async () => {
      const res = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ phone: '123' }));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 VALIDATION_ERROR when laborRate has more decimal places than allowed by currency scale (e.g. 3 decimals for ILS)', async () => {
      const res = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ laborRate: 80.125 }));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 VALIDATION_ERROR when laborRate is negative or exceeds maxFinancialAmount', async () => {
      const resNeg = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ laborRate: -10 }));

      expect(resNeg.status).toBe(400);
      expect(resNeg.body.errors[0].code).toBe('VALIDATION_ERROR');

      const resExcess = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ laborRate: config.maxFinancialAmount + 1 }));

      expect(resExcess.status).toBe(400);
      expect(resExcess.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 VALIDATION_ERROR when name is shorter than 2 or longer than 100 characters', async () => {
      const resShort = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ name: 'A' }));

      expect(resShort.status).toBe(400);
      expect(resShort.body.errors[0].code).toBe('VALIDATION_ERROR');

      const resLong = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ name: 'A'.repeat(101) }));

      expect(resLong.status).toBe(400);
      expect(resLong.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 VALIDATION_ERROR when city is shorter than 2 or longer than 60 characters', async () => {
      const resShort = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ city: 'R' }));

      expect(resShort.status).toBe(400);
      expect(resShort.body.errors[0].code).toBe('VALIDATION_ERROR');

      const resLong = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ city: 'R'.repeat(61) }));

      expect(resLong.status).toBe(400);
      expect(resLong.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 GARAGE_ALREADY_EXISTS when creating duplicate name in same organization with different casing and whitespace', async () => {
      await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ name: 'Al-Manara Auto Repair' }));

      const resDup = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ name: '  al-manara auto repair  ' }));

      expect(resDup.status).toBe(409);
      expect(resDup.body.success).toBe(false);
      expect(resDup.body.errors[0].code).toBe('GARAGE_ALREADY_EXISTS');
    });

    it('should treat names differing only in internal whitespace as duplicates (409)', async () => {
      await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ name: 'Al-Manara Auto Repair' }));

      const resDup = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ name: 'Al-Manara   Auto    Repair' }));

      expect(resDup.status).toBe(409);
      expect(resDup.body.success).toBe(false);
      expect(resDup.body.errors[0].code).toBe('GARAGE_ALREADY_EXISTS');
    });

    it('should allow creating a garage with the same name in a different organization', async () => {
      const resOrg1 = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ name: 'Al-Manara Auto Repair' }));
      expect(resOrg1.status).toBe(201);

      const resOrg2 = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken2}`)
        .send(validGaragePayload({ name: 'Al-Manara Auto Repair' }));
      expect(resOrg2.status).toBe(201);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/v1/garages
  // ───────────────────────────────────────────────────────────────────────────
  describe('GET /api/v1/garages', () => {
    beforeEach(async () => {
      // Create test garages in Org 1
      await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ name: 'Alpha Garage', governorate: 'RAMALLAH_AL_BIREH', approved: true }));

      await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ name: 'Beta Workshop', governorate: 'NABLUS', approved: false }));

      await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ name: 'Gamma Motors', governorate: 'HEBRON', approved: true }));

      // Create test garage in Org 2
      await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken2}`)
        .send(validGaragePayload({ name: 'Org2 Garage', governorate: 'JERUSALEM', approved: true }));
    });

    it('should allow ADMIN to list all garages including unapproved ones', async () => {
      const res = await request(app)
        .get('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(3);
      const names = res.body.data.map((g) => g.name);
      expect(names).toContain('Alpha Garage');
      expect(names).toContain('Beta Workshop');
      expect(names).toContain('Gamma Motors');
    });

    it('should allow CLAIMS_OFFICER to list approved garages only', async () => {
      const res = await request(app)
        .get('/api/v1/garages')
        .set('Authorization', `Bearer ${officerToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      const names = res.body.data.map((g) => g.name);
      expect(names).toContain('Alpha Garage');
      expect(names).toContain('Gamma Motors');
      expect(names).not.toContain('Beta Workshop');
    });

    it('should allow FIELD_ADJUSTER to list approved garages only', async () => {
      const res = await request(app)
        .get('/api/v1/garages')
        .set('Authorization', `Bearer ${adjusterToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      const names = res.body.data.map((g) => g.name);
      expect(names).toContain('Alpha Garage');
      expect(names).toContain('Gamma Motors');
      expect(names).not.toContain('Beta Workshop');
    });

    it('should return 401 Unauthorized when listing garages without authentication token', async () => {
      const res = await request(app).get('/api/v1/garages');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should allow ADMIN to filter garages by approved=true and approved=false', async () => {
      const resApproved = await request(app)
        .get('/api/v1/garages?approved=true')
        .set('Authorization', `Bearer ${adminToken1}`);

      expect(resApproved.status).toBe(200);
      expect(resApproved.body.data.length).toBe(2);
      resApproved.body.data.forEach((g) => expect(g.approved).toBe(true));

      const resUnapproved = await request(app)
        .get('/api/v1/garages?approved=false')
        .set('Authorization', `Bearer ${adminToken1}`);

      expect(resUnapproved.status).toBe(200);
      expect(resUnapproved.body.data.length).toBe(1);
      expect(resUnapproved.body.data[0].name).toBe('Beta Workshop');
      expect(resUnapproved.body.data[0].approved).toBe(false);
    });

    it('should return 400 VALIDATION_ERROR when non-ADMIN attempts to filter by approved status', async () => {
      const resOfficer = await request(app)
        .get('/api/v1/garages?approved=false')
        .set('Authorization', `Bearer ${officerToken1}`);

      expect(resOfficer.status).toBe(400);
      expect(resOfficer.body.errors[0].code).toBe('VALIDATION_ERROR');

      const resAdjuster = await request(app)
        .get('/api/v1/garages?approved=true')
        .set('Authorization', `Bearer ${adjusterToken1}`);

      expect(resAdjuster.status).toBe(400);
      expect(resAdjuster.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should filter garages by governorate', async () => {
      const res = await request(app)
        .get('/api/v1/garages?governorate=HEBRON')
        .set('Authorization', `Bearer ${adminToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe('Gamma Motors');
    });

    it('should filter garages by q case-insensitively and safely escape regex special characters', async () => {
      const resCase = await request(app)
        .get('/api/v1/garages?q=alpha')
        .set('Authorization', `Bearer ${adminToken1}`);

      expect(resCase.status).toBe(200);
      expect(resCase.body.data.length).toBe(1);
      expect(resCase.body.data[0].name).toBe('Alpha Garage');

      const resRegexSpecial = await request(app)
        .get('/api/v1/garages?q=.*')
        .set('Authorization', `Bearer ${adminToken1}`);

      expect(resRegexSpecial.status).toBe(200);
      expect(resRegexSpecial.body.data.length).toBe(0);
    });

    it('should return pagination headers (X-Total-Count, X-Page, X-Limit, X-Total-Pages) and paginate correctly', async () => {
      const resPage1 = await request(app)
        .get('/api/v1/garages?page=1&limit=2')
        .set('Authorization', `Bearer ${adminToken1}`);

      expect(resPage1.status).toBe(200);
      expect(resPage1.headers['x-total-count']).toBe('3');
      expect(resPage1.headers['x-page']).toBe('1');
      expect(resPage1.headers['x-limit']).toBe('2');
      expect(resPage1.headers['x-total-pages']).toBe('2');
      expect(resPage1.body.data.length).toBe(2);

      const resPage2 = await request(app)
        .get('/api/v1/garages?page=2&limit=2')
        .set('Authorization', `Bearer ${adminToken1}`);

      expect(resPage2.status).toBe(200);
      expect(resPage2.headers['x-page']).toBe('2');
      expect(resPage2.body.data.length).toBe(1);
    });

    it('should sort garages by name ascending, then _id', async () => {
      const res = await request(app)
        .get('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].name).toBe('Alpha Garage');
      expect(res.body.data[1].name).toBe('Beta Workshop');
      expect(res.body.data[2].name).toBe('Gamma Motors');
    });

    it('should isolate garages by organization (never leak garages from another tenant)', async () => {
      const resOrg1 = await request(app)
        .get('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`);

      expect(resOrg1.status).toBe(200);
      const org1Names = resOrg1.body.data.map((g) => g.name);
      expect(org1Names).not.toContain('Org2 Garage');

      const resOrg2 = await request(app)
        .get('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken2}`);

      expect(resOrg2.status).toBe(200);
      expect(resOrg2.body.data.length).toBe(1);
      expect(resOrg2.body.data[0].name).toBe('Org2 Garage');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/v1/garages/:garageId
  // ───────────────────────────────────────────────────────────────────────────
  describe('GET /api/v1/garages/:garageId', () => {
    let approvedGarageId;
    let unapprovedGarageId;
    let org2GarageId;

    beforeEach(async () => {
      const resApp = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ name: 'Approved Garage', approved: true }));
      approvedGarageId = resApp.body.data.id;

      const resUnapp = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ name: 'Unapproved Garage', approved: false }));
      unapprovedGarageId = resUnapp.body.data.id;

      const resOrg2 = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken2}`)
        .send(validGaragePayload({ name: 'Org2 Other Garage', approved: true }));
      org2GarageId = resOrg2.body.data.id;
    });

    it('should allow ADMIN to get an approved garage by id', async () => {
      const res = await request(app)
        .get(`/api/v1/garages/${approvedGarageId}`)
        .set('Authorization', `Bearer ${adminToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(approvedGarageId);
      expect(res.body.data.approved).toBe(true);
    });

    it('should allow ADMIN to get an unapproved garage by id', async () => {
      const res = await request(app)
        .get(`/api/v1/garages/${unapprovedGarageId}`)
        .set('Authorization', `Bearer ${adminToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(unapprovedGarageId);
      expect(res.body.data.approved).toBe(false);
    });

    it('should allow CLAIMS_OFFICER and FIELD_ADJUSTER to get an approved garage by id', async () => {
      const resOfficer = await request(app)
        .get(`/api/v1/garages/${approvedGarageId}`)
        .set('Authorization', `Bearer ${officerToken1}`);
      expect(resOfficer.status).toBe(200);
      expect(resOfficer.body.data.id).toBe(approvedGarageId);

      const resAdjuster = await request(app)
        .get(`/api/v1/garages/${approvedGarageId}`)
        .set('Authorization', `Bearer ${adjusterToken1}`);
      expect(resAdjuster.status).toBe(200);
      expect(resAdjuster.body.data.id).toBe(approvedGarageId);
    });

    it('should return 404 GARAGE_NOT_FOUND when CLAIMS_OFFICER or FIELD_ADJUSTER requests an unapproved garage by id', async () => {
      const resOfficer = await request(app)
        .get(`/api/v1/garages/${unapprovedGarageId}`)
        .set('Authorization', `Bearer ${officerToken1}`);

      expect(resOfficer.status).toBe(404);
      expect(resOfficer.body.success).toBe(false);
      expect(resOfficer.body.errors[0].code).toBe('GARAGE_NOT_FOUND');

      const resAdjuster = await request(app)
        .get(`/api/v1/garages/${unapprovedGarageId}`)
        .set('Authorization', `Bearer ${adjusterToken1}`);

      expect(resAdjuster.status).toBe(404);
      expect(resAdjuster.body.success).toBe(false);
      expect(resAdjuster.body.errors[0].code).toBe('GARAGE_NOT_FOUND');
    });

    it('should return 404 GARAGE_NOT_FOUND for non-existent garageId', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .get(`/api/v1/garages/${nonExistentId}`)
        .set('Authorization', `Bearer ${adminToken1}`);

      expect(res.status).toBe(404);
      expect(res.body.errors[0].code).toBe('GARAGE_NOT_FOUND');
    });

    it('should return 404 GARAGE_NOT_FOUND for cross-tenant garageId (even if caller is ADMIN)', async () => {
      const res = await request(app)
        .get(`/api/v1/garages/${org2GarageId}`)
        .set('Authorization', `Bearer ${adminToken1}`);

      expect(res.status).toBe(404);
      expect(res.body.errors[0].code).toBe('GARAGE_NOT_FOUND');
    });

    it('should return 400 VALIDATION_ERROR for malformed ObjectId param', async () => {
      const res = await request(app)
        .get('/api/v1/garages/not-a-valid-object-id')
        .set('Authorization', `Bearer ${adminToken1}`);

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should never include normalizedName or __v in the garage response', async () => {
      const res = await request(app)
        .get(`/api/v1/garages/${approvedGarageId}`)
        .set('Authorization', `Bearer ${adminToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('normalizedName');
      expect(res.body.data).not.toHaveProperty('__v');
      expect(res.body.data).not.toHaveProperty('organizationId');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PATCH /api/v1/garages/:garageId
  // ───────────────────────────────────────────────────────────────────────────
  describe('PATCH /api/v1/garages/:garageId', () => {
    let garageId;
    let secondGarageId;
    let org2GarageId;

    beforeEach(async () => {
      const res1 = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ name: 'First Garage', laborRate: 60 }));
      garageId = res1.body.data.id;

      const res2 = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken1}`)
        .send(validGaragePayload({ name: 'Second Garage', laborRate: 70 }));
      secondGarageId = res2.body.data.id;

      const res3 = await request(app)
        .post('/api/v1/garages')
        .set('Authorization', `Bearer ${adminToken2}`)
        .send(validGaragePayload({ name: 'Org2 Garage', laborRate: 80 }));
      org2GarageId = res3.body.data.id;
    });

    it('should allow ADMIN to update a subset of fields (e.g. phone and laborRate converted to minor units)', async () => {
      const res = await request(app)
        .patch(`/api/v1/garages/${garageId}`)
        .set('Authorization', `Bearer ${adminToken1}`)
        .send({ phone: '+970599999888', laborRate: 95.5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.phone).toBe('+970599999888');
      expect(res.body.data.laborRate).toBe(95.5);

      const inDb = await mongoose.connection
        .collection('garages')
        .findOne({ _id: new mongoose.Types.ObjectId(garageId) });
      expect(inDb.laborRate).toBe(9550);
      expect(inDb.phone).toBe('+970599999888');
    });

    it('should allow ADMIN to toggle approved status to false (deactivating garage)', async () => {
      const res = await request(app)
        .patch(`/api/v1/garages/${garageId}`)
        .set('Authorization', `Bearer ${adminToken1}`)
        .send({ approved: false });

      expect(res.status).toBe(200);
      expect(res.body.data.approved).toBe(false);
    });

    it('should update normalizedName when name is changed', async () => {
      const res = await request(app)
        .patch(`/api/v1/garages/${garageId}`)
        .set('Authorization', `Bearer ${adminToken1}`)
        .send({ name: '  Renamed Garage  ' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Renamed Garage');

      const inDb = await mongoose.connection
        .collection('garages')
        .findOne({ _id: new mongoose.Types.ObjectId(garageId) });
      expect(inDb.normalizedName).toBe('renamed garage');
    });

    it('should return 409 GARAGE_ALREADY_EXISTS when renaming to an existing garage name in same org', async () => {
      const res = await request(app)
        .patch(`/api/v1/garages/${garageId}`)
        .set('Authorization', `Bearer ${adminToken1}`)
        .send({ name: 'Second Garage' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('GARAGE_ALREADY_EXISTS');
    });

    it('should return 400 VALIDATION_ERROR when PATCH body is empty', async () => {
      const res = await request(app)
        .patch(`/api/v1/garages/${garageId}`)
        .set('Authorization', `Bearer ${adminToken1}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 VALIDATION_ERROR when PATCH body contains unknown keys', async () => {
      const res = await request(app)
        .patch(`/api/v1/garages/${garageId}`)
        .set('Authorization', `Bearer ${adminToken1}`)
        .send({ name: 'Valid Name', unknownField: 'forbidden' });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 GARAGE_NOT_FOUND when updating non-existent or cross-tenant garage', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const resNonExistent = await request(app)
        .patch(`/api/v1/garages/${nonExistentId}`)
        .set('Authorization', `Bearer ${adminToken1}`)
        .send({ city: 'Nablus' });

      expect(resNonExistent.status).toBe(404);
      expect(resNonExistent.body.errors[0].code).toBe('GARAGE_NOT_FOUND');

      const resCrossTenant = await request(app)
        .patch(`/api/v1/garages/${org2GarageId}`)
        .set('Authorization', `Bearer ${adminToken1}`)
        .send({ city: 'Jerusalem' });

      expect(resCrossTenant.status).toBe(404);
      expect(resCrossTenant.body.errors[0].code).toBe('GARAGE_NOT_FOUND');
    });

    it('should forbid CLAIMS_OFFICER and FIELD_ADJUSTER from updating a garage (403)', async () => {
      const resOfficer = await request(app)
        .patch(`/api/v1/garages/${garageId}`)
        .set('Authorization', `Bearer ${officerToken1}`)
        .send({ city: 'Jericho' });

      expect(resOfficer.status).toBe(403);

      const resAdjuster = await request(app)
        .patch(`/api/v1/garages/${garageId}`)
        .set('Authorization', `Bearer ${adjusterToken1}`)
        .send({ city: 'Jericho' });

      expect(resAdjuster.status).toBe(403);
    });
  });
});

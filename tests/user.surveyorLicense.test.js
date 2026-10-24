const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Customer = require('../src/modules/customers/customer.model');
const config = require('../src/config/env');
const { buildPolicy } = require('./helpers/policyFactory');
const { toHebronDate } = require('../src/utils/hebronDate');

jest.mock('../src/modules/notifications/notification.service', () => ({
  createAndSendNotification: jest.fn().mockResolvedValue({}),
}));

let mongoServer;
let org1, org2;
let admin1, adminToken1;
let officer1, officerToken1;
let testPolicy;

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

const addDaysToHebron = (now, days) => {
  const hebronStr = toHebronDate(now);
  const [y, m, d] = hebronStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

  officer1 = await User.create({
    name: 'Officer One',
    employeeCode: 'CO-01',
    password: 'Password123!',
    role: 'CLAIMS_OFFICER',
    organizationId: org1._id,
    status: 'ACTIVE',
  });
  officerToken1 = generateToken(officer1);

  testPolicy = await buildPolicy({
    policyNumber: 'POL-SURV-001',
    status: 'ACTIVE',
    startDate: new Date('2026-01-01'),
    expiryDate: new Date('2027-12-31'),
    organizationId: org1._id,
  });
});

describe('Surveyor License Integration Tests (INT-01 to INT-29)', () => {
  const now = new Date();
  const validExpiry = addDaysToHebron(now, 100);
  const soonExpiry = addDaysToHebron(now, 15);
  const todayExpiry = toHebronDate(now);
  const yesterdayExpiry = addDaysToHebron(now, -1);

  it('INT-01. POST /users: ADMIN creates FIELD_ADJUSTER with valid license', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        name: 'Valid Adjuster',
        employeeCode: 'FA-V01',
        password: 'Password123!',
        role: 'FIELD_ADJUSTER',
        surveyorLicenseNumber: 'LIC-FA-V01',
        surveyorLicenseExpiry: validExpiry,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('FIELD_ADJUSTER');
    expect(res.body.data.surveyorLicenseNumber).toBe('LIC-FA-V01');
    expect(res.body.data.surveyorLicenseExpiry).toBe(validExpiry);
    expect(res.body.data.licenseState).toBe('VALID');
  });

  it('INT-02. POST /users: FIELD_ADJUSTER missing license number', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        name: 'No Number Adjuster',
        employeeCode: 'FA-NN',
        password: 'Password123!',
        role: 'FIELD_ADJUSTER',
        surveyorLicenseExpiry: validExpiry,
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('INT-03. POST /users: FIELD_ADJUSTER missing license expiry', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        name: 'No Expiry Adjuster',
        employeeCode: 'FA-NE',
        password: 'Password123!',
        role: 'FIELD_ADJUSTER',
        surveyorLicenseNumber: 'LIC-FA-NE',
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('INT-04. POST /users: FIELD_ADJUSTER with expired license', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        name: 'Expired Adjuster',
        employeeCode: 'FA-EXP',
        password: 'Password123!',
        role: 'FIELD_ADJUSTER',
        surveyorLicenseNumber: 'LIC-FA-EXP',
        surveyorLicenseExpiry: yesterdayExpiry,
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('SURVEYOR_LICENSE_EXPIRED');
    expect(res.body.errors[0].reason).toBe('LICENSE_EXPIRED');

    const created = await User.findOne({ employeeCode: 'FA-EXP' });
    expect(created).toBeNull();
  });

  it('INT-05. POST /users: CLAIMS_OFFICER with license fields', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        name: 'Officer With License',
        employeeCode: 'CO-WL',
        password: 'Password123!',
        role: 'CLAIMS_OFFICER',
        surveyorLicenseNumber: 'LIC-CO-01',
        surveyorLicenseExpiry: validExpiry,
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('INT-06. PATCH /users/:userId/status: Activate FIELD_ADJUSTER with valid license', async () => {
    const adjuster = await User.create({
      name: 'Adj Inactive',
      employeeCode: 'FA-ACT1',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'INACTIVE',
      surveyorLicenseNumber: 'LIC-ACT1',
      surveyorLicenseExpiry: validExpiry,
    });

    const res = await request(app)
      .patch(`/api/v1/users/${adjuster._id}/status`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ACTIVE');
  });

  it('INT-07. PATCH /users/:userId/status: Activate FIELD_ADJUSTER with missing license', async () => {
    const adjuster = await User.create({
      name: 'Adj Missing',
      employeeCode: 'FA-ACT2',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'INACTIVE',
      surveyorLicenseNumber: null,
      surveyorLicenseExpiry: null,
    });

    const res = await request(app)
      .patch(`/api/v1/users/${adjuster._id}/status`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('SURVEYOR_LICENSE_EXPIRED');
    expect(res.body.errors[0].reason).toBe('LICENSE_MISSING');
  });

  it('INT-08. PATCH /users/:userId/status: Activate FIELD_ADJUSTER with expired license', async () => {
    const adjuster = await User.create({
      name: 'Adj Expired',
      employeeCode: 'FA-ACT3',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'INACTIVE',
      surveyorLicenseNumber: 'LIC-ACT3',
      surveyorLicenseExpiry: yesterdayExpiry,
    });

    const res = await request(app)
      .patch(`/api/v1/users/${adjuster._id}/status`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('SURVEYOR_LICENSE_EXPIRED');
    expect(res.body.errors[0].reason).toBe('LICENSE_EXPIRED');
  });

  it('INT-09. PATCH /users/:userId/status: Deactivate to INACTIVE succeeds unconditionally regardless of license', async () => {
    const adjuster = await User.create({
      name: 'Adj Deact',
      employeeCode: 'FA-DEACT',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: null,
      surveyorLicenseExpiry: null,
    });

    const res = await request(app)
      .patch(`/api/v1/users/${adjuster._id}/status`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ status: 'INACTIVE' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('INACTIVE');
  });

  it('INT-10. PATCH /users/:userId/status: Activate CLAIMS_OFFICER succeeds without license', async () => {
    const officer = await User.create({
      name: 'Off Inactive',
      employeeCode: 'CO-INACT',
      password: 'p',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
      status: 'INACTIVE',
    });

    const res = await request(app)
      .patch(`/api/v1/users/${officer._id}/status`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ACTIVE');
  });

  it('INT-11. PATCH /users/:userId/status: Activate user in different organization -> 404 USER_NOT_FOUND', async () => {
    const org2User = await User.create({
      name: 'Org2 User',
      employeeCode: 'FA-ORG2',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org2._id,
      status: 'INACTIVE',
      surveyorLicenseNumber: 'LIC-ORG2',
      surveyorLicenseExpiry: validExpiry,
    });

    const res = await request(app)
      .patch(`/api/v1/users/${org2User._id}/status`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('USER_NOT_FOUND');
  });

  it('INT-12. PATCH /users/:userId/surveyor-license: ADMIN updates license', async () => {
    const adjuster = await User.create({
      name: 'Adj To License',
      employeeCode: 'FA-TL',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: null,
      surveyorLicenseExpiry: null,
    });

    const res = await request(app)
      .patch(`/api/v1/users/${adjuster._id}/surveyor-license`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        surveyorLicenseNumber: 'lic-new-001',
        surveyorLicenseExpiry: validExpiry,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(adjuster._id.toString());
    expect(res.body.data.surveyorLicenseNumber).toBe('LIC-NEW-001');
    expect(res.body.data.surveyorLicenseExpiry).toBe(validExpiry);
    expect(res.body.data.licenseState).toBe('VALID');
  });

  it('INT-13. PATCH /users/:userId/surveyor-license: Renewing expired license unhides adjuster in GET /users/adjusters', async () => {
    const adjuster = await User.create({
      name: 'Adj Renew',
      employeeCode: 'FA-REN',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-OLD',
      surveyorLicenseExpiry: yesterdayExpiry,
    });

    // Hidden initially
    const listRes1 = await request(app)
      .get('/api/v1/users/adjusters')
      .set('Authorization', `Bearer ${officerToken1}`);
    expect(listRes1.body.data.some((a) => a.id === adjuster._id.toString())).toBe(false);

    // Renew
    const renewRes = await request(app)
      .patch(`/api/v1/users/${adjuster._id}/surveyor-license`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        surveyorLicenseNumber: 'LIC-RENEWED',
        surveyorLicenseExpiry: validExpiry,
      });
    expect(renewRes.status).toBe(200);

    // Visible now
    const listRes2 = await request(app)
      .get('/api/v1/users/adjusters')
      .set('Authorization', `Bearer ${officerToken1}`);
    expect(listRes2.body.data.some((a) => a.id === adjuster._id.toString())).toBe(true);
  });

  it('INT-14. PATCH /users/:userId/surveyor-license: Setting past expiry accepted -> 200, adjuster stays hidden from GET /users/adjusters', async () => {
    const adjuster = await User.create({
      name: 'Adj Past',
      employeeCode: 'FA-PAST',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-PAST-1',
      surveyorLicenseExpiry: validExpiry,
    });

    const res = await request(app)
      .patch(`/api/v1/users/${adjuster._id}/surveyor-license`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        surveyorLicenseNumber: 'LIC-PAST-EXPIRED',
        surveyorLicenseExpiry: yesterdayExpiry,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.licenseState).toBe('EXPIRED');

    const listRes = await request(app)
      .get('/api/v1/users/adjusters')
      .set('Authorization', `Bearer ${officerToken1}`);
    expect(listRes.body.data.some((a) => a.id === adjuster._id.toString())).toBe(false);
  });

  it('INT-15. PATCH /users/:userId/surveyor-license: Target user is CLAIMS_OFFICER -> 422 NOT_A_FIELD_ADJUSTER', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${officer1._id}/surveyor-license`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        surveyorLicenseNumber: 'LIC-CO',
        surveyorLicenseExpiry: validExpiry,
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('NOT_A_FIELD_ADJUSTER');
  });

  it('INT-16. PATCH /users/:userId/surveyor-license: Target user from different organization -> 404 USER_NOT_FOUND', async () => {
    const org2Adjuster = await User.create({
      name: 'Org2 Adj',
      employeeCode: 'FA-ORG2B',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org2._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-ORG2',
      surveyorLicenseExpiry: validExpiry,
    });

    const res = await request(app)
      .patch(`/api/v1/users/${org2Adjuster._id}/surveyor-license`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        surveyorLicenseNumber: 'LIC-HACK',
        surveyorLicenseExpiry: validExpiry,
      });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('USER_NOT_FOUND');
  });

  it('INT-17. PATCH /users/:userId/surveyor-license: Called by CLAIMS_OFFICER -> 403 FORBIDDEN', async () => {
    const adjuster = await User.create({
      name: 'Adj Forbidden',
      employeeCode: 'FA-FB',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-FB',
      surveyorLicenseExpiry: validExpiry,
    });

    const res = await request(app)
      .patch(`/api/v1/users/${adjuster._id}/surveyor-license`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        surveyorLicenseNumber: 'LIC-FAIL',
        surveyorLicenseExpiry: validExpiry,
      });

    expect(res.status).toBe(403);
  });

  it('INT-18. GET /users/adjusters: Excludes adjusters with MISSING or EXPIRED license', async () => {
    await User.create({
      name: 'Adj Valid',
      employeeCode: 'FA-OK',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-OK',
      surveyorLicenseExpiry: validExpiry,
    });
    await User.create({
      name: 'Adj Expired',
      employeeCode: 'FA-EX',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-EX',
      surveyorLicenseExpiry: yesterdayExpiry,
    });
    await User.create({
      name: 'Adj Missing',
      employeeCode: 'FA-MS',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: null,
      surveyorLicenseExpiry: null,
    });

    const resNoFilter = await request(app)
      .get('/api/v1/users/adjusters')
      .set('Authorization', `Bearer ${officerToken1}`);

    expect(resNoFilter.status).toBe(200);
    expect(resNoFilter.body.data.length).toBe(1);
    expect(resNoFilter.body.data[0].employeeCode).toBe('FA-OK');

    const resWithFilter = await request(app)
      .get('/api/v1/users/adjusters?status=available')
      .set('Authorization', `Bearer ${officerToken1}`);

    expect(resWithFilter.status).toBe(200);
    expect(resWithFilter.body.data.length).toBe(1);
    expect(resWithFilter.body.data[0].employeeCode).toBe('FA-OK');
  });

  it('INT-19. GET /users/adjusters: Returns licenseExpiringSoon: true for EXPIRING_SOON and false for VALID', async () => {
    await User.create({
      name: 'Adj Valid',
      employeeCode: 'FA-VLD',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-VLD',
      surveyorLicenseExpiry: validExpiry,
    });
    await User.create({
      name: 'Adj Soon',
      employeeCode: 'FA-SOON',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-SOON',
      surveyorLicenseExpiry: soonExpiry,
    });

    const res = await request(app)
      .get('/api/v1/users/adjusters')
      .set('Authorization', `Bearer ${officerToken1}`);

    expect(res.status).toBe(200);
    const validAdj = res.body.data.find((a) => a.employeeCode === 'FA-VLD');
    const soonAdj = res.body.data.find((a) => a.employeeCode === 'FA-SOON');

    expect(validAdj.licenseExpiringSoon).toBe(false);
    expect(validAdj.surveyorLicenseExpiry).toBe(validExpiry);

    expect(soonAdj.licenseExpiringSoon).toBe(true);
    expect(soonAdj.surveyorLicenseExpiry).toBe(soonExpiry);
  });

  it('INT-20. GET /users: ADMIN listing returns license fields and licenseState for adjusters, and null for non-adjusters', async () => {
    await User.create({
      name: 'Adj In List',
      employeeCode: 'FA-LIST',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-LIST',
      surveyorLicenseExpiry: validExpiry,
    });

    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken1}`);

    expect(res.status).toBe(200);
    const adjItem = res.body.data.find((u) => u.employeeCode === 'FA-LIST');
    const officerItem = res.body.data.find((u) => u.employeeCode === 'CO-01');

    expect(adjItem.surveyorLicenseNumber).toBe('LIC-LIST');
    expect(adjItem.surveyorLicenseExpiry).toBe(validExpiry);
    expect(adjItem.licenseState).toBe('VALID');

    expect(officerItem.surveyorLicenseNumber).toBeNull();
    expect(officerItem.surveyorLicenseExpiry).toBeNull();
    expect(officerItem.licenseState).toBeNull();
  });

  it('INT-21. POST /claims/:claimId/assign: Assigning adjuster with expired license -> 422 SURVEYOR_LICENSE_EXPIRED', async () => {
    const expiredAdj = await User.create({
      name: 'Adj Exp Assign',
      employeeCode: 'FA-EXP-A',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-EXP-A',
      surveyorLicenseExpiry: yesterdayExpiry,
    });

    const claim = await Claim.create({
      organizationId: org1._id,
      policyId: testPolicy._id,
      createdBy: officer1._id,
      status: 'NEW',
      customer: { name: 'Customer', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({ adjusterId: expiredAdj._id });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('SURVEYOR_LICENSE_EXPIRED');
    expect(res.body.errors[0].reason).toBe('LICENSE_EXPIRED');
  });

  it('INT-22. POST /claims/:claimId/assign: Assigning adjuster with missing license -> 422 SURVEYOR_LICENSE_EXPIRED', async () => {
    const missingAdj = await User.create({
      name: 'Adj Miss Assign',
      employeeCode: 'FA-MS-A',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: null,
      surveyorLicenseExpiry: null,
    });

    const claim = await Claim.create({
      organizationId: org1._id,
      policyId: testPolicy._id,
      createdBy: officer1._id,
      status: 'NEW',
      customer: { name: 'Customer', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({ adjusterId: missingAdj._id });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('SURVEYOR_LICENSE_EXPIRED');
    expect(res.body.errors[0].reason).toBe('LICENSE_MISSING');
  });

  it('INT-23. POST /claims/:claimId/assign: overrideCapacity: true does NOT bypass missing or expired license -> 422', async () => {
    const expiredAdj = await User.create({
      name: 'Adj Exp Cap',
      employeeCode: 'FA-EXP-C',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-EXP-C',
      surveyorLicenseExpiry: yesterdayExpiry,
    });

    const claim = await Claim.create({
      organizationId: org1._id,
      policyId: testPolicy._id,
      createdBy: officer1._id,
      status: 'NEW',
      customer: { name: 'Customer', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({ adjusterId: expiredAdj._id, overrideCapacity: true });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('SURVEYOR_LICENSE_EXPIRED');
    expect(res.body.errors[0].reason).toBe('LICENSE_EXPIRED');
  });

  it('INT-24. POST /claims/:claimId/assign: Error order: 404 ADJUSTER_NOT_FOUND precedes 422 SURVEYOR_LICENSE_EXPIRED precedes 409 ADJUSTER_UNAVAILABLE', async () => {
    const claim = await Claim.create({
      organizationId: org1._id,
      policyId: testPolicy._id,
      createdBy: officer1._id,
      status: 'NEW',
      customer: { name: 'Customer', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
    });

    // 1. Inactive adjuster gives 404 (ADJUSTER_NOT_FOUND) even if license missing
    const inactiveAdj = await User.create({
      name: 'Inactive',
      employeeCode: 'FA-IN404',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'INACTIVE',
      surveyorLicenseNumber: null,
      surveyorLicenseExpiry: null,
    });
    const res404 = await request(app)
      .post(`/api/v1/claims/${claim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({ adjusterId: inactiveAdj._id });
    expect(res404.status).toBe(404);
    expect(res404.body.errors[0].code).toBe('ADJUSTER_NOT_FOUND');

    // 2. Active adjuster with expired license AND over capacity gives 422 before 409
    const busyExpiredAdj = await User.create({
      name: 'Busy Expired',
      employeeCode: 'FA-B-EXP',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-B-EXP',
      surveyorLicenseExpiry: yesterdayExpiry,
    });
    for (let i = 0; i < 4; i++) {
      await Claim.create({
        organizationId: org1._id,
        policyId: testPolicy._id,
        createdBy: officer1._id,
        status: 'ASSIGNED',
        assignedTo: busyExpiredAdj._id,
        customer: { name: `C${i}`, phone: '0599000000' },
        incidentType: 'COLLISION',
        incidentLocation: 'Ramallah',
      });
    }
    const res422 = await request(app)
      .post(`/api/v1/claims/${claim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({ adjusterId: busyExpiredAdj._id });
    expect(res422.status).toBe(422);
    expect(res422.body.errors[0].code).toBe('SURVEYOR_LICENSE_EXPIRED');

    // 3. Active adjuster with valid license AND over capacity gives 409
    const busyValidAdj = await User.create({
      name: 'Busy Valid',
      employeeCode: 'FA-B-VLD',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-B-VLD',
      surveyorLicenseExpiry: validExpiry,
    });
    for (let i = 0; i < 4; i++) {
      await Claim.create({
        organizationId: org1._id,
        policyId: testPolicy._id,
        createdBy: officer1._id,
        status: 'ASSIGNED',
        assignedTo: busyValidAdj._id,
        customer: { name: `C${i}`, phone: '0599000000' },
        incidentType: 'COLLISION',
        incidentLocation: 'Ramallah',
      });
    }
    const res409 = await request(app)
      .post(`/api/v1/claims/${claim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({ adjusterId: busyValidAdj._id });
    expect(res409.status).toBe(409);
    expect(res409.body.errors[0].code).toBe('ADJUSTER_UNAVAILABLE');
  });

  it('INT-25. POST /claims/:claimId/accept-assignment: Adjuster with expired license cannot accept', async () => {
    const expiredAdj = await User.create({
      name: 'Adj Exp Accept',
      employeeCode: 'FA-EXP-ACC',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-EXP-ACC',
      surveyorLicenseExpiry: yesterdayExpiry,
    });
    const expiredToken = generateToken(expiredAdj);

    const claim = await Claim.create({
      organizationId: org1._id,
      policyId: testPolicy._id,
      createdBy: officer1._id,
      assignedTo: expiredAdj._id,
      status: 'PENDING_ACCEPTANCE',
      customer: { name: 'Customer', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/accept-assignment`)
      .set('Authorization', `Bearer ${expiredToken}`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('SURVEYOR_LICENSE_EXPIRED');
    expect(res.body.errors[0].reason).toBe('LICENSE_EXPIRED');

    const freshClaim = await Claim.findById(claim._id);
    expect(freshClaim.status).toBe('PENDING_ACCEPTANCE');
  });

  it('INT-26. POST /claims/:claimId/accept-assignment: Adjuster with missing license cannot accept', async () => {
    const missingAdj = await User.create({
      name: 'Adj Miss Accept',
      employeeCode: 'FA-MS-ACC',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: null,
      surveyorLicenseExpiry: null,
    });
    const missingToken = generateToken(missingAdj);

    const claim = await Claim.create({
      organizationId: org1._id,
      policyId: testPolicy._id,
      createdBy: officer1._id,
      assignedTo: missingAdj._id,
      status: 'PENDING_ACCEPTANCE',
      customer: { name: 'Customer', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/accept-assignment`)
      .set('Authorization', `Bearer ${missingToken}`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('SURVEYOR_LICENSE_EXPIRED');
    expect(res.body.errors[0].reason).toBe('LICENSE_MISSING');

    const freshClaim = await Claim.findById(claim._id);
    expect(freshClaim.status).toBe('PENDING_ACCEPTANCE');
  });

  it('INT-27. Inspection steps after acceptance execute successfully even if adjuster license expires afterwards', async () => {
    const adjuster = await User.create({
      name: 'Adj Inspect',
      employeeCode: 'FA-INSP',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-INSP',
      surveyorLicenseExpiry: yesterdayExpiry, // already expired
    });
    const adjToken = generateToken(adjuster);

    const vehicle = await Vehicle.create({
      organizationId: org1._id,
      plateNumber: 'PLT-777',
      make: 'Hyundai',
      model: 'Ioniq',
      year: 2022,
    });

    const claim = await Claim.create({
      organizationId: org1._id,
      policyId: testPolicy._id,
      createdBy: officer1._id,
      assignedTo: adjuster._id,
      status: 'ASSIGNED',
      vehicle: { vehicleId: vehicle._id, plateNumber: 'PLT-777' },
      accident: { accidentType: 'COLLISION' },
      location: { latitude: 24, longitude: 46 },
      evidence: [
        {
          imageType: 'DAMAGE_CLOSEUP',
          url: 'https://res.cloudinary.com/test/photo.jpg',
          publicId: 'pid1',
          uploadedBy: adjuster._id,
        },
      ],
      signature: {
        url: 'https://res.cloudinary.com/test/sig.png',
        publicId: 'sig1',
        capturedBy: adjuster._id,
        capturedAt: new Date(),
      },
      customer: { name: 'Customer', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
    });

    // Start inspection
    const startRes = await request(app)
      .post(`/api/v1/claims/${claim._id}/inspection/start`)
      .set('Authorization', `Bearer ${adjToken}`);
    expect(startRes.status).toBe(200);
    expect(startRes.body.data.status).toBe('IN_PROGRESS');

    // Submit inspection
    const submitRes = await request(app)
      .post(`/api/v1/claims/${claim._id}/inspection/submit`)
      .set('Authorization', `Bearer ${adjToken}`);
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.data.status).toBe('SUBMITTED');
  });

  it('INT-28. rejects a license expiry that is not a real calendar day', async () => {
    // 1. POST /users with impossible day 2026-02-30
    const resPost = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        name: 'Bad Day Adjuster',
        employeeCode: 'FA-BAD1',
        password: 'Password123!',
        role: 'FIELD_ADJUSTER',
        surveyorLicenseNumber: 'LIC-BAD1',
        surveyorLicenseExpiry: '2026-02-30',
      });
    expect(resPost.status).toBe(400);
    expect(resPost.body.errors[0].code).toBe('VALIDATION_ERROR');

    // 2. PATCH surveyor-license with datetime string
    const adjuster = await User.create({
      name: 'Adj Bad Expiry',
      employeeCode: 'FA-BAD2',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-INIT',
      surveyorLicenseExpiry: validExpiry,
    });

    const resPatch = await request(app)
      .patch(`/api/v1/users/${adjuster._id}/surveyor-license`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        surveyorLicenseNumber: 'LIC-BAD2',
        surveyorLicenseExpiry: '2027-12-31T10:00:00Z',
      });
    expect(resPatch.status).toBe(400);
    expect(resPatch.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('INT-29. aggregate filter and helper agree at the expiry day', async () => {
    const adjToday = await User.create({
      name: 'Adj Today',
      employeeCode: 'FA-TODAY',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-TODAY',
      surveyorLicenseExpiry: todayExpiry,
    });

    const adjYesterday = await User.create({
      name: 'Adj Yesterday',
      employeeCode: 'FA-YEST',
      password: 'p',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-YEST',
      surveyorLicenseExpiry: yesterdayExpiry,
    });

    // Listing: adjToday is visible with licenseExpiringSoon: true; adjYesterday is hidden
    const listRes = await request(app)
      .get('/api/v1/users/adjusters')
      .set('Authorization', `Bearer ${officerToken1}`);
    expect(listRes.status).toBe(200);

    const foundToday = listRes.body.data.find((a) => a.employeeCode === 'FA-TODAY');
    const foundYesterday = listRes.body.data.find((a) => a.employeeCode === 'FA-YEST');

    expect(foundToday).toBeDefined();
    expect(foundToday.licenseExpiringSoon).toBe(true);
    expect(foundToday.surveyorLicenseExpiry).toBe(todayExpiry);
    expect(foundYesterday).toBeUndefined();

    // Assigning to adjToday succeeds (200 PENDING_ACCEPTANCE)
    const claim1 = await Claim.create({
      organizationId: org1._id,
      policyId: testPolicy._id,
      createdBy: officer1._id,
      status: 'NEW',
      customer: { name: 'Customer 1', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
    });
    const assignTodayRes = await request(app)
      .post(`/api/v1/claims/${claim1._id}/assign`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({ adjusterId: adjToday._id });
    expect(assignTodayRes.status).toBe(200);
    expect(assignTodayRes.body.data.status).toBe('PENDING_ACCEPTANCE');

    // Assigning to adjYesterday gives 422 SURVEYOR_LICENSE_EXPIRED (reason LICENSE_EXPIRED)
    const claim2 = await Claim.create({
      organizationId: org1._id,
      policyId: testPolicy._id,
      createdBy: officer1._id,
      status: 'NEW',
      customer: { name: 'Customer 2', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
    });
    const assignYestRes = await request(app)
      .post(`/api/v1/claims/${claim2._id}/assign`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({ adjusterId: adjYesterday._id });
    expect(assignYestRes.status).toBe(422);
    expect(assignYestRes.body.errors[0].code).toBe('SURVEYOR_LICENSE_EXPIRED');
    expect(assignYestRes.body.errors[0].reason).toBe('LICENSE_EXPIRED');
  });
});

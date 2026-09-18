const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const jwt = require('jsonwebtoken');
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

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

describe('GET /api/v1/users/adjusters', () => {
  let org1, org2;
  let admin, officer, adjuster1, adjuster2, adjuster3, inactiveAdjuster, otherOrgAdjuster;
  let officerToken;

  beforeEach(async () => {
    org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1' });
    org2 = await Organization.create({ name: 'Org 2', code: 'ORG-2' });

    officer = await User.create({
      name: 'Claims Officer',
      employeeCode: 'CO-01',
      password: 'password',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    officerToken = generateToken(officer);

    adjuster1 = await User.create({
      name: 'Adjuster 1',
      employeeCode: 'FA-01',
      password: 'password',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    adjuster2 = await User.create({
      name: 'Adjuster 2',
      employeeCode: 'FA-02',
      password: 'password',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    adjuster3 = await User.create({
      name: 'Adjuster 3',
      employeeCode: 'FA-03',
      password: 'password',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    inactiveAdjuster = await User.create({
      name: 'Inactive Adjuster',
      employeeCode: 'FA-INACTIVE',
      password: 'password',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'INACTIVE',
    });

    otherOrgAdjuster = await User.create({
      name: 'Other Org Adjuster',
      employeeCode: 'FA-OTHER',
      password: 'password',
      role: 'FIELD_ADJUSTER',
      organizationId: org2._id,
      status: 'ACTIVE',
    });

    // Assign 4 claims to adjuster 2 (so activeTasksCount > 3, making them unavailable)
    for (let i = 0; i < 4; i++) {
      await Claim.create({
        organizationId: org1._id,
        createdBy: officer._id,
        status: 'ASSIGNED',
        customer: { name: `C${i}`, phone: '1' },
        incidentType: 'COLLISION',
        incidentLocation: 'L',
        assignedTo: adjuster2._id,
      });
    }
  });

  it('should fetch all adjusters in the organization with their availability', async () => {
    const response = await request(app)
      .get('/api/v1/users/adjusters')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBe(4); // adjuster1, adjuster2, adjuster3, inactiveAdjuster

    const a1 = response.body.data.find(a => a.employeeCode === 'FA-01');
    const a2 = response.body.data.find(a => a.employeeCode === 'FA-02');
    const aInactive = response.body.data.find(a => a.employeeCode === 'FA-INACTIVE');

    expect(a1.availability).toBe('AVAILABLE');
    expect(a1.activeTasksCount).toBe(0);
    expect(a1.capacityLimit).toBe(3);
    expect(a2.availability).toBe('UNAVAILABLE');
    expect(a2.activeTasksCount).toBe(4);
    expect(a2.capacityLimit).toBe(3);
    expect(aInactive.availability).toBe('UNAVAILABLE');
    expect(aInactive.capacityLimit).toBe(3);
  });

  it('should include numeric capacityLimit and activeTasksCount for all adjusters', async () => {
    const response = await request(app)
      .get('/api/v1/users/adjusters')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    response.body.data.forEach((adjuster) => {
      expect(typeof adjuster.activeTasksCount).toBe('number');
      expect(typeof adjuster.capacityLimit).toBe('number');
      expect(adjuster.capacityLimit).toBe(3);
    });
  });

  it('should filter adjusters when status=available is passed', async () => {
    const response = await request(app)
      .get('/api/v1/users/adjusters?status=available')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBe(2); // adjuster1, adjuster3
    expect(response.body.data.find(a => a.employeeCode === 'FA-02')).toBeUndefined();
    expect(response.body.data.find(a => a.employeeCode === 'FA-INACTIVE')).toBeUndefined();
  });

  it('should return 400 Bad Request when status query parameter is not "available"', async () => {
    const response = await request(app)
      .get('/api/v1/users/adjusters?status=busy')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Validation Error');
    expect(response.body.errors[0].code).toBe('VALIDATION_ERROR');
    expect(response.body.errors[0].details).toMatch(/status must be: available/i);
  });

  it('should return 400 Bad Request when unknown query parameter is passed', async () => {
    const response = await request(app)
      .get('/api/v1/users/adjusters?unknownParam=attack')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('should not count SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, or CLOSED claims towards activeTasksCount', async () => {
    // Assign non-ASSIGNED claims to adjuster1
    await Claim.create({
      organizationId: org1._id,
      createdBy: officer._id,
      status: 'SUBMITTED',
      customer: { name: 'C1', phone: '1' },
      incidentType: 'COLLISION',
      incidentLocation: 'L1',
      assignedTo: adjuster1._id,
    });
    await Claim.create({
      organizationId: org1._id,
      createdBy: officer._id,
      status: 'CLOSED',
      customer: { name: 'C2', phone: '2' },
      incidentType: 'COLLISION',
      incidentLocation: 'L2',
      assignedTo: adjuster1._id,
    });

    const response = await request(app)
      .get('/api/v1/users/adjusters')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(response.status).toBe(200);
    const a1 = response.body.data.find((a) => a.employeeCode === 'FA-01');
    expect(a1.activeTasksCount).toBe(0);
    expect(a1.availability).toBe('AVAILABLE');
  });

  it('should correctly reflect multiple active assigned tasks and availability (available when <= 3, unavailable when > 3)', async () => {
    // Reset claims for adjuster1
    await Claim.deleteMany({ assignedTo: adjuster1._id });

    // 1. Give adjuster1 3 active assigned tasks
    for (let i = 1; i <= 3; i++) {
      await Claim.create({
        organizationId: org1._id,
        createdBy: officer._id,
        status: 'ASSIGNED',
        customer: { name: `C${i}`, phone: '1' },
        incidentType: 'COLLISION',
        incidentLocation: 'L',
        assignedTo: adjuster1._id,
      });
    }

    let response = await request(app)
      .get('/api/v1/users/adjusters')
      .set('Authorization', `Bearer ${officerToken}`);

    let a1 = response.body.data.find((a) => a.employeeCode === 'FA-01');
    expect(a1.activeTasksCount).toBe(3);
    expect(a1.availability).toBe('AVAILABLE'); // 3 or less is available

    // 2. Add a 4th active claim (> 3)
    await Claim.create({
      organizationId: org1._id,
      createdBy: officer._id,
      status: 'ASSIGNED',
      customer: { name: 'C4', phone: '1' },
      incidentType: 'COLLISION',
      incidentLocation: 'L',
      assignedTo: adjuster1._id,
    });

    response = await request(app)
      .get('/api/v1/users/adjusters')
      .set('Authorization', `Bearer ${officerToken}`);

    a1 = response.body.data.find((a) => a.employeeCode === 'FA-01');
    expect(a1.activeTasksCount).toBe(4);
    expect(a1.availability).toBe('UNAVAILABLE'); // more than 3 is unavailable
  });

  it('should count IN_PROGRESS and CORRECTION_REQUIRED claims towards activeTasksCount', async () => {
    // Reset adjuster1 & adjuster3
    await Claim.deleteMany({ assignedTo: { $in: [adjuster1._id, adjuster3._id] } });

    await Claim.create({
      organizationId: org1._id,
      createdBy: officer._id,
      status: 'IN_PROGRESS',
      customer: { name: 'C1', phone: '1' },
      incidentType: 'COLLISION',
      incidentLocation: 'L1',
      assignedTo: adjuster1._id,
    });
    await Claim.create({
      organizationId: org1._id,
      createdBy: officer._id,
      status: 'CORRECTION_REQUIRED',
      customer: { name: 'C2', phone: '2' },
      incidentType: 'COLLISION',
      incidentLocation: 'L2',
      assignedTo: adjuster3._id,
    });

    const response = await request(app)
      .get('/api/v1/users/adjusters')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(response.status).toBe(200);
    const a1 = response.body.data.find((a) => a.employeeCode === 'FA-01');
    const a3 = response.body.data.find((a) => a.employeeCode === 'FA-03');
    expect(a1.activeTasksCount).toBe(1);
    expect(a1.availability).toBe('AVAILABLE');
    expect(a3.activeTasksCount).toBe(1);
    expect(a3.availability).toBe('AVAILABLE');
  });

  it('should eliminate N+1 queries by never calling Claim.countDocuments', async () => {
    const countSpy = jest.spyOn(Claim, 'countDocuments');

    const response = await request(app)
      .get('/api/v1/users/adjusters')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(response.status).toBe(200);
    expect(countSpy).not.toHaveBeenCalled();
    countSpy.mockRestore();
  });
});


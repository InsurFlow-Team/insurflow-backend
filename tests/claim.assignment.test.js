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

describe('POST /api/v1/claims/:claimId/assign', () => {
  let org1, org2;
  let officer1, officer2, adjusterAvailable, adjusterBusy, adjusterInactive;
  let claimOrg1, claimOrg2;

  beforeEach(async () => {
    org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1' });
    org2 = await Organization.create({ name: 'Org 2', code: 'ORG-2' });

    officer1 = await User.create({ name: 'O1', employeeCode: 'O-1', password: 'p', role: 'CLAIMS_OFFICER', organizationId: org1._id });
    officer2 = await User.create({ name: 'O2', employeeCode: 'O-2', password: 'p', role: 'CLAIMS_OFFICER', organizationId: org2._id });

    adjusterAvailable = await User.create({ name: 'AA', employeeCode: 'AA-1', password: 'p', role: 'FIELD_ADJUSTER', organizationId: org1._id, status: 'ACTIVE' });
    adjusterBusy = await User.create({ name: 'AB', employeeCode: 'AB-1', password: 'p', role: 'FIELD_ADJUSTER', organizationId: org1._id, status: 'ACTIVE' });
    adjusterInactive = await User.create({ name: 'AI', employeeCode: 'AI-1', password: 'p', role: 'FIELD_ADJUSTER', organizationId: org1._id, status: 'INACTIVE' });

    claimOrg1 = await Claim.create({ organizationId: org1._id, createdBy: officer1._id, status: 'NEW', customer: { name: 'C', phone: '1' }, incidentType: 'COLLISION', incidentLocation: 'L' });
    claimOrg2 = await Claim.create({ organizationId: org2._id, createdBy: officer2._id, status: 'NEW', customer: { name: 'C', phone: '1' }, incidentType: 'COLLISION', incidentLocation: 'L' });

    // Make adjusterBusy actually busy
    await Claim.create({ organizationId: org1._id, createdBy: officer1._id, status: 'ASSIGNED', assignedTo: adjusterBusy._id, customer: { name: 'C', phone: '1' }, incidentType: 'COLLISION', incidentLocation: 'L' });
  });

  it('should successfully assign a NEW claim to an available adjuster', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterAvailable._id });

    expect(response.status).toBe(200);
    expect(response.body.data.assignedTo).toBe(adjusterAvailable._id.toString());
    expect(response.body.data.status).toBe('ASSIGNED');
  });

  it('should fail to assign if adjuster is busy', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterBusy._id });

    expect(response.status).toBe(409);
    expect(response.body.errors[0].code).toBe('ADJUSTER_UNAVAILABLE');
  });

  it('should fail to assign if adjuster is inactive', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterInactive._id });

    expect(response.status).toBe(404);
    expect(response.body.errors[0].code).toBe('ADJUSTER_NOT_FOUND');
  });

  it('should fail if claim belongs to another organization', async () => {
    const token = generateToken(officer1); // officer1 belongs to org1
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg2._id}/assign`) // claimOrg2 belongs to org2
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterAvailable._id });

    expect(response.status).toBe(404);
  });

  it('should fail if claim is already ASSIGNED (not NEW)', async () => {
    // claimOrg1 is NEW. Let's assign it first.
    await Claim.updateOne({ _id: claimOrg1._id }, { status: 'ASSIGNED' });

    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterAvailable._id });

    expect(response.status).toBe(409);
    expect(response.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('should return 403 if called by a FIELD_ADJUSTER', async () => {
    const token = generateToken(adjusterAvailable); // FIELD_ADJUSTER token
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterAvailable._id });

    expect(response.status).toBe(403);
  });

  it('should successfully assign with priority and notes', async () => {
    const token = generateToken(officer1);
    const response = await request(app)
      .post(`/api/v1/claims/${claimOrg1._id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ adjusterId: adjusterAvailable._id, priority: 'HIGH', notes: 'Please hurry' });

    expect(response.status).toBe(200);
    expect(response.body.data.assignedTo).toBe(adjusterAvailable._id.toString());
    expect(response.body.data.priority).toBe('HIGH');
  });

  it('should generate sequential claim numbers without collision risk', async () => {
    // claimOrg1, claimOrg2, and the busy claim were created sequentially in beforeEach.
    // They should be CLM-0001, CLM-0002, CLM-0003
    expect(claimOrg1.claimNumber).toMatch(/^CLM-\d{4}$/);
    expect(claimOrg2.claimNumber).toMatch(/^CLM-\d{4}$/);
    
    const seq1 = parseInt(claimOrg1.claimNumber.split('-')[1], 10);
    const seq2 = parseInt(claimOrg2.claimNumber.split('-')[1], 10);
    
    // They should be different and sequential
    expect(seq1).not.toBe(seq2);
    
    // Let's create two back to back explicitly to be absolutely sure
    const c1 = await Claim.create({ organizationId: org1._id, createdBy: officer1._id, status: 'NEW', customer: { name: 'C', phone: '1' }, incidentType: 'COLLISION', incidentLocation: 'L' });
    const c2 = await Claim.create({ organizationId: org1._id, createdBy: officer1._id, status: 'NEW', customer: { name: 'C', phone: '1' }, incidentType: 'COLLISION', incidentLocation: 'L' });
    
    const seqC1 = parseInt(c1.claimNumber.split('-')[1], 10);
    const seqC2 = parseInt(c2.claimNumber.split('-')[1], 10);
    
    expect(seqC2).toBe(seqC1 + 1);
  });
});

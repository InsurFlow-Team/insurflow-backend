const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Customer = require('../src/modules/customers/customer.model');
const { buildPolicy } = require('./helpers/policyFactory');
const claimRepository = require('../src/modules/claims/claim.repository');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');

const Incident = require('../src/modules/incidents/incident.model');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
}, 30000);

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

describe('PB-01a Incident Intake', () => {
  let org, officer, policy;

  beforeEach(async () => {
    org = await Organization.create({ name: 'Test Org', code: 'TST' });
    officer = await User.create({
      name: 'Officer',
      employeeCode: 'OF-TST-01',
      password: 'p',
      role: 'CLAIMS_OFFICER',
      organizationId: org._id,
    });
    policy = await buildPolicy({
      policyNumber: 'POL-INC-001',
      status: 'ACTIVE',
      startDate: new Date('2025-01-01'),
      expiryDate: new Date('2027-12-31'),
      organizationId: org._id,
    });
    const customer = await Customer.create({
      fullName: 'Test Customer',
      phone: '0591111111',
      organizationId: org._id,
    });
    await Vehicle.create({
      plateNumber: 'INC-100',
      make: 'Toyota',
      model: 'Camry',
      year: 2023,
      color: 'White',
      organizationId: org._id,
      complementaryPolicyId: policy._id,
      customerId: customer._id,
    });
  });

  const claimBody = () => ({
    policyId: policy._id.toString(),
    plateNumber: 'INC-100',
    incidentType: 'COLLISION',
    incidentLocation: 'Main Road',
    incidentDate: '2026-06-15',
    description: 'Front bumper damage',
    latitude: 31.9038,
    longitude: 35.2034,
  });

  // ── Must fail before the code exists ────────────────────────────

  it('PB-01a POST /claims creates one Incident with incidentNumber INC-<ORG_CODE>-0001', async () => {
    const token = generateToken(officer);
    await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${token}`)
      .send(claimBody());

    const IncidentModel = Incident;
    const incidents = await IncidentModel.find({ organizationId: org._id }).lean();
    expect(incidents).toHaveLength(1);
    expect(incidents[0].incidentNumber).toBe('INC-TST-0001');
    expect(incidents[0].organizationId.toString()).toBe(org._id.toString());
  });

  it('PB-01a POST /claims links the claim with incidentId, incidentNumber and claimType OWN_DAMAGE', async () => {
    const token = generateToken(officer);
    const res = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${token}`)
      .send(claimBody());

    expect(res.status).toBe(201);
    expect(res.body.data.incidentId).toBeTruthy();
    expect(res.body.data.incidentNumber).toBe('INC-TST-0001');
    expect(res.body.data.claimType).toBe('OWN_DAMAGE');

    // Verify in DB
    const claim = await Claim.findById(res.body.data.id).lean();
    expect(claim.incidentId).toBeTruthy();
    expect(claim.incidentNumber).toBe('INC-TST-0001');
    expect(claim.claimType).toBe('OWN_DAMAGE');
  });

  it('PB-01a Incident intake facts equal the claim copy', async () => {
    const token = generateToken(officer);
    const res = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${token}`)
      .send(claimBody());

    expect(res.status).toBe(201);
    const claim = await Claim.findById(res.body.data.id).lean();
    const IncidentModel = Incident;
    const incident = await IncidentModel.findById(claim.incidentId).lean();

    expect(incident.incidentDate).toBe(claim.incidentDate);
    expect(incident.incidentType).toBe(claim.incidentType);
    expect(incident.incidentLocation).toBe(claim.incidentLocation);
    expect(incident.incidentDescription).toBe(claim.incidentDescription);
    expect(incident.incidentCoordinates.latitude).toBe(claim.incidentCoordinates.latitude);
    expect(incident.incidentCoordinates.longitude).toBe(claim.incidentCoordinates.longitude);
  });

  it('PB-01a incidentNumber restarts at 0001 for a second organization', async () => {
    const token = generateToken(officer);
    // First org claim
    await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${token}`)
      .send(claimBody());

    // Second org setup
    const org2 = await Organization.create({ name: 'Org Two', code: 'ORG2' });
    const officer2 = await User.create({
      name: 'Officer2',
      employeeCode: 'OF-ORG2-01',
      password: 'p',
      role: 'CLAIMS_OFFICER',
      organizationId: org2._id,
    });
    const policy2 = await buildPolicy({
      policyNumber: 'POL-ORG2-001',
      status: 'ACTIVE',
      startDate: new Date('2025-01-01'),
      expiryDate: new Date('2027-12-31'),
      organizationId: org2._id,
    });
    const customer2 = await Customer.create({
      fullName: 'Customer Two',
      phone: '0592222222',
      organizationId: org2._id,
    });
    await Vehicle.create({
      plateNumber: 'ORG2-100',
      make: 'Honda',
      model: 'Civic',
      year: 2023,
      color: 'Black',
      organizationId: org2._id,
      complementaryPolicyId: policy2._id,
      customerId: customer2._id,
    });

    const token2 = generateToken(officer2);
    const res2 = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${token2}`)
      .send({
        policyId: policy2._id.toString(),
        plateNumber: 'ORG2-100',
        incidentType: 'COLLISION',
        incidentLocation: 'Second Road',
        incidentDate: '2026-06-15',
      });

    expect(res2.status).toBe(201);
    const IncidentModel = Incident;
    const incident2 = await IncidentModel.findOne({ organizationId: org2._id }).lean();
    expect(incident2.incidentNumber).toBe('INC-ORG2-0001');
  });

  it('PB-01a five concurrent POST /claims get five unique incidentNumbers', async () => {
    const token = generateToken(officer);
    const promises = Array.from({ length: 5 }, () =>
      request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${token}`)
        .send(claimBody())
    );
    const results = await Promise.all(promises);

    results.forEach((res) => expect(res.status).toBe(201));

    const IncidentModel = Incident;
    const incidents = await IncidentModel.find({ organizationId: org._id }).lean();
    const numbers = incidents.map((i) => i.incidentNumber).sort();
    expect(numbers).toEqual([
      'INC-TST-0001',
      'INC-TST-0002',
      'INC-TST-0003',
      'INC-TST-0004',
      'INC-TST-0005',
    ]);
  });

  it('PB-01a deletes the Incident when the claim insert fails', async () => {
    const token = generateToken(officer);
    const countBefore = await Claim.countDocuments();

    const spy = jest.spyOn(claimRepository, 'create')
      .mockRejectedValueOnce(new Error('Simulated claim insert failure'));

    const res = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${token}`)
      .send(claimBody());

    spy.mockRestore();

    expect(res.status).toBe(500);
    expect(res.body.errors[0].code).toBe('INTERNAL_ERROR');

    const IncidentModel = Incident;
    const incidentCount = await IncidentModel.countDocuments();
    expect(incidentCount).toBe(0);

    const countAfter = await Claim.countDocuments();
    expect(countAfter).toBe(countBefore);
  });

  it('PB-01a GET /claims/:claimId returns incidentId, incidentNumber and claimType', async () => {
    const token = generateToken(officer);
    const createRes = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${token}`)
      .send(claimBody());

    expect(createRes.status).toBe(201);
    const claimId = createRes.body.data.id;

    const getRes = await request(app)
      .get(`/api/v1/claims/${claimId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.incidentId).toBeTruthy();
    expect(getRes.body.data.incidentNumber).toBe('INC-TST-0001');
    expect(getRes.body.data.claimType).toBe('OWN_DAMAGE');
  });

  // ── Regression guard ───────────────────────────────────────────

  describe('PB-01a a rejected POST /claims creates no Incident', () => {
    it('404 POLICY_NOT_FOUND', async () => {
      const token = generateToken(officer);
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...claimBody(), policyId: fakeId.toString() });

      expect(res.status).toBe(404);
      expect(res.body.errors[0].code).toBe('POLICY_NOT_FOUND');
      const incidentCount = await Incident.countDocuments();
      expect(incidentCount).toBe(0);
    });

    it('422 POLICY_CANCELLED', async () => {
      const cancelledPolicy = await buildPolicy({
        policyNumber: 'POL-CANCEL-001',
        status: 'CANCELLED',
        organizationId: org._id,
      });
      const customer = await Customer.create({
        fullName: 'Cancel Cust',
        phone: '0593333333',
        organizationId: org._id,
      });
      await Vehicle.create({
        plateNumber: 'CANCEL-1',
        make: 'Ford',
        model: 'Focus',
        year: 2023,
        organizationId: org._id,
        complementaryPolicyId: cancelledPolicy._id,
        customerId: customer._id,
      });

      const token = generateToken(officer);
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...claimBody(), policyId: cancelledPolicy._id.toString(), plateNumber: 'CANCEL-1' });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('POLICY_CANCELLED');
      const incidentCount = await Incident.countDocuments();
      expect(incidentCount).toBe(0);
    });

    it('422 VEHICLE_MISMATCH', async () => {
      const token = generateToken(officer);
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...claimBody(), plateNumber: 'DOES-NOT-EXIST' });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('VEHICLE_MISMATCH');
      const incidentCount = await Incident.countDocuments();
      expect(incidentCount).toBe(0);
    });

    it('400 INVALID_INCIDENT_DATE', async () => {
      const token = generateToken(officer);
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...claimBody(), incidentDate: '2099-01-01' });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('INVALID_INCIDENT_DATE');
      const incidentCount = await Incident.countDocuments();
      expect(incidentCount).toBe(0);
    });
  });

  // ── Must fail before the code exists ───────────────────────────

  it('PB-01a GET /claims/:claimId of a claim without incidentId returns incidentId null and claimType OWN_DAMAGE', async () => {
    // Create a legacy claim directly, no incident
    const legacyClaim = await Claim.create({
      organizationId: org._id,
      policyId: policy._id,
      createdBy: officer._id,
      status: 'NEW',
      customer: { name: 'Legacy', phone: '0590000000' },
      vehicle: { plateNumber: 'INC-100' },
      incidentType: 'COLLISION',
      incidentLocation: 'Old Road',
    });

    const token = generateToken(officer);
    const res = await request(app)
      .get(`/api/v1/claims/${legacyClaim._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.incidentId).toBeNull();
    expect(res.body.data.incidentNumber).toBeNull();
    expect(res.body.data.claimType).toBe('OWN_DAMAGE');
  });
});

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Customer = require('../src/modules/customers/customer.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Claim = require('../src/modules/claims/claim.model');
const Incident = require('../src/modules/incidents/incident.model');
const { buildPolicy } = require('./helpers/policyFactory');
const config = require('../src/config/env');

jest.mock('../src/modules/notifications/notification.service', () => ({
  createAndSendNotification: jest.fn().mockResolvedValue({}),
  sendToOrganization: jest.fn().mockResolvedValue({}),
}));

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

describe('PB-01b Incident Endpoints & Sub-claims', () => {
  let mongoServer;
  let org, officer, officerToken, admin, adminToken, adjuster, adjusterToken;
  let otherOrg, otherOfficer, otherOfficerToken;
  let policy, vehicle, customer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    await Claim.init();
    const indexNames = (await Claim.collection.indexes()).map((i) => i.name);
    console.log('Claim indexes:', indexNames);
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

  const setupBaseFixture = async () => {
    org = await Organization.create({ name: 'Test Org', code: 'TST', status: 'ACTIVE' });

    officer = await User.create({
      name: 'Test Officer',
      employeeCode: 'OF-TST-01',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    officerToken = generateToken(officer);

    admin = await User.create({
      name: 'Test Admin',
      employeeCode: 'AD-TST-01',
      password: 'password123',
      role: 'ADMIN',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    adminToken = generateToken(admin);

    adjuster = await User.create({
      name: 'Test Adjuster',
      employeeCode: 'ADJ-TST-01',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    adjusterToken = generateToken(adjuster);

    otherOrg = await Organization.create({ name: 'Other Org', code: 'OTH', status: 'ACTIVE' });
    otherOfficer = await User.create({
      name: 'Other Officer',
      employeeCode: 'OF-OTH-01',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: otherOrg._id,
      status: 'ACTIVE',
    });
    otherOfficerToken = generateToken(otherOfficer);

    policy = await buildPolicy({
      policyNumber: 'POL-TST-001',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2025-01-01'),
      expiryDate: new Date('2027-12-31'),
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
      deductibleAmount: 500,
    });

    customer = await Customer.create({
      fullName: 'Ahmad Customer',
      phone: '0599112233',
      organizationId: org._id,
    });

    vehicle = await Vehicle.create({
      plateNumber: 'INC-100',
      make: 'Toyota',
      model: 'Camry',
      year: 2023,
      color: 'White',
      organizationId: org._id,
      policyId: policy._id,
      customerId: customer._id,
    });
  };

  const createIncidentFixture = async (overrides = {}) => {
    return await Incident.create({
      organizationId: org._id,
      incidentDate: '2026-06-15',
      incidentType: 'COLLISION',
      incidentLocation: 'King Fahd Rd, Riyadh',
      incidentDescription: 'Front collision with barrier',
      incidentCoordinates: { latitude: 24.7136, longitude: 46.6753, capturedAt: new Date() },
      createdBy: officer._id,
      ...overrides,
    });
  };

  // ─── Group 1: Must fail before the code exists ───────────────────────────────

  it('PB-01b POST /incidents creates an Incident with the next incidentNumber and no claim', async () => {
    await setupBaseFixture();
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentType: 'COLLISION',
        incidentLocation: 'King Fahd Rd, Riyadh',
        incidentDate: '2026-06-15',
        description: 'Two car collision',
        latitude: 24.7136,
        longitude: 46.6753,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.incidentNumber).toBe('INC-TST-0001');
    expect(res.body.data.incidentDate).toBe('2026-06-15');
    expect(res.body.data.incidentType).toBe('COLLISION');
    expect(res.body.data.incidentLocation).toBe('King Fahd Rd, Riyadh');
    expect(res.body.data.incidentDescription).toBe('Two car collision');
    expect(res.body.data.incidentCoordinates).toEqual(
      expect.objectContaining({ latitude: 24.7136, longitude: 46.6753 })
    );
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.createdAt).toBeDefined();

    const claimCount = await Claim.countDocuments();
    expect(claimCount).toBe(0);
  });

  it('PB-01b POST /incidents rejects a future incidentDate with 400 INVALID_INCIDENT_DATE', async () => {
    await setupBaseFixture();
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentType: 'COLLISION',
        incidentLocation: 'King Fahd Rd, Riyadh',
        incidentDate: '2099-01-01',
        description: 'Future accident',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('INVALID_INCIDENT_DATE');

    const incidentCount = await Incident.countDocuments();
    expect(incidentCount).toBe(0);
  });

  it('PB-01b POST /incidents/:incidentId/claims creates an OWN_DAMAGE claim that copies the incident facts', async () => {
    await setupBaseFixture();
    const incident = await createIncidentFixture();
    const incidentCountBefore = await Incident.countDocuments();

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: 'INC-100',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.claimType).toBe('OWN_DAMAGE');
    expect(data.incidentId).toBe(incident._id.toString());
    expect(data.incidentNumber).toBe(incident.incidentNumber);
    expect(data.claimNumber).toBeDefined();
    expect(data.trackingToken).toBeDefined();
    expect(data.status).toBe('NEW');

    // Correction 6: assert that no new incident was created
    const incidentCountAfter = await Incident.countDocuments();
    expect(incidentCountAfter).toBe(incidentCountBefore);

    // Assert that the claim document copied facts from the Incident document
    const savedClaim = await Claim.findById(data.id).lean();
    expect(savedClaim.incidentDate).toBe(incident.incidentDate);
    expect(savedClaim.incidentType).toBe(incident.incidentType);
    expect(savedClaim.incidentLocation).toBe(incident.incidentLocation);
    expect(savedClaim.incidentDescription).toBe(incident.incidentDescription);
    expect(savedClaim.incidentCoordinates.latitude).toBe(incident.incidentCoordinates.latitude);
    expect(savedClaim.incidentCoordinates.longitude).toBe(incident.incidentCoordinates.longitude);
  });

  it('PB-01b two vehicles on one fleet policy in one incident get two OWN_DAMAGE claims', async () => {
    await setupBaseFixture();
    const vehicle2 = await Vehicle.create({
      plateNumber: 'INC-200',
      make: 'Nissan',
      model: 'Patrol',
      year: 2024,
      color: 'Black',
      organizationId: org._id,
      policyId: policy._id,
      customerId: customer._id,
    });

    const incident = await createIncidentFixture();

    const res1 = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: 'INC-100',
      });
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: 'INC-200',
      });
    expect(res2.status).toBe(201);

    const claims = await Claim.find({ incidentId: incident._id });
    expect(claims).toHaveLength(2);
  });

  it('PB-01b a second OWN_DAMAGE claim for the same vehicle in one incident returns 409 DUPLICATE_SUB_CLAIM', async () => {
    await setupBaseFixture();
    const incident = await createIncidentFixture();

    const res1 = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: 'INC-100',
      });
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: 'INC-100',
      });

    expect(res2.status).toBe(409);
    expect(res2.body.success).toBe(false);
    expect(res2.body.errors[0].code).toBe('DUPLICATE_SUB_CLAIM');

    const claims = await Claim.find({ incidentId: incident._id });
    expect(claims).toHaveLength(1);
  });

  it('PB-01b two concurrent requests for the same vehicle create exactly one claim', async () => {
    await setupBaseFixture();
    const incident = await createIncidentFixture();

    const sendReq = () =>
      request(app)
        .post(`/api/v1/incidents/${incident._id}/claims`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          claimType: 'OWN_DAMAGE',
          policyId: policy._id.toString(),
          plateNumber: 'INC-100',
        });

    const [resA, resB] = await Promise.all([sendReq(), sendReq()]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const conflictRes = resA.status === 409 ? resA : resB;
    expect(conflictRes.body.errors[0].code).toBe('DUPLICATE_SUB_CLAIM');

    const claims = await Claim.find({ incidentId: incident._id });
    expect(claims).toHaveLength(1);
  });

  it('PB-01b THIRD_PARTY_PD returns 422 CLAIM_TYPE_NOT_SUPPORTED and creates no claim', async () => {
    await setupBaseFixture();
    const incident = await createIncidentFixture();

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'THIRD_PARTY_PD',
        policyId: policy._id.toString(),
        plateNumber: 'INC-100',
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('CLAIM_TYPE_NOT_SUPPORTED');

    const claims = await Claim.find({ incidentId: incident._id });
    expect(claims).toHaveLength(0);
  });

  it('PB-01b an incident of another organization returns 404 INCIDENT_NOT_FOUND on GET and on POST claims', async () => {
    await setupBaseFixture();
    const otherIncident = await Incident.create({
      organizationId: otherOrg._id,
      incidentDate: '2026-06-15',
      incidentType: 'COLLISION',
      incidentLocation: 'Dammam Highway',
      createdBy: otherOfficer._id,
    });

    const getRes = await request(app)
      .get(`/api/v1/incidents/${otherIncident._id}`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(getRes.status).toBe(404);
    expect(getRes.body.errors[0].code).toBe('INCIDENT_NOT_FOUND');

    const postRes = await request(app)
      .post(`/api/v1/incidents/${otherIncident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: 'INC-100',
      });
    expect(postRes.status).toBe(404);
    expect(postRes.body.errors[0].code).toBe('INCIDENT_NOT_FOUND');
  });

  it('PB-01b a policy of another organization returns 404 POLICY_NOT_FOUND on POST claims', async () => {
    await setupBaseFixture();
    const otherPolicy = await buildPolicy({
      policyNumber: 'POL-OTH-999',
      status: 'ACTIVE',
      organizationId: otherOrg._id,
    });

    const incident = await createIncidentFixture();

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: otherPolicy._id.toString(),
        plateNumber: 'INC-100',
      });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('POLICY_NOT_FOUND');
  });

  it('PB-01b GET /incidents filters by incidentNumber and by incidentDate range, newest first, with pagination', async () => {
    await setupBaseFixture();

    // Create 3 incidents across different dates and createdAt
    const inc1 = await createIncidentFixture({ incidentDate: '2026-01-10', incidentLocation: 'Loc 1' });
    const inc2 = await createIncidentFixture({ incidentDate: '2026-02-15', incidentLocation: 'Loc 2' });
    const inc3 = await createIncidentFixture({ incidentDate: '2026-03-20', incidentLocation: 'Loc 3' });

    // Test list all with pagination headers
    const listRes = await request(app)
      .get('/api/v1/incidents?page=1&limit=2')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(2);
    expect(listRes.headers['x-total-count']).toBe('3');
    expect(listRes.headers['x-page']).toBe('1');
    expect(listRes.headers['x-limit']).toBe('2');
    expect(listRes.headers['x-total-pages']).toBe('2');
    // Newest first by createdAt
    expect(listRes.body.data[0].id).toBe(inc3._id.toString());
    expect(listRes.body.data[1].id).toBe(inc2._id.toString());

    // Test filter by incidentNumber
    const numRes = await request(app)
      .get(`/api/v1/incidents?incidentNumber=${inc2.incidentNumber}`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(numRes.status).toBe(200);
    expect(numRes.body.data).toHaveLength(1);
    expect(numRes.body.data[0].incidentNumber).toBe(inc2.incidentNumber);

    // Test filter by incidentDate range
    const rangeRes = await request(app)
      .get('/api/v1/incidents?from=2026-02-01&to=2026-03-31')
      .set('Authorization', `Bearer ${officerToken}`);
    expect(rangeRes.status).toBe(200);
    expect(rangeRes.body.data).toHaveLength(2);
    const returnedDates = rangeRes.body.data.map((i) => i.incidentDate);
    expect(returnedDates).toEqual(['2026-03-20', '2026-02-15']);
  });

  it('PB-01b GET /incidents/:incidentId lists its claims', async () => {
    await setupBaseFixture();
    const incident = await createIncidentFixture();

    const subClaimRes = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: 'INC-100',
      });
    expect(subClaimRes.status).toBe(201);
    const createdClaim = subClaimRes.body.data;

    const res = await request(app)
      .get(`/api/v1/incidents/${incident._id}`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(incident._id.toString());
    expect(res.body.data.incidentNumber).toBe(incident.incidentNumber);
    expect(res.body.data.incidentDescription).toBe(incident.incidentDescription);
    expect(res.body.data.incidentCoordinates).toBeDefined();
    expect(res.body.data.claims).toHaveLength(1);
    expect(res.body.data.claims[0]).toEqual({
      id: createdClaim.id,
      claimNumber: createdClaim.claimNumber,
      claimType: 'OWN_DAMAGE',
      status: 'NEW',
      plateNumber: 'INC-100',
    });
  });

  it('PB-01b FIELD_ADJUSTER gets 403 on every incidents route', async () => {
    await setupBaseFixture();
    const incident = await createIncidentFixture();

    const postIncidentRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({
        incidentType: 'COLLISION',
        incidentLocation: 'Loc',
        incidentDate: '2026-06-15',
      });
    expect(postIncidentRes.status).toBe(403);

    const listIncidentsRes = await request(app)
      .get('/api/v1/incidents')
      .set('Authorization', `Bearer ${adjusterToken}`);
    expect(listIncidentsRes.status).toBe(403);

    const getIncidentRes = await request(app)
      .get(`/api/v1/incidents/${incident._id}`)
      .set('Authorization', `Bearer ${adjusterToken}`);
    expect(getIncidentRes.status).toBe(403);

    const postSubClaimRes = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
      });
    expect(postSubClaimRes.status).toBe(403);
  });

  it('PB-01b GET /claims/stats returns totalIncidents for CLAIMS_OFFICER and ADMIN', async () => {
    await setupBaseFixture();
    // Create 2 incidents in org
    await createIncidentFixture();
    await createIncidentFixture();

    // Officer
    const officerRes = await request(app)
      .get('/api/v1/claims/stats')
      .set('Authorization', `Bearer ${officerToken}`);
    expect(officerRes.status).toBe(200);
    expect(officerRes.body.data.scope).toBe('ORGANIZATION');
    expect(officerRes.body.data.totalIncidents).toBe(2);

    // Admin
    const adminRes = await request(app)
      .get('/api/v1/claims/stats')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.data.scope).toBe('ORGANIZATION');
    expect(adminRes.body.data.totalIncidents).toBe(2);
  });

  // ─── Group 2: Regression guards, expected to pass before and after ───────────

  it('PB-01b GET /claims/stats for FIELD_ADJUSTER has no totalIncidents', async () => {
    await setupBaseFixture();
    await createIncidentFixture();

    const res = await request(app)
      .get('/api/v1/claims/stats')
      .set('Authorization', `Bearer ${adjusterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.scope).toBe('ASSIGNED');
    expect(res.body.data.totalIncidents).toBeUndefined();
  });

  it('PB-01b POST /claims still creates its own new Incident and the same response keys', async () => {
    await setupBaseFixture();

    const res = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyId: policy._id.toString(),
        plateNumber: 'INC-100',
        incidentType: 'COLLISION',
        incidentLocation: 'Main St, Riyadh',
        incidentDate: '2026-06-15',
        description: 'Front collision',
        latitude: 24.7136,
        longitude: 46.6753,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const data = res.body.data;

    expect(data.id).toBeDefined();
    expect(data.claimNumber).toBeDefined();
    expect(data.incidentId).toBeDefined();
    expect(data.incidentNumber).toBeDefined();
    expect(data.claimType).toBe('OWN_DAMAGE');
    expect(data.status).toBe('NEW');
    expect(data.trackingToken).toBeDefined();
    expect(data.trackingUrl).toBeDefined();
    expect(data.eligibilityHint).toBeDefined();
    expect(data.coverageSnapshot).toBeDefined();
    expect(data.createdAt).toBeDefined();

    const incident = await Incident.findById(data.incidentId);
    expect(incident).not.toBeNull();
    expect(incident.incidentNumber).toBe(data.incidentNumber);
  });
});

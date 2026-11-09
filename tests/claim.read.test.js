const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/modules/users/user.model');
const Organization = require('../src/modules/organizations/organization.model');
const Claim = require('../src/modules/claims/claim.model');
const Policy = require('../src/modules/policies/policy.model');
const { buildPolicy } = require('./helpers/policyFactory');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Customer = require('../src/modules/customers/customer.model');
const jwt = require('jsonwebtoken');

const { MongoMemoryServer } = require('mongodb-memory-server');
const config = require('../src/config/env');

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret || 'test-secret',
    { expiresIn: config.jwtExpiresIn || '1h' }
  );
};

describe('Claim Read Endpoints', () => {
  let org1;
  let officer1;
  let adjuster1;
  let tokenOfficer;
  let tokenAdjuster;
  let newClaim;
  let assignedClaim;
  let mongoServer;
  let policy1;
  let customer1;
  let vehicle1;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Organization.deleteMany({});
    await User.deleteMany({});
    await Claim.deleteMany({});
    await Policy.deleteMany({});
    await Vehicle.deleteMany({});
    await Customer.deleteMany({});

    org1 = await Organization.create({
      name: 'Test Org 1',
      code: 'ORG-1',
      domain: 'test1.com',
      status: 'ACTIVE',
    });

    officer1 = await User.create({
      name: 'Test Officer',
      employeeCode: 'CO-1',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    tokenOfficer = generateToken(officer1);

    adjuster1 = await User.create({
      name: 'Test Adjuster',
      employeeCode: 'ADJ-1',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'LIC-ADJ-1',
      surveyorLicenseExpiry: '2099-12-31',
    });
    tokenAdjuster = generateToken(adjuster1);

    // ── Policy, Customer, Vehicle fixtures ──────────────────────────
    policy1 = await buildPolicy({
      policyNumber: 'POL-TEST-001',
      status: 'ACTIVE',
      startDate: new Date('2026-01-01'),
      expiryDate: new Date('2027-12-31'),
      organizationId: org1._id,
    });

    customer1 = await Customer.create({
      fullName: 'John Doe',
      phone: '0591234567',
      organizationId: org1._id,
    });

    vehicle1 = await Vehicle.create({
      plateNumber: 'ABC-123',
      make: 'Toyota',
      model: 'Camry',
      year: 2024,
      color: 'White',
      customerId: customer1._id,
      complementaryPolicyId: policy1._id,
      organizationId: org1._id,
    });

    newClaim = await Claim.create({
      organizationId: org1._id,
      createdBy: officer1._id,
      policyId: policy1._id,
      status: 'NEW',
      customer: { name: 'John Doe', phone: '0591234567' },
      vehicle: { plateNumber: 'ABC-123' },
      incidentType: 'COLLISION',
      incidentLocation: 'Street A',
    });

    assignedClaim = await Claim.create({
      organizationId: org1._id,
      createdBy: officer1._id,
      policyId: policy1._id,
      status: 'ASSIGNED',
      customer: { name: 'Jane Doe', phone: '456' },
      vehicle: {
        plateNumber: 'XYZ-987',
        vehicleId: vehicle1._id,
        customerId: customer1._id,
      },
      incidentType: 'OTHER',
      incidentLocation: 'Street B',
      assignedTo: adjuster1._id,
      assignedBy: officer1._id,
      assignedAt: new Date(),
      priority: 'HIGH',
      assignmentNotes: 'Please check ASAP',
    });
  });

  // ─── GET /claims (list) tests ─────────────────────────────────────

  it('GET /api/v1/claims returns flat shapes without _id or nested objects', async () => {
    const res = await request(app)
      .get('/api/v1/claims')
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const claims = res.body.data;
    expect(claims.length).toBe(2);

    for (const claim of claims) {
      expect(claim).toHaveProperty('id');
      expect(claim).not.toHaveProperty('_id');
      expect(claim).toHaveProperty('customerName');
      expect(claim).toHaveProperty('initialPlateNumber');
      expect(claim).not.toHaveProperty('customer');
      expect(claim).not.toHaveProperty('vehicle');
    }
  });

  it('GET /api/v1/claims?status=NEW only returns claims with status NEW', async () => {
    const res = await request(app)
      .get('/api/v1/claims?status=NEW')
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const claims = res.body.data;
    expect(claims.length).toBe(1);
    expect(claims[0].status).toBe('NEW');
    expect(claims[0].id).toBe(newClaim._id.toString());
  });

  it('GET /api/v1/claims?status=ASSIGNED only returns ASSIGNED claims', async () => {
    const res = await request(app)
      .get('/api/v1/claims?status=ASSIGNED')
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const claims = res.body.data;
    expect(claims.length).toBe(1);
    expect(claims[0].status).toBe('ASSIGNED');
    expect(claims[0].id).toBe(assignedClaim._id.toString());
  });

  it('GET /api/v1/claims returns assignedTo with id and name for assigned claim, and null for unassigned claim', async () => {
    const res = await request(app)
      .get('/api/v1/claims')
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const claims = res.body.data;
    expect(claims.length).toBe(2);

    const assigned = claims.find((c) => c.id === assignedClaim._id.toString());
    const unassigned = claims.find((c) => c.id === newClaim._id.toString());

    expect(assigned.assignedTo).toEqual({
      id: adjuster1._id.toString(),
      name: 'Test Adjuster',
    });
    expect(assigned.fieldAdjuster).toEqual({
      id: adjuster1._id.toString(),
      name: 'Test Adjuster',
    });

    expect(unassigned.assignedTo).toBeNull();
    expect(unassigned.fieldAdjuster).toBeNull();
  });

  it('GET /api/v1/claims?adjusterId=:id filters claims by assigned field adjuster', async () => {
    const res = await request(app)
      .get(`/api/v1/claims?adjusterId=${adjuster1._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const claims = res.body.data;
    expect(claims.length).toBe(1);
    expect(claims[0].id).toBe(assignedClaim._id.toString());
    expect(claims[0].assignedTo.id).toBe(adjuster1._id.toString());
  });

  it('GET /api/v1/claims?assignedTo=:id works as an alias to filter by assigned adjuster', async () => {
    const res = await request(app)
      .get(`/api/v1/claims?assignedTo=${adjuster1._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const claims = res.body.data;
    expect(claims.length).toBe(1);
    expect(claims[0].id).toBe(assignedClaim._id.toString());
  });

  it('GET /api/v1/claims?adjusterId=invalid-id returns 400 Bad Request with VALIDATION_ERROR', async () => {
    const res = await request(app)
      .get('/api/v1/claims?adjusterId=invalid-id')
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('GET /api/v1/claims?status=INVALID_STATUS returns 400 Bad Request with VALIDATION_ERROR', async () => {
    const res = await request(app)
      .get('/api/v1/claims?status=INVALID_STATUS')
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Validation Error');
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    expect(res.body.errors[0].details).toMatch(/status must be one of/i);
  });

  it('GET /api/v1/claims with unknown query parameter returns 400 Bad Request with VALIDATION_ERROR', async () => {
    const res = await request(app)
      .get('/api/v1/claims?unknownParam=attack')
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // ─── GET /claims/:claimId (detail) tests ──────────────────────────

  it('GET /api/v1/claims/:claimId returns structured response without _id, __v, or organizationId', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${assignedClaim._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const data = res.body.data;

    // Core identity
    expect(data).toHaveProperty('id', assignedClaim._id.toString());
    expect(data).not.toHaveProperty('_id');
    expect(data).not.toHaveProperty('organizationId');
    expect(data).not.toHaveProperty('__v');

    // Assignment section has formatted user objects
    expect(data.assignment).toBeDefined();
    expect(data.assignment.assignedTo).toEqual({
      id: adjuster1._id.toString(),
      name: 'Test Adjuster',
      employeeCode: 'ADJ-1',
    });
    expect(data.assignment.assignedBy).toEqual({
      id: officer1._id.toString(),
      name: 'Test Officer',
      employeeCode: 'CO-1',
    });
    expect(data.assignment.priority).toBe('HIGH');
    expect(data.assignment.assignmentNotes).toBe('Please check ASAP');
  });

  it('GET /api/v1/claims/:claimId returns policy information when populated', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${assignedClaim._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const data = res.body.data;

    // Policy section
    expect(data.policy).toBeDefined();
    expect(data.policy.id).toBe(policy1._id.toString());
    expect(data.policy.policyNumber).toBe('POL-TEST-001');
    expect(data.policy.status).toBe('ACTIVE');
    expect(data.policy.startDate).toBeDefined();
    expect(data.policy.expiryDate).toBeDefined();
  });

  it('GET /api/v1/claims/:claimId returns vehicle details from populated vehicleId', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${assignedClaim._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const data = res.body.data;

    // Vehicle section (merged from claim plateNumber + populated Vehicle entity)
    expect(data.vehicle).toBeDefined();
    expect(data.vehicle.plateNumber).toBe('XYZ-987');
    expect(data.vehicle.make).toBe('Toyota');
    expect(data.vehicle.model).toBe('Camry');
    expect(data.vehicle.year).toBe(2024);
    expect(data.vehicle.color).toBe('White');
  });

  it('GET /api/v1/claims/:claimId returns null vehicle details when vehicleId not yet set', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${newClaim._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const data = res.body.data;

    // NEW claim has plateNumber but no vehicleId populated yet
    expect(data.vehicle.plateNumber).toBe('ABC-123');
    expect(data.vehicle.make).toBeNull();
    expect(data.vehicle.model).toBeNull();
    expect(data.vehicle.year).toBeNull();
    expect(data.vehicle.color).toBeNull();
  });

  it('POST /api/v1/claims intake followed by GET /api/v1/claims/:claimId populates non-null vehicle make/model/year/color', async () => {
    const createRes = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${tokenOfficer}`)
      .send({
        policyId: policy1._id.toString(),
        plateNumber: 'ABC-123',
        incidentType: 'COLLISION',
        incidentLocation: 'King Abdullah St, Amman',
        incidentDate: '2026-06-15',
      });

    expect(createRes.statusCode).toBe(201);
    const createdClaimId = createRes.body.data.id;

    const getRes = await request(app)
      .get(`/api/v1/claims/${createdClaimId}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(getRes.statusCode).toBe(200);
    const vehicle = getRes.body.data.vehicle;

    expect(vehicle.plateNumber).toBe('ABC-123');
    expect(vehicle.make).toBe('Toyota');
    expect(vehicle.model).toBe('Camry');
    expect(vehicle.year).toBe(2024);
    expect(vehicle.color).toBe('White');

    expect(getRes.body.data.customer.name).toBe('John Doe');
    expect(getRes.body.data.customer.phone).toBe('0591234567');
  });

  it('GET /api/v1/claims/:claimId returns createdBy as formatted user object', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${assignedClaim._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const data = res.body.data;

    expect(data.createdBy).toEqual({
      id: officer1._id.toString(),
      name: 'Test Officer',
      employeeCode: 'CO-1',
    });
  });

  it('GET /api/v1/claims/:claimId returns null for empty optional sections', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${newClaim._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    const data = res.body.data;

    // Unassigned claim
    expect(data.assignment.assignedTo).toBeNull();
    expect(data.assignment.assignedBy).toBeNull();
    expect(data.assignment.assignedAt).toBeNull();

    // No inspection data yet
    expect(data.evidence).toEqual([]);
    expect(data.signature).toBeNull();
    expect(data.decisionNotes).toBeNull();
    expect(data.closedBy).toBeNull();
    expect(data.closedAt).toBeNull();
    expect(data.closingNotes).toBeNull();
  });

  it('GET /api/v1/claims/:claimId on an assigned claim allows the assigned adjuster', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${assignedClaim._id}`)
      .set('Authorization', `Bearer ${tokenAdjuster}`);

    expect(res.statusCode).toBe(200);
    const data = res.body.data;

    expect(data.assignment.assignedTo.id).toBe(adjuster1._id.toString());
  });

  it('GET /api/v1/claims called by FIELD_ADJUSTER returns only assigned claims with adjuster info', async () => {
    const res = await request(app)
      .get('/api/v1/claims')
      .set('Authorization', `Bearer ${tokenAdjuster}`);

    expect(res.statusCode).toBe(200);
    const claims = res.body.data;
    expect(claims.length).toBe(1);
    expect(claims[0].id).toBe(assignedClaim._id.toString());
    expect(claims[0].assignedTo).toEqual({
      id: adjuster1._id.toString(),
      name: 'Test Adjuster',
    });
    expect(claims[0].fieldAdjuster).toEqual({
      id: adjuster1._id.toString(),
      name: 'Test Adjuster',
    });
  });

  // ─── GAP-05: Incident Date Persistence Tests ────────────────────

  it('POST /api/v1/claims persists incidentDate when supplied and GET /claims/:claimId returns it', async () => {
    const createRes = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${tokenOfficer}`)
      .send({
        policyId: policy1._id.toString(),
        plateNumber: 'ABC-123',
        incidentType: 'COLLISION',
        incidentLocation: 'King Abdullah St, Amman',
        incidentDate: '2026-06-15',
      });

    expect(createRes.statusCode).toBe(201);
    const createdClaimId = createRes.body.data.id;

    // Verify persisted directly in MongoDB
    const claimDoc = await Claim.findById(createdClaimId).lean();
    expect(claimDoc.incidentDate).toBe('2026-06-15');

    // Verify returned by GET /claims/:claimId
    const getRes = await request(app)
      .get(`/api/v1/claims/${createdClaimId}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(getRes.statusCode).toBe(200);
    expect(getRes.body.data.incidentDate).toBe('2026-06-15');
  });

  it('POST /api/v1/claims returns 400 VALIDATION_ERROR when incidentDate is omitted', async () => {
    const createRes = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${tokenOfficer}`)
      .send({
        policyId: policy1._id.toString(),
        plateNumber: 'ABC-123',
        incidentType: 'COLLISION',
        incidentLocation: 'King Abdullah St, Amman',
      });

    expect(createRes.statusCode).toBe(400);
    expect(createRes.body.success).toBe(false);
    expect(createRes.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('GET /api/v1/claims/:claimId safely returns incidentDate as null on legacy claims without incidentDate', async () => {
    // newClaim was created via Claim.create without incidentDate field
    const res = await request(app)
      .get(`/api/v1/claims/${newClaim._id}`)
      .set('Authorization', `Bearer ${tokenOfficer}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.incidentDate).toBeNull();
  });

  // ─── SLA-01: Stage Timing, Status History, and Due Time Tests ───
  describe('SLA-01 Stage Timing and Status History', () => {
    it('GET /api/v1/claims/:claimId returns statusEnteredAt, statusDueAt, and statusHistory via real transitions', async () => {
      // 1. Create -> NEW
      const createRes = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${tokenOfficer}`)
        .send({
          policyId: policy1._id.toString(),
          plateNumber: 'ABC-123',
          incidentType: 'COLLISION',
          incidentLocation: 'Street A',
          incidentDate: '2026-06-15',
        });
      expect(createRes.status).toBe(201);
      const claimId = createRes.body.data.id;

      // 2. Assign -> PENDING_ACCEPTANCE
      const assignRes = await request(app)
        .post(`/api/v1/claims/${claimId}/assign`)
        .set('Authorization', `Bearer ${tokenOfficer}`)
        .send({ adjusterId: adjuster1._id.toString() });
      expect(assignRes.status).toBe(200);

      // 3. Accept -> ASSIGNED
      const acceptRes = await request(app)
        .post(`/api/v1/claims/${claimId}/accept-assignment`)
        .set('Authorization', `Bearer ${tokenAdjuster}`)
        .send({});
      expect(acceptRes.status).toBe(200);

      // 4. Start inspection -> IN_PROGRESS
      const startRes = await request(app)
        .post(`/api/v1/claims/${claimId}/inspection/start`)
        .set('Authorization', `Bearer ${tokenAdjuster}`);
      expect(startRes.status).toBe(200);

      // Detail fetch
      const getRes = await request(app)
        .get(`/api/v1/claims/${claimId}`)
        .set('Authorization', `Bearer ${tokenOfficer}`);
      expect(getRes.status).toBe(200);
      const data = getRes.body.data;

      expect(data.status).toBe('IN_PROGRESS');
      expect(data.statusEnteredAt).toBeDefined();
      expect(data.statusDueAt).toBeDefined();
      expect(Array.isArray(data.statusHistory)).toBe(true);
      expect(data.statusHistory.length).toBe(4);

      expect(data.statusHistory.map((h) => h.status)).toEqual([
        'NEW',
        'PENDING_ACCEPTANCE',
        'ASSIGNED',
        'IN_PROGRESS',
      ]);
      expect(data.statusHistory[0].action).toBe('Claim Created');
      expect(data.statusHistory[3].action).toBe('Inspection Started');
      expect(data.statusHistory[3].enteredAt).toBe(data.statusEnteredAt);
      expect(data.statusHistory[3].exitedAt).toBeNull();

      // IN_PROGRESS default threshold is 48 hours
      const enteredTime = new Date(data.statusEnteredAt).getTime();
      const expectedDue = new Date(enteredTime + 48 * 3600 * 1000).toISOString();
      expect(new Date(data.statusDueAt).toISOString()).toBe(expectedDue);
    });

    it('GET /api/v1/claims list items return statusEnteredAt and statusDueAt matching detail values', async () => {
      // Create a claim
      const createRes = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${tokenOfficer}`)
        .send({
          policyId: policy1._id.toString(),
          plateNumber: 'ABC-123',
          incidentType: 'COLLISION',
          incidentLocation: 'Street A',
          incidentDate: '2026-06-15',
        });
      const claimId = createRes.body.data.id;

      const [listRes, detailRes] = await Promise.all([
        request(app).get('/api/v1/claims').set('Authorization', `Bearer ${tokenOfficer}`),
        request(app).get(`/api/v1/claims/${claimId}`).set('Authorization', `Bearer ${tokenOfficer}`),
      ]);

      expect(listRes.status).toBe(200);
      expect(detailRes.status).toBe(200);

      const listItem = listRes.body.data.find((c) => c.id === claimId);
      expect(listItem).toBeDefined();
      expect(listItem.statusEnteredAt).toBe(detailRes.body.data.statusEnteredAt);
      expect(listItem.statusDueAt).toBe(detailRes.body.data.statusDueAt);

      // Verify list does NOT include timeline or statusHistory
      expect(listItem.timeline).toBeUndefined();
      expect(listItem.statusHistory).toBeUndefined();
      expect('timeline' in listItem).toBe(false);
      expect('statusHistory' in listItem).toBe(false);
    });

    it('correction loop driven through real endpoints asserts statusHistory order and second Review Started timestamp', async () => {
      // 1. Create -> NEW
      const createRes = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${tokenOfficer}`)
        .send({
          policyId: policy1._id.toString(),
          plateNumber: 'ABC-123',
          incidentType: 'COLLISION',
          incidentLocation: 'Street A',
          incidentDate: '2026-06-15',
        });
      expect(createRes.status).toBe(201);
      const claimId = createRes.body.data.id;

      // 2. Assign -> PENDING_ACCEPTANCE
      const assignRes = await request(app)
        .post(`/api/v1/claims/${claimId}/assign`)
        .set('Authorization', `Bearer ${tokenOfficer}`)
        .send({ adjusterId: adjuster1._id.toString() });
      expect(assignRes.status).toBe(200);

      // 3. Accept -> ASSIGNED
      const acceptRes = await request(app)
        .post(`/api/v1/claims/${claimId}/accept-assignment`)
        .set('Authorization', `Bearer ${tokenAdjuster}`)
        .send({});
      expect(acceptRes.status).toBe(200);

      // 4. Start inspection -> IN_PROGRESS
      const startRes = await request(app)
        .post(`/api/v1/claims/${claimId}/inspection/start`)
        .set('Authorization', `Bearer ${tokenAdjuster}`);
      expect(startRes.status).toBe(200);

      // 5. Fill vehicle, accident, location, evidence, signature for inspection completeness
      const vehicleRes = await request(app)
        .put(`/api/v1/claims/${claimId}/vehicle`)
        .set('Authorization', `Bearer ${tokenAdjuster}`)
        .send({
          vehicleId: vehicle1._id,
          policyId: policy1._id,
          customerId: customer1._id,
          plateNumber: 'ABC-123',
        });
      expect(vehicleRes.status).toBe(200);

      const accidentRes = await request(app)
        .put(`/api/v1/claims/${claimId}/accident`)
        .set('Authorization', `Bearer ${tokenAdjuster}`)
        .send({
          accidentType: 'COLLISION',
          accidentDate: '2026-06-15',
          accidentTime: '10:00',
          description: 'Accident description',
          damageDescription: 'Damage description',
        });
      expect(accidentRes.status).toBe(200);

      const locationRes = await request(app)
        .put(`/api/v1/claims/${claimId}/location`)
        .set('Authorization', `Bearer ${tokenAdjuster}`)
        .send({
          latitude: 31.9,
          longitude: 35.2,
          address: 'Ramallah',
          capturedAt: new Date().toISOString(),
        });
      expect(locationRes.status).toBe(200);

      await Claim.findByIdAndUpdate(claimId, {
        evidence: [
          {
            imageType: 'DAMAGE_CLOSEUP',
            url: 'https://res.cloudinary.com/test/photo.jpg',
            publicId: 'pid1',
            uploadedBy: adjuster1._id,
          },
        ],
        signature: {
          url: 'https://res.cloudinary.com/test/sig.png',
          publicId: 'sig1',
          capturedBy: adjuster1._id,
          capturedAt: new Date(),
        },
      });

      // 6. Submit inspection -> SUBMITTED
      const submitRes = await request(app)
        .post(`/api/v1/claims/${claimId}/inspection/submit`)
        .set('Authorization', `Bearer ${tokenAdjuster}`);
      expect(submitRes.status).toBe(200);

      // 7. Start review 1 -> UNDER_REVIEW
      const review1Res = await request(app)
        .post(`/api/v1/claims/${claimId}/review/start`)
        .set('Authorization', `Bearer ${tokenOfficer}`);
      expect(review1Res.status).toBe(200);

      // 8. Request correction -> CORRECTION_REQUIRED
      const correctionRes = await request(app)
        .post(`/api/v1/claims/${claimId}/review/request-correction`)
        .set('Authorization', `Bearer ${tokenOfficer}`)
        .send({ notes: 'Please inspect undercarriage' });
      expect(correctionRes.status).toBe(200);

      // 9. Resume inspection (start again) -> IN_PROGRESS
      const resumeRes = await request(app)
        .post(`/api/v1/claims/${claimId}/inspection/start`)
        .set('Authorization', `Bearer ${tokenAdjuster}`);
      expect(resumeRes.status).toBe(200);

      // 10. Resubmit inspection -> SUBMITTED
      const resubmitRes = await request(app)
        .post(`/api/v1/claims/${claimId}/inspection/submit`)
        .set('Authorization', `Bearer ${tokenAdjuster}`);
      expect(resubmitRes.status).toBe(200);

      // 11. Start review 2 -> UNDER_REVIEW
      const review2Res = await request(app)
        .post(`/api/v1/claims/${claimId}/review/start`)
        .set('Authorization', `Bearer ${tokenOfficer}`);
      expect(review2Res.status).toBe(200);

      // Detail fetch
      const getRes = await request(app)
        .get(`/api/v1/claims/${claimId}`)
        .set('Authorization', `Bearer ${tokenOfficer}`);

      expect(getRes.status).toBe(200);
      const data = getRes.body.data;
      expect(data.status).toBe('UNDER_REVIEW');

      // Assert statusHistory statuses in order (10 entries)
      expect(data.statusHistory.map((h) => h.status)).toEqual([
        'NEW',
        'PENDING_ACCEPTANCE',
        'ASSIGNED',
        'IN_PROGRESS',
        'SUBMITTED',
        'UNDER_REVIEW',
        'CORRECTION_REQUIRED',
        'IN_PROGRESS',
        'SUBMITTED',
        'UNDER_REVIEW',
      ]);

      const secondReviewEntry = data.statusHistory[9];
      expect(secondReviewEntry.action).toBe('Review Started');
      expect(secondReviewEntry.exitedAt).toBeNull();
      expect(data.statusEnteredAt).toBe(secondReviewEntry.enteredAt);

      // UNDER_REVIEW threshold is 120 hours
      const expectedDue = new Date(new Date(secondReviewEntry.enteredAt).getTime() + 120 * 3600 * 1000).toISOString();
      expect(new Date(data.statusDueAt).toISOString()).toBe(expectedDue);
    });
  });
});

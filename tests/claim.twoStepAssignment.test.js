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
const { buildPolicy } = require('./helpers/policyFactory');
jest.mock('../src/modules/notifications/notification.service', () => ({
  createAndSendNotification: jest.fn().mockResolvedValue({}),
}));

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

describe('Two-Step Assignment Flow', () => {
  let org1, org2;
  let officer1;
  let adjusterA, adjusterB;

  beforeEach(async () => {
    org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1' });
    global.__testPol = await buildPolicy({ policyNumber: 'POL-FIX-001', status: 'ACTIVE', startDate: new Date('2026-01-01'), expiryDate: new Date('2027-12-31'), organizationId: org1._id });
    org2 = await Organization.create({ name: 'Org 2', code: 'ORG-2' });

    officer1 = await User.create({
      name: 'Officer 1',
      employeeCode: 'OFF-01',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    adjusterA = await User.create({
      name: 'Adjuster A',
      employeeCode: 'ADJ-A',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    adjusterB = await User.create({
      name: 'Adjuster B',
      employeeCode: 'ADJ-B',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
  });

  const createNewClaim = async (customFields = {}) => {
    return await Claim.create({
      organizationId: org1._id,
      policyId: global.__testPol._id,
      createdBy: officer1._id,
      status: 'NEW',
      customer: { name: 'Customer Test', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah City Center',
      ...customFields,
    });
  };

  it('1. assign should set status to PENDING_ACCEPTANCE (not ASSIGNED)', async () => {
    const claim = await createNewClaim();
    const officerToken = generateToken(officer1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ adjusterId: adjusterA._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Assignment pending acceptance');
    expect(res.body.data.status).toBe('PENDING_ACCEPTANCE');
    expect(res.body.data.assignedTo).toBe(adjusterA._id.toString());

    const dbClaim = await Claim.findById(claim._id);
    expect(dbClaim.status).toBe('PENDING_ACCEPTANCE');
    expect(dbClaim.assignedTo.toString()).toBe(adjusterA._id.toString());
  });

  it('2. PENDING_ACCEPTANCE should NOT count in adjuster activeTasksCount', async () => {
    const officerToken = generateToken(officer1);

    // Create 4 claims and assign all to adjusterA -> PENDING_ACCEPTANCE each
    for (let i = 0; i < 4; i++) {
      const c = await createNewClaim();
      const res = await request(app)
        .post(`/api/v1/claims/${c._id}/assign`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ adjusterId: adjusterA._id.toString() });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PENDING_ACCEPTANCE');
    }

    // Assign a 5th claim without overrideCapacity -> should succeed (200) because pending tasks don't count
    const fifthClaim = await createNewClaim();
    const res5 = await request(app)
      .post(`/api/v1/claims/${fifthClaim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ adjusterId: adjusterA._id.toString() });

    expect(res5.status).toBe(200);
    expect(res5.body.data.status).toBe('PENDING_ACCEPTANCE');
  });

  it('3. accept-assignment from assigned adjuster → 200, status ASSIGNED', async () => {
    const claim = await createNewClaim();
    const officerToken = generateToken(officer1);
    const adjusterAToken = generateToken(adjusterA);

    await request(app)
      .post(`/api/v1/claims/${claim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ adjusterId: adjusterA._id.toString() });

    const acceptRes = await request(app)
      .post(`/api/v1/claims/${claim._id}/accept-assignment`)
      .set('Authorization', `Bearer ${adjusterAToken}`)
      .send({});

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.success).toBe(true);
    expect(acceptRes.body.data.status).toBe('ASSIGNED');

    const dbClaim = await Claim.findById(claim._id);
    expect(dbClaim.status).toBe('ASSIGNED');
    const lastTimeline = dbClaim.timeline[dbClaim.timeline.length - 1];
    expect(lastTimeline.action).toBe('Assignment Accepted');
    expect(lastTimeline.previousStatus).toBe('PENDING_ACCEPTANCE');
    expect(lastTimeline.newStatus).toBe('ASSIGNED');
    expect(lastTimeline.notes).toContain('[ASSIGNMENT ACCEPTED]');
    expect(lastTimeline.notes).toContain('ADJ-A');
  });

  it('4. accept-assignment from wrong adjuster → 404 (stealth tenancy)', async () => {
    const claim = await createNewClaim();
    const officerToken = generateToken(officer1);
    const adjusterBToken = generateToken(adjusterB);

    await request(app)
      .post(`/api/v1/claims/${claim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ adjusterId: adjusterA._id.toString() });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/accept-assignment`)
      .set('Authorization', `Bearer ${adjusterBToken}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('5. accept-assignment on non-PENDING_ACCEPTANCE claim → 409', async () => {
    // Claim is NEW and not in PENDING_ACCEPTANCE
    const claim = await createNewClaim({ assignedTo: adjusterA._id });
    const adjusterAToken = generateToken(adjusterA);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/accept-assignment`)
      .set('Authorization', `Bearer ${adjusterAToken}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('6. decline-assignment from assigned adjuster → 200, status NEW', async () => {
    const claim = await createNewClaim();
    const officerToken = generateToken(officer1);
    const adjusterAToken = generateToken(adjusterA);

    await request(app)
      .post(`/api/v1/claims/${claim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ adjusterId: adjusterA._id.toString() });

    const declineRes = await request(app)
      .post(`/api/v1/claims/${claim._id}/decline-assignment`)
      .set('Authorization', `Bearer ${adjusterAToken}`)
      .send({ reason: 'busy with another emergency inspection' });

    expect(declineRes.status).toBe(200);
    expect(declineRes.body.success).toBe(true);
    expect(declineRes.body.data.status).toBe('NEW');
    expect(declineRes.body.data.assignedTo).toBeNull();

    const dbClaim = await Claim.findById(claim._id);
    expect(dbClaim.status).toBe('NEW');
    expect(dbClaim.assignedTo).toBeNull();
    const lastTimeline = dbClaim.timeline[dbClaim.timeline.length - 1];
    expect(lastTimeline.action).toBe('Assignment Declined');
    expect(lastTimeline.previousStatus).toBe('PENDING_ACCEPTANCE');
    expect(lastTimeline.newStatus).toBe('NEW');
    expect(lastTimeline.notes).toContain('[ASSIGNMENT DECLINED]');
    expect(lastTimeline.notes).toContain('ADJ-A');
  });

  it('7. decline-assignment from wrong adjuster → 404 (stealth tenancy)', async () => {
    const claim = await createNewClaim();
    const officerToken = generateToken(officer1);
    const adjusterBToken = generateToken(adjusterB);

    await request(app)
      .post(`/api/v1/claims/${claim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ adjusterId: adjusterA._id.toString() });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/decline-assignment`)
      .set('Authorization', `Bearer ${adjusterBToken}`)
      .send({ reason: 'Not my territory' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('8. decline-assignment without reason → 400', async () => {
    const claim = await createNewClaim();
    const officerToken = generateToken(officer1);
    const adjusterAToken = generateToken(adjusterA);

    await request(app)
      .post(`/api/v1/claims/${claim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ adjusterId: adjusterA._id.toString() });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/decline-assignment`)
      .set('Authorization', `Bearer ${adjusterAToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('9. decline-assignment with reason > 300 chars → 400', async () => {
    const claim = await createNewClaim();
    const officerToken = generateToken(officer1);
    const adjusterAToken = generateToken(adjusterA);

    await request(app)
      .post(`/api/v1/claims/${claim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ adjusterId: adjusterA._id.toString() });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/decline-assignment`)
      .set('Authorization', `Bearer ${adjusterAToken}`)
      .send({ reason: 'x'.repeat(301) });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('10. after decline, claim is re-assignable (NEW)', async () => {
    const claim = await createNewClaim();
    const officerToken = generateToken(officer1);
    const adjusterAToken = generateToken(adjusterA);

    // 1. Assign to adjusterA -> PENDING_ACCEPTANCE
    await request(app)
      .post(`/api/v1/claims/${claim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ adjusterId: adjusterA._id.toString() });

    // 2. AdjusterA declines -> NEW
    await request(app)
      .post(`/api/v1/claims/${claim._id}/decline-assignment`)
      .set('Authorization', `Bearer ${adjusterAToken}`)
      .send({ reason: 'Unavailable today' });

    // 3. Re-assign to adjusterB -> PENDING_ACCEPTANCE
    const reassignRes = await request(app)
      .post(`/api/v1/claims/${claim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ adjusterId: adjusterB._id.toString() });

    expect(reassignRes.status).toBe(200);
    expect(reassignRes.body.data.status).toBe('PENDING_ACCEPTANCE');
    expect(reassignRes.body.data.assignedTo).toBe(adjusterB._id.toString());
  });

  it('11. overrideCapacity works with two-step flow', async () => {
    const officerToken = generateToken(officer1);

    // Create 4 accepted claims for adjusterA (status: ASSIGNED)
    for (let i = 0; i < 4; i++) {
      await Claim.create({
        organizationId: org1._id,
      policyId: global.__testPol._id,
        createdBy: officer1._id,
        assignedTo: adjusterA._id,
        assignedBy: officer1._id,
        assignedAt: new Date(),
        status: 'ASSIGNED',
        customer: { name: `Customer ${i}`, phone: '0599111111' },
        incidentType: 'COLLISION',
        incidentLocation: 'Location',
      });
    }

    const fifthClaim = await createNewClaim();

    // Assign without override -> 409
    const resNoOverride = await request(app)
      .post(`/api/v1/claims/${fifthClaim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ adjusterId: adjusterA._id.toString() });

    expect(resNoOverride.status).toBe(409);
    expect(resNoOverride.body.errors[0].code).toBe('ADJUSTER_UNAVAILABLE');

    // Assign with override -> 200
    const resOverride = await request(app)
      .post(`/api/v1/claims/${fifthClaim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ adjusterId: adjusterA._id.toString(), overrideCapacity: true });

    expect(resOverride.status).toBe(200);
    expect(resOverride.body.data.status).toBe('PENDING_ACCEPTANCE');

    const dbClaim = await Claim.findById(fifthClaim._id);
    const assignTimeline = dbClaim.timeline.find((t) => t.action === 'Assignment Pending Acceptance');
    expect(assignTimeline).toBeDefined();
    expect(assignTimeline.notes).toContain('[CAPACITY OVERRIDE]');
  });

  it('12. GET /claims?status=NEW returns incidentCoordinates', async () => {
    const officerToken = generateToken(officer1);

    // Create claim with coordinates
    await createNewClaim({
      incidentCoordinates: { latitude: 31.9038, longitude: 35.2034, capturedAt: new Date() },
    });

    // Create claim without coordinates
    await createNewClaim({ incidentCoordinates: null });

    const res = await request(app)
      .get('/api/v1/claims?status=NEW')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);

    const withCoords = res.body.data.find((c) => c.incidentCoordinates !== null);
    const withoutCoords = res.body.data.find((c) => c.incidentCoordinates === null);

    expect(withCoords).toBeDefined();
    expect(withCoords.incidentCoordinates.latitude).toBe(31.9038);
    expect(withCoords.incidentCoordinates.longitude).toBe(35.2034);

    expect(withoutCoords).toBeDefined();
    expect(withoutCoords.incidentCoordinates).toBeNull();
  });

  it('13. GET /claims?status=PENDING_ACCEPTANCE returns correct claims', async () => {
    const officerToken = generateToken(officer1);
    const claim = await createNewClaim();

    // Assign claim -> PENDING_ACCEPTANCE
    await request(app)
      .post(`/api/v1/claims/${claim._id}/assign`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ adjusterId: adjusterA._id.toString() });

    const res = await request(app)
      .get('/api/v1/claims?status=PENDING_ACCEPTANCE')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe(claim._id.toString());
    expect(res.body.data[0].status).toBe('PENDING_ACCEPTANCE');
  });
});

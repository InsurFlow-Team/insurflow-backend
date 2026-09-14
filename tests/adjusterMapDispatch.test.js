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

describe('Feature 18: Map-Based Adjuster Dispatch & Location Tracking', () => {
  let org1, org2;
  let officer1, adjuster1, adjuster2, adjuster3, otherOrgAdjuster;
  let officerToken, adjuster1Token;

  beforeEach(async () => {
    org1 = await Organization.create({ name: 'Alpha Insurance', code: 'ALPHA' });
    org2 = await Organization.create({ name: 'Beta Insurance', code: 'BETA' });

    officer1 = await User.create({
      name: 'Claims Officer One',
      employeeCode: 'CO-01',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    officerToken = generateToken(officer1);

    // Adjuster 1: In Ramallah (31.9038, 35.2034)
    adjuster1 = await User.create({
      name: 'Adjuster Ramallah',
      employeeCode: 'FA-01',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      location: {
        latitude: 31.9038,
        longitude: 35.2034,
        updatedAt: new Date(),
      },
    });
    adjuster1Token = generateToken(adjuster1);

    // Adjuster 2: In Jerusalem (31.7683, 35.2137)
    adjuster2 = await User.create({
      name: 'Adjuster Jerusalem',
      employeeCode: 'FA-02',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      location: {
        latitude: 31.7683,
        longitude: 35.2137,
        updatedAt: new Date(),
      },
    });

    // Adjuster 3: No location reported yet
    adjuster3 = await User.create({
      name: 'Adjuster Unknown Location',
      employeeCode: 'FA-03',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    // Adjuster in Org 2
    otherOrgAdjuster = await User.create({
      name: 'Beta Adjuster',
      employeeCode: 'FA-B1',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org2._id,
      status: 'ACTIVE',
      location: {
        latitude: 31.9038,
        longitude: 35.2034,
        updatedAt: new Date(),
      },
    });
  });

  describe('Adjuster Location Capture via HTTP Headers', () => {
    it('updates stored location on a FIELD_ADJUSTER request carrying valid X-Latitude and X-Longitude headers while the primary request succeeds', async () => {
      // Unassigned claim for org1
      await Claim.create({
        organizationId: org1._id,
        createdBy: officer1._id,
        status: 'ASSIGNED',
        assignedTo: adjuster1._id,
        customer: { name: 'Customer A', phone: '123' },
        incidentType: 'COLLISION',
        incidentLocation: 'Ramallah City Center',
        incidentCoordinates: { latitude: 31.9, longitude: 35.2, capturedAt: new Date() },
      });

      const res = await request(app)
        .get('/api/v1/claims')
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .set('X-Latitude', '32.0000')
        .set('X-Longitude', '35.3000');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updatedUser = await User.findById(adjuster1._id);
      expect(updatedUser.location.latitude).toBe(32.0000);
      expect(updatedUser.location.longitude).toBe(35.3000);
      expect(updatedUser.location.updatedAt).toBeInstanceOf(Date);
    });

    it('succeeds normally and does not update location when headers are malformed or out-of-range', async () => {
      // Out-of-range latitude: 95.0
      const res = await request(app)
        .get('/api/v1/claims')
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .set('X-Latitude', '95.0000')
        .set('X-Longitude', '35.3000');

      expect(res.status).toBe(200);

      const userAfterInvalid = await User.findById(adjuster1._id);
      // Keeps original location from beforeEach
      expect(userAfterInvalid.location.latitude).toBe(31.9038);
      expect(userAfterInvalid.location.longitude).toBe(35.2034);

      // Malformed string header
      const res2 = await request(app)
        .get('/api/v1/claims')
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .set('X-Latitude', 'not-a-number')
        .set('X-Longitude', '35.3000');

      expect(res2.status).toBe(200);

      const userAfterNaN = await User.findById(adjuster1._id);
      expect(userAfterNaN.location.latitude).toBe(31.9038);
    });

    it('ignores location headers on non-FIELD_ADJUSTER requests without updating location', async () => {
      const res = await request(app)
        .get('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .set('X-Latitude', '32.0000')
        .set('X-Longitude', '35.3000');

      expect(res.status).toBe(200);

      const officerInDb = await User.findById(officer1._id);
      expect(officerInDb.location.latitude).toBeNull();
      expect(officerInDb.location.longitude).toBeNull();
    });
  });

  describe('POST /api/v1/claims — Incident Coordinates at Claim Creation', () => {
    it('populates incidentCoordinates with capturedAt and preserves incidentLocation original text when valid latitude/longitude are provided', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          customerName: 'Ahmad Accident',
          customerPhone: '0599123456',
          initialPlateNumber: '77-888-99',
          incidentType: 'COLLISION',
          incidentLocation: 'Al-Irsal St, Ramallah',
          latitude: 31.9050,
          longitude: 35.2040,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const claimId = res.body.data.id;
      const claimInDb = await Claim.findById(claimId);

      // Verify incidentLocation string preserved
      expect(claimInDb.incidentLocation).toBe('Al-Irsal St, Ramallah');

      // Verify incidentCoordinates populated
      expect(claimInDb.incidentCoordinates).toBeDefined();
      expect(claimInDb.incidentCoordinates.latitude).toBe(31.9050);
      expect(claimInDb.incidentCoordinates.longitude).toBe(35.2040);
      expect(claimInDb.incidentCoordinates.capturedAt).toBeInstanceOf(Date);

      // Existing inspection location must remain untouched with nulls
      expect(claimInDb.location.latitude).toBeNull();
      expect(claimInDb.location.longitude).toBeNull();
      expect(claimInDb.location.address).toBeNull();
    });

    it('preserves incidentLocation original text and leaves incidentCoordinates as null when latitude/longitude are omitted', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          customerName: 'No Coordinates Customer',
          customerPhone: '0599123456',
          initialPlateNumber: '11-222-33',
          incidentType: 'COLLISION',
          incidentLocation: 'Unknown Street 123',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const claimInDb = await Claim.findById(res.body.data.id);
      expect(claimInDb.incidentLocation).toBe('Unknown Street 123');
      expect(claimInDb.incidentCoordinates).toBeNull();
      expect(claimInDb.location.latitude).toBeNull();
      expect(claimInDb.location.longitude).toBeNull();
    });
  });

  describe('GET /api/v1/users/adjusters — Proximity and Distance Calculation', () => {
    it('calculates Haversine distance and sorts adjusters ascending by distanceKm using direct latitude/longitude query params', async () => {
      // Query point near Ramallah: (31.9030, 35.2020)
      const res = await request(app)
        .get('/api/v1/users/adjusters?latitude=31.9030&longitude=35.2020')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const adjusters = res.body.data;

      expect(adjusters.length).toBe(3);

      // Adjuster 1 (Ramallah) is very close (~0.16 km)
      expect(adjusters[0].name).toBe('Adjuster Ramallah');
      expect(adjusters[0].distanceKm).toBeLessThan(1);
      expect(adjusters[0].availability).toBe('AVAILABLE');

      // Adjuster 2 (Jerusalem) is further away (~15 km)
      expect(adjusters[1].name).toBe('Adjuster Jerusalem');
      expect(adjusters[1].distanceKm).toBeGreaterThan(10);

      // Adjuster 3 has no location data -> sorted last with distanceKm: null
      expect(adjusters[2].name).toBe('Adjuster Unknown Location');
      expect(adjusters[2].distanceKm).toBeNull();
    });

    it('calculates distance based on claimId incidentCoordinates and sorts adjusters accordingly', async () => {
      const claim = await Claim.create({
        organizationId: org1._id,
        createdBy: officer1._id,
        status: 'NEW',
        customer: { name: 'Customer Test', phone: '123' },
        incidentType: 'COLLISION',
        incidentLocation: 'Al-Irsal St, Ramallah',
        incidentCoordinates: {
          latitude: 31.9040,
          longitude: 35.2030,
          capturedAt: new Date(),
        },
      });

      const res = await request(app)
        .get(`/api/v1/users/adjusters?claimId=${claim._id}`)
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(200);
      const adjusters = res.body.data;

      expect(adjusters[0].name).toBe('Adjuster Ramallah');
      expect(adjusters[0].distanceKm).toBeLessThan(1);
      expect(adjusters[2].name).toBe('Adjuster Unknown Location');
      expect(adjusters[2].distanceKm).toBeNull();
    });

    it('returns adjusters with distanceKm: null unsorted by distance when neither coordinates nor claimId are provided', async () => {
      const res = await request(app)
        .get('/api/v1/users/adjusters')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(200);
      const adjusters = res.body.data;
      expect(adjusters.length).toBe(3);
      adjusters.forEach((adj) => {
        expect(adj.distanceKm).toBeNull();
      });
    });

    it('returns 404 CLAIM_NOT_FOUND when querying adjusters with a claimId belonging to another organization (multi-tenancy guard)', async () => {
      const betaClaim = await Claim.create({
        organizationId: org2._id,
        createdBy: otherOrgAdjuster._id,
        status: 'NEW',
        customer: { name: 'Beta Customer', phone: '999' },
        incidentType: 'COLLISION',
        incidentLocation: 'Al-Quds St, Bethlehem',
        incidentCoordinates: {
          latitude: 31.9040,
          longitude: 35.2030,
          capturedAt: new Date(),
        },
      });

      const res = await request(app)
        .get(`/api/v1/users/adjusters?claimId=${betaClaim._id}`)
        .set('Authorization', `Bearer ${officerToken}`); // Officer is in org1

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
    });
  });

  describe('POST /api/v1/claims/:claimId/assign — Advisory Capacity & Flexible Override', () => {
    let testClaim;

    beforeEach(async () => {
      // Give Adjuster 1 four active tasks (capacity limit is 3)
      for (let i = 1; i <= 4; i++) {
        await Claim.create({
          organizationId: org1._id,
          createdBy: officer1._id,
          status: 'ASSIGNED',
          assignedTo: adjuster1._id,
          customer: { name: `Active Claim ${i}`, phone: '123' },
          incidentType: 'COLLISION',
          incidentLocation: `Active Incident Location ${i}`,
          incidentCoordinates: { latitude: 31.9, longitude: 35.2, capturedAt: new Date() },
        });
      }

      // Create target claim in NEW status
      testClaim = await Claim.create({
        organizationId: org1._id,
        createdBy: officer1._id,
        status: 'NEW',
        customer: { name: 'Target Claim', phone: '123' },
        incidentType: 'COLLISION',
        incidentLocation: 'Target Incident Location',
      });
    });

    it('blocks assignment to an over-capacity adjuster with 409 ADJUSTER_UNAVAILABLE when overrideCapacity is absent or false', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${testClaim._id}/assign`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          adjusterId: adjuster1._id.toString(),
          priority: 'HIGH',
          notes: 'Standard assign attempt',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('ADJUSTER_UNAVAILABLE');

      // Claim status must remain NEW
      const claimAfter = await Claim.findById(testClaim._id);
      expect(claimAfter.status).toBe('NEW');
    });

    it('successfully assigns an over-capacity adjuster when overrideCapacity is true, recording [CAPACITY OVERRIDE] in timeline notes', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${testClaim._id}/assign`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          adjusterId: adjuster1._id.toString(),
          priority: 'HIGH',
          notes: 'Urgent nearest adjuster needed',
          overrideCapacity: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ASSIGNED');

      const claimAfter = await Claim.findById(testClaim._id);
      expect(claimAfter.status).toBe('ASSIGNED');
      expect(claimAfter.assignedTo.toString()).toBe(adjuster1._id.toString());

      // Check timeline audit trail for the override note
      const assignedTimelineEvent = claimAfter.timeline.find((t) => t.action === 'Claim Assigned');
      expect(assignedTimelineEvent).toBeDefined();
      expect(assignedTimelineEvent.notes).toContain('[CAPACITY OVERRIDE] Assigned while adjuster had 4 active tasks (max: 3)');
      expect(assignedTimelineEvent.notes).toContain('Urgent nearest adjuster needed');
    });
  });
});

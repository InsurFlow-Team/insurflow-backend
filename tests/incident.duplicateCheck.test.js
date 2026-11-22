const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Incident = require('../src/modules/incidents/incident.model');
const Claim = require('../src/modules/claims/claim.model');
const config = require('../src/config/env');
const incidentRepository = require('../src/modules/incidents/incident.repository');

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

describe('DC-01 Incident Duplicate Check', () => {
  let mongoServer;
  let org, officer, officerToken, admin, adminToken, adjuster, adjusterToken;
  let otherOrg, otherOfficer, otherOfficerToken;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    await Incident.init();
    await Claim.init();
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
  };

  const createIncidentHelper = async (overrides = {}) => {
    return await Incident.create({
      organizationId: org._id,
      incidentDate: '2026-11-22',
      incidentAt: new Date('2026-11-22T10:00:00+02:00'),
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah City Center',
      incidentCoordinates: { latitude: 31.9038, longitude: 35.2034, capturedAt: new Date() },
      governorate: 'RAMALLAH_AL_BIREH',
      createdBy: officer._id,
      vehicles: [
        {
          vehicleRole: 'INSURED',
          plateRegion: 'PALESTINIAN',
          plateNumber: '1-1000-H',
        },
      ],
      ...overrides,
    });
  };

  // ─── T01: same plate 23h before and 23h after: matched, EXACT ────────────────
  it('T01: matches same plate at 23h before and 23h after as EXACT', async () => {
    await setupBaseFixture();
    const reqTime = '2026-11-22T10:00:00+02:00';
    const before23h = new Date(new Date(reqTime).getTime() - 23 * 60 * 60 * 1000);
    const after23h = new Date(new Date(reqTime).getTime() + 23 * 60 * 60 * 1000);

    const incBefore = await createIncidentHelper({
      incidentAt: before23h,
      incidentDate: '2026-11-21',
    });
    const incAfter = await createIncidentHelper({
      incidentAt: after23h,
      incidentDate: '2026-11-23',
    });

    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: reqTime,
        plateNumbers: ['1-1000-H'],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.matches.length).toBe(2);
    const ids = res.body.data.matches.map((m) => m.incidentId);
    expect(ids).toContain(incBefore._id.toString());
    expect(ids).toContain(incAfter._id.toString());
    expect(res.body.data.matches[0].timeBasis).toBe('EXACT');
    expect(res.body.data.matches[1].timeBasis).toBe('EXACT');
  });

  // ─── T02: same plate 25h away: not matched ───────────────────────────────────
  it('T02: excludes same plate at 25h away (both before and after)', async () => {
    await setupBaseFixture();
    const reqTime = '2026-11-22T10:00:00+02:00';
    const before25h = new Date(new Date(reqTime).getTime() - 25 * 60 * 60 * 1000);
    const after25h = new Date(new Date(reqTime).getTime() + 25 * 60 * 60 * 1000);

    await createIncidentHelper({ incidentAt: before25h, incidentDate: '2026-11-21' });
    await createIncidentHelper({ incidentAt: after25h, incidentDate: '2026-11-23' });

    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: reqTime,
        plateNumbers: ['1-1000-H'],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.matches).toEqual([]);
    expect(res.body.data.truncated).toBe(false);
  });

  // ─── T03: exactly 24h boundary: matched ──────────────────────────────────────
  it('T03: matches same plate at exactly 24h boundary (inclusive)', async () => {
    await setupBaseFixture();
    const reqTime = '2026-11-22T10:00:00+02:00';
    const exactMinus24h = new Date(new Date(reqTime).getTime() - 24 * 60 * 60 * 1000);
    const exactPlus24h = new Date(new Date(reqTime).getTime() + 24 * 60 * 60 * 1000);

    const incMinus = await createIncidentHelper({ incidentAt: exactMinus24h, incidentDate: '2026-11-21' });
    const incPlus = await createIncidentHelper({ incidentAt: exactPlus24h, incidentDate: '2026-11-23' });

    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: reqTime,
        plateNumbers: ['1-1000-H'],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.matches.length).toBe(2);
    const ids = res.body.data.matches.map((m) => m.incidentId);
    expect(ids).toContain(incMinus._id.toString());
    expect(ids).toContain(incPlus._id.toString());
  });

  // ─── T04: different plate only: not matched ──────────────────────────────────
  it('T04: returns empty matches when plates are different', async () => {
    await setupBaseFixture();
    await createIncidentHelper({
      vehicles: [
        {
          vehicleRole: 'INSURED',
          plateRegion: 'PALESTINIAN',
          plateNumber: '9-9999-Z',
        },
      ],
    });

    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H'],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.matches).toEqual([]);
  });

  // ─── T05: one shared plate of two: matched with only that plate in matchedPlates
  it('T05: returns only the shared plate in matchedPlates when multiple plates exist', async () => {
    await setupBaseFixture();
    const inc = await createIncidentHelper({
      vehicles: [
        {
          vehicleRole: 'INSURED',
          plateRegion: 'PALESTINIAN',
          plateNumber: '1-1000-H',
        },
        {
          vehicleRole: 'OTHER',
          plateRegion: 'PALESTINIAN',
          plateNumber: '2-2000-B',
        },
      ],
    });

    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H', '3-3000-C'],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.matches.length).toBe(1);
    expect(res.body.data.matches[0].incidentId).toBe(inc._id.toString());
    expect(res.body.data.matches[0].matchedPlates).toEqual([
      { plateNumber: '1-1000-H', vehicleRole: 'INSURED' },
    ]);
  });

  // ─── T06: shared plate on a THIRD_PARTY vehicle ──────────────────────────────
  it('T06: matches plate on THIRD_PARTY vehicle with vehicleRole THIRD_PARTY', async () => {
    await setupBaseFixture();
    const inc = await createIncidentHelper({
      vehicles: [
        {
          vehicleRole: 'THIRD_PARTY',
          plateRegion: 'PALESTINIAN',
          plateNumber: '1-1000-H',
        },
      ],
    });

    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H'],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.matches.length).toBe(1);
    expect(res.body.data.matches[0].matchedPlates).toEqual([
      { plateNumber: '1-1000-H', vehicleRole: 'THIRD_PARTY' },
    ]);
  });

  // ─── T07: DATE_ONLY candidate inside Hebron day set ──────────────────────────
  it('T07: matches DATE_ONLY incident (incidentAt null) inside Hebron day set with timeBasis DATE_ONLY', async () => {
    await setupBaseFixture();
    const inc = await createIncidentHelper({
      incidentAt: null,
      incidentDate: '2026-11-22',
    });

    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H'],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.matches.length).toBe(1);
    expect(res.body.data.matches[0].incidentId).toBe(inc._id.toString());
    expect(res.body.data.matches[0].incidentAt).toBeNull();
    expect(res.body.data.matches[0].incidentDate).toBe('2026-11-22');
    expect(res.body.data.matches[0].timeBasis).toBe('DATE_ONLY');
  });

  // ─── T08: DATE_ONLY candidate outside Hebron day set ─────────────────────────
  it('T08: excludes DATE_ONLY incident outside Hebron day set', async () => {
    await setupBaseFixture();
    await createIncidentHelper({
      incidentAt: null,
      incidentDate: '2026-11-20', // Outside [2026-11-21, 2026-11-22, 2026-11-23]
    });

    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H'],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.matches).toEqual([]);
  });

  // ─── T09: request near midnight Asia/Hebron covers both dates ────────────────
  it('T09: matches DATE_ONLY incidents across both dates when request is near midnight Asia/Hebron', async () => {
    await setupBaseFixture();
    // 2026-11-22T23:30:00+02:00 is late night Hebron.
    // Window: 2026-11-21T23:30:00+02:00 to 2026-11-23T23:30:00+02:00.
    // Days covered: 2026-11-21, 2026-11-22, 2026-11-23.
    const incDay1 = await createIncidentHelper({ incidentAt: null, incidentDate: '2026-11-21' });
    const incDay2 = await createIncidentHelper({ incidentAt: null, incidentDate: '2026-11-22' });
    const incDay3 = await createIncidentHelper({ incidentAt: null, incidentDate: '2026-11-23' });

    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T23:30:00+02:00',
        plateNumbers: ['1-1000-H'],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.matches.length).toBe(3);
    const dates = res.body.data.matches.map((m) => m.incidentDate);
    expect(dates).toContain('2026-11-21');
    expect(dates).toContain('2026-11-22');
    expect(dates).toContain('2026-11-23');
  });

  // ─── T10: legacy incident with no vehicles: never matched ────────────────────
  it('T10: never matches legacy incident with empty vehicles array on the same day', async () => {
    await setupBaseFixture();
    await createIncidentHelper({
      vehicles: [],
      incidentAt: null,
      incidentDate: '2026-11-22',
    });

    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H'],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.matches).toEqual([]);
  });

  // ─── T11: tenancy isolation ──────────────────────────────────────────────────
  it('T11: strictly enforces tenancy: incident of another organization is not matched', async () => {
    await setupBaseFixture();
    await createIncidentHelper({
      organizationId: otherOrg._id,
      createdBy: otherOfficer._id,
      incidentAt: new Date('2026-11-22T10:00:00+02:00'),
    });

    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H'],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.matches).toEqual([]);
  });

  // ─── T12: excludeIncidentId leaves that incident out ─────────────────────────
  it('T12: excludes incident specified in excludeIncidentId', async () => {
    await setupBaseFixture();
    const inc = await createIncidentHelper();

    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H'],
        excludeIncidentId: inc._id.toString(),
      });

    expect(res.status).toBe(200);
    expect(res.body.data.matches).toEqual([]);
  });

  // ─── T13: distanceKm computation and null fallbacks ──────────────────────────
  it('T13: computes distanceKm when coordinates exist on both sides, returns null when either side lacks them', async () => {
    await setupBaseFixture();
    // Matched with coordinates
    const incWithCoords = await createIncidentHelper({
      incidentCoordinates: { latitude: 31.9038, longitude: 35.2034, capturedAt: new Date() },
    });
    // Matched without coordinates
    const incNoCoords = await createIncidentHelper({
      incidentCoordinates: null,
    });

    // Request with coordinates (e.g. 31.9000, 35.2000)
    const resWithCoords = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H'],
        latitude: 31.9000,
        longitude: 35.2000,
      });

    expect(resWithCoords.status).toBe(200);
    const mWithCoords = resWithCoords.body.data.matches.find(
      (m) => m.incidentId === incWithCoords._id.toString()
    );
    const mNoCoords = resWithCoords.body.data.matches.find(
      (m) => m.incidentId === incNoCoords._id.toString()
    );
    expect(typeof mWithCoords.distanceKm).toBe('number');
    expect(mNoCoords.distanceKm).toBeNull();

    // Request without coordinates
    const resNoCoords = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H'],
      });

    expect(resNoCoords.status).toBe(200);
    expect(resNoCoords.body.data.matches[0].distanceKm).toBeNull();
    expect(resNoCoords.body.data.matches[1].distanceKm).toBeNull();
  });

  // ─── T14: claimsCount counts claims accurately across statuses ───────────────
  it('T14: aggregates claimsCount accurately across all claim statuses for matched incidents', async () => {
    await setupBaseFixture();
    const inc1 = await createIncidentHelper();
    const inc2 = await createIncidentHelper();

    // Add 2 claims to inc1 in various statuses
    await Claim.collection.insertOne({
      organizationId: org._id,
      incidentId: inc1._id,
      incidentNumber: inc1.incidentNumber,
      claimNumber: 'CLM-TST-0001',
      claimType: 'OWN_DAMAGE',
      status: 'UNDER_REVIEW',
      createdBy: officer._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await Claim.collection.insertOne({
      organizationId: org._id,
      incidentId: inc1._id,
      incidentNumber: inc1.incidentNumber,
      claimNumber: 'CLM-TST-0002',
      claimType: 'THIRD_PARTY_PD',
      status: 'CLOSED',
      createdBy: officer._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Add 1 claim to inc1 under OTHER org (should not be counted)
    await Claim.collection.insertOne({
      organizationId: otherOrg._id,
      incidentId: inc1._id,
      claimNumber: 'CLM-OTH-0001',
      claimType: 'OWN_DAMAGE',
      status: 'UNDER_REVIEW',
      createdBy: otherOfficer._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H'],
      });

    expect(res.status).toBe(200);
    const m1 = res.body.data.matches.find((m) => m.incidentId === inc1._id.toString());
    const m2 = res.body.data.matches.find((m) => m.incidentId === inc2._id.toString());
    expect(m1.claimsCount).toBe(2);
    expect(m2.claimsCount).toBe(0);
  });

  // ─── T15: 21 matches capped to 20, truncated true, sorted by time distance ───
  it('T15: limits matches to 20, sets truncated true, and sorts by time distance with EXACT before DATE_ONLY on tie', async () => {
    await setupBaseFixture();
    const baseTime = new Date('2026-11-22T10:00:00+02:00');

    // Create 1 EXACT match on the exact same date & time (distance 0)
    const incExactZero = await createIncidentHelper({
      incidentAt: baseTime,
      incidentDate: '2026-11-22',
      incidentNumber: 'INC-TST-0000',
    });

    // Create 1 DATE_ONLY match on the exact same date (distance 0)
    const incDateZero = await createIncidentHelper({
      incidentAt: null,
      incidentDate: '2026-11-22',
      incidentNumber: 'INC-TST-0001',
    });

    // Create 19 more EXACT incidents at increasing hourly distances: 1h, 2h, ... 19h
    for (let i = 1; i <= 19; i++) {
      await createIncidentHelper({
        incidentAt: new Date(baseTime.getTime() + i * 60 * 60 * 1000),
        incidentDate: '2026-11-22',
        incidentNumber: `INC-TST-${String(i + 1).padStart(4, '0')}`,
      });
    }

    // Now total created: 21 matches!
    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H'],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.matches.length).toBe(20);
    expect(res.body.data.truncated).toBe(true);

    // EXACT with distance 0 must come before DATE_ONLY with distance 0 (tie rule D9)
    expect(res.body.data.matches[0].incidentId).toBe(incExactZero._id.toString());
    expect(res.body.data.matches[0].timeBasis).toBe('EXACT');
    expect(res.body.data.matches[1].incidentId).toBe(incDateZero._id.toString());
    expect(res.body.data.matches[1].timeBasis).toBe('DATE_ONLY');
  });

  // ─── T16: C1 case-insensitive collation match and raw plate return ──────────
  it('T16: matches stored mixed-case plate "ab-123" with request "AB-123", padded request " 1-1000-h ", and returns raw plate', async () => {
    await setupBaseFixture();
    const inc1 = await createIncidentHelper({
      vehicles: [
        {
          vehicleRole: 'INSURED',
          plateRegion: 'PALESTINIAN',
          plateNumber: 'ab-123', // mixed/lowercase stored plate
        },
      ],
    });
    const inc2 = await createIncidentHelper({
      vehicles: [
        {
          vehicleRole: 'THIRD_PARTY',
          plateRegion: 'PALESTINIAN',
          plateNumber: '1-1000-H', // uppercase stored plate
        },
      ],
    });

    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['AB-123', ' 1-1000-h '],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.matches.length).toBe(2);

    const m1 = res.body.data.matches.find((m) => m.incidentId === inc1._id.toString());
    const m2 = res.body.data.matches.find((m) => m.incidentId === inc2._id.toString());

    // Q2 binding decision: returns the plate exactly as stored on that incident vehicle
    expect(m1.matchedPlates[0].plateNumber).toBe('ab-123');
    expect(m2.matchedPlates[0].plateNumber).toBe('1-1000-H');
  });

  // ─── T17: Read-only endpoint writes nothing ──────────────────────────────────
  it('T17: read-only endpoint writes nothing (incident and claim counts unchanged)', async () => {
    await setupBaseFixture();
    await createIncidentHelper();

    const incidentCountBefore = await Incident.countDocuments();
    const claimCountBefore = await Claim.countDocuments();

    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H'],
      });

    expect(res.status).toBe(200);
    const incidentCountAfter = await Incident.countDocuments();
    const claimCountAfter = await Claim.countDocuments();

    expect(incidentCountAfter).toBe(incidentCountBefore);
    expect(claimCountAfter).toBe(claimCountBefore);
  });

  // ─── T18: 400 VALIDATION_ERROR cases ─────────────────────────────────────────
  it('T18: rejects with 400 VALIDATION_ERROR on empty plateNumbers, >10 plates, missing incidentAt, missing timezone, or partial coords', async () => {
    await setupBaseFixture();

    // 1. empty plateNumbers
    const resEmptyPlates = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: [],
      });
    expect(resEmptyPlates.status).toBe(400);
    expect(resEmptyPlates.body.success).toBe(false);
    expect(resEmptyPlates.body.errors[0].code).toBe('VALIDATION_ERROR');

    // 2. 11 plates (> 10)
    const res11Plates = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: Array.from({ length: 11 }, (_, i) => `PLT-${i}`),
      });
    expect(res11Plates.status).toBe(400);

    // 3. missing incidentAt
    const resNoIncidentAt = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        plateNumbers: ['1-1000-H'],
      });
    expect(resNoIncidentAt.status).toBe(400);

    // 4. incidentAt without timezone
    const resNoTz = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00',
        plateNumbers: ['1-1000-H'],
      });
    expect(resNoTz.status).toBe(400);

    // 5. only latitude (missing longitude)
    const resOnlyLat = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H'],
        latitude: 31.9,
      });
    expect(resOnlyLat.status).toBe(400);
  });

  // ─── T19: Role authorization - FIELD_ADJUSTER: 403 ───────────────────────────
  it('T19: rejects FIELD_ADJUSTER with 403 Forbidden', async () => {
    await setupBaseFixture();
    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H'],
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // ─── T20: Role authorization - ADMIN: 200 ────────────────────────────────────
  it('T20: allows ADMIN to perform duplicate check', async () => {
    await setupBaseFixture();
    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H'],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ─── C1-explain: Index utilization with collation ────────────────────────────
  it('C1-explain: winning plan uses dup_check_plate_time with an IXSCAN and no COLLSCAN', async () => {
    await setupBaseFixture();
    for (let i = 0; i < 15; i++) {
      await createIncidentHelper({
        vehicles: [{ vehicleRole: 'INSURED', plateRegion: 'PALESTINIAN', plateNumber: `PLT-${i}` }],
      });
    }
    const filter = {
      organizationId: org._id,
      'vehicles.plateNumber': { $in: ['PLT-5'] },
      $or: [
        {
          incidentAt: {
            $gte: new Date('2026-11-21T10:00:00Z'),
            $lte: new Date('2026-11-23T10:00:00Z'),
          },
        },
        { incidentAt: null, incidentDate: { $in: ['2026-11-21', '2026-11-22', '2026-11-23'] } },
      ],
    };

    const explain = await Incident.find(filter)
      .collation({ locale: 'en', strength: 2 })
      .explain('executionStats');

    const winningPlanStr = JSON.stringify(explain.queryPlanner?.winningPlan || explain);
    expect(winningPlanStr).toContain('dup_check_plate_time');
    expect(winningPlanStr).toContain('IXSCAN');
    expect(winningPlanStr).not.toContain('COLLSCAN');
  });

  // ─── C4-mock: No swallowed errors ────────────────────────────────────────────
  it('C4-mock: does not swallow errors; returns error response and no matches key when repository throws', async () => {
    await setupBaseFixture();
    const spy = jest
      .spyOn(incidentRepository, 'findDuplicateCandidates')
      .mockRejectedValueOnce(new Error('Simulated Database Failure'));

    const res = await request(app)
      .post('/api/v1/incidents/duplicate-check')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        incidentAt: '2026-11-22T10:00:00+02:00',
        plateNumbers: ['1-1000-H'],
      });

    spy.mockRestore();

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeUndefined();
    expect(res.body.matches).toBeUndefined();
  });
});

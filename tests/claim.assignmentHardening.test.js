const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Customer = require('../src/modules/customers/customer.model');
const Claim = require('../src/modules/claims/claim.model');
const { buildPolicy } = require('./helpers/policyFactory');
const config = require('../src/config/env');
const { isAssignmentExpired, isLocationStale } = require('../src/utils/assignmentTiming');
const { governorateCenters, demoCoordinatesFor } = require('../src/scripts/demo/governorateCenters');
const { GOVERNORATES } = require('../src/utils/governorates');
const Notification = require('../src/modules/notifications/notification.model');
const claimRepository = require('../src/modules/claims/claim.repository');

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

describe('ASG-01: Assignment Hardening Integration & Unit Tests', () => {
  let mongoServer;
  let org1, org2;
  let officer1, officer2, admin1;
  let adjuster1, adjuster2, adjuster3, adjusterOtherOrg;
  let officer1Token, admin1Token, adjuster1Token;
  let testPolicy1;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    org1 = await Organization.create({
      name: 'Palestine Insurance Co',
      code: 'PIC-01',
      status: 'ACTIVE',
    });

    org2 = await Organization.create({
      name: 'Other Insurance Co',
      code: 'OIC-02',
      status: 'ACTIVE',
    });

    officer1 = await User.create({
      name: 'Officer One',
      employeeCode: 'OFF-01',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    officer1Token = generateToken(officer1);

    officer2 = await User.create({
      name: 'Officer Two',
      employeeCode: 'OFF-02',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    admin1 = await User.create({
      name: 'Admin One',
      employeeCode: 'ADM-01',
      password: 'password123',
      role: 'ADMIN',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    admin1Token = generateToken(admin1);

    adjuster1 = await User.create({
      name: 'Adjuster One',
      employeeCode: 'ADJ-01',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'SURV-001',
      surveyorLicenseExpiry: '2030-12-31',
      location: {
        latitude: 31.9038,
        longitude: 35.2034,
        updatedAt: new Date(),
      },
    });
    adjuster1Token = generateToken(adjuster1);

    adjuster2 = await User.create({
      name: 'Adjuster Two',
      employeeCode: 'ADJ-02',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'SURV-002',
      surveyorLicenseExpiry: '2030-12-31',
      location: {
        latitude: 31.9050,
        longitude: 35.2050,
        updatedAt: new Date(),
      },
    });

    adjuster3 = await User.create({
      name: 'Adjuster Three',
      employeeCode: 'ADJ-03',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'SURV-003',
      surveyorLicenseExpiry: '2030-12-31',
      location: {
        latitude: 31.9100,
        longitude: 35.2100,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000), // Stale: 20 mins ago
      },
    });

    adjusterOtherOrg = await User.create({
      name: 'Adjuster Org 2',
      employeeCode: 'ADJ-ORG2',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org2._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'SURV-ORG2',
      surveyorLicenseExpiry: '2030-12-31',
    });

    testPolicy1 = await buildPolicy({
      policyNumber: 'POL-ASG-001',
      status: 'ACTIVE',
      organizationId: org1._id,
      startDate: new Date('2025-01-01'),
      expiryDate: new Date('2027-12-31'),
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  const createTestClaim = async (fields = {}) => {
    return await Claim.create({
      organizationId: org1._id,
      policyId: testPolicy1._id,
      createdBy: officer1._id,
      status: 'NEW',
      customer: { name: 'Test Customer', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Al-Masyoun, Ramallah',
      incidentCoordinates: {
        latitude: 31.9020,
        longitude: 35.2010,
        capturedAt: new Date(),
      },
      ...fields,
    });
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // C4 & C10: Pure Unit Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe('C10: Pure assignmentTiming Helpers', () => {
    it('isAssignmentExpired: returns true when claim status is PENDING_ACCEPTANCE and acceptanceDueAt is null', () => {
      expect(isAssignmentExpired({ status: 'PENDING_ACCEPTANCE', acceptanceDueAt: null })).toBe(true);
    });

    it('isAssignmentExpired: returns false outside PENDING_ACCEPTANCE', () => {
      const now = new Date();
      expect(isAssignmentExpired({ status: 'NEW', acceptanceDueAt: null }, now)).toBe(false);
      expect(isAssignmentExpired({ status: 'ASSIGNED', acceptanceDueAt: new Date(now.getTime() - 10000) }, now)).toBe(false);
    });

    it('isAssignmentExpired: exact boundary tests', () => {
      const now = new Date('2026-11-16T10:00:00.000Z');
      const dueAtExact = new Date('2026-11-16T10:00:00.000Z');
      const dueAtPast = new Date('2026-11-16T09:59:59.000Z');
      const dueAtFuture = new Date('2026-11-16T10:00:01.000Z');

      // Exact boundary: <= now counts as expired
      expect(isAssignmentExpired({ status: 'PENDING_ACCEPTANCE', acceptanceDueAt: dueAtExact }, now)).toBe(true);
      // Past: expired
      expect(isAssignmentExpired({ status: 'PENDING_ACCEPTANCE', acceptanceDueAt: dueAtPast }, now)).toBe(true);
      // Future: active (not expired)
      expect(isAssignmentExpired({ status: 'PENDING_ACCEPTANCE', acceptanceDueAt: dueAtFuture }, now)).toBe(false);
    });

    it('isLocationStale: evaluates 15-minute threshold accurately', () => {
      const now = new Date('2026-11-16T10:15:00.000Z');
      const staleMinutes = 15;

      // Null location or null updatedAt
      expect(isLocationStale(null, now, staleMinutes)).toBe(true);
      expect(isLocationStale({}, now, staleMinutes)).toBe(true);
      expect(isLocationStale({ updatedAt: null }, now, staleMinutes)).toBe(true);

      // Fresh (14 mins ago)
      const fresh14 = new Date(now.getTime() - 14 * 60 * 1000);
      expect(isLocationStale({ updatedAt: fresh14 }, now, staleMinutes)).toBe(false);

      // Exactly 15 mins ago (ageMs === 15 * 60 * 1000, ageMs > threshold is false)
      const exact15 = new Date(now.getTime() - 15 * 60 * 1000);
      expect(isLocationStale({ updatedAt: exact15 }, now, staleMinutes)).toBe(false);

      // 15 mins + 1 sec ago (stale)
      const stale15Plus1 = new Date(now.getTime() - (15 * 60 * 1000 + 1000));
      expect(isLocationStale({ updatedAt: stale15Plus1 }, now, staleMinutes)).toBe(true);
    });
  });

  describe('C4: governorateCenters Helper & Demo Coordinates', () => {
    it('covers every governorate in GOVERNORATES', () => {
      for (const gov of GOVERNORATES) {
        expect(governorateCenters[gov]).toBeDefined();
        expect(typeof governorateCenters[gov].latitude).toBe('number');
        expect(typeof governorateCenters[gov].longitude).toBe('number');
      }
    });

    it('throws on an unknown governorate', () => {
      expect(() => demoCoordinatesFor('UNKNOWN_GOV', 0)).toThrow(/Unknown governorate/);
    });

    it('returns different deterministic coordinates for different indices', () => {
      const p1 = demoCoordinatesFor('RAMALLAH_AL_BIREH', 0);
      const p2 = demoCoordinatesFor('RAMALLAH_AL_BIREH', 1);
      const p11 = demoCoordinatesFor('RAMALLAH_AL_BIREH', 10);

      expect(p1).not.toEqual(p2);
      expect(p1.latitude).not.toBe(p2.latitude);
      expect(p1.longitude).not.toBe(p11.longitude);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Group 1: Capacity & Override Validation (D1, D2, D3, D4, A3, A4, A13, C9)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Group 1: Capacity & Override Validation', () => {
    let busyAdjuster;

    beforeEach(async () => {
      busyAdjuster = await User.create({
        name: 'Busy Adjuster',
        employeeCode: `BUSY-${Date.now()}`,
        password: 'password123',
        role: 'FIELD_ADJUSTER',
        organizationId: org1._id,
        status: 'ACTIVE',
        surveyorLicenseNumber: 'SURV-BUSY',
        surveyorLicenseExpiry: '2030-12-31',
      });
    });

    it('[ASG-01-CAP-01] Adjuster with 2 active tasks: assignment succeeds without override (200)', async () => {
      // Create 2 active claims for busyAdjuster
      for (let i = 0; i < 2; i++) {
        await createTestClaim({ status: 'ASSIGNED', assignedTo: busyAdjuster._id });
      }

      const claimToAssign = await createTestClaim();
      const res = await request(app)
        .post(`/api/v1/claims/${claimToAssign._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ adjusterId: busyAdjuster._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('PENDING_ACCEPTANCE');
    });

    it('[ASG-01-CAP-02] Adjuster with 3 active tasks without override returns 409 ADJUSTER_UNAVAILABLE', async () => {
      for (let i = 0; i < 3; i++) {
        await createTestClaim({ status: 'ASSIGNED', assignedTo: busyAdjuster._id });
      }

      const claimToAssign = await createTestClaim();
      const res = await request(app)
        .post(`/api/v1/claims/${claimToAssign._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ adjusterId: busyAdjuster._id.toString() });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('ADJUSTER_UNAVAILABLE');
    });

    it('[ASG-01-CAP-03] Adjuster with 3 active tasks with overrideCapacity: true and valid overrideReason (10..300 chars) succeeds (200)', async () => {
      for (let i = 0; i < 3; i++) {
        await createTestClaim({ status: 'IN_PROGRESS', assignedTo: busyAdjuster._id });
      }

      const claimToAssign = await createTestClaim();
      const overrideReason = 'Emergency heavy snowfall across the district.';
      const res = await request(app)
        .post(`/api/v1/claims/${claimToAssign._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({
          adjusterId: busyAdjuster._id.toString(),
          overrideCapacity: true,
          overrideReason,
          notes: 'Urgent priority inspection',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbClaim = await Claim.findById(claimToAssign._id);
      expect(dbClaim.capacityOverride).toBeDefined();
      expect(dbClaim.capacityOverride.reason).toBe(overrideReason);
      expect(dbClaim.capacityOverride.activeTasksAtAssign).toBe(3);
      expect(dbClaim.capacityOverride.capacityLimit).toBe(3);
      expect(dbClaim.capacityOverride.overriddenBy.toString()).toBe(officer1._id.toString());
      expect(dbClaim.capacityOverride.overriddenAt).toBeInstanceOf(Date);
      expect(dbClaim.assignmentNotes).toBe('Urgent priority inspection'); // No prefix!
    });

    it('[ASG-01-CAP-04] Adjuster with 3 active tasks with overrideCapacity: true and missing overrideReason returns 422 OVERRIDE_REASON_REQUIRED', async () => {
      for (let i = 0; i < 3; i++) {
        await createTestClaim({ status: 'CORRECTION_REQUIRED', assignedTo: busyAdjuster._id });
      }

      const claimToAssign = await createTestClaim();
      const res = await request(app)
        .post(`/api/v1/claims/${claimToAssign._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({
          adjusterId: busyAdjuster._id.toString(),
          overrideCapacity: true,
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('OVERRIDE_REASON_REQUIRED');
    });

    it('[C9] overrideCapacity true, adjuster full, overrideReason: "" gives 422 OVERRIDE_REASON_REQUIRED', async () => {
      for (let i = 0; i < 3; i++) {
        await createTestClaim({ status: 'ASSIGNED', assignedTo: busyAdjuster._id });
      }

      const claimToAssign = await createTestClaim();
      const res = await request(app)
        .post(`/api/v1/claims/${claimToAssign._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({
          adjusterId: busyAdjuster._id.toString(),
          overrideCapacity: true,
          overrideReason: '',
        });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('OVERRIDE_REASON_REQUIRED');
    });

    it('[ASG-01-CAP-05] Adjuster with 2 active tasks with overrideCapacity: true succeeds as normal assign and capacityOverride stays null', async () => {
      for (let i = 0; i < 2; i++) {
        await createTestClaim({ status: 'ASSIGNED', assignedTo: busyAdjuster._id });
      }

      const claimToAssign = await createTestClaim();
      const res = await request(app)
        .post(`/api/v1/claims/${claimToAssign._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({
          adjusterId: busyAdjuster._id.toString(),
          overrideCapacity: true,
          overrideReason: 'Superfluous override reason here',
        });

      expect(res.status).toBe(200);
      const dbClaim = await Claim.findById(claimToAssign._id);
      expect(dbClaim.capacityOverride).toBeNull();
    });

    it('[ASG-01-CAP-06] overrideReason present without overrideCapacity: true returns 400 VALIDATION_ERROR', async () => {
      const claimToAssign = await createTestClaim();
      const res = await request(app)
        .post(`/api/v1/claims/${claimToAssign._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({
          adjusterId: busyAdjuster._id.toString(),
          overrideReason: 'Should fail validation',
        });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('[ASG-01-CAP-07 & 08] overrideReason < 10 or > 300 chars returns 400 VALIDATION_ERROR', async () => {
      const claimToAssign = await createTestClaim();
      const resShort = await request(app)
        .post(`/api/v1/claims/${claimToAssign._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({
          adjusterId: busyAdjuster._id.toString(),
          overrideCapacity: true,
          overrideReason: 'Too short', // 9 chars
        });
      expect(resShort.status).toBe(400);
      expect(resShort.body.errors[0].code).toBe('VALIDATION_ERROR');

      const resLong = await request(app)
        .post(`/api/v1/claims/${claimToAssign._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({
          adjusterId: busyAdjuster._id.toString(),
          overrideCapacity: true,
          overrideReason: 'A'.repeat(301),
        });
      expect(resLong.status).toBe(400);
      expect(resLong.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('[ASG-01-CAP-09] notes > 500 characters returns 400 VALIDATION_ERROR', async () => {
      const claimToAssign = await createTestClaim();
      const res = await request(app)
        .post(`/api/v1/claims/${claimToAssign._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({
          adjusterId: busyAdjuster._id.toString(),
          notes: 'N'.repeat(501),
        });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('[ASG-01-CAP-10] Claims in PENDING_ACCEPTANCE do NOT count toward the 3 active tasks', async () => {
      for (let i = 0; i < 3; i++) {
        await createTestClaim({ status: 'PENDING_ACCEPTANCE', assignedTo: busyAdjuster._id });
      }

      const claimToAssign = await createTestClaim();
      const res = await request(app)
        .post(`/api/v1/claims/${claimToAssign._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ adjusterId: busyAdjuster._id.toString() });

      expect(res.status).toBe(200);
    });

    it('[ASG-01-CAP-11] Claims in another organization do NOT count toward the 3 active tasks', async () => {
      const otherOrgPolicy = await buildPolicy({
        policyNumber: `POL-ORG2-${Date.now()}`,
        status: 'ACTIVE',
        organizationId: org2._id,
        startDate: new Date('2025-01-01'),
        expiryDate: new Date('2027-12-31'),
      });

      for (let i = 0; i < 3; i++) {
        await Claim.create({
          organizationId: org2._id,
          policyId: otherOrgPolicy._id,
          createdBy: officer1._id,
          status: 'ASSIGNED',
          assignedTo: busyAdjuster._id,
          customer: { name: 'C', phone: '1' },
          incidentType: 'COLLISION',
          incidentLocation: 'L',
          incidentCoordinates: { latitude: 31.9, longitude: 35.2, capturedAt: new Date() },
        });
      }

      const claimToAssign = await createTestClaim();
      const res = await request(app)
        .post(`/api/v1/claims/${claimToAssign._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ adjusterId: busyAdjuster._id.toString() });

      expect(res.status).toBe(200);
    });

    it('[ASG-01-CAP-12 & 13] ADMIN and CLAIMS_OFFICER can override; FIELD_ADJUSTER gets 403', async () => {
      for (let i = 0; i < 3; i++) {
        await createTestClaim({ status: 'ASSIGNED', assignedTo: busyAdjuster._id });
      }

      const claimToAssignAdmin = await createTestClaim();
      const resAdmin = await request(app)
        .post(`/api/v1/claims/${claimToAssignAdmin._id}/assign`)
        .set('Authorization', `Bearer ${admin1Token}`)
        .send({
          adjusterId: busyAdjuster._id.toString(),
          overrideCapacity: true,
          overrideReason: 'Admin authorized override for capacity',
        });
      expect(resAdmin.status).toBe(200);

      const claimToAssignAdj = await createTestClaim();
      const resAdj = await request(app)
        .post(`/api/v1/claims/${claimToAssignAdj._id}/assign`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({
          adjusterId: busyAdjuster._id.toString(),
          overrideCapacity: true,
          overrideReason: 'Field adjuster cannot assign',
        });
      expect(resAdj.status).toBe(403);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Group 2: Validation Order & Coordinates Gate (D7, A4, A14)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Group 2: Validation Order & Coordinates Gate', () => {
    it('[ASG-01-ORD-01] Non-existent claim with a busy adjuster returns 404 CLAIM_NOT_FOUND (not 409)', async () => {
      const busyAdjuster = await User.create({
        name: 'Busy Order Adj',
        employeeCode: `BUSY-ORD-${Date.now()}`,
        password: 'p',
        role: 'FIELD_ADJUSTER',
        organizationId: org1._id,
        status: 'ACTIVE',
        surveyorLicenseNumber: 'LIC-BO',
        surveyorLicenseExpiry: '2030-12-31',
      });
      for (let i = 0; i < 4; i++) {
        await createTestClaim({ status: 'ASSIGNED', assignedTo: busyAdjuster._id });
      }

      const nonExistentId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .post(`/api/v1/claims/${nonExistentId}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ adjusterId: busyAdjuster._id.toString() });

      expect(res.status).toBe(404);
      expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
    });

    it('[ASG-01-LOC-01 & 02 & 03] POST /incidents latitude/longitude validation', async () => {
      const incidentBase = {
        incidentType: 'COLLISION',
        incidentLocation: 'Ramallah City',
        incidentAt: '2026-11-16T08:00:00.000Z',
        governorate: 'RAMALLAH_AL_BIREH',
        reportSource: 'AGREED_STATEMENT',
        injuriesReported: false,
        vehicles: [
          { vehicleRole: 'INSURED', plateRegion: 'PALESTINIAN', plateNumber: '1234-A' },
        ],
        parties: [
          { partyType: 'PERSON', role: 'POLICYHOLDER', fullName: 'Ahmad User' },
        ],
      };

      // Missing latitude
      const resNoLat = await request(app)
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ ...incidentBase, longitude: 35.2034 });
      expect(resNoLat.status).toBe(400);
      expect(resNoLat.body.errors[0].code).toBe('VALIDATION_ERROR');

      // Missing longitude
      const resNoLon = await request(app)
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ ...incidentBase, latitude: 31.9038 });
      expect(resNoLon.status).toBe(400);
      expect(resNoLon.body.errors[0].code).toBe('VALIDATION_ERROR');

      // Out-of-range latitude
      const resOutRange = await request(app)
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ ...incidentBase, latitude: 95, longitude: 35.2034 });
      expect(resOutRange.status).toBe(400);
      expect(resOutRange.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('[ASG-01-LOC-04] Assigning a legacy claim with null incidentCoordinates returns 422 INCIDENT_LOCATION_MISSING', async () => {
      const legacyClaim = await createTestClaim({ incidentCoordinates: null });

      const res = await request(app)
        .post(`/api/v1/claims/${legacyClaim._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ adjusterId: adjuster1._id.toString() });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('INCIDENT_LOCATION_MISSING');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Group 3: Detail Read, Isolation & Notifications (D5, D6, A9, A10, A11)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Group 3: Detail Read, Isolation & Notifications', () => {
    it('[ASG-01-READ-01] GET /claims/:claimId exposes capacityOverride, acceptanceDueAt, acceptanceExpired, clean notes to assigned adjuster', async () => {
      const busyAdjuster = await User.create({
        name: 'Detail Read Adj',
        employeeCode: `ADJ-DET-${Date.now()}`,
        password: 'p',
        role: 'FIELD_ADJUSTER',
        organizationId: org1._id,
        status: 'ACTIVE',
        surveyorLicenseNumber: 'LIC-DET',
        surveyorLicenseExpiry: '2030-12-31',
      });
      for (let i = 0; i < 3; i++) {
        await createTestClaim({ status: 'ASSIGNED', assignedTo: busyAdjuster._id });
      }

      const claim = await createTestClaim();
      const overrideReason = 'Valid reason for assigning over capacity limit.';
      await request(app)
        .post(`/api/v1/claims/${claim._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({
          adjusterId: busyAdjuster._id.toString(),
          overrideCapacity: true,
          overrideReason,
          notes: 'Clean adjuster notes without prefix',
        });

      const busyAdjToken = generateToken(busyAdjuster);
      const res = await request(app)
        .get(`/api/v1/claims/${claim._id}`)
        .set('Authorization', `Bearer ${busyAdjToken}`);

      expect(res.status).toBe(200);
      const assignment = res.body.data.assignment;
      expect(assignment.acceptanceDueAt).toBeDefined();
      expect(assignment.acceptanceExpired).toBe(false);
      expect(assignment.assignmentNotes).toBe('Clean adjuster notes without prefix');
      expect(assignment.capacityOverride).toBeDefined();
      expect(assignment.capacityOverride.reason).toBe(overrideReason);
      expect(assignment.capacityOverride.activeTasksAtAssign).toBe(3);
      expect(assignment.capacityOverride.capacityLimit).toBe(3);
      expect(assignment.capacityOverride.overriddenBy.employeeCode).toBe('OFF-01');
    });

    it('[ASG-01-NOTIF-01] Capacity override assign creates notification with override title and params', async () => {
      const busyAdjuster = await User.create({
        name: 'Notif Adj',
        employeeCode: `ADJ-NOTIF-${Date.now()}`,
        password: 'p',
        role: 'FIELD_ADJUSTER',
        organizationId: org1._id,
        status: 'ACTIVE',
        surveyorLicenseNumber: 'LIC-NOTIF',
        surveyorLicenseExpiry: '2030-12-31',
      });
      for (let i = 0; i < 3; i++) {
        await createTestClaim({ status: 'ASSIGNED', assignedTo: busyAdjuster._id });
      }

      const claim = await createTestClaim();
      const overrideReason = 'Emergency assignment override notification test';
      await request(app)
        .post(`/api/v1/claims/${claim._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({
          adjusterId: busyAdjuster._id.toString(),
          overrideCapacity: true,
          overrideReason,
          notes: 'Field notes here',
        });

      const notif = await Notification.findOne({
        relatedClaimId: claim._id,
        recipientId: busyAdjuster._id,
        type: 'PENDING_ACCEPTANCE',
      });

      expect(notif).toBeDefined();
      expect(notif.title).toContain('Capacity Override');
      expect(notif.params).toBeDefined();
      expect(notif.params.actor.employeeCode).toBe('OFF-01');
      expect(notif.params.reason).toBe(overrideReason);
      expect(notif.params.notes).toBe('Field notes here');
    });

    it('[ASG-01-PUB-01] Public tracking on a reassigned claim does not leak notes, override reason, or officer names', async () => {
      const claim = await createTestClaim({
        trackingToken: '1111222233334444555566667777888811112222333344445555666677778888',
      });

      // Initial assign
      await request(app)
        .post(`/api/v1/claims/${claim._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ adjusterId: adjuster1._id.toString() });

      // Move time past 5 minutes
      await Claim.updateOne(
        { _id: claim._id },
        { $set: { acceptanceDueAt: new Date(Date.now() - 10 * 60 * 1000) } }
      );

      // Reassign
      await request(app)
        .post(`/api/v1/claims/${claim._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ adjusterId: adjuster2._id.toString() });

      const res = await request(app)
        .get(`/api/v1/public/claims/track/${claim.trackingToken}`);

      expect(res.status).toBe(200);
      const dataStr = JSON.stringify(res.body.data);
      expect(dataStr).not.toContain('Assignment Expired');
      expect(dataStr).not.toContain('OFF-01');
      expect(dataStr).not.toContain('Officer One');
      expect(dataStr).not.toContain('[ASSIGNMENT EXPIRED]');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Group 4: Acceptance Window & Reassign Lifecycle (D9, A5, A6, A7, A8, C2)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Group 4: Acceptance Window & Reassign Lifecycle', () => {
    it('[ASG-01-EXP-01] Adjuster accepts claim within 5 minutes -> status ASSIGNED (200)', async () => {
      const claim = await createTestClaim();
      await request(app)
        .post(`/api/v1/claims/${claim._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ adjusterId: adjuster1._id.toString() });

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/accept-assignment`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ASSIGNED');
    });

    it('[ASG-01-EXP-02] Adjuster accepts claim after 5 minutes -> returns 409 ASSIGNMENT_EXPIRED, status stays PENDING_ACCEPTANCE', async () => {
      const claim = await createTestClaim();
      await request(app)
        .post(`/api/v1/claims/${claim._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ adjusterId: adjuster1._id.toString() });

      // Simulate expired acceptanceDueAt
      await Claim.updateOne(
        { _id: claim._id },
        { $set: { acceptanceDueAt: new Date(Date.now() - 1000) } }
      );

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/accept-assignment`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('ASSIGNMENT_EXPIRED');

      const dbClaim = await Claim.findById(claim._id);
      expect(dbClaim.status).toBe('PENDING_ACCEPTANCE');
    });

    it('[ASG-01-EXP-03] Officer reassigns claim within 5-minute window -> returns 409 INVALID_STATUS_TRANSITION (ACCEPTANCE_PENDING)', async () => {
      const claim = await createTestClaim();
      await request(app)
        .post(`/api/v1/claims/${claim._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ adjusterId: adjuster1._id.toString() });

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ adjusterId: adjuster2._id.toString() });

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
      expect(res.body.errors[0].reason).toBe('ACCEPTANCE_PENDING');
    });

    it('[ASG-01-EXP-04] Officer reassigns after window -> succeeds, pushes both timeline events, and computes statusEnteredAt', async () => {
      const claim = await createTestClaim();
      await request(app)
        .post(`/api/v1/claims/${claim._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ adjusterId: adjuster1._id.toString() });

      // Simulate expiry
      const oldDueAt = new Date(Date.now() - 5000);
      await Claim.updateOne(
        { _id: claim._id },
        { $set: { acceptanceDueAt: oldDueAt } }
      );

      const resReassign = await request(app)
        .post(`/api/v1/claims/${claim._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ adjusterId: adjuster2._id.toString() });

      expect(resReassign.status).toBe(200);
      expect(resReassign.body.data.assignedTo).toBe(adjuster2._id.toString());
      expect(resReassign.body.data.acceptanceDueAt).toBeDefined();

      const dbClaim = await Claim.findById(claim._id);
      expect(dbClaim.timeline.length).toBeGreaterThanOrEqual(2);
      const expiredEvt = dbClaim.timeline[dbClaim.timeline.length - 2];
      const pendingEvt = dbClaim.timeline[dbClaim.timeline.length - 1];

      expect(expiredEvt.action).toBe('Assignment Expired');
      expect(expiredEvt.previousStatus).toBe('PENDING_ACCEPTANCE');
      expect(expiredEvt.newStatus).toBe('NEW');

      expect(pendingEvt.action).toBe('Assignment Pending Acceptance');
      expect(pendingEvt.previousStatus).toBe('NEW');
      expect(pendingEvt.newStatus).toBe('PENDING_ACCEPTANCE');

      // Verify computed statusEnteredAt in GET /claims/:claimId
      const resGet = await request(app)
        .get(`/api/v1/claims/${claim._id}`)
        .set('Authorization', `Bearer ${officer1Token}`);

      expect(resGet.status).toBe(200);
      expect(new Date(resGet.body.data.statusEnteredAt).getTime()).toBe(new Date(pendingEvt.timestamp).getTime());
    });

    it('[ASG-01-EXP-05] Officer reassigns a legacy claim with acceptanceDueAt: null -> succeeds', async () => {
      const claim = await createTestClaim({
        status: 'PENDING_ACCEPTANCE',
        assignedTo: adjuster1._id,
        acceptanceDueAt: null,
      });

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({ adjusterId: adjuster2._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.data.assignedTo).toBe(adjuster2._id.toString());
    });

    it('[ASG-01-EXP-06] Adjuster declines an expired pending claim -> reverts to NEW, resets acceptanceDueAt and capacityOverride', async () => {
      const claim = await createTestClaim({
        status: 'PENDING_ACCEPTANCE',
        assignedTo: adjuster1._id,
        acceptanceDueAt: new Date(Date.now() - 10000), // Expired
        capacityOverride: {
          reason: 'Emergency override that is now expired',
          activeTasksAtAssign: 3,
          capacityLimit: 3,
          overriddenBy: officer1._id,
          overriddenAt: new Date(),
        },
      });

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/decline-assignment`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({ reason: 'Cannot take this task due to vehicle breakdown' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('NEW');

      const dbClaim = await Claim.findById(claim._id);
      expect(dbClaim.acceptanceDueAt).toBeNull();
      expect(dbClaim.capacityOverride).toBeNull();
      expect(dbClaim.assignedTo).toBeNull();
    });

    it('[ASG-01-EXP-07] Two officers concurrently reassigning the same expired claim: exactly one wins', async () => {
      const claim = await createTestClaim({
        status: 'PENDING_ACCEPTANCE',
        assignedTo: adjuster1._id,
        acceptanceDueAt: new Date(Date.now() - 10000), // Expired
      });

      const officer2Token = generateToken(officer2);

      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/api/v1/claims/${claim._id}/assign`)
          .set('Authorization', `Bearer ${officer1Token}`)
          .send({ adjusterId: adjuster2._id.toString() }),
        request(app)
          .post(`/api/v1/claims/${claim._id}/assign`)
          .set('Authorization', `Bearer ${officer2Token}`)
          .send({ adjusterId: adjuster3._id.toString() }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Group 5: Adjuster Staleness & Availability (D1, D8, A12)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Group 5: Adjuster Staleness & Availability', () => {
    it('[ASG-01-STALE-01 & 02 & 03] GET /users/adjusters exposes locationUpdatedAt, locationStale, and distance sorting', async () => {
      // Set adjuster1 location to 10 mins ago (fresh)
      await User.updateOne(
        { _id: adjuster1._id },
        {
          $set: {
            'location.latitude': 31.9038,
            'location.longitude': 35.2034,
            'location.updatedAt': new Date(Date.now() - 10 * 60 * 1000),
          },
        }
      );

      // Set adjuster2 location to 16 mins ago (stale)
      await User.updateOne(
        { _id: adjuster2._id },
        {
          $set: {
            'location.latitude': 31.9039, // Closer coordinate than adjuster1
            'location.longitude': 35.2035,
            'location.updatedAt': new Date(Date.now() - 16 * 60 * 1000),
          },
        }
      );

      // Set adjuster3 location updatedAt to null (stale)
      await User.updateOne(
        { _id: adjuster3._id },
        {
          $set: {
            'location.latitude': 31.9040,
            'location.longitude': 35.2040,
            'location.updatedAt': null,
          },
        }
      );

      const res = await request(app)
        .get('/api/v1/users/adjusters?latitude=31.9038&longitude=35.2034')
        .set('Authorization', `Bearer ${officer1Token}`);

      expect(res.status).toBe(200);
      const adjusters = res.body.data;

      const a1 = adjusters.find((a) => a.id === adjuster1._id.toString());
      const a2 = adjusters.find((a) => a.id === adjuster2._id.toString());
      const a3 = adjusters.find((a) => a.id === adjuster3._id.toString());

      // Fresh adjuster
      expect(a1.locationStale).toBe(false);
      expect(a1.locationUpdatedAt).toBeDefined();
      expect(typeof a1.distanceKm).toBe('number');

      // Stale adjuster (> 15 mins)
      expect(a2.locationStale).toBe(true);
      expect(a2.distanceKm).toBeNull();

      // Stale adjuster (null updatedAt)
      expect(a3.locationStale).toBe(true);
      expect(a3.distanceKm).toBeNull();

      // Sorting: fresh adjusters with distanceKm first, then stale ones
      const firstAdj = adjusters[0];
      expect(firstAdj.id).toBe(adjuster1._id.toString());
    });

    it('[ASG-01-STALE-04] Adjuster with 3 active tasks displays availability: UNAVAILABLE in GET /users/adjusters', async () => {
      const fullAdj = await User.create({
        name: 'Full Adjuster',
        employeeCode: `FULL-${Date.now()}`,
        password: 'p',
        role: 'FIELD_ADJUSTER',
        organizationId: org1._id,
        status: 'ACTIVE',
        surveyorLicenseNumber: 'LIC-FULL',
        surveyorLicenseExpiry: '2030-12-31',
      });

      for (let i = 0; i < 3; i++) {
        await createTestClaim({ status: 'ASSIGNED', assignedTo: fullAdj._id });
      }

      const res = await request(app)
        .get('/api/v1/users/adjusters')
        .set('Authorization', `Bearer ${officer1Token}`);

      expect(res.status).toBe(200);
      const target = res.body.data.find((a) => a.id === fullAdj._id.toString());
      expect(target).toBeDefined();
      expect(target.activeTasksCount).toBe(3);
      expect(target.availability).toBe('UNAVAILABLE');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ASG-01-fix-01: Fixes F1, F3, F4
  // ─────────────────────────────────────────────────────────────────────────────
  describe('ASG-01-fix-01: Fixes F1, F3, F4', () => {
    it('[FIX-F1] POST /claims without latitude gives 400 VALIDATION_ERROR; without longitude gives 400', async () => {
      const basePayload = {
        policyId: testPolicy1._id.toString(),
        plateNumber: 'INT-1111',
        incidentDate: '2025-06-15',
        incidentType: 'COLLISION',
        incidentLocation: 'Ramallah Main St',
      };

      const noLatRes = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({
          ...basePayload,
          longitude: 35.2034,
        });

      expect(noLatRes.status).toBe(400);
      expect(noLatRes.body.success).toBe(false);
      expect(noLatRes.body.errors[0].code).toBe('VALIDATION_ERROR');

      const noLngRes = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({
          ...basePayload,
          latitude: 31.9038,
        });

      expect(noLngRes.status).toBe(400);
      expect(noLngRes.body.success).toBe(false);
      expect(noLngRes.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('[FIX-F3] The reassign filter rejects a claim whose assignedTo changed between the read and the write', async () => {
      const claim = await createTestClaim({
        status: 'PENDING_ACCEPTANCE',
        assignedTo: adjuster1._id,
        acceptanceDueAt: new Date(Date.now() - 10000),
      });

      const wrongAssigneeId = new mongoose.Types.ObjectId();
      const now = new Date();
      const updateData = {
        assignedTo: adjuster2._id,
        assignedBy: officer1._id,
        assignedAt: now,
        acceptanceDueAt: new Date(now.getTime() + 5 * 60 * 1000),
        status: 'PENDING_ACCEPTANCE',
        priority: 'MEDIUM',
        assignmentNotes: 'Reassigned notes',
        capacityOverride: null,
        timelineEvents: [{
          action: 'Assignment Pending Acceptance',
          previousStatus: 'PENDING_ACCEPTANCE',
          newStatus: 'PENDING_ACCEPTANCE',
          notes: 'Reassigned notes',
          performedBy: officer1._id,
          role: 'CLAIMS_OFFICER',
          timestamp: now,
        }],
      };

      const result = await claimRepository.reassignExpiredClaim(
        claim._id,
        org1._id,
        wrongAssigneeId,
        now,
        updateData
      );

      expect(result).toBeNull();
    });

    it('[FIX-F4] A normal assign creates a notification with params.actor set, params.reason null, params.notes equal to the sent notes', async () => {
      const claim = await createTestClaim();
      const sentNotes = 'Normal assignment without override notes';

      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/assign`)
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({
          adjusterId: adjuster1._id.toString(),
          notes: sentNotes,
          overrideCapacity: false,
        });

      expect(res.status).toBe(200);

      const notif = await Notification.findOne({
        relatedClaimId: claim._id,
        recipientId: adjuster1._id,
        type: 'PENDING_ACCEPTANCE',
      });

      expect(notif).toBeDefined();
      expect(notif.params).toBeDefined();
      expect(notif.params.actor).toBeDefined();
      expect(notif.params.actor.employeeCode).toBe(officer1.employeeCode);
      expect(notif.params.actor.name).toBe(officer1.name);
      expect(notif.params.reason).toBeNull();
      expect(notif.params.notes).toBe(sentNotes);
    });
  });
});

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

describe('GET /api/v1/claims/stats — Dashboard KPI Aggregation', () => {
  let org1, org2;
  let admin1, officer1, adjuster1, adjuster2, adjuster3, inactiveAdjuster1;
  let officer2, adjusterOrg2;
  let adminToken, officerToken, adjuster1Token, adjuster2Token;
  let officer2Token;

  beforeEach(async () => {
    // Organizations
    org1 = await Organization.create({ name: 'Tenant Alpha', code: 'TALP' });
    global.__testPol = await buildPolicy({ policyNumber: 'POL-FIX-001', status: 'ACTIVE', startDate: new Date('2026-01-01'), expiryDate: new Date('2027-12-31'), organizationId: org1._id });
    org2 = await Organization.create({ name: 'Tenant Beta', code: 'TBET' });

    // Org 1 Users
    admin1 = await User.create({
      name: 'Admin Alpha',
      employeeCode: 'ADM-01',
      password: 'password',
      role: 'ADMIN',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    adminToken = generateToken(admin1);

    officer1 = await User.create({
      name: 'Officer Alpha',
      employeeCode: 'OFF-01',
      password: 'password',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    officerToken = generateToken(officer1);

    adjuster1 = await User.create({
      name: 'Adjuster 1',
      employeeCode: 'ADJ-01',
      password: 'password',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    adjuster1Token = generateToken(adjuster1);

    adjuster2 = await User.create({
      name: 'Adjuster 2',
      employeeCode: 'ADJ-02',
      password: 'password',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    adjuster2Token = generateToken(adjuster2);

    adjuster3 = await User.create({
      name: 'Adjuster 3',
      employeeCode: 'ADJ-03',
      password: 'password',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    inactiveAdjuster1 = await User.create({
      name: 'Inactive Adjuster',
      employeeCode: 'ADJ-INACTIVE',
      password: 'password',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'INACTIVE',
    });

    // Org 2 Users
    officer2 = await User.create({
      name: 'Officer Beta',
      employeeCode: 'OFF-02',
      password: 'password',
      role: 'CLAIMS_OFFICER',
      organizationId: org2._id,
      status: 'ACTIVE',
    });
    officer2Token = generateToken(officer2);

    adjusterOrg2 = await User.create({
      name: 'Adjuster Beta',
      employeeCode: 'ADJ-B01',
      password: 'password',
      role: 'FIELD_ADJUSTER',
      organizationId: org2._id,
      status: 'ACTIVE',
    });
  });

  // Helper to create claims with specific status, assignee, and createdAt
  const createClaim = async (orgId, creatorId, status, assignedTo = null, createdAt = null) => {
    let pol = await Policy.findOne({ organizationId: orgId });
    if (!pol) {
      pol = await buildPolicy({
        policyNumber: `POL-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        status: 'ACTIVE',
        startDate: new Date('2024-01-01'),
        expiryDate: new Date('2028-12-31'),
        organizationId: orgId,
      });
    }
    const claimData = {
      organizationId: orgId,
      policyId: pol._id,
      createdBy: creatorId,
      status,
      customer: { name: 'John Doe', phone: '+1234567890' },
      incidentType: 'COLLISION',
      incidentLocation: 'Highway 1',
      vehicle: { plateNumber: 'ABC-1234' },
      ...(assignedTo && { assignedTo }),
    };
    const claim = await Claim.create(claimData);
    if (createdAt) {
      await Claim.collection.updateOne({ _id: claim._id }, { $set: { createdAt } });
    }
    return claim;
  };


  describe('1. Authentication & Role-Based Access Control', () => {
    it('should return 401 Unauthorized if no JWT token is provided', async () => {
      const res = await request(app).get('/api/v1/claims/stats');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should allow ADMIN role (200 OK, scope: ORGANIZATION)', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.scope).toBe('ORGANIZATION');
    });

    it('should allow CLAIMS_OFFICER role (200 OK, scope: ORGANIZATION)', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.scope).toBe('ORGANIZATION');
    });

    it('should allow FIELD_ADJUSTER role (200 OK, scope: ASSIGNED, never 403)', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats')
        .set('Authorization', `Bearer ${adjuster1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.scope).toBe('ASSIGNED');
    });
  });

  describe('2. ADMIN / CLAIMS_OFFICER Response Envelope & Metrics', () => {
    beforeEach(async () => {
      // Seed Org 1 Claims across multiple statuses:
      // NEW: 2
      await createClaim(org1._id, officer1._id, 'NEW');
      await createClaim(org1._id, officer1._id, 'NEW');

      // Adjuster 1: 2 active claims -> nearCapacity (2 of 3)
      await createClaim(org1._id, officer1._id, 'ASSIGNED', adjuster1._id);
      await createClaim(org1._id, officer1._id, 'IN_PROGRESS', adjuster1._id);

      // Adjuster 2: 3 active claims -> atCapacity (3 of 3)
      await createClaim(org1._id, officer1._id, 'ASSIGNED', adjuster2._id);
      await createClaim(org1._id, officer1._id, 'IN_PROGRESS', adjuster2._id);
      await createClaim(org1._id, officer1._id, 'CORRECTION_REQUIRED', adjuster2._id);

      // Adjuster 3: 0 active claims -> available (0 of 3)

      // Inactive adjuster has 1 active claim: should NOT be in totalActive
      await createClaim(org1._id, officer1._id, 'ASSIGNED', inactiveAdjuster1._id);

      // Other statuses (review & decisions)
      await createClaim(org1._id, officer1._id, 'SUBMITTED', adjuster1._id);
      await createClaim(org1._id, officer1._id, 'UNDER_REVIEW', adjuster1._id);
      await createClaim(org1._id, officer1._id, 'APPROVED', adjuster1._id);
      await createClaim(org1._id, officer1._id, 'REJECTED', adjuster2._id);
      await createClaim(org1._id, officer1._id, 'CLOSED', adjuster2._id);
    });

    it('should return complete uniform response envelope for CLAIMS_OFFICER', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.scope).toBe('ORGANIZATION');

      // Verify all 10 statuses present
      expect(data.byStatus).toEqual({
        NEW: 2,
        PENDING_ACCEPTANCE: 0,
        ASSIGNED: 3, // adjuster1: 1, adjuster2: 1, inactiveAdjuster: 1
        IN_PROGRESS: 2, // adjuster1: 1, adjuster2: 1
        SUBMITTED: 1,
        UNDER_REVIEW: 1,
        CORRECTION_REQUIRED: 1, // adjuster2: 1
        APPROVED: 1,
        REJECTED: 1,
        CLOSED: 1,
      });

      // totalClaims = 2 + 3 + 2 + 1 + 1 + 1 + 1 + 1 + 1 = 13
      expect(data.totalClaims).toBe(13);

      // pendingActionCount = NEW (2) + SUBMITTED (1) + UNDER_REVIEW (1) = 4
      expect(data.pendingActionCount).toBe(4);

      // actionableBreakdown: unassigned = NEW (2), readyForReview = SUBMITTED (1) + UNDER_REVIEW (1) = 2
      expect(data.actionableBreakdown).toEqual({
        unassigned: 2,
        pendingAcceptance: 0,
        readyForReview: 2,
      });

      // adjustersWorkload:
      // Active field adjusters: adjuster1, adjuster2, adjuster3 (totalActive = 3, inactive excluded)
      // adjuster1: 2 active claims -> nearCapacity = 1, available = 1
      // adjuster2: 3 active claims -> atCapacity = 1, available = 1 (<= 3 is AVAILABLE per domain convention)
      // adjuster3: 0 active claims -> available = 1
      // Total available = 3, nearCapacity = 1, atCapacity = 1
      expect(data.adjustersWorkload).toEqual({
        totalActive: 3,
        available: 3,
        nearCapacity: 1,
        atCapacity: 1,
      });

      // capacity must NOT be present for ADMIN / CLAIMS_OFFICER
      expect(data.capacity).toBeUndefined();
    });

    it('should return identical organization-wide stats for ADMIN role', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.scope).toBe('ORGANIZATION');
      expect(res.body.data.totalClaims).toBe(13);
      expect(res.body.data.pendingActionCount).toBe(4);
      expect(res.body.data.adjustersWorkload.totalActive).toBe(3);
      expect(res.body.data.capacity).toBeUndefined();
    });
  });

  describe('3. FIELD_ADJUSTER Response Envelope & Role Scoping', () => {
    beforeEach(async () => {
      // Org 1 claims:
      // 2 unassigned claims (NEW)
      await createClaim(org1._id, officer1._id, 'NEW');
      await createClaim(org1._id, officer1._id, 'NEW');

      // Adjuster 1 claims:
      // ASSIGNED: 2, IN_PROGRESS: 1, CORRECTION_REQUIRED: 1, SUBMITTED: 1, APPROVED: 1
      await createClaim(org1._id, officer1._id, 'ASSIGNED', adjuster1._id);
      await createClaim(org1._id, officer1._id, 'ASSIGNED', adjuster1._id);
      await createClaim(org1._id, officer1._id, 'IN_PROGRESS', adjuster1._id);
      await createClaim(org1._id, officer1._id, 'CORRECTION_REQUIRED', adjuster1._id);
      await createClaim(org1._id, officer1._id, 'SUBMITTED', adjuster1._id);
      await createClaim(org1._id, officer1._id, 'APPROVED', adjuster1._id);

      // Adjuster 2 claims:
      // ASSIGNED: 1, CLOSED: 1
      await createClaim(org1._id, officer1._id, 'ASSIGNED', adjuster2._id);
      await createClaim(org1._id, officer1._id, 'CLOSED', adjuster2._id);
    });

    it('should scope stats strictly to the calling adjuster and provide capacity', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats')
        .set('Authorization', `Bearer ${adjuster1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.scope).toBe('ASSIGNED');

      // Adjuster 1 should see only their own claims (total: 6)
      // NEW should be 0 because unassigned claims have no assignedTo
      expect(data.totalClaims).toBe(6);
      expect(data.byStatus).toEqual({
        NEW: 0,
        PENDING_ACCEPTANCE: 0,
        ASSIGNED: 2,
        IN_PROGRESS: 1,
        SUBMITTED: 1,
        UNDER_REVIEW: 0,
        CORRECTION_REQUIRED: 1,
        APPROVED: 1,
        REJECTED: 0,
        CLOSED: 0,
      });

      // pendingActionCount = ASSIGNED (2) + IN_PROGRESS (1) + CORRECTION_REQUIRED (1) = 4
      expect(data.pendingActionCount).toBe(4);

      // actionableBreakdown: toStart, inProgress, needsCorrection
      expect(data.actionableBreakdown).toEqual({
        toStart: 2,
        inProgress: 1,
        needsCorrection: 1,
      });

      // capacity: { active: 4, max: 3 }
      expect(data.capacity).toEqual({
        active: 4,
        max: 3,
      });

      // adjustersWorkload must NOT be present for FIELD_ADJUSTER
      expect(data.adjustersWorkload).toBeUndefined();
    });

    it('should return separate scoped stats for adjuster 2', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats')
        .set('Authorization', `Bearer ${adjuster2Token}`);

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.scope).toBe('ASSIGNED');
      expect(data.totalClaims).toBe(2);
      expect(data.byStatus.ASSIGNED).toBe(1);
      expect(data.byStatus.CLOSED).toBe(1);
      expect(data.pendingActionCount).toBe(1);
      expect(data.actionableBreakdown).toEqual({
        toStart: 1,
        inProgress: 0,
        needsCorrection: 0,
      });
      expect(data.capacity).toEqual({
        active: 1,
        max: 3,
      });
      expect(data.adjustersWorkload).toBeUndefined();
    });
  });

  describe('4. Multi-Tenancy Isolation', () => {
    beforeEach(async () => {
      // Org 1: 2 claims
      await createClaim(org1._id, officer1._id, 'NEW');
      await createClaim(org1._id, officer1._id, 'ASSIGNED', adjuster1._id);

      // Org 2: 5 claims
      await createClaim(org2._id, officer2._id, 'NEW');
      await createClaim(org2._id, officer2._id, 'ASSIGNED', adjusterOrg2._id);
      await createClaim(org2._id, officer2._id, 'IN_PROGRESS', adjusterOrg2._id);
      await createClaim(org2._id, officer2._id, 'SUBMITTED', adjusterOrg2._id);
      await createClaim(org2._id, officer2._id, 'APPROVED', adjusterOrg2._id);
    });

    it('should never leak claims or workload across organizations (Org 1 vs Org 2)', async () => {
      // Org 1 caller
      const resOrg1 = await request(app)
        .get('/api/v1/claims/stats')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(resOrg1.status).toBe(200);
      expect(resOrg1.body.data.totalClaims).toBe(2);
      expect(resOrg1.body.data.adjustersWorkload.totalActive).toBe(3); // adjuster1, adjuster2, adjuster3

      // Org 2 caller
      const resOrg2 = await request(app)
        .get('/api/v1/claims/stats')
        .set('Authorization', `Bearer ${officer2Token}`);

      expect(resOrg2.status).toBe(200);
      expect(resOrg2.body.data.totalClaims).toBe(5);
      expect(resOrg2.body.data.adjustersWorkload.totalActive).toBe(1); // adjusterOrg2
    });

    it('should handle zero-claim organization gracefully with all 0 metrics', async () => {
      // Create empty tenant
      const emptyOrg = await Organization.create({ name: 'Empty Org', code: 'EMPT' });
      const emptyOfficer = await User.create({
        name: 'Empty Officer',
        employeeCode: 'EMP-OFF',
        password: 'password',
        role: 'CLAIMS_OFFICER',
        organizationId: emptyOrg._id,
        status: 'ACTIVE',
      });
      const emptyToken = generateToken(emptyOfficer);

      const res = await request(app)
        .get('/api/v1/claims/stats')
        .set('Authorization', `Bearer ${emptyToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalClaims).toBe(0);
      expect(res.body.data.pendingActionCount).toBe(0);
      expect(res.body.data.actionableBreakdown).toEqual({
        unassigned: 0,
        pendingAcceptance: 0,
        readyForReview: 0,
      });
      expect(res.body.data.adjustersWorkload).toEqual({
        totalActive: 0,
        available: 0,
        nearCapacity: 0,
        atCapacity: 0,
      });
    });
  });

  describe('5. Date Filtering (from, to)', () => {
    beforeEach(async () => {
      // Create claims with explicit timestamps:
      // Claim 1: 2025-06-15T10:00:00.000Z
      await createClaim(org1._id, officer1._id, 'NEW', null, new Date('2025-06-15T10:00:00.000Z'));
      // Claim 2: 2025-06-15T22:30:00.000Z (tests date-only 'to' expansion to 23:59:59.999Z)
      await createClaim(org1._id, officer1._id, 'ASSIGNED', adjuster1._id, new Date('2025-06-15T22:30:00.000Z'));
      // Claim 3: 2025-08-01T12:00:00.000Z
      await createClaim(org1._id, officer1._id, 'IN_PROGRESS', adjuster1._id, new Date('2025-08-01T12:00:00.000Z'));
      // Claim 4: 2026-01-10T14:00:00.000Z
      await createClaim(org1._id, officer1._id, 'APPROVED', adjuster1._id, new Date('2026-01-10T14:00:00.000Z'));
    });

    it('should filter claims by date-only range inclusive of both ends', async () => {
      // 2025-06-15 expands from 00:00:00.000Z to 23:59:59.999Z, capturing both Claim 1 & Claim 2
      const res = await request(app)
        .get('/api/v1/claims/stats?from=2025-06-15&to=2025-06-15')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalClaims).toBe(2);
      expect(res.body.data.byStatus.NEW).toBe(1);
      expect(res.body.data.byStatus.ASSIGNED).toBe(1);
    });

    it('should filter with only "from" supplied (open-ended upper bound)', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats?from=2025-08-01')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(200);
      // Should match Claim 3 (2025-08-01) and Claim 4 (2026-01-10)
      expect(res.body.data.totalClaims).toBe(2);
      expect(res.body.data.byStatus.IN_PROGRESS).toBe(1);
      expect(res.body.data.byStatus.APPROVED).toBe(1);
    });

    it('should filter with only "to" supplied (open-ended lower bound)', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats?to=2025-06-15')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(200);
      // Should match Claim 1 & Claim 2
      expect(res.body.data.totalClaims).toBe(2);
      expect(res.body.data.byStatus.NEW).toBe(1);
      expect(res.body.data.byStatus.ASSIGNED).toBe(1);
    });

    it('should return all-time claims when neither from nor to is supplied', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalClaims).toBe(4);
    });

    it('should accept full ISO timestamps', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats?from=2025-06-15T00:00:00.000Z&to=2025-06-15T12:00:00.000Z')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(200);
      // Only Claim 1 was created before 12:00
      expect(res.body.data.totalClaims).toBe(1);
      expect(res.body.data.byStatus.NEW).toBe(1);
    });

    it('should silently cap future "to" date to current server timestamp (not an error)', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats?from=2025-01-01&to=2099-01-01')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalClaims).toBe(4);
    });
  });

  describe('6. Query Validation Errors (400 VALIDATION_ERROR)', () => {
    it('should return 400 when from date > to date', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats?from=2025-06-20&to=2025-06-10')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'VALIDATION_ERROR',
            details: 'from date must be before or equal to to date',
          }),
        ])
      );
    });

    it('should return 400 when from date is in the future', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats?from=2099-01-01')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'VALIDATION_ERROR',
            details: 'from date cannot be in the future',
          }),
        ])
      );
    });

    it('should return 400 when date range exceeds 5 years', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats?from=2018-01-01&to=2025-01-01')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'VALIDATION_ERROR',
            details: 'date range cannot exceed 5 years',
          }),
        ])
      );
    });

    it('should return 400 when only from is supplied and it exceeds 5 years from now', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats?from=2015-01-01')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'VALIDATION_ERROR',
            details: 'date range cannot exceed 5 years',
          }),
        ])
      );
    });

    it('should return 400 when invalid date string is provided', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats?from=invalid-date')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when unknown query parameter is passed', async () => {
      const res = await request(app)
        .get('/api/v1/claims/stats?unexpected=param')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });
  });
});

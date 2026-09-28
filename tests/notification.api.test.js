const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const Policy = require('../src/modules/policies/policy.model');
const { buildPolicy } = require('./helpers/policyFactory');
const Customer = require('../src/modules/customers/customer.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Notification = require('../src/modules/notifications/notification.model');
const notificationService = require('../src/modules/notifications/notification.service');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');

let mongoServer;

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Feature 21: Dashboard Notification Center API & Triggers', () => {
  let org1, org2;
  let admin1, officer1, officer2, inactiveOfficer, adjuster1;
  let officerOrg2;
  let adminToken, officer1Token, officer2Token, adjusterToken, org2Token;
  let policy1, customer1, vehicle1, claim1, claim2;

  beforeEach(async () => {
    // Clean collections
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany();
    }

    // ── Organizations ──
    org1 = await Organization.create({ name: 'Alpha Insurance', code: 'ALPHA', domain: 'alpha.com', status: 'ACTIVE' });
    org2 = await Organization.create({ name: 'Beta Insurance', code: 'BETA', domain: 'beta.com', status: 'ACTIVE' });

    // ── Users (Org 1) ──
    admin1 = await User.create({
      name: 'Alpha Admin', employeeCode: 'ADM-01', password: 'password123',
      role: 'ADMIN', organizationId: org1._id, status: 'ACTIVE',
    });
    adminToken = generateToken(admin1);

    officer1 = await User.create({
      name: 'Officer One', employeeCode: 'OFF-01', password: 'password123',
      role: 'CLAIMS_OFFICER', organizationId: org1._id, status: 'ACTIVE',
    });
    officer1Token = generateToken(officer1);

    officer2 = await User.create({
      name: 'Officer Two', employeeCode: 'OFF-02', password: 'password123',
      role: 'CLAIMS_OFFICER', organizationId: org1._id, status: 'ACTIVE',
    });
    officer2Token = generateToken(officer2);

    inactiveOfficer = await User.create({
      name: 'Inactive Officer', employeeCode: 'OFF-INACTIVE', password: 'password123',
      role: 'CLAIMS_OFFICER', organizationId: org1._id, status: 'INACTIVE',
    });

    adjuster1 = await User.create({
      name: 'Adjuster One', employeeCode: 'ADJ-01', password: 'password123',
      role: 'FIELD_ADJUSTER', organizationId: org1._id, status: 'ACTIVE',
    });
    adjusterToken = generateToken(adjuster1);

    // ── Users (Org 2) ──
    officerOrg2 = await User.create({
      name: 'Beta Officer', employeeCode: 'OFF-B01', password: 'password123',
      role: 'CLAIMS_OFFICER', organizationId: org2._id, status: 'ACTIVE',
    });
    org2Token = generateToken(officerOrg2);

    // ── Policy, Customer, Vehicle, Claims ──
    customer1 = await Customer.create({
      fullName: 'Customer One', phone: '+962791112233', organizationId: org1._id,
    });

    policy1 = await buildPolicy({
      policyNumber: 'POL-ALPHA-01', status: 'ACTIVE',
      startDate: new Date('2025-01-01'), expiryDate: new Date('2027-12-31'),
      organizationId: org1._id,
    });

    vehicle1 = await Vehicle.create({
      plateNumber: '11-22334', make: 'Toyota', model: 'Corolla', year: 2022,
      customerId: customer1._id, policyId: policy1._id, organizationId: org1._id,
    });

    claim1 = await Claim.create({
      organizationId: org1._id,
      createdBy: officer1._id,
      policyId: policy1._id,
      status: 'NEW',
      customer: { name: 'Customer One', phone: '+962791112233' },
      vehicle: { plateNumber: vehicle1.plateNumber, vehicleId: vehicle1._id, policyId: policy1._id },
      incidentType: 'COLLISION',
      incidentLocation: 'Amman Downtown',
    });

    claim2 = await Claim.create({
      organizationId: org1._id,
      createdBy: officer1._id,
      policyId: policy1._id,
      status: 'PENDING_ACCEPTANCE',
      assignedTo: adjuster1._id,
      assignedBy: officer1._id,
      assignedAt: new Date(),
      customer: { name: 'Customer One', phone: '+962791112233' },
      vehicle: { plateNumber: vehicle1.plateNumber, vehicleId: vehicle1._id, policyId: policy1._id },
      incidentType: 'COLLISION',
      incidentLocation: 'Amman 7th Circle',
    });
  });

  describe('GET /api/v1/notifications', () => {
    beforeEach(async () => {
      // Seed notifications for officer1: 3 unread, 2 read
      const baseTime = Date.now();
      await Notification.create([
        {
          recipientId: officer1._id, organizationId: org1._id, type: 'NEW_CLAIM',
          relatedClaimId: claim1._id, title: 'New Claim 1', body: 'Body 1',
          readAt: null, createdAt: new Date(baseTime - 4000),
        },
        {
          recipientId: officer1._id, organizationId: org1._id, type: 'INSPECTION_COMPLETED',
          relatedClaimId: claim1._id, title: 'Inspection 2', body: 'Body 2',
          readAt: new Date(baseTime - 2000), createdAt: new Date(baseTime - 3000),
        },
        {
          recipientId: officer1._id, organizationId: org1._id, type: 'ASSIGNMENT_DECLINED',
          relatedClaimId: claim2._id, title: 'Declined 3', body: 'Body 3',
          readAt: null, createdAt: new Date(baseTime - 2000),
        },
        {
          recipientId: officer1._id, organizationId: org1._id, type: 'APPROVED',
          relatedClaimId: claim1._id, title: 'Approved 4', body: 'Body 4',
          readAt: new Date(baseTime - 500), createdAt: new Date(baseTime - 1000),
        },
        {
          recipientId: officer1._id, organizationId: org1._id, type: 'NEW_CLAIM',
          relatedClaimId: claim2._id, title: 'New Claim 5', body: 'Body 5',
          readAt: null, createdAt: new Date(baseTime),
        },
      ]);

      // Seed a notification for officer2 (same org)
      await Notification.create({
        recipientId: officer2._id, organizationId: org1._id, type: 'NEW_CLAIM',
        relatedClaimId: claim1._id, title: 'Officer 2 Notif', body: 'Body',
        readAt: null,
      });

      // Seed a notification for officerOrg2 (different org)
      await Notification.create({
        recipientId: officerOrg2._id, organizationId: org2._id, type: 'NEW_CLAIM',
        relatedClaimId: claim1._id, title: 'Org 2 Notif', body: 'Body',
        readAt: null,
      });
    });

    it('should return paginated notifications newest first with headers and populated claimNumber', async () => {
      const res = await request(app)
        .get('/api/v1/notifications?page=1&limit=2')
        .set('Authorization', `Bearer ${officer1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.headers['x-total-count']).toBe('5');
      expect(res.headers['x-page']).toBe('1');
      expect(res.headers['x-limit']).toBe('2');
      expect(res.headers['x-total-pages']).toBe('3');

      // First item is newest
      expect(res.body.data[0].title).toBe('New Claim 5');
      expect(res.body.data[1].title).toBe('Approved 4');

      // Populated relatedClaimId should include claimNumber
      expect(res.body.data[0].relatedClaimId).toBeDefined();
      expect(res.body.data[0].relatedClaimId.claimNumber).toBe(claim2.claimNumber);
      expect(res.body.data[0].claimNumber).toBeUndefined(); // Never stored on document directly
    });

    it('should filter unread notifications when unreadOnly=true', async () => {
      const res = await request(app)
        .get('/api/v1/notifications?unreadOnly=true')
        .set('Authorization', `Bearer ${officer1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);
      expect(res.headers['x-total-count']).toBe('3');
      res.body.data.forEach((notif) => {
        expect(notif.readAt).toBeNull();
      });
    });

    it('should enforce user and tenant scoping strictly', async () => {
      const resOfficer2 = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${officer2Token}`);

      expect(resOfficer2.status).toBe(200);
      expect(resOfficer2.body.data).toHaveLength(1);
      expect(resOfficer2.body.data[0].title).toBe('Officer 2 Notif');

      const resOrg2 = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${org2Token}`);

      expect(resOrg2.status).toBe(200);
      expect(resOrg2.body.data).toHaveLength(1);
      expect(resOrg2.body.data[0].title).toBe('Org 2 Notif');
    });

    it('should return 401 when unauthenticated', async () => {
      const res = await request(app).get('/api/v1/notifications');
      expect(res.status).toBe(401);
    });

    it('should return 400 on invalid query parameters', async () => {
      const res1 = await request(app)
        .get('/api/v1/notifications?page=0')
        .set('Authorization', `Bearer ${officer1Token}`);
      expect(res1.status).toBe(400);

      const res2 = await request(app)
        .get('/api/v1/notifications?limit=150')
        .set('Authorization', `Bearer ${officer1Token}`);
      expect(res2.status).toBe(400);

      const res3 = await request(app)
        .get('/api/v1/notifications?unknownParam=xyz')
        .set('Authorization', `Bearer ${officer1Token}`);
      expect(res3.status).toBe(400);
    });
  });

  describe('GET /api/v1/notifications/unread-count', () => {
    beforeEach(async () => {
      await Notification.create([
        {
          recipientId: officer1._id, organizationId: org1._id, type: 'NEW_CLAIM',
          relatedClaimId: claim1._id, title: 'Notif 1', body: 'B1', readAt: null,
        },
        {
          recipientId: officer1._id, organizationId: org1._id, type: 'NEW_CLAIM',
          relatedClaimId: claim1._id, title: 'Notif 2', body: 'B2', readAt: null,
        },
        {
          recipientId: officer1._id, organizationId: org1._id, type: 'NEW_CLAIM',
          relatedClaimId: claim1._id, title: 'Notif 3', body: 'B3', readAt: new Date(),
        },
      ]);
    });

    it('should return accurate unread count for req.user', async () => {
      const res = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${officer1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ count: 2 });
    });

    it('should return 0 when user has no unread notifications', async () => {
      const res = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${officer2Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ count: 0 });
    });

    it('should return 401 when unauthenticated', async () => {
      const res = await request(app).get('/api/v1/notifications/unread-count');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/v1/notifications/:id/read', () => {
    let notif;

    beforeEach(async () => {
      notif = await Notification.create({
        recipientId: officer1._id,
        organizationId: org1._id,
        type: 'NEW_CLAIM',
        relatedClaimId: claim1._id,
        title: 'Unread Notification',
        body: 'Mark me as read',
        readAt: null,
      });
    });

    it('should mark notification as read and set readAt timestamp', async () => {
      const res = await request(app)
        .patch(`/api/v1/notifications/${notif._id}/read`)
        .set('Authorization', `Bearer ${officer1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.readAt).not.toBeNull();
      expect(new Date(res.body.data.readAt)).toBeInstanceOf(Date);
      expect(res.body.data.relatedClaimId.claimNumber).toBe(claim1.claimNumber);

      const inDb = await Notification.findById(notif._id);
      expect(inDb.readAt).not.toBeNull();
    });

    it('should be idempotent and not overwrite readAt on subsequent calls', async () => {
      const res1 = await request(app)
        .patch(`/api/v1/notifications/${notif._id}/read`)
        .set('Authorization', `Bearer ${officer1Token}`);

      const firstReadAt = res1.body.data.readAt;

      // Small delay to ensure timestamp would differ if overwritten
      await new Promise((r) => setTimeout(r, 50));

      const res2 = await request(app)
        .patch(`/api/v1/notifications/${notif._id}/read`)
        .set('Authorization', `Bearer ${officer1Token}`);

      expect(res2.status).toBe(200);
      expect(res2.body.data.readAt).toBe(firstReadAt);
    });

    it('should return 404 stealth-tenancy when notification belongs to another user in same org', async () => {
      const res = await request(app)
        .patch(`/api/v1/notifications/${notif._id}/read`)
        .set('Authorization', `Bearer ${officer2Token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('NOTIFICATION_NOT_FOUND');
    });

    it('should return 404 stealth-tenancy when notification belongs to user in another org', async () => {
      const res = await request(app)
        .patch(`/api/v1/notifications/${notif._id}/read`)
        .set('Authorization', `Bearer ${org2Token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('NOTIFICATION_NOT_FOUND');
    });

    it('should return 404 when notification does not exist', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .patch(`/api/v1/notifications/${nonExistentId}/read`)
        .set('Authorization', `Bearer ${officer1Token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('NOTIFICATION_NOT_FOUND');
    });

    it('should return 400 when notification ID is not a valid ObjectId', async () => {
      const res = await request(app)
        .patch('/api/v1/notifications/invalid-id/read')
        .set('Authorization', `Bearer ${officer1Token}`);

      expect(res.status).toBe(400);
    });
  });

  describe('Notification Service: sendToOrganization helper', () => {
    it('should produce 1 document per active CLAIMS_OFFICER and ADMIN in the org', async () => {
      const notifs = await notificationService.sendToOrganization({
        organizationId: org1._id,
        type: 'INSPECTION_COMPLETED',
        relatedClaimId: claim1._id,
        title: 'Inspection Completed',
        body: 'Inspection is done',
      });

      // Active officers/admins in org1: admin1, officer1, officer2 = 3 users
      // adjuster1 (FIELD_ADJUSTER) and inactiveOfficer (INACTIVE) excluded
      expect(notifs).toHaveLength(3);

      const recipientIds = notifs.map((n) => n.recipientId.toString());
      expect(recipientIds).toContain(admin1._id.toString());
      expect(recipientIds).toContain(officer1._id.toString());
      expect(recipientIds).toContain(officer2._id.toString());
      expect(recipientIds).not.toContain(adjuster1._id.toString());
      expect(recipientIds).not.toContain(inactiveOfficer._id.toString());
      expect(recipientIds).not.toContain(officerOrg2._id.toString());
    });

    it('should exclude specified excludeUserId from recipient list', async () => {
      const notifs = await notificationService.sendToOrganization({
        organizationId: org1._id,
        type: 'NEW_CLAIM',
        relatedClaimId: claim1._id,
        title: 'New Claim Created',
        body: 'Claim created',
        excludeUserId: officer1._id,
      });

      // Active officers/admins excluding officer1: admin1, officer2 = 2 users
      expect(notifs).toHaveLength(2);
      const recipientIds = notifs.map((n) => n.recipientId.toString());
      expect(recipientIds).not.toContain(officer1._id.toString());
      expect(recipientIds).toContain(admin1._id.toString());
      expect(recipientIds).toContain(officer2._id.toString());
    });

    it('should return empty array and not throw when zero active officers/admins exist in org', async () => {
      const emptyOrg = await Organization.create({ name: 'Empty Org', code: 'EMPTY', domain: 'empty.com' });

      let result;
      await expect(
        (async () => {
          result = await notificationService.sendToOrganization({
            organizationId: emptyOrg._id,
            type: 'NEW_CLAIM',
            relatedClaimId: claim1._id,
            title: 'No one to notify',
            body: 'Zero recipients',
          });
        })()
      ).resolves.not.toThrow();

      expect(result).toEqual([]);
    });
  });

  describe('Trigger Integration in Claims Domain', () => {
    it('Trigger 1: createClaim should fire NEW_CLAIM to active officers/admins excluding creator', async () => {
      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({
          policyId: policy1._id.toString(),
          plateNumber: vehicle1.plateNumber,
          incidentType: 'COLLISION',
          incidentLocation: 'Rainbow Street',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const createdClaimId = res.body.data.id;

      // Check Notification documents created
      const notifs = await Notification.find({
        organizationId: org1._id,
        type: 'NEW_CLAIM',
        relatedClaimId: createdClaimId,
      });

      // Should be 2 notifications (admin1, officer2), excluding officer1
      expect(notifs).toHaveLength(2);
      const recipients = notifs.map((n) => n.recipientId.toString());
      expect(recipients).not.toContain(officer1._id.toString());
      expect(recipients).toContain(admin1._id.toString());
      expect(recipients).toContain(officer2._id.toString());
    });

    it('Trigger 2: declineAssignment should fire ASSIGNMENT_DECLINED to active officers/admins', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${claim2._id}/decline-assignment`)
        .set('Authorization', `Bearer ${adjusterToken}`)
        .send({ reason: 'Overloaded with cases' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('NEW');

      const notifs = await Notification.find({
        organizationId: org1._id,
        type: 'ASSIGNMENT_DECLINED',
        relatedClaimId: claim2._id,
      });

      // 3 active officers/admins in org1 (admin1, officer1, officer2)
      expect(notifs).toHaveLength(3);
      const recipients = notifs.map((n) => n.recipientId.toString());
      expect(recipients).toContain(admin1._id.toString());
      expect(recipients).toContain(officer1._id.toString());
      expect(recipients).toContain(officer2._id.toString());
      expect(notifs[0].title).toBe('Assignment Declined');
    });

    it('Trigger 3: submitInspection should fire INSPECTION_COMPLETED to active officers/admins', async () => {
      // Transition claim to IN_PROGRESS with complete pillars
      await Claim.findByIdAndUpdate(claim2._id, {
        status: 'IN_PROGRESS',
        assignedTo: adjuster1._id,
        accident: { accidentType: 'COLLISION' },
        location: { latitude: 31.95, longitude: 35.91 },
        evidence: [{ url: 'https://cloudinary.com/test.jpg', publicId: 'ev1' }],
        signature: { url: 'https://cloudinary.com/sig.png', publicId: 'sig1' },
      });

      const res = await request(app)
        .post(`/api/v1/claims/${claim2._id}/inspection/submit`)
        .set('Authorization', `Bearer ${adjusterToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUBMITTED');

      const notifs = await Notification.find({
        organizationId: org1._id,
        type: 'INSPECTION_COMPLETED',
        relatedClaimId: claim2._id,
      });

      // 3 active officers/admins in org1 (admin1, officer1, officer2)
      expect(notifs).toHaveLength(3);
      const recipients = notifs.map((n) => n.recipientId.toString());
      expect(recipients).toContain(admin1._id.toString());
      expect(recipients).toContain(officer1._id.toString());
      expect(recipients).toContain(officer2._id.toString());
      expect(notifs[0].title).toBe('Inspection Completed');
    });

    it('Zero-failure guarantee: claim operations succeed even if notification throws', async () => {
      const sendToOrgSpy = jest.spyOn(notificationService, 'sendToOrganization')
        .mockRejectedValue(new Error('Simulated notification DB crash'));

      const res = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officer1Token}`)
        .send({
          policyId: policy1._id.toString(),
          plateNumber: vehicle1.plateNumber,
          incidentType: 'COLLISION',
          incidentLocation: 'Rainbow Street',
        });

      // Claim creation must still succeed with 201
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      sendToOrgSpy.mockRestore();
    });
  });
});

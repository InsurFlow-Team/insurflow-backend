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
const Garage = require('../src/modules/garages/garage.model');
const Counter = require('../src/utils/counter.model');
const crypto = require('crypto');
const { buildPolicy } = require('./helpers/policyFactory');
const config = require('../src/config/env');

let letterTemplates;
try {
  letterTemplates = require('../src/modules/letters/letter.templates');
} catch {
  letterTemplates = null;
}

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

describe('PB-10: Repair Orders, Tracking & Repair Authorization Letter', () => {
  let mongoServer;
  let org1, org2;
  let admin1, officer1, officer2, adjuster1, adjuster2;
  let customer1, vehicle1, policy1;
  let garage1, garage2, unapprovedGarage, org2Garage;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany();
    }

    org1 = await Organization.create({
      name: 'Apex Insurance',
      code: 'APX',
      settings: {
        vatRatePercent: 16,
        letterhead: {
          address: 'Al-Irsal St, Ramallah, Palestine',
          phone: '+97022987654',
        },
      },
    });

    org2 = await Organization.create({
      name: 'Beacon Mutual',
      code: 'BCN',
      settings: {
        vatRatePercent: 16,
        letterhead: {
          address: 'Nablus Main St',
          phone: '+97022345678',
        },
      },
    });

    admin1 = await User.create({
      name: 'Admin Alice',
      employeeCode: 'ADM-01',
      password: 'password123',
      role: 'ADMIN',
      organizationId: org1._id,
    });

    officer1 = await User.create({
      name: 'Officer Oscar',
      employeeCode: 'OFF-01',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
    });

    officer2 = await User.create({
      name: 'Officer Omar',
      employeeCode: 'OFF-02',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org2._id,
    });

    adjuster1 = await User.create({
      name: 'Adjuster Adam',
      employeeCode: 'ADJ-01',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
    });

    adjuster2 = await User.create({
      name: 'Adjuster Amir',
      employeeCode: 'ADJ-02',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
    });

    customer1 = await Customer.create({
      organizationId: org1._id,
      fullName: 'Sarah Connor',
      phone: '0599123456',
      nationalId: '987654321',
    });

    policy1 = await buildPolicy({
      policyNumber: 'POL-RO-001',
      status: 'ACTIVE',
      organizationId: org1._id,
      startDate: new Date('2025-01-01'),
      expiryDate: new Date('2027-12-31'),
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
      deductibleAmount: 500,
    });

    vehicle1 = await Vehicle.create({
      organizationId: org1._id,
      complementaryPolicyId: policy1._id,
      customerId: customer1._id,
      plateNumber: 'DXB-A-12345',
      make: 'Toyota',
      model: 'Corolla',
      year: 2022,
      color: 'White',
    });

    garage1 = await Garage.create({
      organizationId: org1._id,
      name: 'Al-Manara Garage',
      normalizedName: 'al-manara garage',
      governorate: 'RAMALLAH_AL_BIREH',
      city: 'Ramallah',
      phone: '022987001',
      laborRate: 10000,
      approved: true,
    });

    garage2 = await Garage.create({
      organizationId: org1._id,
      name: 'Al-Quds Garage',
      normalizedName: 'al-quds garage',
      governorate: 'JERUSALEM',
      city: 'Al-Eizariya',
      phone: '022987002',
      laborRate: 12000,
      approved: true,
    });

    unapprovedGarage = await Garage.create({
      organizationId: org1._id,
      name: 'Unapproved Auto',
      normalizedName: 'unapproved auto',
      governorate: 'NABLUS',
      city: 'Nablus',
      phone: '022987003',
      laborRate: 8000,
      approved: false,
    });

    org2Garage = await Garage.create({
      organizationId: org2._id,
      name: 'Beacon Partner Garage',
      normalizedName: 'beacon partner garage',
      governorate: 'NABLUS',
      city: 'Nablus',
      phone: '022987004',
      laborRate: 10000,
      approved: true,
    });
  });

  const createApprovedClaim = async (overrides = {}) => {
    return await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'APPROVED',
      trackingToken: crypto.randomBytes(32).toString('hex'),
      customer: { name: 'Sarah Connor', phone: '0599123456' },
      vehicle: {
        plateNumber: 'DXB-A-12345',
        vehicleId: vehicle1._id,
        policyId: policy1._id,
        customerId: customer1._id,
      },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah Main St',
      incidentDate: '2026-07-11',
      lossAssessment: {
        estimatedPartsCost: 200000,
        laborCost: 250000,
        totalDamage: 450000,
        policyDeductible: 50000,
        deductibleApplied: 50000,
        netApprovedPayout: 400000,
        assessedBy: officer1._id,
        assessedAt: new Date(),
      },
      estimatesCount: 0,
      estimates: [],
      repairOrders: [],
      timeline: [
        {
          action: 'Claim Approved',
          performedBy: officer1._id,
          role: 'CLAIMS_OFFICER',
          timestamp: new Date(),
          previousStatus: 'UNDER_REVIEW',
          newStatus: 'APPROVED',
        },
      ],
      ...overrides,
    });
  };

  // ══════════════════════════════════════════════════════════════════════════
  // Suite 1: Repair Order Creation (POST /claims/:claimId/repair-orders)
  // ══════════════════════════════════════════════════════════════════════════

  test('R2 & A1: create on APPROVED with explicit garage succeeds with 201 and status AUTHORIZED', async () => {
    const claim = await createApprovedClaim();
    const token = generateToken(officer1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        garageId: garage1._id.toString(),
        notes: 'Initial repair order',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.orderNumber).toMatch(/^RO-APX-\d{4}-\d{4}$/);
    expect(data.status).toBe('AUTHORIZED');
    expect(data.garageId).toBe(garage1._id.toString());
    expect(data.garage.name).toBe(garage1.name);
    expect(data.garage.city).toBe(garage1.city);
    expect(data.garage.phone).toBe(garage1.phone);
    expect(data.authorizedAmount).toBe(4000);
    expect(data.deductibleToCollect).toBe(500);
    expect(data.repairTotal).toBe(4500);
    expect(Array.isArray(data.statusHistory)).toBe(true);
  });

  test('R2 & D2 & A1: create with default garage from latest GARAGE estimate when garageId is omitted', async () => {
    const claim = await createApprovedClaim({
      estimates: [
        {
          version: 1,
          source: 'SURVEYOR',
          garageId: null,
          vatApplied: true,
          vatRatePercent: 16,
          lines: [],
          totals: { partsNet: 0, labor: 0, paint: 0, surveyorFee: 0, towing: 0, repairSubtotal: 0, vat: 0, repairTotal: 0, expenses: 0 },
          mapped: { estimatedPartsCost: 0, laborCost: 0 },
          createdBy: adjuster1._id,
          createdByRole: 'FIELD_ADJUSTER',
        },
        {
          version: 2,
          source: 'GARAGE',
          garageId: garage2._id,
          vatApplied: true,
          vatRatePercent: 16,
          lines: [],
          totals: { partsNet: 0, labor: 0, paint: 0, surveyorFee: 0, towing: 0, repairSubtotal: 0, vat: 0, repairTotal: 0, expenses: 0 },
          mapped: { estimatedPartsCost: 0, laborCost: 0 },
          createdBy: officer1._id,
          createdByRole: 'CLAIMS_OFFICER',
        },
      ],
      estimatesCount: 2,
    });

    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data.garageId).toBe(garage2._id.toString());
    expect(res.body.data.garage.name).toBe(garage2.name);
  });

  test('A1: 400 VALIDATION_ERROR when garageId is omitted and claim has no GARAGE estimate quote', async () => {
    const claim = await createApprovedClaim({ estimates: [] });
    const token = generateToken(officer1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    expect(res.body.errors[0].details).toContain('garageId is required when the claim has no garage quote');
  });

  test('A1: 404 GARAGE_NOT_FOUND when explicit garageId belongs to another organization', async () => {
    const claim = await createApprovedClaim();
    const token = generateToken(officer1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: org2Garage._id.toString() });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('GARAGE_NOT_FOUND');
  });

  test('A1: 404 GARAGE_NOT_FOUND when explicit garage is unapproved (approved: false)', async () => {
    const claim = await createApprovedClaim();
    const token = generateToken(officer1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: unapprovedGarage._id.toString() });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('GARAGE_NOT_FOUND');
  });

  test('R2: 409 INVALID_STATUS_TRANSITION when creating repair order on UNDER_REVIEW claim', async () => {
    const claim = await createApprovedClaim({ status: 'UNDER_REVIEW' });
    const token = generateToken(officer1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage1._id.toString() });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R2: 409 INVALID_STATUS_TRANSITION when creating repair order on REJECTED claim', async () => {
    const claim = await createApprovedClaim({ status: 'REJECTED' });
    const token = generateToken(officer1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage1._id.toString() });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R2: 409 INVALID_STATUS_TRANSITION when creating repair order on CLOSED claim', async () => {
    const claim = await createApprovedClaim({ status: 'CLOSED' });
    const token = generateToken(officer1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage1._id.toString() });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R2: 409 INVALID_STATUS_TRANSITION when creating repair order on claim without lossAssessment', async () => {
    const claim = await createApprovedClaim({ lossAssessment: null });
    const token = generateToken(officer1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage1._id.toString() });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R2: 409 REPAIR_ORDER_EXISTS when creating second repair order while an order is active', async () => {
    const claim = await createApprovedClaim();
    const token = generateToken(officer1);

    const firstRes = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage1._id.toString() });
    expect(firstRes.status).toBe(201);

    const secondRes = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage2._id.toString() });

    expect(secondRes.status).toBe(409);
    expect(secondRes.body.errors[0].code).toBe('REPAIR_ORDER_EXISTS');
  });

  test('R2: 409 REPAIR_ORDER_EXISTS when creating second repair order after an order is DELIVERED', async () => {
    const claim = await createApprovedClaim();
    const token = generateToken(officer1);

    const firstRes = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage1._id.toString() });
    expect(firstRes.status).toBe(201);
    const orderNumber = firstRes.body.data.orderNumber;

    // Transition AUTHORIZED -> IN_REPAIR -> READY -> DELIVERED
    await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_REPAIR' });
    await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'READY' });
    await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DELIVERED' });

    const secondRes = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage2._id.toString() });

    expect(secondRes.status).toBe(409);
    expect(secondRes.body.errors[0].code).toBe('REPAIR_ORDER_EXISTS');
  });

  test('R2: concurrent creates on the same claim give one 201 and one 409 REPAIR_ORDER_EXISTS', async () => {
    const claim = await createApprovedClaim();
    const token = generateToken(officer1);

    const [resA, resB] = await Promise.all([
      request(app)
        .post(`/api/v1/claims/${claim._id}/repair-orders`)
        .set('Authorization', `Bearer ${token}`)
        .send({ garageId: garage1._id.toString() }),
      request(app)
        .post(`/api/v1/claims/${claim._id}/repair-orders`)
        .set('Authorization', `Bearer ${token}`)
        .send({ garageId: garage1._id.toString() }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const errorRes = resA.status === 409 ? resA : resB;
    expect(errorRes.body.errors[0].code).toBe('REPAIR_ORDER_EXISTS');
  });

  test('R2: new repair order creation is allowed after prior order was CANCELLED', async () => {
    const claim = await createApprovedClaim();
    const token = generateToken(officer1);

    const firstRes = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage1._id.toString() });
    expect(firstRes.status).toBe(201);
    const order1Number = firstRes.body.data.orderNumber;

    // Cancel order 1
    const cancelRes = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${order1Number}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED', notes: 'Vehicle totaled or client refused garage' });
    expect(cancelRes.status).toBe(200);

    // Create order 2
    const secondRes = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage2._id.toString() });

    expect(secondRes.status).toBe(201);
    expect(secondRes.body.data.status).toBe('AUTHORIZED');
    expect(secondRes.body.data.orderNumber).not.toBe(order1Number);
  });

  test('A3: create matches and succeeds on legacy claim document lacking repairOrders field', async () => {
    const legacyClaimId = new mongoose.Types.ObjectId();
    await Claim.collection.insertOne({
      _id: legacyClaimId,
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      status: 'APPROVED',
      customer: { name: 'Legacy Customer', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      incidentDate: '2026-07-01',
      lossAssessment: {
        estimatedPartsCost: 100000,
        laborCost: 150000,
        totalDamage: 250000,
        policyDeductible: 50000,
        deductibleApplied: 50000,
        netApprovedPayout: 200000,
        assessedBy: officer1._id,
        assessedAt: new Date(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${legacyClaimId}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage1._id.toString() });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('AUTHORIZED');
    expect(res.body.data.authorizedAmount).toBe(2000);
  });

  test('R3 & D1: amounts computed from lossAssessment and returned in major units', async () => {
    const claim = await createApprovedClaim({
      lossAssessment: {
        estimatedPartsCost: 300000,
        laborCost: 350000,
        totalDamage: 650000,
        policyDeductible: 100000,
        deductibleApplied: 100000,
        netApprovedPayout: 550000,
        assessedBy: officer1._id,
        assessedAt: new Date(),
      },
    });

    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage1._id.toString() });

    expect(res.status).toBe(201);
    expect(res.body.data.authorizedAmount).toBe(5500);
    expect(res.body.data.deductibleToCollect).toBe(1000);
    expect(res.body.data.repairTotal).toBe(6500);

    const dbClaim = await Claim.findById(claim._id).lean();
    const stored = dbClaim.repairOrders[0];
    expect(stored.authorizedAmount).toBe(550000);
    expect(stored.deductibleToCollect).toBe(100000);
    expect(stored.repairTotal).toBe(650000);
  });

  test('R3: orderNumber generated as RO-<ORG_CODE>-<YEAR>-0001 via tenant-year Counter', async () => {
    const claim1 = await createApprovedClaim();
    const token = generateToken(officer1);

    const res1 = await request(app)
      .post(`/api/v1/claims/${claim1._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage1._id.toString() });
    expect(res1.status).toBe(201);
    expect(res1.body.data.orderNumber).toBe('RO-APX-2026-0001');

    // Cancel and create second order
    await request(app)
      .patch(`/api/v1/claims/${claim1._id}/repair-orders/${res1.body.data.orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED', notes: 'Cancelled order for sequence test' });

    const res2 = await request(app)
      .post(`/api/v1/claims/${claim1._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage1._id.toString() });
    expect(res2.status).toBe(201);
    expect(res2.body.data.orderNumber).toBe('RO-APX-2026-0002');
  });

  test('A2: garage snapshot is frozen on repair order at creation time', async () => {
    const claim = await createApprovedClaim();
    const token = generateToken(officer1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage1._id.toString() });
    expect(res.status).toBe(201);
    expect(res.body.data.garage.name).toBe('Al-Manara Garage');

    // Update garage name in DB
    await Garage.findByIdAndUpdate(garage1._id, { name: 'Al-Manara Renamed Garage' });

    // Read repair orders
    const getRes = await request(app)
      .get(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data[0].garage.name).toBe('Al-Manara Garage');
  });

  test('R7: claim timeline event Repair Order Created pushed with previousStatus = newStatus = APPROVED', async () => {
    const claim = await createApprovedClaim();
    const token = generateToken(officer1);

    // Public tracking check before
    const trackBefore = await request(app)
      .get(`/api/v1/public/claims/track/${claim.trackingToken}`);
    expect(trackBefore.status).toBe(200);
    const timelineBefore = trackBefore.body.data.timeline;

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage1._id.toString() });
    expect(res.status).toBe(201);

    // Public tracking check after
    const trackAfter = await request(app)
      .get(`/api/v1/public/claims/track/${claim.trackingToken}`);
    expect(trackAfter.status).toBe(200);
    expect(trackAfter.body.data.timeline).toEqual(timelineBefore);

    const dbClaim = await Claim.findById(claim._id).lean();
    const lastEvent = dbClaim.timeline[dbClaim.timeline.length - 1];
    expect(lastEvent.action).toBe('Repair Order Created');
    expect(lastEvent.previousStatus).toBe('APPROVED');
    expect(lastEvent.newStatus).toBe('APPROVED');
    expect(lastEvent.role).toBe('CLAIMS_OFFICER');
  });

  test('R2: 403 FORBIDDEN when FIELD_ADJUSTER attempts to create a repair order', async () => {
    const claim = await createApprovedClaim();
    const token = generateToken(adjuster1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage1._id.toString() });

    expect(res.status).toBe(403);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Suite 2: Repair Order State Transitions (PATCH /claims/:claimId/repair-orders/:orderNumber/status)
  // ══════════════════════════════════════════════════════════════════════════

  const setupClaimWithOrder = async (orderStatus = 'AUTHORIZED') => {
    const claim = await createApprovedClaim();
    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage1._id.toString() });
    const orderNumber = res.body.data.orderNumber;

    if (orderStatus === 'IN_REPAIR') {
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'IN_REPAIR' });
    } else if (orderStatus === 'SUPPLEMENT_REQUESTED') {
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'IN_REPAIR' });
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'SUPPLEMENT_REQUESTED', notes: 'Hidden engine frame damage discovered' });
    } else if (orderStatus === 'READY') {
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'IN_REPAIR' });
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'READY' });
    } else if (orderStatus === 'DELIVERED') {
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'IN_REPAIR' });
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'READY' });
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'DELIVERED' });
    } else if (orderStatus === 'CANCELLED') {
      await request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'CANCELLED', notes: 'Repair order cancelled by insured' });
    }

    return { claim, orderNumber, token };
  };

  test('R4: allowed transition AUTHORIZED -> IN_REPAIR', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('AUTHORIZED');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_REPAIR' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('IN_REPAIR');
    expect(res.body.data.statusHistory.length).toBe(1);
    expect(res.body.data.statusHistory[0].from).toBe('AUTHORIZED');
    expect(res.body.data.statusHistory[0].to).toBe('IN_REPAIR');
  });

  test('R4: allowed transition AUTHORIZED -> CANCELLED with valid notes', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('AUTHORIZED');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED', notes: 'Insured chose alternative settlement' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  test('R4: allowed transition IN_REPAIR -> SUPPLEMENT_REQUESTED with valid notes', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('IN_REPAIR');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUPPLEMENT_REQUESTED', notes: 'Additional suspension work needed' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SUPPLEMENT_REQUESTED');
  });

  test('R4: allowed transition IN_REPAIR -> READY with optional notes', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('IN_REPAIR');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'READY', notes: 'Vehicle ready for pick up' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('READY');
  });

  test('R4: allowed transition IN_REPAIR -> CANCELLED with valid notes', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('IN_REPAIR');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED', notes: 'Vehicle deemed total loss during repair' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  test('R4: allowed transition SUPPLEMENT_REQUESTED -> IN_REPAIR with optional notes', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('SUPPLEMENT_REQUESTED');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_REPAIR', notes: 'Supplement reviewed and repair resumed' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('IN_REPAIR');
  });

  test('R4: allowed transition SUPPLEMENT_REQUESTED -> CANCELLED with valid notes', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('SUPPLEMENT_REQUESTED');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED', notes: 'Cost exceeded economic threshold' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  test('R4: allowed transition READY -> DELIVERED', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('READY');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DELIVERED', notes: 'Customer took delivery' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DELIVERED');
  });

  test('R4: 409 INVALID_STATUS_TRANSITION for forbidden transition AUTHORIZED -> READY', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('AUTHORIZED');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'READY' });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R4: 409 INVALID_STATUS_TRANSITION for forbidden transition AUTHORIZED -> DELIVERED', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('AUTHORIZED');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DELIVERED' });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R4: 409 INVALID_STATUS_TRANSITION for forbidden transition SUPPLEMENT_REQUESTED -> READY', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('SUPPLEMENT_REQUESTED');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'READY' });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R4: 409 INVALID_STATUS_TRANSITION for forbidden transition SUPPLEMENT_REQUESTED -> DELIVERED', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('SUPPLEMENT_REQUESTED');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DELIVERED' });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R4: 409 INVALID_STATUS_TRANSITION for forbidden transition READY -> CANCELLED', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('READY');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED', notes: 'Attempting cancellation of completed vehicle' });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R4: 409 INVALID_STATUS_TRANSITION for forbidden transition READY -> IN_REPAIR', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('READY');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_REPAIR' });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R4: 409 INVALID_STATUS_TRANSITION for forbidden transition READY -> SUPPLEMENT_REQUESTED', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('READY');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUPPLEMENT_REQUESTED', notes: 'Late supplement after vehicle ready' });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R4: 409 INVALID_STATUS_TRANSITION for any transition from terminal status DELIVERED', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('DELIVERED');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'READY' });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R4: 409 INVALID_STATUS_TRANSITION for any transition from terminal status CANCELLED', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('CANCELLED');
    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_REPAIR' });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R4: 400 VALIDATION_ERROR when CANCELLED notes is missing or shorter than 10 characters', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('AUTHORIZED');

    const resMissing = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED' });
    expect(resMissing.status).toBe(400);

    const resTooShort = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED', notes: 'short' });
    expect(resTooShort.status).toBe(400);
  });

  test('R4: 400 VALIDATION_ERROR when SUPPLEMENT_REQUESTED notes is missing or shorter than 10 characters', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('IN_REPAIR');

    const resMissing = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUPPLEMENT_REQUESTED' });
    expect(resMissing.status).toBe(400);

    const resTooShort = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUPPLEMENT_REQUESTED', notes: 'damage' });
    expect(resTooShort.status).toBe(400);
  });

  test('R4: 400 VALIDATION_ERROR when notes exceed 300 characters', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('IN_REPAIR');
    const longNotes = 'a'.repeat(301);

    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'READY', notes: longNotes });

    expect(res.status).toBe(400);
  });

  test('R5: concurrent transitions on same order result in exactly one success and 409 for loser', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('AUTHORIZED');

    const [resA, resB] = await Promise.all([
      request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'IN_REPAIR' }),
      request(app)
        .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'CANCELLED', notes: 'Cancelled due to total loss decision' }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const errorRes = resA.status === 409 ? resA : resB;
    expect(errorRes.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R5: 404 REPAIR_ORDER_NOT_FOUND when orderNumber does not exist on the claim', async () => {
    const claim = await createApprovedClaim();
    const token = generateToken(officer1);

    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/RO-APX-2026-9999/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_REPAIR' });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('REPAIR_ORDER_NOT_FOUND');
  });

  test('R7: status update pushes claim timeline event Repair Order <status> with previousStatus = newStatus = APPROVED', async () => {
    const { claim, orderNumber, token } = await setupClaimWithOrder('AUTHORIZED');

    // Public tracking check before
    const trackBefore = await request(app)
      .get(`/api/v1/public/claims/track/${claim.trackingToken}`);
    expect(trackBefore.status).toBe(200);
    const timelineBefore = trackBefore.body.data.timeline;

    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_REPAIR' });
    expect(res.status).toBe(200);

    // Public tracking check after
    const trackAfter = await request(app)
      .get(`/api/v1/public/claims/track/${claim.trackingToken}`);
    expect(trackAfter.status).toBe(200);
    expect(trackAfter.body.data.timeline).toEqual(timelineBefore);

    const dbClaim = await Claim.findById(claim._id).lean();
    const lastEvent = dbClaim.timeline[dbClaim.timeline.length - 1];
    expect(lastEvent.action).toBe('Repair Order IN_REPAIR');
    expect(lastEvent.previousStatus).toBe('APPROVED');
    expect(lastEvent.newStatus).toBe('APPROVED');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Suite 3: RBAC & Tenant Isolation on Transitions
  // ══════════════════════════════════════════════════════════════════════════

  test('D3 & R6: CLAIMS_OFFICER and ADMIN can perform every allowed status transition', async () => {
    const { claim, orderNumber } = await setupClaimWithOrder('AUTHORIZED');
    const adminToken = generateToken(admin1);

    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'IN_REPAIR' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('IN_REPAIR');
  });

  test('D3 & R6: assigned FIELD_ADJUSTER can transition to IN_REPAIR, SUPPLEMENT_REQUESTED, and READY', async () => {
    const { claim, orderNumber } = await setupClaimWithOrder('AUTHORIZED');
    const adjToken = generateToken(adjuster1);

    const resInRepair = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${adjToken}`)
      .send({ status: 'IN_REPAIR' });
    expect(resInRepair.status).toBe(200);
    expect(resInRepair.body.data.status).toBe('IN_REPAIR');

    const resSupp = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${adjToken}`)
      .send({ status: 'SUPPLEMENT_REQUESTED', notes: 'Field inspection revealed extra frame damage' });
    expect(resSupp.status).toBe(200);
    expect(resSupp.body.data.status).toBe('SUPPLEMENT_REQUESTED');

    const resBack = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${adjToken}`)
      .send({ status: 'IN_REPAIR' });
    expect(resBack.status).toBe(200);

    const resReady = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${adjToken}`)
      .send({ status: 'READY' });
    expect(resReady.status).toBe(200);
    expect(resReady.body.data.status).toBe('READY');
  });

  test('R6: 403 FORBIDDEN when assigned FIELD_ADJUSTER attempts transition to DELIVERED', async () => {
    const { claim, orderNumber } = await setupClaimWithOrder('READY');
    const adjToken = generateToken(adjuster1);

    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${adjToken}`)
      .send({ status: 'DELIVERED' });

    expect(res.status).toBe(403);
    expect(res.body.errors[0].code).toBe('FORBIDDEN');
    expect(res.body.errors[0].details).toBe('Forbidden: Insufficient permissions');
  });

  test('R6: 403 FORBIDDEN when assigned FIELD_ADJUSTER attempts transition to CANCELLED', async () => {
    const { claim, orderNumber } = await setupClaimWithOrder('AUTHORIZED');
    const adjToken = generateToken(adjuster1);

    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${adjToken}`)
      .send({ status: 'CANCELLED', notes: 'Adjuster attempt to cancel repair order' });

    expect(res.status).toBe(403);
    expect(res.body.errors[0].code).toBe('FORBIDDEN');
    expect(res.body.errors[0].details).toBe('Forbidden: Insufficient permissions');
  });

  test('R6: 404 CLAIM_NOT_FOUND when unassigned FIELD_ADJUSTER attempts any status update', async () => {
    const { claim, orderNumber } = await setupClaimWithOrder('AUTHORIZED');
    const unassignedToken = generateToken(adjuster2);

    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${unassignedToken}`)
      .send({ status: 'IN_REPAIR' });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  test('R6: 404 CLAIM_NOT_FOUND when cross-tenant user attempts status update', async () => {
    const { claim, orderNumber } = await setupClaimWithOrder('AUTHORIZED');
    const org2Token = generateToken(officer2);

    const res = await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${orderNumber}/status`)
      .set('Authorization', `Bearer ${org2Token}`)
      .send({ status: 'IN_REPAIR' });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Suite 4: Read Repair Orders (GET /claims/:claimId/repair-orders)
  // ══════════════════════════════════════════════════════════════════════════

  test('R8: CLAIMS_OFFICER, ADMIN, and assigned FIELD_ADJUSTER can list repair orders', async () => {
    const { claim, orderNumber } = await setupClaimWithOrder('AUTHORIZED');

    for (const user of [officer1, admin1, adjuster1]) {
      const token = generateToken(user);
      const res = await request(app)
        .get(`/api/v1/claims/${claim._id}/repair-orders`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0].orderNumber).toBe(orderNumber);
    }
  });

  test('R8: 404 CLAIM_NOT_FOUND when unassigned FIELD_ADJUSTER attempts to list repair orders', async () => {
    const { claim } = await setupClaimWithOrder('AUTHORIZED');
    const token = generateToken(adjuster2);

    const res = await request(app)
      .get(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  test('R8: 404 CLAIM_NOT_FOUND for cross-tenant read request', async () => {
    const { claim } = await setupClaimWithOrder('AUTHORIZED');
    const token = generateToken(officer2);

    const res = await request(app)
      .get(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  test('R8: returns repair orders newest first with amounts in major units', async () => {
    const claim = await createApprovedClaim();
    const token = generateToken(officer1);

    const res1 = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage1._id.toString() });
    const order1Number = res1.body.data.orderNumber;

    await request(app)
      .patch(`/api/v1/claims/${claim._id}/repair-orders/${order1Number}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED', notes: 'First order cancelled by workshop' });

    const res2 = await request(app)
      .post(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garageId: garage2._id.toString() });
    const order2Number = res2.body.data.orderNumber;

    const listRes = await request(app)
      .get(`/api/v1/claims/${claim._id}/repair-orders`)
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBe(2);
    expect(listRes.body.data[0].orderNumber).toBe(order2Number);
    expect(listRes.body.data[1].orderNumber).toBe(order1Number);
    expect(listRes.body.data[0].authorizedAmount).toBe(4000);
    expect(listRes.body.data[0].deductibleToCollect).toBe(500);
    expect(listRes.body.data[0].repairTotal).toBe(4500);
  });

  test('A4: GET /claims/:claimId keys do not change (contract.keys.test.js passes unchanged)', async () => {
    const { claim } = await setupClaimWithOrder('AUTHORIZED');
    const token = generateToken(officer1);

    const res = await request(app)
      .get(`/api/v1/claims/${claim._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.repairOrders).toBeUndefined();
    expect(Object.keys(res.body.data).sort()).toEqual(
      [
        'accident',
        'assignment',
        'claimNumber',
        'claimType',
        'claimant',
        'claimantPartyId',
        'closedAt',
        'closedBy',
        'closingNotes',
        'coverageSnapshot',
        'createdAt',
        'createdBy',
        'customer',
        'decisionNotes',
        'eligibilityHint',
        'evidence',
        'id',
        'incidentCoordinates',
        'incidentDate',
        'incidentDescription',
        'incidentId',
        'incidentLocation',
        'incidentNumber',
        'incidentType',
        'location',
        'lossAssessment',
        'policy',
        'signature',
        'status',
        'statusDueAt',
        'statusEnteredAt',
        'statusHistory',
        'subjectRef',
        'timeline',
        'trackingToken',
        'trackingUrl',
        'updatedAt',
        'vehicle',
      ].sort()
    );
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Suite 5: Repair Authorization Letter (POST /claims/:claimId/letters)
  // ══════════════════════════════════════════════════════════════════════════

  test('R9: successfully issues REPAIR_AUTHORIZATION letter when claim has an active repair order', async () => {
    const { claim } = await setupClaimWithOrder('AUTHORIZED');
    const token = generateToken(officer1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'REPAIR_AUTHORIZATION' });

    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('REPAIR_AUTHORIZATION');
    expect(res.body.data.letterNumber).toMatch(/^LTR-APX-\d{4}-\d{4}$/);
    expect(res.body.data.snapshot.orderNumber).toMatch(/^RO-APX-\d{4}-\d{4}$/);
  });

  test('R9: successfully issues REPAIR_AUTHORIZATION letter when claim has a DELIVERED repair order', async () => {
    const { claim } = await setupClaimWithOrder('DELIVERED');
    const token = generateToken(officer1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'REPAIR_AUTHORIZATION' });

    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('REPAIR_AUTHORIZATION');
  });

  test('R9: 409 INVALID_STATUS_TRANSITION when claim has no repair orders', async () => {
    const claim = await createApprovedClaim();
    const token = generateToken(officer1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'REPAIR_AUTHORIZATION' });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R9: 409 INVALID_STATUS_TRANSITION when the only repair order on claim is CANCELLED', async () => {
    const { claim } = await setupClaimWithOrder('CANCELLED');
    const token = generateToken(officer1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'REPAIR_AUTHORIZATION' });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R9: addressee is the garage and snapshot includes garage, insuredName, plate, orderNumber, financials', async () => {
    const { claim, orderNumber } = await setupClaimWithOrder('IN_REPAIR');
    const token = generateToken(officer1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'REPAIR_AUTHORIZATION' });

    expect(res.status).toBe(201);
    const snap = res.body.data.snapshot;
    expect(snap.addresseeName).toBe('Al-Manara Garage');
    expect(snap.garageName).toBe('Al-Manara Garage');
    expect(snap.garageCity).toBe('Ramallah');
    expect(snap.garagePhone).toBe('022987001');
    expect(snap.orderNumber).toBe(orderNumber);
    expect(snap.insuredName).toBe('Sarah Connor');
    expect(snap.plateNumber).toBe('DXB-A-12345');
    expect(snap.claimNumber).toBe(claim.claimNumber);
    expect(snap.authorizedAmount).toBe(400000);
    expect(snap.deductibleToCollect).toBe(50000);
    expect(snap.currency).toBe('ILS');
    expect(snap.issuer.name).toBe('Officer Oscar');
    expect(snap.issuer.role).toBe('CLAIMS_OFFICER');
  });

  test('R9: garage snapshot is frozen on letter and unaffected by subsequent garage modifications', async () => {
    const { claim } = await setupClaimWithOrder('AUTHORIZED');
    const token = generateToken(officer1);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'REPAIR_AUTHORIZATION' });
    expect(res.status).toBe(201);
    const letterNumber = res.body.data.letterNumber;

    // Mutate garage in database
    await Garage.findByIdAndUpdate(garage1._id, { name: 'Al-Manara Completely Changed Name' });

    // Fetch letters
    const listRes = await request(app)
      .get(`/api/v1/claims/${claim._id}/letters`)
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    const letter = listRes.body.data.find((l) => l.letterNumber === letterNumber);
    expect(letter.snapshot.garageName).toBe('Al-Manara Garage');
    expect(letter.snapshot.addresseeName).toBe('Al-Manara Garage');
  });

  test('R9: REPAIR_AUTHORIZATION letter can be superseded by another REPAIR_AUTHORIZATION letter', async () => {
    const { claim } = await setupClaimWithOrder('AUTHORIZED');
    const token = generateToken(officer1);

    const res1 = await request(app)
      .post(`/api/v1/claims/${claim._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'REPAIR_AUTHORIZATION' });
    expect(res1.status).toBe(201);
    const letter1Number = res1.body.data.letterNumber;

    const res2 = await request(app)
      .post(`/api/v1/claims/${claim._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'REPAIR_AUTHORIZATION',
        supersedesLetterNumber: letter1Number,
      });

    expect(res2.status).toBe(201);
    expect(res2.body.data.supersedesLetterId).toBe(res1.body.data.id);

    const listRes = await request(app)
      .get(`/api/v1/claims/${claim._id}/letters`)
      .set('Authorization', `Bearer ${token}`);
    const letter1 = listRes.body.data.find((l) => l.letterNumber === letter1Number);
    expect(letter1.superseded).toBe(true);
  });

  test('R10: document definition contains exact Arabic subject, salutation, opening, body, table rows, closing, and signature', () => {
    if (!letterTemplates || typeof letterTemplates.buildLetterDocDefinition !== 'function') {
      throw new Error('letterTemplates module not ready');
    }

    const snapshot = {
      letterhead: {
        organizationName: 'Apex Insurance',
        address: 'Al-Irsal St, Ramallah',
        phone: '+97022987654',
      },
      letterNumber: 'LTR-APX-2026-0001',
      issueDate: '2026-10-25',
      type: 'REPAIR_AUTHORIZATION',
      addresseeName: 'Al-Manara Garage',
      garageName: 'Al-Manara Garage',
      orderNumber: 'RO-APX-2026-0001',
      claimNumber: 'CLM-APX-0001',
      plateNumber: 'DXB-A-12345',
      insuredName: 'Sarah Connor',
      authorizedAmount: 400000,
      deductibleToCollect: 50000,
      currency: 'ILS',
    };

    const docDef = letterTemplates.buildLetterDocDefinition(snapshot);
    const jsonStr = JSON.stringify(docDef);

    // Subject
    expect(jsonStr).toContain('تفويض إصلاح المركبة، المطالبة رقم CLM-APX-0001');
    // Salutation
    expect(jsonStr).toContain('السادة Al-Manara Garage المحترمين');
    // Opening
    expect(jsonStr).toContain('تحية طيبة وبعد،');
    // Body
    expect(jsonStr).toContain('نفوضكم بإصلاح المركبة المذكورة أدناه وفق التقدير المعتمد، على ألا تتجاوز التكلفة على الشركة المبلغ المفوض به:');
    // Table rows
    expect(jsonStr).toContain('رقم أمر الإصلاح');
    expect(jsonStr).toContain('RO-APX-2026-0001');
    expect(jsonStr).toContain('رقم المطالبة');
    expect(jsonStr).toContain('CLM-APX-0001');
    expect(jsonStr).toContain('رقم المركبة');
    expect(jsonStr).toContain('DXB-A-12345');
    expect(jsonStr).toContain('اسم المؤمن له');
    expect(jsonStr).toContain('Sarah Connor');
    expect(jsonStr).toContain('المبلغ المفوض به على الشركة');
    expect(jsonStr).toContain('4000.00 ILS');
    expect(jsonStr).toContain('التحمل المستحق على المؤمن له');
    expect(jsonStr).toContain('500.00 ILS');
    // Closing
    expect(jsonStr).toContain('يرجى إبلاغنا قبل البدء بأي أعمال إضافية غير مشمولة بالتقدير المعتمد. وتفضلوا بقبول فائق الاحترام،');
    // Signature
    expect(jsonStr).toContain('دائرة المطالبات، Apex Insurance');
  });

  test('R10: document definition renders table rows without undefined values', () => {
    if (!letterTemplates || typeof letterTemplates.buildLetterDocDefinition !== 'function') {
      throw new Error('letterTemplates module not ready');
    }

    const docDef = letterTemplates.buildLetterDocDefinition({ type: 'REPAIR_AUTHORIZATION' });
    const jsonStr = JSON.stringify(docDef);
    expect(jsonStr.includes('undefined')).toBe(false);
  });
});

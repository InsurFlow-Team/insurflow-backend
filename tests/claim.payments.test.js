const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const Garage = require('../src/modules/garages/garage.model');
const claimRepository = require('../src/modules/claims/claim.repository');
const config = require('../src/config/env');
const { buildPolicy } = require('./helpers/policyFactory');
const { toHebronDate } = require('../src/utils/hebronDate');

let mongoServer;
let org1, org2;
let admin1, adminToken1;
let officer1, officerToken1;
let adjuster1, adjusterToken1;
let testPolicy1;
let approvedGarage1, unapprovedGarage1, crossTenantGarage;

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

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

  org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1' });
  org2 = await Organization.create({ name: 'Org 2', code: 'ORG-2' });

  testPolicy1 = await buildPolicy({
    policyNumber: 'POL-PAY-001',
    status: 'ACTIVE',
    organizationId: org1._id,
    startDate: new Date('2026-01-01'),
    expiryDate: new Date('2027-12-31'),
    policyType: 'COMPREHENSIVE',
    policyKind: 'COMPLEMENTARY',
  });

  admin1 = await User.create({
    name: 'Admin One',
    employeeCode: 'ADM-01',
    password: 'Password123!',
    role: 'ADMIN',
    organizationId: org1._id,
    status: 'ACTIVE',
    canRecordPayments: true,
  });
  adminToken1 = generateToken(admin1);

  officer1 = await User.create({
    name: 'Officer One',
    employeeCode: 'OFF-01',
    password: 'Password123!',
    role: 'CLAIMS_OFFICER',
    organizationId: org1._id,
    status: 'ACTIVE',
    canRecordPayments: true,
  });
  officerToken1 = generateToken(officer1);

  adjuster1 = await User.create({
    name: 'Adjuster One',
    employeeCode: 'ADJ-01',
    password: 'Password123!',
    role: 'FIELD_ADJUSTER',
    organizationId: org1._id,
    status: 'ACTIVE',
    surveyorLicenseNumber: 'LIC-ADJ-01',
    surveyorLicenseExpiry: '2028-12-31',
  });
  adjusterToken1 = generateToken(adjuster1);

  approvedGarage1 = await Garage.create({
    organizationId: org1._id,
    name: 'Al-Amal Garage',
    normalizedName: 'al-amal garage',
    governorate: 'RAMALLAH_AL_BIREH',
    city: 'Ramallah',
    phone: '+970599111222',
    laborRate: 10000,
    approved: true,
  });

  unapprovedGarage1 = await Garage.create({
    organizationId: org1._id,
    name: 'Unapproved Workshop',
    normalizedName: 'unapproved workshop',
    governorate: 'RAMALLAH_AL_BIREH',
    city: 'Ramallah',
    phone: '+970599333444',
    laborRate: 8000,
    approved: false,
  });

  crossTenantGarage = await Garage.create({
    organizationId: org2._id,
    name: 'Org 2 Garage',
    normalizedName: 'org 2 garage',
    governorate: 'NABLUS',
    city: 'Nablus',
    phone: '+970599555666',
    laborRate: 10000,
    approved: true,
  });
});

const createApprovedClaimWithDischarge = async (payoutMinor = 216800, indemnityReserve = 216800, expenseReserve = 50000) => {
  return await Claim.create({
    organizationId: org1._id,
    policyId: testPolicy1._id,
    createdBy: officer1._id,
    status: 'APPROVED',
    customer: { name: 'Customer Test', phone: '0599000000' },
    incidentType: 'COLLISION',
    incidentLocation: 'Ramallah',
    lossAssessment: {
      estimatedPartsCost: payoutMinor,
      laborCost: 0,
      totalDamage: payoutMinor,
      policyDeductible: 0,
      deductibleApplied: 0,
      netApprovedPayout: payoutMinor,
      assessedBy: officer1._id,
    },
    reserve: {
      indemnity: indemnityReserve,
      expense: expenseReserve,
      history: [
        {
          category: 'INDEMNITY',
          previousAmount: null,
          newAmount: indemnityReserve,
          source: 'DECISION',
          reason: 'Initial decision approval',
          performedBy: officer1._id,
          role: 'CLAIMS_OFFICER',
          at: new Date(),
        },
        {
          category: 'EXPENSE',
          previousAmount: null,
          newAmount: expenseReserve,
          source: 'INITIAL',
          reason: 'Initial estimate',
          performedBy: officer1._id,
          role: 'CLAIMS_OFFICER',
          at: new Date(),
        },
      ],
    },
    discharges: [
      {
        dischargeNumber: 'DSC-ORG-1-2026-0001',
        amount: payoutMinor,
        status: 'SIGNED',
        snapshot: {
          letterhead: {},
          dischargeNumber: 'DSC-ORG-1-2026-0001',
          issueDate: '2026-10-27',
          claimNumber: 'CLM-ORG-1-0001',
          plateNumber: '1234-A',
          incidentDate: '2026-06-01',
          claimantName: 'Customer Test',
          claimantIdNumber: '123456789',
          amount: payoutMinor,
          currency: 'ILS',
        },
        signedAt: new Date(),
        createdBy: officer1._id,
      },
    ],
    paidTotals: {
      indemnity: 0,
      expense: 0,
    },
    reversedPaymentNumbers: [],
  });
};

describe('PB-16: Payments, Reversals, Permissions, and Close Gate', () => {
  it('POST /payments: officer without canRecordPayments permission receives 403 PAYMENT_PERMISSION_REQUIRED', async () => {
    await User.findByIdAndUpdate(officer1._id, { canRecordPayments: false });
    const claim = await createApprovedClaimWithDischarge();

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 500,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('PAYMENT_PERMISSION_REQUIRED');
  });

  it('POST /payments: revoking canRecordPayments takes effect immediately on subsequent payment request (403)', async () => {
    const claim = await createApprovedClaimWithDischarge();

    // Revoke permission directly in DB
    await User.findByIdAndUpdate(officer1._id, { canRecordPayments: false });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 500,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(403);
    expect(res.body.errors[0].code).toBe('PAYMENT_PERMISSION_REQUIRED');
  });

  it('POST /payments/:paymentNumber/reverse: officer without canRecordPayments receives 403 PAYMENT_PERMISSION_REQUIRED', async () => {
    await User.findByIdAndUpdate(officer1._id, { canRecordPayments: false });
    const claim = await createApprovedClaimWithDischarge();

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments/PAY-ORG-1-2026-0001/reverse`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        reason: 'Payment check bounce or cancellation',
      });

    expect(res.status).toBe(403);
    expect(res.body.errors[0].code).toBe('PAYMENT_PERMISSION_REQUIRED');
  });

  it('GET /payments: CLAIMS_OFFICER without canRecordPayments can read payments (200)', async () => {
    await User.findByIdAndUpdate(officer1._id, { canRecordPayments: false });
    const claim = await createApprovedClaimWithDischarge();

    const res = await request(app)
      .get(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('entries');
    expect(res.body.data).toHaveProperty('paidTotals');
    expect(res.body.data).toHaveProperty('paymentStatus');
  });

  it('GET /payments: ADMIN without canRecordPayments can read payments (200)', async () => {
    await User.findByIdAndUpdate(admin1._id, { canRecordPayments: false });
    const claim = await createApprovedClaimWithDischarge();

    const res = await request(app)
      .get(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${adminToken1}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('entries');
  });

  it('GET /payments: FIELD_ADJUSTER caller returns 403 Forbidden', async () => {
    const claim = await createApprovedClaimWithDischarge();

    const res = await request(app)
      .get(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${adjusterToken1}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('GET /payments: cross-tenant access returns 404 CLAIM_NOT_FOUND', async () => {
    const claim = await createApprovedClaimWithDischarge();
    const admin2 = await User.create({
      name: 'Admin Two',
      employeeCode: 'ADM-02',
      password: 'Password123!',
      role: 'ADMIN',
      organizationId: org2._id,
      status: 'ACTIVE',
    });
    const token2 = generateToken(admin2);

    const res = await request(app)
      .get(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  it('GET /payments: non-existent claim returns 404 CLAIM_NOT_FOUND', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/v1/claims/${fakeId}/payments`)
      .set('Authorization', `Bearer ${adminToken1}`);

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  it('POST /payments: claim not in APPROVED status (NEW, UNDER_REVIEW, REJECTED, CLOSED) returns 409 INVALID_STATUS_TRANSITION', async () => {
    const claim = await Claim.create({
      organizationId: org1._id,
      policyId: testPolicy1._id,
      createdBy: officer1._id,
      status: 'UNDER_REVIEW',
      customer: { name: 'Customer Test', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 500,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('POST /payments: cross-tenant claim returns 404 CLAIM_NOT_FOUND', async () => {
    const claim = await createApprovedClaimWithDischarge();
    const admin2 = await User.create({
      name: 'Admin Two',
      employeeCode: 'ADM-02',
      password: 'Password123!',
      role: 'ADMIN',
      organizationId: org2._id,
      status: 'ACTIVE',
      canRecordPayments: true,
    });
    const token2 = generateToken(admin2);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${token2}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 500,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  it('POST /payments: legacy claim with null reserve returns 422 RESERVE_NOT_SET', async () => {
    const claim = await Claim.create({
      organizationId: org1._id,
      policyId: testPolicy1._id,
      createdBy: officer1._id,
      status: 'APPROVED',
      customer: { name: 'Legacy Claim', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      lossAssessment: {
        estimatedPartsCost: 100000,
        laborCost: 0,
        totalDamage: 100000,
        policyDeductible: 0,
        deductibleApplied: 0,
        netApprovedPayout: 100000,
        assessedBy: officer1._id,
      },
      reserve: {
        indemnity: null,
        expense: null,
        history: [],
      },
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 500,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('RESERVE_NOT_SET');
  });

  it('POST /payments: INDEMNITY payment without signed discharge returns 422 DISCHARGE_REQUIRED', async () => {
    const claim = await createApprovedClaimWithDischarge();
    await Claim.findByIdAndUpdate(claim._id, { discharges: [] });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 500,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('DISCHARGE_REQUIRED');
  });

  it('POST /payments: INDEMNITY payment with DRAFT discharge only returns 422 DISCHARGE_REQUIRED', async () => {
    const claim = await createApprovedClaimWithDischarge();
    await Claim.findByIdAndUpdate(claim._id, { 'discharges.0.status': 'DRAFT' });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 500,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('DISCHARGE_REQUIRED');
  });

  it('POST /payments: INDEMNITY payment where cumulative paid + amount exceeds signed discharge amount returns 422 DISCHARGE_REQUIRED', async () => {
    const claim = await createApprovedClaimWithDischarge(200000, 200000, 50000);
    await Claim.findByIdAndUpdate(claim._id, { 'discharges.0.amount': 100000 });
    // Signed discharge covers 1000.00 (100000 minor). Try to pay 1500.00
    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 1500,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('DISCHARGE_REQUIRED');
  });

  it('POST /payments: INDEMNITY payment where cumulative paid + amount exceeds netApprovedPayout returns 422 PAYMENT_EXCEEDS_APPROVED', async () => {
    const claim = await createApprovedClaimWithDischarge(100000, 200000, 50000);
    // Signed discharge covers 200000, but payout is only 100000
    await Claim.findByIdAndUpdate(claim._id, { 'discharges.0.amount': 200000 });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 1500,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('PAYMENT_EXCEEDS_APPROVED');
  });

  it('POST /payments: INDEMNITY payment exceeding outstanding reserve.indemnity returns 422 PAYMENT_EXCEEDS_RESERVE', async () => {
    const claim = await createApprovedClaimWithDischarge(200000, 50000, 50000);
    // Net approved payout is 200000, discharge covers 200000, but reserve.indemnity is only 50000 (500.00)
    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 1000,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('PAYMENT_EXCEEDS_RESERVE');
  });

  it('POST /payments: EXPENSE payment exceeding outstanding reserve.expense returns 422 PAYMENT_EXCEEDS_RESERVE', async () => {
    const claim = await createApprovedClaimWithDischarge(200000, 200000, 30000); // expense reserve 300.00
    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'EXPENSE',
        payeeType: 'SURVEYOR',
        payeeName: 'Surveyor Eng',
        amount: 400,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('PAYMENT_EXCEEDS_RESERVE');
  });

  it('POST /payments: EXPENSE payment succeeds without requiring a signed discharge', async () => {
    const claim = await createApprovedClaimWithDischarge(200000, 200000, 50000);
    await Claim.findByIdAndUpdate(claim._id, { discharges: [] });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'EXPENSE',
        payeeType: 'SURVEYOR',
        payeeName: 'Surveyor Eng',
        amount: 250,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.amount).toBe(250);
  });

  it('POST /payments: garage payee with approved garage succeeds (201)', async () => {
    const claim = await createApprovedClaimWithDischarge();

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'GARAGE',
        payeeName: 'Al-Amal Garage',
        garageId: approvedGarage1._id.toString(),
        amount: 500,
        currency: 'ILS',
        method: 'BANK_TRANSFER',
        reference: 'REF-BANK-001',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.garageId).toBe(approvedGarage1._id.toString());
  });

  it('POST /payments: garage payee with unapproved garage returns 404 GARAGE_NOT_FOUND', async () => {
    const claim = await createApprovedClaimWithDischarge();

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'GARAGE',
        payeeName: 'Unapproved Workshop',
        garageId: unapprovedGarage1._id.toString(),
        amount: 500,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('GARAGE_NOT_FOUND');
  });

  it('POST /payments: garage payee with cross-tenant garage returns 404 GARAGE_NOT_FOUND', async () => {
    const claim = await createApprovedClaimWithDischarge();

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'GARAGE',
        payeeName: 'Org 2 Garage',
        garageId: crossTenantGarage._id.toString(),
        amount: 500,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('GARAGE_NOT_FOUND');
  });

  it('POST /payments: BANK_TRANSFER without reference returns 400 VALIDATION_ERROR', async () => {
    const claim = await createApprovedClaimWithDischarge();

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 500,
        currency: 'ILS',
        method: 'BANK_TRANSFER',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('POST /payments: CHEQUE without reference returns 400 VALIDATION_ERROR', async () => {
    const claim = await createApprovedClaimWithDischarge();

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 500,
        currency: 'ILS',
        method: 'CHEQUE',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('POST /payments: CASH payment without reference succeeds (201)', async () => {
    const claim = await createApprovedClaimWithDischarge();

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 500,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reference).toBeNull();
  });

  it('POST /payments: paidAt in future in Asia/Hebron timezone returns 400 VALIDATION_ERROR', async () => {
    const claim = await createApprovedClaimWithDischarge();

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 500,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2099-01-01',
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('POST /payments: currency other than config.currency returns 400 VALIDATION_ERROR', async () => {
    const claim = await createApprovedClaimWithDischarge();

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 500,
        currency: 'USD',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('POST /payments: sequential execution of worked example step 1 (1000.00 INDEMNITY -> PARTIALLY_PAID)', async () => {
    const claim = await createApprovedClaimWithDischarge(216800, 216800, 50000);

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'GARAGE',
        payeeName: 'Al-Amal Garage',
        garageId: approvedGarage1._id.toString(),
        amount: 1000,
        currency: 'ILS',
        method: 'BANK_TRANSFER',
        reference: 'TR-101',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const updatedClaim = await Claim.findById(claim._id);
    expect(updatedClaim.paidTotals.indemnity).toBe(100000);
    expect(updatedClaim.reserve.indemnity).toBe(116800);

    const getRes = await request(app)
      .get(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`);
    expect(getRes.body.data.paymentStatus).toBe('PARTIALLY_PAID');
    expect(getRes.body.data.paidTotals.indemnity).toBe(1000);
  });

  it('POST /payments: sequential execution of worked example step 2 (250.00 EXPENSE)', async () => {
    const claim = await createApprovedClaimWithDischarge(216800, 216800, 50000);
    await Claim.findByIdAndUpdate(claim._id, {
      'paidTotals.indemnity': 100000,
      'reserve.indemnity': 116800,
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'EXPENSE',
        payeeType: 'SURVEYOR',
        payeeName: 'Surveyor Expert',
        amount: 250,
        currency: 'ILS',
        method: 'CHEQUE',
        reference: 'CHQ-202',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(201);
    const updatedClaim = await Claim.findById(claim._id);
    expect(updatedClaim.reserve.expense).toBe(25000);
    expect(updatedClaim.paidTotals.expense).toBe(25000);
  });

  it('POST /payments: sequential execution of worked example step 3 (1200.00 INDEMNITY fails with 422 PAYMENT_EXCEEDS_APPROVED)', async () => {
    const claim = await createApprovedClaimWithDischarge(216800, 216800, 50000);
    await Claim.findByIdAndUpdate(claim._id, {
      'paidTotals.indemnity': 100000,
      'reserve.indemnity': 116800,
      'reserve.expense': 25000,
      'paidTotals.expense': 25000,
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 1200,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('PAYMENT_EXCEEDS_APPROVED');
  });

  it('POST /payments: sequential execution of worked example step 4 (1168.00 INDEMNITY -> PAID and close succeeds)', async () => {
    const claim = await createApprovedClaimWithDischarge(216800, 216800, 50000);
    await Claim.findByIdAndUpdate(claim._id, {
      'paidTotals.indemnity': 100000,
      'reserve.indemnity': 116800,
    });

    const payRes = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'INSURED',
        payeeName: 'Customer Test',
        amount: 1168,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    expect(payRes.status).toBe(201);
    const updatedClaim = await Claim.findById(claim._id);
    expect(updatedClaim.paidTotals.indemnity).toBe(216800);
    expect(updatedClaim.reserve.indemnity).toBe(0);

    const getRes = await request(app)
      .get(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`);
    expect(getRes.body.data.paymentStatus).toBe('PAID');

    // Close claim
    const closeRes = await request(app)
      .post(`/api/v1/claims/${claim._id}/close`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ closingNotes: 'All paid in full' });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.status).toBe('CLOSED');
  });

  it('POST /payments: sequential execution of worked example step 5 (reverse payment 1 on CLOSED claim sets paymentReversedAfterClose)', async () => {
    const claim = await createApprovedClaimWithDischarge(216800, 216800, 50000);
    await Claim.findByIdAndUpdate(claim._id, {
      status: 'CLOSED',
      'paidTotals.indemnity': 216800,
      'reserve.indemnity': 0,
      payments: [
        {
          paymentNumber: 'PAY-ORG-1-2026-0001',
          type: 'PAYMENT',
          category: 'INDEMNITY',
          payeeType: 'GARAGE',
          payeeName: 'Al-Amal Garage',
          amount: 100000,
          currency: 'ILS',
          method: 'BANK_TRANSFER',
          reference: 'TR-101',
          paidAt: '2026-10-27',
          recordedBy: officer1._id,
          recordedAt: new Date(),
        },
      ],
      reversedPaymentNumbers: [],
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments/PAY-ORG-1-2026-0001/reverse`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        reason: 'Cheque returned or reversal requested by garage accounting',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updatedClaim = await Claim.findById(claim._id);
    expect(updatedClaim.paidTotals.indemnity).toBe(116800);
    expect(updatedClaim.reserve.indemnity).toBe(100000);
    expect(updatedClaim.paymentReversedAfterClose).toBe(true);
    expect(updatedClaim.reversedPaymentNumbers).toContain('PAY-ORG-1-2026-0001');
  });

  it('POST /payments: concurrent payments whose sum would exceed netApprovedPayout allow exactly one success and one failure', async () => {
    const claim = await createApprovedClaimWithDischarge(150000, 150000, 50000);

    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/v1/claims/${claim._id}/payments`)
        .set('Authorization', `Bearer ${officerToken1}`)
        .send({
          category: 'INDEMNITY',
          payeeType: 'INSURED',
          payeeName: 'Customer Test',
          amount: 1000,
          currency: 'ILS',
          method: 'CASH',
          paidAt: '2026-10-27',
        }),
      request(app)
        .post(`/api/v1/claims/${claim._id}/payments`)
        .set('Authorization', `Bearer ${officerToken1}`)
        .send({
          category: 'INDEMNITY',
          payeeType: 'INSURED',
          payeeName: 'Customer Test',
          amount: 1000,
          currency: 'ILS',
          method: 'CASH',
          paidAt: '2026-10-27',
        }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses[0]).toBe(201);
    expect([409, 422]).toContain(statuses[1]);

    const updatedClaim = await Claim.findById(claim._id);
    expect(updatedClaim.paidTotals.indemnity).toBe(100000);
  });

  it('POST /payments/:paymentNumber/reverse: reversing an already reversed payment returns 409 PAYMENT_ALREADY_REVERSED', async () => {
    const claim = await createApprovedClaimWithDischarge(216800, 216800, 50000);
    await Claim.findByIdAndUpdate(claim._id, {
      payments: [
        {
          paymentNumber: 'PAY-ORG-1-2026-0001',
          type: 'PAYMENT',
          category: 'INDEMNITY',
          payeeType: 'GARAGE',
          payeeName: 'Al-Amal Garage',
          amount: 100000,
          currency: 'ILS',
          method: 'CASH',
          paidAt: '2026-10-27',
          recordedBy: officer1._id,
          recordedAt: new Date(),
        },
      ],
      reversedPaymentNumbers: ['PAY-ORG-1-2026-0001'],
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments/PAY-ORG-1-2026-0001/reverse`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        reason: 'Attempting to reverse the same payment a second time',
      });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('PAYMENT_ALREADY_REVERSED');
  });

  it('POST /payments/:paymentNumber/reverse: reversing a REVERSAL entry returns 404 PAYMENT_NOT_FOUND', async () => {
    const claim = await createApprovedClaimWithDischarge(216800, 216800, 50000);
    await Claim.findByIdAndUpdate(claim._id, {
      payments: [
        {
          paymentNumber: 'PAY-ORG-1-2026-0002',
          type: 'REVERSAL',
          category: 'INDEMNITY',
          payeeType: 'GARAGE',
          payeeName: 'Al-Amal Garage',
          amount: 100000,
          currency: 'ILS',
          method: 'CASH',
          paidAt: '2026-10-27',
          reversesPaymentNumber: 'PAY-ORG-1-2026-0001',
          reason: 'Initial reversal reason here',
          recordedBy: officer1._id,
          recordedAt: new Date(),
        },
      ],
      reversedPaymentNumbers: ['PAY-ORG-1-2026-0001'],
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments/PAY-ORG-1-2026-0002/reverse`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        reason: 'Attempting to reverse a reversal entry',
      });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('PAYMENT_NOT_FOUND');
  });

  it('POST /payments/:paymentNumber/reverse: non-existent paymentNumber returns 404 PAYMENT_NOT_FOUND', async () => {
    const claim = await createApprovedClaimWithDischarge();

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments/PAY-NONEXISTENT-9999/reverse`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        reason: 'Reversing a non existent payment transaction',
      });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('PAYMENT_NOT_FOUND');
  });

  it('POST /payments/:paymentNumber/reverse: reason under 10 characters returns 400 VALIDATION_ERROR', async () => {
    const claim = await createApprovedClaimWithDischarge();

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments/PAY-ORG-1-2026-0001/reverse`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        reason: 'Short',
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('POST /claims/:claimId/close: closing an approved claim before indemnity is paid in full returns 422 PAYMENT_INCOMPLETE with remaining amount', async () => {
    const claim = await createApprovedClaimWithDischarge(216800, 216800, 50000);
    // Payout is 2168.00, paid indemnity is 0

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/close`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ closingNotes: 'Attempting close before payment' });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('PAYMENT_INCOMPLETE');
    expect(res.body.message).toContain('2168.00');
  });

  it('POST /claims/:claimId/close: an APPROVED claim without lossAssessment is refused with 422 PAYMENT_INCOMPLETE', async () => {
    const claim = await Claim.create({
      organizationId: org1._id,
      policyId: testPolicy1._id,
      createdBy: officer1._id,
      status: 'APPROVED',
      customer: { name: 'Claim without LA', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      lossAssessment: null,
      paidTotals: { indemnity: 0, expense: 0 },
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/close`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ closingNotes: 'Close without loss assessment' });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('PAYMENT_INCOMPLETE');
    expect(res.body.message).toBe('Claim has no approved amount');
  });

  it('POST /payments: a reserve adjustment between read and write gives 409 PAYMENT_CONFLICT and the reserve history stays consistent', async () => {
    const claim = await createApprovedClaimWithDischarge(216800, 216800, 50000);

    // Spy on claimRepository.findByIdAndOrganization to simulate a concurrent reserve adjustment directly in DB
    const origFind = claimRepository.findByIdAndOrganization;
    jest.spyOn(claimRepository, 'findByIdAndOrganization').mockImplementationOnce(async (cid, oid) => {
      const doc = await origFind(cid, oid);
      // Simulate concurrent reserve adjustment: update reserve.indemnity in DB
      await Claim.findByIdAndUpdate(cid, { 'reserve.indemnity': 150000 });
      return doc;
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claim._id}/payments`)
      .set('Authorization', `Bearer ${officerToken1}`)
      .send({
        category: 'INDEMNITY',
        payeeType: 'GARAGE',
        payeeName: 'Al-Amal Garage',
        garageId: approvedGarage1._id.toString(),
        amount: 1000,
        currency: 'ILS',
        method: 'CASH',
        paidAt: '2026-10-27',
      });

    claimRepository.findByIdAndOrganization.mockRestore();

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('PAYMENT_CONFLICT');

    // Confirm that the payment was not written and reserve history remains consistent
    const dbClaim = await Claim.findById(claim._id);
    expect(dbClaim.payments).toHaveLength(0);
    expect(dbClaim.reserve.history.filter((h) => h.source === 'PAYMENT')).toHaveLength(0);
  });
});

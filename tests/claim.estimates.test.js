const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const Garage = require('../src/modules/garages/garage.model');
const { buildPolicy } = require('./helpers/policyFactory');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');

jest.mock('../src/modules/notifications/notification.service', () => ({
  createAndSendNotification: jest.fn().mockResolvedValue({}),
  sendToOrganization: jest.fn().mockResolvedValue({}),
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
    await collections[key].deleteMany();
  }
});

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

const workedExampleLines = [
  {
    lineType: 'PART',
    description: 'Front bumper',
    quantity: 1,
    unitPrice: 1200.0,
    partCondition: 'NEW_ORIGINAL',
    depreciationPercent: 10,
  },
  {
    lineType: 'PART',
    description: 'Headlight',
    quantity: 2,
    unitPrice: 150.0,
    partCondition: 'USED',
    depreciationPercent: 0,
  },
  {
    lineType: 'LABOR',
    description: 'Panel repair',
    quantity: 6.5,
    unitPrice: 80.0,
  },
  {
    lineType: 'PAINT',
    description: 'Bumper paint',
    quantity: 1,
    unitPrice: 400.0,
  },
  {
    lineType: 'SURVEYOR_FEE',
    description: 'Survey fee',
    quantity: 1,
    unitPrice: 250.0,
  },
  {
    lineType: 'TOWING',
    description: 'Towing service',
    quantity: 1,
    unitPrice: 150.0,
  },
];

describe('Claim Estimates (PB-08)', () => {
  let org1, org2;
  let policy1;
  let adjuster1, adjuster2, officer1, admin1;
  let garage1, garage2Unapproved, garageOrg2;
  let claimInProgress, claimSubmitted, claimUnderReview, claimApproved;

  beforeEach(async () => {
    org1 = await Organization.create({
      name: 'Org 1',
      code: 'ORG1',
      settings: { vatRatePercent: 16 },
    });
    org2 = await Organization.create({
      name: 'Org 2',
      code: 'ORG2',
      settings: { vatRatePercent: 16 },
    });

    policy1 = await buildPolicy({
      policyNumber: 'POL-PB08-01',
      status: 'ACTIVE',
      organizationId: org1._id,
      deductibleAmount: 50000, // 500.00 ILS
    });

    adjuster1 = await User.create({
      name: 'Adjuster 1',
      employeeCode: 'ADJ1',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'SURV-001',
      surveyorLicenseExpiry: '2028-12-31',
    });

    adjuster2 = await User.create({
      name: 'Adjuster 2',
      employeeCode: 'ADJ2',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
      surveyorLicenseNumber: 'SURV-002',
      surveyorLicenseExpiry: '2028-12-31',
    });

    officer1 = await User.create({
      name: 'Officer 1',
      employeeCode: 'OFF1',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    admin1 = await User.create({
      name: 'Admin 1',
      employeeCode: 'ADM1',
      password: 'password123',
      role: 'ADMIN',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    garage1 = await Garage.create({
      organizationId: org1._id,
      name: 'Al-Amal Garage',
      normalizedName: 'al-amal garage',
      governorate: 'RAMALLAH_AL_BIREH',
      city: 'Ramallah',
      phone: '0599000001',
      laborRate: 8000,
      approved: true,
    });

    garage2Unapproved = await Garage.create({
      organizationId: org1._id,
      name: 'Unapproved Garage',
      normalizedName: 'unapproved garage',
      governorate: 'RAMALLAH_AL_BIREH',
      city: 'Ramallah',
      phone: '0599000002',
      laborRate: 8000,
      approved: false,
    });

    garageOrg2 = await Garage.create({
      organizationId: org2._id,
      name: 'Org 2 Garage',
      normalizedName: 'org 2 garage',
      governorate: 'NABLUS',
      city: 'Nablus',
      phone: '0599000003',
      laborRate: 8000,
      approved: true,
    });

    claimInProgress = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'IN_PROGRESS',
      customer: { name: 'Customer A', phone: '0599111111' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      coverageSnapshot: {
        policyType: 'COMPREHENSIVE',
        coveredPerils: ['COLLISION'],
        deductibleAmount: 50000,
      },
    });

    claimSubmitted = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'SUBMITTED',
      customer: { name: 'Customer B', phone: '0599111112' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      coverageSnapshot: {
        policyType: 'COMPREHENSIVE',
        coveredPerils: ['COLLISION'],
        deductibleAmount: 50000,
      },
    });

    claimUnderReview = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'UNDER_REVIEW',
      customer: { name: 'Customer C', phone: '0599111113' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      coverageSnapshot: {
        policyType: 'COMPREHENSIVE',
        coveredPerils: ['COLLISION'],
        deductibleAmount: 50000,
      },
    });

    claimApproved = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'APPROVED',
      customer: { name: 'Customer D', phone: '0599111114' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      coverageSnapshot: {
        policyType: 'COMPREHENSIVE',
        coveredPerils: ['COLLISION'],
        deductibleAmount: 50000,
      },
    });
  });

  // 1
  it('should correctly compute and return the worked example end to end in major units and store minor units', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        vatApplied: true,
        lines: workedExampleLines,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const est = res.body.data;
    expect(est.version).toBe(1);
    expect(est.source).toBe('SURVEYOR');
    expect(est.vatApplied).toBe(true);
    expect(est.vatRatePercent).toBe(16);

    expect(est.totals).toEqual({
      partsNet: 1380.0,
      labor: 520.0,
      paint: 400.0,
      surveyorFee: 250.0,
      towing: 150.0,
      repairSubtotal: 2300.0,
      vat: 368.0,
      repairTotal: 2668.0,
      expenses: 400.0,
    });

    expect(est.mapped).toEqual({
      estimatedPartsCost: 2148.0,
      laborCost: 520.0,
    });

    const dbClaim = await Claim.findById(claimInProgress._id).lean();
    expect(dbClaim.estimatesCount).toBe(1);
    expect(dbClaim.estimates).toHaveLength(1);
    const dbEst = dbClaim.estimates[0];
    expect(dbEst.totals).toEqual({
      partsNet: 138000,
      labor: 52000,
      paint: 40000,
      surveyorFee: 25000,
      towing: 15000,
      repairSubtotal: 230000,
      vat: 36800,
      repairTotal: 266800,
      expenses: 40000,
    });
    expect(dbEst.mapped).toEqual({
      estimatedPartsCost: 214800,
      laborCost: 52000,
    });
  });

  // 2
  it('should round half-up for odd minor unit depreciation calculations', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [
          {
            lineType: 'PART',
            description: 'Odd part',
            quantity: 1,
            unitPrice: 10.05,
            partCondition: 'NEW_ORIGINAL',
            depreciationPercent: 15,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.lines[0].gross).toBe(10.05);
    expect(res.body.data.lines[0].depreciation).toBe(1.51);
    expect(res.body.data.lines[0].net).toBe(8.54);
  });

  // 3
  it('should reject PART line with USED condition and depreciationPercent > 0 with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [
          {
            lineType: 'PART',
            description: 'Used part',
            quantity: 1,
            unitPrice: 100.0,
            partCondition: 'USED',
            depreciationPercent: 10,
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 4
  it('should calculate estimate without VAT when vatApplied is false', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        vatApplied: false,
        lines: workedExampleLines,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.totals.vat).toBe(0);
    expect(res.body.data.totals.repairTotal).toBe(2300.0);
    expect(res.body.data.mapped.estimatedPartsCost).toBe(1780.0); // partsNet 1380 + paint 400 + vat 0
  });

  // 5
  it('should allow assigned FIELD_ADJUSTER to create SURVEYOR estimate when claim is IN_PROGRESS', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [
          {
            lineType: 'LABOR',
            description: 'Diagnosis',
            quantity: 1,
            unitPrice: 100.0,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.source).toBe('SURVEYOR');
  });

  // 6
  it('should forbid CLAIMS_OFFICER and ADMIN from creating SURVEYOR estimate with 403 Forbidden', async () => {
    const resOfficer = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [
          {
            lineType: 'LABOR',
            description: 'Diagnosis',
            quantity: 1,
            unitPrice: 100.0,
          },
        ],
      });

    expect(resOfficer.status).toBe(403);

    const resAdmin = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(admin1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [
          {
            lineType: 'LABOR',
            description: 'Diagnosis',
            quantity: 1,
            unitPrice: 100.0,
          },
        ],
      });

    expect(resAdmin.status).toBe(403);
  });

  // 7
  it('should reject SURVEYOR estimate submission with 409 INVALID_STATUS_TRANSITION if claim is not IN_PROGRESS', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimSubmitted._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [
          {
            lineType: 'LABOR',
            description: 'Diagnosis',
            quantity: 1,
            unitPrice: 100.0,
          },
        ],
      });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  // 8
  it('should allow assigned FIELD_ADJUSTER to create GARAGE quote when claim is IN_PROGRESS', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: [
          {
            lineType: 'LABOR',
            description: 'Garage Repair',
            quantity: 2,
            unitPrice: 80.0,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.source).toBe('GARAGE');
    expect(res.body.data.garageId).toBe(garage1._id.toString());
  });

  // 9
  it('should allow CLAIMS_OFFICER and ADMIN to create GARAGE quote when claim is IN_PROGRESS, SUBMITTED, or UNDER_REVIEW', async () => {
    const resProgress = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: [{ lineType: 'LABOR', description: 'Labor 1', quantity: 1, unitPrice: 80.0 }],
      });
    expect(resProgress.status).toBe(201);

    const resSubmitted = await request(app)
      .post(`/api/v1/claims/${claimSubmitted._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(admin1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: [{ lineType: 'LABOR', description: 'Labor 2', quantity: 1, unitPrice: 80.0 }],
      });
    expect(resSubmitted.status).toBe(201);

    const resReview = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: [{ lineType: 'LABOR', description: 'Labor 3', quantity: 1, unitPrice: 80.0 }],
      });
    expect(resReview.status).toBe(201);
  });

  // 10
  it('should reject GARAGE quote submission with 409 INVALID_STATUS_TRANSITION if status is NEW, ASSIGNED, APPROVED, REJECTED, or CLOSED', async () => {
    const resApproved = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: [{ lineType: 'LABOR', description: 'Labor', quantity: 1, unitPrice: 80.0 }],
      });

    expect(resApproved.status).toBe(409);
    expect(resApproved.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  // 11
  it('should reject GARAGE quote with 404 GARAGE_NOT_FOUND when garageId does not exist', async () => {
    const nonExistentGarageId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: nonExistentGarageId,
        lines: [{ lineType: 'LABOR', description: 'Labor', quantity: 1, unitPrice: 80.0 }],
      });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('GARAGE_NOT_FOUND');
  });

  // 12
  it('should reject GARAGE quote with 404 GARAGE_NOT_FOUND when garage is unapproved', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage2Unapproved._id.toString(),
        lines: [{ lineType: 'LABOR', description: 'Labor', quantity: 1, unitPrice: 80.0 }],
      });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('GARAGE_NOT_FOUND');
  });

  // 13
  it('should reject GARAGE quote with 404 GARAGE_NOT_FOUND when garage belongs to another organization', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garageOrg2._id.toString(),
        lines: [{ lineType: 'LABOR', description: 'Labor', quantity: 1, unitPrice: 80.0 }],
      });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('GARAGE_NOT_FOUND');
  });

  // 14
  it('should reject lines with DIMINISHED_VALUE or LOSS_OF_USE with 422 LINE_TYPE_NOT_ALLOWED', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [
          {
            lineType: 'DIMINISHED_VALUE',
            description: 'Diminished market value',
            quantity: 1,
            unitPrice: 500.0,
          },
        ],
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('LINE_TYPE_NOT_ALLOWED');
  });

  // 15
  it('should increment estimate versions sequentially (1, 2, 3) across alternating SURVEYOR and GARAGE sources', async () => {
    const res1 = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [{ lineType: 'LABOR', description: 'V1', quantity: 1, unitPrice: 50.0 }],
      });
    expect(res1.body.data.version).toBe(1);

    const res2 = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: [{ lineType: 'LABOR', description: 'V2', quantity: 1, unitPrice: 60.0 }],
      });
    expect(res2.body.data.version).toBe(2);

    const res3 = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [{ lineType: 'LABOR', description: 'V3', quantity: 1, unitPrice: 70.0 }],
      });
    expect(res3.body.data.version).toBe(3);
  });

  // 16
  it('should handle concurrent estimate creations giving distinct versions and retry on lost race', async () => {
    const p1 = request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [{ lineType: 'LABOR', description: 'Concurrent 1', quantity: 1, unitPrice: 50.0 }],
      });

    const p2 = request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: [{ lineType: 'LABOR', description: 'Concurrent 2', quantity: 1, unitPrice: 60.0 }],
      });

    const [res1, res2] = await Promise.all([p1, p2]);
    expect([201, 409]).toContain(res1.status);
    expect([201, 409]).toContain(res2.status);

    const versions = [res1.body?.data?.version, res2.body?.data?.version].filter(Boolean);
    if (versions.length === 2) {
      expect(versions).toContain(1);
      expect(versions).toContain(2);
    }
  });

  // 17
  it('should return 409 ESTIMATE_VERSION_CONFLICT when max retry is exhausted during version race', async () => {
    const claimRepo = require('../src/modules/claims/claim.repository');
    const spy = jest.spyOn(claimRepo, 'addEstimate').mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [{ lineType: 'LABOR', description: 'Test', quantity: 1, unitPrice: 50.0 }],
      });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('ESTIMATE_VERSION_CONFLICT');
    spy.mockRestore();
  });

  // 18
  it('should return all estimates newest-first with approvedEstimateVersion via GET /claims/:claimId/estimates', async () => {
    await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [{ lineType: 'LABOR', description: 'V1', quantity: 1, unitPrice: 50.0 }],
      });

    await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: [{ lineType: 'LABOR', description: 'V2', quantity: 1, unitPrice: 60.0 }],
      });

    const res = await request(app)
      .get(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.approvedEstimateVersion).toBeNull();
    expect(res.body.data.estimates).toHaveLength(2);
    expect(res.body.data.estimates[0].version).toBe(2);
    expect(res.body.data.estimates[1].version).toBe(1);
  });

  // 19
  it('should reject FIELD_ADJUSTER reading estimates on unassigned claim with 404 CLAIM_NOT_FOUND', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster2)}`);

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  // 20
  it('should reject cross-tenant estimate access with 404 CLAIM_NOT_FOUND', async () => {
    const otherOfficer = await User.create({
      name: 'Other Org Officer',
      employeeCode: 'OO1',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org2._id,
    });

    const res = await request(app)
      .get(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(otherOfficer)}`);

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  // 21
  it('should compare latest versions of SURVEYOR and GARAGE by default', async () => {
    // V1 Surveyor: repairTotal = 1000
    await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        vatApplied: false,
        lines: [{ lineType: 'LABOR', description: 'Surveyor Labor', quantity: 10, unitPrice: 100.0 }],
      });

    // V2 Garage: repairTotal = 1200
    await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        vatApplied: false,
        lines: [{ lineType: 'LABOR', description: 'Garage Labor', quantity: 12, unitPrice: 100.0 }],
      });

    const res = await request(app)
      .get(`/api/v1/claims/${claimInProgress._id}/estimates/compare`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.surveyor.version).toBe(1);
    expect(res.body.data.garage.version).toBe(2);
    expect(res.body.data.difference.repairTotal).toBe(200.0);
    expect(res.body.data.differencePercent).toBe(20.0);
  });

  // 22
  it('should compare explicitly specified versions of SURVEYOR and GARAGE', async () => {
    // V1 Surveyor
    await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        vatApplied: false,
        lines: [{ lineType: 'LABOR', description: 'Surveyor V1', quantity: 10, unitPrice: 100.0 }],
      });

    // V2 Garage
    await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        vatApplied: false,
        lines: [{ lineType: 'LABOR', description: 'Garage V2', quantity: 12, unitPrice: 100.0 }],
      });

    // V3 Surveyor
    await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        vatApplied: false,
        lines: [{ lineType: 'LABOR', description: 'Surveyor V3', quantity: 15, unitPrice: 100.0 }],
      });

    const res = await request(app)
      .get(`/api/v1/claims/${claimInProgress._id}/estimates/compare?surveyorVersion=1&garageVersion=2`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.surveyor.version).toBe(1);
    expect(res.body.data.garage.version).toBe(2);
    expect(res.body.data.difference.repairTotal).toBe(200.0);
  });

  // 23
  it('should return 404 ESTIMATE_NOT_FOUND on compare when a source or requested version is missing', async () => {
    // Only Surveyor estimate exists
    await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [{ lineType: 'LABOR', description: 'Labor', quantity: 1, unitPrice: 100.0 }],
      });

    const resMissingGarage = await request(app)
      .get(`/api/v1/claims/${claimInProgress._id}/estimates/compare`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(resMissingGarage.status).toBe(404);
    expect(resMissingGarage.body.errors[0].code).toBe('ESTIMATE_NOT_FOUND');

    const resMissingVersion = await request(app)
      .get(`/api/v1/claims/${claimInProgress._id}/estimates/compare?surveyorVersion=99`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(resMissingVersion.status).toBe(404);
    expect(resMissingVersion.body.errors[0].code).toBe('ESTIMATE_NOT_FOUND');
  });

  // 24
  it('should allow CLAIMS_OFFICER or ADMIN to approve an estimate when claim is UNDER_REVIEW', async () => {
    await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: [{ lineType: 'LABOR', description: 'Labor', quantity: 1, unitPrice: 100.0 }],
      });

    const res = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates/1/approve`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.approvedEstimateVersion).toBe(1);

    const dbClaim = await Claim.findById(claimUnderReview._id);
    expect(dbClaim.approvedEstimateVersion).toBe(1);
  });

  // 25
  it('should reject estimate approval with 403 Forbidden when requested by FIELD_ADJUSTER', async () => {
    await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: [{ lineType: 'LABOR', description: 'Labor', quantity: 1, unitPrice: 100.0 }],
      });

    const res = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates/1/approve`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`);

    expect(res.status).toBe(403);
  });

  // 26
  it('should reject estimate approval with 409 INVALID_STATUS_TRANSITION when claim is not in UNDER_REVIEW', async () => {
    await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [{ lineType: 'LABOR', description: 'Labor', quantity: 1, unitPrice: 100.0 }],
      });

    const res = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates/1/approve`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  // 27
  it('should reject estimate approval with 404 ESTIMATE_NOT_FOUND when version does not exist', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates/99/approve`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('ESTIMATE_NOT_FOUND');
  });

  // 28
  it('should replace previous approval when another version is approved', async () => {
    await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: [{ lineType: 'LABOR', description: 'V1', quantity: 1, unitPrice: 100.0 }],
      });

    await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: [{ lineType: 'LABOR', description: 'V2', quantity: 2, unitPrice: 100.0 }],
      });

    await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates/1/approve`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    const res = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates/2/approve`)
      .set('Authorization', `Bearer ${generateToken(admin1)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.approvedEstimateVersion).toBe(2);

    const dbClaim = await Claim.findById(claimUnderReview._id);
    expect(dbClaim.approvedEstimateVersion).toBe(2);
  });

  // 29
  it('should feed approved estimate into decision when lossAssessment is omitted', async () => {
    const resEst = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: workedExampleLines,
      });
    expect(resEst.status).toBe(201);

    const resApprove = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates/1/approve`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);
    expect(resApprove.status).toBe(200);

    const res = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        decision: 'APPROVED',
        notes: 'Approved based on Garage quote',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
    expect(res.body.data.lossAssessment.estimatedPartsCost).toBe(2148.0);
    expect(res.body.data.lossAssessment.laborCost).toBe(520.0);
    expect(res.body.data.lossAssessment.totalDamage).toBe(2668.0);
    expect(res.body.data.lossAssessment.policyDeductible).toBe(500.0);
    expect(res.body.data.lossAssessment.deductibleApplied).toBe(500.0);
    expect(res.body.data.lossAssessment.netApprovedPayout).toBe(2168.0);
  });

  // 30
  it('should accept decision when lossAssessment matches approved estimate R6 values', async () => {
    const resEst = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: workedExampleLines,
      });
    expect(resEst.status).toBe(201);

    const resApprove = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates/1/approve`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);
    expect(resApprove.status).toBe(200);

    const res = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 2148.0,
          laborCost: 520.0,
          deductibleApplied: 500.0,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.lossAssessment.estimatedPartsCost).toBe(2148.0);
  });

  // 31
  it('should reject decision with 422 LOSS_ASSESSMENT_MISMATCH when lossAssessment differs from approved estimate', async () => {
    const resEst = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: workedExampleLines,
      });
    expect(resEst.status).toBe(201);

    const resApprove = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates/1/approve`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);
    expect(resApprove.status).toBe(200);

    const res = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        decision: 'APPROVED',
        lossAssessment: {
          estimatedPartsCost: 2000.0, // differs from 2148.0
          laborCost: 520.0,
        },
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('LOSS_ASSESSMENT_MISMATCH');
  });

  // 32
  it('should reject approval with 400 VALIDATION_ERROR when no approved estimate exists and lossAssessment is omitted', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        decision: 'APPROVED',
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    expect(res.body.errors[0].details).toMatch(/lossAssessment is required/i);
  });

  // 33
  it('should ensure SURVEYOR_FEE and TOWING expenses never enter lossAssessment or netApprovedPayout', async () => {
    const resEst = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: workedExampleLines,
      });
    expect(resEst.status).toBe(201);

    const resApprove = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates/1/approve`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);
    expect(resApprove.status).toBe(200);

    const res = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/decision`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        decision: 'APPROVED',
      });

    expect(res.status).toBe(200);
    // Total damage in lossAssessment = parts (2148) + labor (520) = 2668.
    // Expenses (surveyor fee 250 + towing 150 = 400) are excluded.
    expect(res.body.data.lossAssessment.totalDamage).toBe(2668.0);
    expect(res.body.data.lossAssessment.netApprovedPayout).toBe(2168.0);
  });

  // 34
  it('should reject estimate creation or approval after claim is APPROVED, REJECTED, or CLOSED with 409 INVALID_STATUS_TRANSITION', async () => {
    const resAdd = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: [{ lineType: 'LABOR', description: 'Labor', quantity: 1, unitPrice: 100.0 }],
      });

    expect(resAdd.status).toBe(409);
    expect(resAdd.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');

    const resApprove = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/estimates/1/approve`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(resApprove.status).toBe(409);
    expect(resApprove.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  // 35
  it('should store all financial amounts as integer minor units in database and return major units in API responses', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [
          {
            lineType: 'PART',
            description: 'Door panel',
            quantity: 1,
            unitPrice: 50.25,
            partCondition: 'NEW_ORIGINAL',
            depreciationPercent: 0,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.lines[0].unitPrice).toBe(50.25);
    expect(res.body.data.lines[0].gross).toBe(50.25);

    const dbClaim = await Claim.findById(claimInProgress._id).lean();
    const line = dbClaim.estimates[0].lines[0];
    expect(line.unitPrice).toBe(5025);
    expect(line.gross).toBe(5025);
    expect(line.net).toBe(5025);
    expect(Number.isInteger(line.unitPrice)).toBe(true);
  });

  // 36 (C1)
  it('should add the first estimate to a legacy claim that has no estimatesCount field', async () => {
    // Insert raw legacy claim document directly without estimatesCount
    const legacyClaimId = new mongoose.Types.ObjectId();
    await Claim.collection.insertOne({
      _id: legacyClaimId,
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'IN_PROGRESS',
      customer: { name: 'Legacy Customer', phone: '0599000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post(`/api/v1/claims/${legacyClaimId}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [{ lineType: 'LABOR', description: 'Legacy inspection', quantity: 1, unitPrice: 100.0 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.version).toBe(1);

    const dbClaim = await Claim.findById(legacyClaimId).lean();
    expect(dbClaim.estimatesCount).toBe(1);
    expect(dbClaim.estimates).toHaveLength(1);
  });

  // 37 (R11)
  it('should return 404 CLAIM_NOT_FOUND when a FIELD_ADJUSTER adds an estimate to a claim assigned to someone else', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster2)}`)
      .send({
        source: 'SURVEYOR',
        lines: [{ lineType: 'LABOR', description: 'Labor', quantity: 1, unitPrice: 100.0 }],
      });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  // 38 (C3)
  it('should push timeline events for estimate added and approved without changing the public tracking timeline', async () => {
    // 1. Add estimate
    await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .send({
        source: 'GARAGE',
        garageId: garage1._id.toString(),
        lines: [{ lineType: 'LABOR', description: 'Labor', quantity: 1, unitPrice: 100.0 }],
      });

    // 2. Approve estimate
    await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/estimates/1/approve`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    const dbClaim = await Claim.findById(claimUnderReview._id).lean();
    const addEvent = dbClaim.timeline.find((t) => t.action === 'Estimate Added');
    expect(addEvent).toBeDefined();
    expect(addEvent.notes).toBe('Estimate version 1 (GARAGE)');
    expect(addEvent.previousStatus).toBe('UNDER_REVIEW');
    expect(addEvent.newStatus).toBe('UNDER_REVIEW');

    const approveEvent = dbClaim.timeline.find((t) => t.action === 'Estimate Approved');
    expect(approveEvent).toBeDefined();
    expect(approveEvent.notes).toBe('Approved estimate version 1');
    expect(approveEvent.previousStatus).toBe('UNDER_REVIEW');
    expect(approveEvent.newStatus).toBe('UNDER_REVIEW');

    // 3. Verify public tracking timeline is unchanged
    const publicTrackingRes = await request(app).get(`/api/v1/public/track/${claimUnderReview.trackingToken}`);
    if (publicTrackingRes.status === 200) {
      const publicTimeline = publicTrackingRes.body.data.timeline;
      const actions = publicTimeline.map((t) => t.title || t.status);
      expect(actions).not.toContain('Estimate Added');
      expect(actions).not.toContain('Estimate Approved');
    }
  });

  // 39 (C4)
  it('should reject LABOR hours with more than 2 decimals with 400', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/estimates`)
      .set('Authorization', `Bearer ${generateToken(adjuster1)}`)
      .send({
        source: 'SURVEYOR',
        lines: [
          {
            lineType: 'LABOR',
            description: 'Precision labor',
            quantity: 3.125, // 3 decimal places
            unitPrice: 80.0,
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });
});

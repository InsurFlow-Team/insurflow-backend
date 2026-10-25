const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Customer = require('../src/modules/customers/customer.model');
const Incident = require('../src/modules/incidents/incident.model');
const { buildPolicy } = require('./helpers/policyFactory');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');

let Letter;
try {
  Letter = require('../src/modules/letters/letter.model');
} catch {
  Letter = null;
}

let letterTemplates;
try {
  letterTemplates = require('../src/modules/letters/letter.templates');
} catch {
  letterTemplates = null;
}

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

describe('PB-09: Official Arabic Letters (Approval, Rejection) & Engine', () => {
  let org1, org2;
  let admin1, officer1, officer2, adjuster1;
  let customer1;
  let vehicle1, policy1;
  let claimApproved, claimClosed, claimRejected, claimUnderReview, claimInProgress;

  beforeEach(async () => {
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
      name: 'Officer Olivia (Org 2)',
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
      status: 'ACTIVE',
    });

    customer1 = await Customer.create({
      fullName: 'Sarah Connor',
      phone: '+970599111222',
      organizationId: org1._id,
    });

    vehicle1 = await Vehicle.create({
      plateNumber: 'DXB-A-12345',
      make: 'Toyota',
      model: 'RAV4',
      year: 2023,
      color: 'White',
      customerId: customer1._id,
      organizationId: org1._id,
    });

    policy1 = await buildPolicy({
      policyNumber: 'POL-APX-9988',
      status: 'ACTIVE',
      startDate: new Date('2026-01-01T00:00:00Z'),
      expiryDate: new Date('2027-01-01T00:00:00Z'),
      organizationId: org1._id,
    });

    claimApproved = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'APPROVED',
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      incidentDate: '2026-09-05',
      vehicle: {
        plateNumber: vehicle1.plateNumber,
        vehicleId: vehicle1._id,
        policyId: policy1._id,
        customerId: customer1._id,
      },
      customer: { name: 'Sarah Connor', phone: '+970599111222' },
      lossAssessment: {
        estimatedPartsCost: 300000,
        laborCost: 150000,
        totalDamage: 450000,
        policyDeductible: 50000,
        deductibleApplied: 50000,
        netApprovedPayout: 400000,
        assessedAt: new Date(),
        assessedBy: officer1._id,
      },
    });

    claimClosed = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'CLOSED',
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      incidentDate: '2026-09-05',
      vehicle: {
        plateNumber: vehicle1.plateNumber,
        vehicleId: vehicle1._id,
        policyId: policy1._id,
        customerId: customer1._id,
      },
      customer: { name: 'Sarah Connor', phone: '+970599111222' },
      lossAssessment: {
        estimatedPartsCost: 200000,
        laborCost: 100000,
        totalDamage: 300000,
        policyDeductible: 50000,
        deductibleApplied: 50000,
        netApprovedPayout: 250000,
        assessedAt: new Date(),
        assessedBy: officer1._id,
      },
      closedAt: new Date(),
      closedBy: admin1._id,
    });

    claimRejected = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'REJECTED',
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      incidentDate: '2026-09-01',
      vehicle: {
        plateNumber: vehicle1.plateNumber,
        vehicleId: vehicle1._id,
        policyId: policy1._id,
        customerId: customer1._id,
      },
      customer: { name: 'Sarah Connor', phone: '+970599111222' },
      decisionNotes: 'Policy exclusion applies to driver.',
    });

    claimUnderReview = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'UNDER_REVIEW',
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      incidentDate: '2026-09-02',
      vehicle: {
        plateNumber: vehicle1.plateNumber,
        vehicleId: vehicle1._id,
        policyId: policy1._id,
        customerId: customer1._id,
      },
      customer: { name: 'Sarah Connor', phone: '+970599111222' },
    });

    claimInProgress = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'IN_PROGRESS',
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      incidentDate: '2026-09-03',
      vehicle: {
        plateNumber: vehicle1.plateNumber,
        vehicleId: vehicle1._id,
        policyId: policy1._id,
        customerId: customer1._id,
      },
      customer: { name: 'Sarah Connor', phone: '+970599111222' },
    });
  });

  test('R5: issue APPROVAL letter successfully on an APPROVED claim with lossAssessment', async () => {
    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.letterNumber).toMatch(/^LTR-APX-\d{4}-\d{4}$/);
    expect(res.body.data.type).toBe('APPROVAL');
    expect(res.body.data.claimId).toBe(claimApproved._id.toString());
    expect(res.body.data.issuedByRole).toBe('CLAIMS_OFFICER');
  });

  test('R5: issue APPROVAL letter successfully on a CLOSED claim with lossAssessment', async () => {
    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimClosed._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe('APPROVAL');
  });

  test('R5: issue REJECTION letter successfully on a REJECTED claim with valid reason', async () => {
    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimRejected._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'REJECTION',
        reason: 'السائق غير مغطى بموجب وثيقة التأمين المذكورة.',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe('REJECTION');
    expect(res.body.data.snapshot.reason).toBe('السائق غير مغطى بموجب وثيقة التأمين المذكورة.');
  });

  test('R5: 409 INVALID_STATUS_TRANSITION when issuing APPROVAL on a REJECTED claim', async () => {
    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimRejected._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R5: 409 INVALID_STATUS_TRANSITION when issuing APPROVAL on an UNDER_REVIEW claim', async () => {
    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R5: 409 INVALID_STATUS_TRANSITION when issuing APPROVAL on an APPROVED claim lacking lossAssessment', async () => {
    const claimWithoutLA = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      status: 'APPROVED',
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      vehicle: { plateNumber: vehicle1.plateNumber, customerId: customer1._id },
      customer: { name: 'Sarah Connor', phone: '+970599111222' },
      lossAssessment: null,
    });

    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimWithoutLA._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R5: 409 INVALID_STATUS_TRANSITION when issuing REJECTION on an APPROVED claim', async () => {
    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'REJECTION', reason: 'سبب الرفض للمطالبة المرفوضة هنا' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R5: 409 INVALID_STATUS_TRANSITION when issuing REJECTION on an IN_PROGRESS claim', async () => {
    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimInProgress._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'REJECTION', reason: 'سبب الرفض للمطالبة المرفوضة هنا' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('R6: 400 VALIDATION_ERROR when issuing REJECTION without reason', async () => {
    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimRejected._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'REJECTION' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  test('R6: 400 VALIDATION_ERROR when issuing REJECTION with reason under 10 characters', async () => {
    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimRejected._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'REJECTION', reason: 'قصير' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  test('R6: 400 VALIDATION_ERROR when issuing REJECTION with reason over 500 characters', async () => {
    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimRejected._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'REJECTION', reason: 'أ'.repeat(501) });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  test('R6: 400 VALIDATION_ERROR when issuing APPROVAL with reason present in request body', async () => {
    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL', reason: 'لا يجب كتابة سبب هنا للموافقة' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  test('R7: 403 Forbidden for FIELD_ADJUSTER attempting to issue a letter', async () => {
    const token = generateToken(adjuster1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('R7: 403 Forbidden for FIELD_ADJUSTER attempting to list letters', async () => {
    const token = generateToken(adjuster1);
    const res = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('R7: 403 Forbidden for FIELD_ADJUSTER attempting to download letter PDF', async () => {
    const token = generateToken(adjuster1);
    const res = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/letters/LTR-APX-2026-0001/pdf`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('R7: 200/201 for ADMIN to issue, list, and download letters', async () => {
    const token = generateToken(admin1);
    const issueRes = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    expect(issueRes.status).toBe(201);
    const letterNumber = issueRes.body.data.letterNumber;

    const listRes = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);

    const pdfRes = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/letters/${letterNumber}/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true);
    expect(pdfRes.status).toBe(200);
  });

  test('R7: 404 CLAIM_NOT_FOUND when issuing letter on cross-tenant claim', async () => {
    const token = generateToken(officer2); // Org 2 officer
    const res = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`) // Org 1 claim
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  test('R7: 404 CLAIM_NOT_FOUND when listing letters on cross-tenant claim', async () => {
    const token = generateToken(officer2); // Org 2 officer
    const res = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/letters`) // Org 1 claim
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  test('R7: 404 LETTER_NOT_FOUND when downloading letter from another tenant', async () => {
    // Org 1 officer issues a letter
    const token1 = generateToken(officer1);
    const issueRes = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ type: 'APPROVAL' });
    const letterNumber = issueRes.body.data.letterNumber;

    // Org 2 officer attempts to download it
    const token2 = generateToken(officer2);
    const res = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/letters/${letterNumber}/pdf`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('R2: letter numbering increments sequence per organization (LTR-ORG-YEAR-0001, 0002)', async () => {
    const token = generateToken(officer1);
    const res1 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    const res2 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    expect(res1.body.data.letterNumber).toMatch(/^LTR-APX-\d{4}-0001$/);
    expect(res2.body.data.letterNumber).toMatch(/^LTR-APX-\d{4}-0002$/);
  });

  test('R2: two organizations maintain independent letter numbering sequences', async () => {
    const token1 = generateToken(officer1);
    const token2 = generateToken(officer2);

    const claimOrg2 = await Claim.create({
      organizationId: org2._id,
      policyId: policy1._id,
      createdBy: officer2._id,
      status: 'APPROVED',
      incidentType: 'COLLISION',
      incidentLocation: 'Nablus',
      incidentDate: '2026-09-01',
      customer: { name: 'Org2 Customer', phone: '+970599000000' },
      lossAssessment: {
        estimatedPartsCost: 100000,
        laborCost: 50000,
        totalDamage: 150000,
        policyDeductible: 10000,
        deductibleApplied: 10000,
        netApprovedPayout: 140000,
        assessedAt: new Date(),
        assessedBy: officer2._id,
      },
    });

    const res1 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ type: 'APPROVAL' });

    const res2 = await request(app)
      .post(`/api/v1/claims/${claimOrg2._id}/letters`)
      .set('Authorization', `Bearer ${token2}`)
      .send({ type: 'APPROVAL' });

    expect(res1.body.data.letterNumber).toMatch(/^LTR-APX-\d{4}-0001$/);
    expect(res2.body.data.letterNumber).toMatch(/^LTR-BCN-\d{4}-0001$/);
  });

  test('R2: letter numbering resets sequence to 0001 upon year rollover in Asia/Hebron', async () => {
    const token = generateToken(officer1);

    // Sequence 1 in current year
    const res1 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    expect(res1.body.data.letterNumber).toMatch(/-0001$/);

    // Advance clock to next year 2027
    const OriginalDate = global.Date;
    class MockDate extends OriginalDate {
      constructor(...args) {
        if (args.length) {
          super(...args);
        } else {
          super('2027-01-15T12:00:00Z');
        }
      }
      static now() {
        return new OriginalDate('2027-01-15T12:00:00Z').getTime();
      }
    }
    global.Date = MockDate;

    try {
      const token2027 = generateToken(officer1);
      const res2 = await request(app)
        .post(`/api/v1/claims/${claimApproved._id}/letters`)
        .set('Authorization', `Bearer ${token2027}`)
        .send({ type: 'APPROVAL' });

      expect(res2.body.data.letterNumber).toBe('LTR-APX-2027-0001');
    } finally {
      global.Date = OriginalDate;
    }
  });

  test('R2: concurrent letter issuance requests generate distinct, non-colliding sequential letter numbers', async () => {
    const token = generateToken(officer1);
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/v1/claims/${claimApproved._id}/letters`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'APPROVAL' }),
      request(app)
        .post(`/api/v1/claims/${claimApproved._id}/letters`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'APPROVAL' }),
    ]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    const num1 = res1.body.data.letterNumber;
    const num2 = res2.body.data.letterNumber;
    expect(num1).not.toBe(num2);
    const seqs = [num1, num2].map((n) => parseInt(n.split('-')[3], 10)).sort();
    expect(seqs).toEqual([1, 2]);
  });

  test('A2: addresseeName resolves from incident claimant party when claimantPartyId matches', async () => {
    const claimantPartyId = new mongoose.Types.ObjectId();
    const incident = await Incident.create({
      organizationId: org1._id,
      incidentDate: '2026-08-20',
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      createdBy: officer1._id,
      parties: [
        {
          _id: claimantPartyId,
          role: 'POLICYHOLDER',
          partyType: 'PERSON',
          fullName: 'Ahmad Claimant Party',
        },
      ],
    });

    const claimWithClaimant = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      incidentId: incident._id,
      claimantPartyId,
      status: 'APPROVED',
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      incidentDate: '2026-08-20',
      customer: { name: 'Sarah Connor', phone: '+970599111222' },
      lossAssessment: claimApproved.lossAssessment,
    });

    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimWithClaimant._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    expect(res.status).toBe(201);
    expect(res.body.data.snapshot.addresseeName).toBe('Ahmad Claimant Party');
  });

  test('A2: addresseeName falls back to vehicle owner customer fullName when claimantPartyId is absent', async () => {
    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    expect(res.status).toBe(201);
    expect(res.body.data.snapshot.addresseeName).toBe('Sarah Connor');
  });

  test('A2: 422 ADDRESSEE_NOT_FOUND when neither claimant party nor vehicle owner customer resolves', async () => {
    const insertRes = await Claim.collection.insertOne({
      organizationId: org1._id,
      status: 'APPROVED',
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      incidentDate: '2026-08-20',
      lossAssessment: claimApproved.lossAssessment,
      vehicle: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${insertRes.insertedId}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('ADDRESSEE_NOT_FOUND');
  });

  test('A3: incidentDate resolves from incident incidentDate and falls back to claim incidentDate', async () => {
    const incident = await Incident.create({
      organizationId: org1._id,
      incidentDate: '2026-07-11',
      incidentType: 'COLLISION',
      incidentLocation: 'Hebron',
      createdBy: officer1._id,
    });

    const claimWithInc = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      incidentId: incident._id,
      status: 'APPROVED',
      incidentType: 'COLLISION',
      incidentLocation: 'Hebron',
      incidentDate: '2026-01-01',
      customer: { name: 'Sarah Connor', phone: '+970599111222' },
      lossAssessment: claimApproved.lossAssessment,
    });

    const token = generateToken(officer1);
    const res = await request(app)
      .post(`/api/v1/claims/${claimWithInc._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    expect(res.status).toBe(201);
    expect(res.body.data.snapshot.incidentDate).toBe('2026-07-11');
  });

  test('R3: letter snapshot is frozen; modifying claim, customer, or organization does not alter letter snapshot', async () => {
    const token = generateToken(officer1);
    const issueRes = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    expect(issueRes.status).toBe(201);
    const letterNumber = issueRes.body.data.letterNumber;

    // Mutate claim, customer, and organization
    await Claim.findByIdAndUpdate(claimApproved._id, { 'vehicle.plateNumber': 'MUTATED-PLATE' });
    await Customer.findByIdAndUpdate(customer1._id, { fullName: 'Mutated Customer Name' });
    await Organization.findByIdAndUpdate(org1._id, { name: 'Mutated Org Name' });

    // Fetch letter details
    const listRes = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`);

    const issuedLetter = listRes.body.data.find((l) => l.letterNumber === letterNumber);
    expect(issuedLetter.snapshot.plateNumber).toBe('DXB-A-12345');
    expect(issuedLetter.snapshot.addresseeName).toBe('Sarah Connor');
    expect(issuedLetter.snapshot.letterhead.organizationName).toBe('Apex Insurance');
  });

  test('R4 & A5: superseding a letter of the same type sets supersedesLetterId and marks old letter superseded', async () => {
    const token = generateToken(officer1);
    const res1 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    const letter1Number = res1.body.data.letterNumber;

    const res2 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'APPROVAL',
        supersedesLetterNumber: letter1Number,
      });

    expect(res2.status).toBe(201);
    expect(res2.body.data.supersedesLetterId).toBe(res1.body.data.id);

    const listRes = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`);

    const letters = listRes.body.data;
    const l1 = letters.find((l) => l.letterNumber === letter1Number);
    const l2 = letters.find((l) => l.letterNumber === res2.body.data.letterNumber);

    expect(l1.superseded).toBe(true);
    expect(l2.superseded).toBe(false);
  });

  test('A5: 422 SUPERSEDE_INVALID when superseding letter of a different type', async () => {
    const token = generateToken(officer1);
    const res1 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    const letter1Number = res1.body.data.letterNumber;

    const res2 = await request(app)
      .post(`/api/v1/claims/${claimRejected._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'REJECTION',
        reason: 'سبب الرفض للمطالبة المرفوضة هنا',
        supersedesLetterNumber: letter1Number,
      });

    expect(res2.status).toBe(422);
    expect(res2.body.success).toBe(false);
    expect(res2.body.errors[0].code).toBe('SUPERSEDE_INVALID');
  });

  test('A5: 422 SUPERSEDE_INVALID when superseding letter of a different claim', async () => {
    const token = generateToken(officer1);
    const res1 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    const letter1Number = res1.body.data.letterNumber;

    const res2 = await request(app)
      .post(`/api/v1/claims/${claimClosed._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'APPROVAL',
        supersedesLetterNumber: letter1Number,
      });

    expect(res2.status).toBe(422);
    expect(res2.body.success).toBe(false);
    expect(res2.body.errors[0].code).toBe('SUPERSEDE_INVALID');
  });

  test('A5: 422 SUPERSEDE_INVALID when target letter is already superseded (double supersede prevention)', async () => {
    const token = generateToken(officer1);
    const res1 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    const letter1Number = res1.body.data.letterNumber;

    // Supersede first time
    const res2 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'APPROVAL',
        supersedesLetterNumber: letter1Number,
      });
    expect(res2.status).toBe(201);

    // Attempt second supersede of letter1
    const res3 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'APPROVAL',
        supersedesLetterNumber: letter1Number,
      });

    expect(res3.status).toBe(422);
    expect(res3.body.success).toBe(false);
    expect(res3.body.errors[0].code).toBe('SUPERSEDE_INVALID');
  });

  test('C2: concurrent supersede of the same letter gives one 201 and one 422 SUPERSEDE_INVALID', async () => {
    const token = generateToken(officer1);
    const res1 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    const letter1Number = res1.body.data.letterNumber;

    const [c1, c2] = await Promise.all([
      request(app)
        .post(`/api/v1/claims/${claimApproved._id}/letters`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'APPROVAL', supersedesLetterNumber: letter1Number }),
      request(app)
        .post(`/api/v1/claims/${claimApproved._id}/letters`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'APPROVAL', supersedesLetterNumber: letter1Number }),
    ]);

    const statuses = [c1.status, c2.status].sort();
    expect(statuses).toEqual([201, 422]);

    const failed = c1.status === 422 ? c1 : c2;
    expect(failed.body.errors[0].code).toBe('SUPERSEDE_INVALID');
  });

  test('A4: GET /letters list returns newest first and includes superseded boolean flag', async () => {
    const token = generateToken(officer1);
    const r1 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    const r2 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL', supersedesLetterNumber: r1.body.data.letterNumber });

    const res = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data[0].letterNumber).toBe(r2.body.data.letterNumber);
    expect(res.body.data[1].letterNumber).toBe(r1.body.data.letterNumber);
    expect(res.body.data[0].superseded).toBe(false);
    expect(res.body.data[1].superseded).toBe(true);
  });

  test('A4 & D1: GET /letters/:letterNumber/pdf streams application/pdf starting with %PDF and attachment header', async () => {
    const token = generateToken(officer1);
    const issueRes = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/letters`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'APPROVAL' });

    const letterNumber = issueRes.body.data.letterNumber;

    const res = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/letters/${letterNumber}/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${letterNumber}.pdf"`);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.toString('utf-8').startsWith('%PDF')).toBe(true);
  });

  test('R8: APPROVAL document definition matches exact Arabic text, salutation, body, table, and signature', async () => {
    if (!letterTemplates) {
      throw new Error('letterTemplates module not loaded');
    }
    const snapshot = {
      letterhead: { organizationName: 'Apex Insurance', address: 'Ramallah', phone: '022987654' },
      letterNumber: 'LTR-APX-2026-0001',
      issueDate: '2026-10-25',
      type: 'APPROVAL',
      addresseeName: 'Sarah Connor',
      claimNumber: 'CLM-APX-0001',
      plateNumber: 'DXB-A-12345',
      incidentDate: '2026-09-05',
      financials: { totalDamage: 450000, deductibleApplied: 50000, netApprovedPayout: 400000 },
      currency: 'ILS',
      reason: null,
      issuer: { name: 'Officer Oscar', role: 'CLAIMS_OFFICER' },
    };

    const docDef = letterTemplates.buildLetterDocDefinition(snapshot);
    const jsonStr = JSON.stringify(docDef);

    expect(jsonStr).toContain('الموافقة على مطالبة التعويض رقم CLM-APX-0001');
    expect(jsonStr).toContain('السيد/السيدة Sarah Connor المحترم/ة');
    expect(jsonStr).toContain('تحية طيبة وبعد،');
    expect(jsonStr).toContain('نفيدكم بأنه تمت الموافقة على مطالبتكم المتعلقة بالمركبة المذكورة أدناه، وفق التفاصيل التالية:');
    expect(jsonStr).toContain('رقم المطالبة');
    expect(jsonStr).toContain('رقم المركبة');
    expect(jsonStr).toContain('تاريخ الحادث');
    expect(jsonStr).toContain('قيمة الأضرار المقدرة');
    expect(jsonStr).toContain('التحمل المطبق');
    expect(jsonStr).toContain('صافي مبلغ التعويض');
    expect(jsonStr).toContain('4500.00 ILS');
    expect(jsonStr).toContain('500.00 ILS');
    expect(jsonStr).toContain('4000.00 ILS');
    expect(jsonStr).toContain('وسيتم التواصل معكم لاستكمال إجراءات الإصلاح والصرف. وتفضلوا بقبول فائق الاحترام،');
    expect(jsonStr).toContain('دائرة المطالبات، Apex Insurance');
  });

  test('R8: REJECTION document definition matches exact Arabic text, reason paragraph, table, and signature', async () => {
    if (!letterTemplates) {
      throw new Error('letterTemplates module not loaded');
    }
    const snapshot = {
      letterhead: { organizationName: 'Apex Insurance', address: 'Ramallah', phone: '022987654' },
      letterNumber: 'LTR-APX-2026-0001',
      issueDate: '2026-10-25',
      type: 'REJECTION',
      addresseeName: 'Sarah Connor',
      claimNumber: 'CLM-APX-0001',
      plateNumber: 'DXB-A-12345',
      incidentDate: '2026-09-05',
      financials: null,
      currency: 'ILS',
      reason: 'السائق غير مغطى بموجب وثيقة التأمين المذكورة.',
      issuer: { name: 'Officer Oscar', role: 'CLAIMS_OFFICER' },
    };

    const docDef = letterTemplates.buildLetterDocDefinition(snapshot);
    const jsonStr = JSON.stringify(docDef);

    expect(jsonStr).toContain('الاعتذار عن قبول مطالبة التعويض رقم CLM-APX-0001');
    expect(jsonStr).toContain('السيد/السيدة Sarah Connor المحترم/ة');
    expect(jsonStr).toContain('تحية طيبة وبعد،');
    expect(jsonStr).toContain('نأسف لإبلاغكم بأنه تعذر قبول مطالبتكم المتعلقة بالمركبة المذكورة أدناه، وذلك للسبب التالي:');
    expect(jsonStr).toContain('السائق غير مغطى بموجب وثيقة التأمين المذكورة.');
    expect(jsonStr).toContain('رقم المطالبة');
    expect(jsonStr).toContain('رقم المركبة');
    expect(jsonStr).toContain('تاريخ الحادث');
    expect(jsonStr).toContain('ويمكنكم مراجعة دائرة المطالبات لأي استفسار. وتفضلوا بقبول فائق الاحترام،');
    expect(jsonStr).toContain('دائرة المطالبات، Apex Insurance');
  });

  test('A1: letterhead renders organization name, address, phone, and omits null fields gracefully', async () => {
    if (!letterTemplates) {
      throw new Error('letterTemplates module not loaded');
    }
    const snapshotWithNulls = {
      letterhead: { organizationName: 'Apex Insurance', address: null, phone: null },
      letterNumber: 'LTR-APX-2026-0001',
      issueDate: '2026-10-25',
      type: 'APPROVAL',
      addresseeName: 'Sarah Connor',
      claimNumber: 'CLM-APX-0001',
      plateNumber: 'DXB-A-12345',
      incidentDate: '2026-09-05',
      financials: { totalDamage: 450000, deductibleApplied: 50000, netApprovedPayout: 400000 },
      currency: 'ILS',
      reason: null,
      issuer: { name: 'Officer Oscar', role: 'CLAIMS_OFFICER' },
    };

    const docDef = letterTemplates.buildLetterDocDefinition(snapshotWithNulls);
    const jsonStr = JSON.stringify(docDef);

    expect(jsonStr).toContain('Apex Insurance');
    expect(jsonStr).not.toContain('null');
  });

  test('R1: immutable Letter model blocks save() on non-new documents', async () => {
    if (!Letter) {
      throw new Error('Letter model not loaded');
    }
    const doc = await Letter.create({
      organizationId: org1._id,
      claimId: claimApproved._id,
      letterNumber: 'LTR-APX-2026-0099',
      type: 'APPROVAL',
      snapshot: { sample: 'data' },
      issuedBy: officer1._id,
      issuedByRole: 'CLAIMS_OFFICER',
    });

    doc.type = 'REJECTION';
    await expect(doc.save()).rejects.toThrow(/immutable/i);
  });

  test('R1: immutable Letter model blocks updateOne, updateMany, findOneAndUpdate, and replaceOne', async () => {
    if (!Letter) {
      throw new Error('Letter model not loaded');
    }
    await expect(
      Letter.updateOne({ letterNumber: 'LTR-APX-2026-0001' }, { $set: { type: 'REJECTION' } })
    ).rejects.toThrow(/immutable/i);

    await expect(
      Letter.updateMany({ letterNumber: 'LTR-APX-2026-0001' }, { $set: { type: 'REJECTION' } })
    ).rejects.toThrow(/immutable/i);

    await expect(
      Letter.findOneAndUpdate({ letterNumber: 'LTR-APX-2026-0001' }, { $set: { type: 'REJECTION' } })
    ).rejects.toThrow(/immutable/i);

    await expect(
      Letter.replaceOne({ letterNumber: 'LTR-APX-2026-0001' }, { type: 'REJECTION' })
    ).rejects.toThrow(/immutable/i);
  });

  test('R1: immutable Letter model blocks deleteOne, deleteMany, and findOneAndDelete', async () => {
    if (!Letter) {
      throw new Error('Letter model not loaded');
    }
    await expect(
      Letter.deleteOne({ letterNumber: 'LTR-APX-2026-0001' })
    ).rejects.toThrow(/immutable/i);

    await expect(
      Letter.deleteMany({ letterNumber: 'LTR-APX-2026-0001' })
    ).rejects.toThrow(/immutable/i);

    await expect(
      Letter.findOneAndDelete({ letterNumber: 'LTR-APX-2026-0001' })
    ).rejects.toThrow(/immutable/i);
  });

  test('prints an empty string, never undefined, for a missing snapshot value', () => {
    if (!letterTemplates) {
      throw new Error('letterTemplates module not loaded');
    }
    const approvalDoc = letterTemplates.buildLetterDocDefinition({ type: 'APPROVAL' });
    const rejectionDoc = letterTemplates.buildLetterDocDefinition({ type: 'REJECTION' });

    const approvalJson = JSON.stringify(approvalDoc);
    const rejectionJson = JSON.stringify(rejectionDoc);

    expect(approvalJson.includes('undefined')).toBe(false);
    expect(rejectionJson.includes('undefined')).toBe(false);
  });
});

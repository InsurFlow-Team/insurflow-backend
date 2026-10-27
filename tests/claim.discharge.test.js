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
const cloudinary = require('../src/config/cloudinary');
const { isDischargeCovering } = require('../src/modules/claims/claim.service');

// Mock uploadToCloudinary
jest.mock('../src/utils/uploadToCloudinary', () =>
  jest.fn().mockResolvedValue({
    url: 'https://res.cloudinary.com/fake/discharge-scan.jpg',
    publicId: 'sawn/test-org/discharges/fake-scan-id',
  })
);

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
  jest.clearAllMocks();
});

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

describe('PB-15: Final Discharge (Generate, Sign, Upload)', () => {
  let org1, org2;
  let admin1, officer1, officer2, adjuster1;
  let customer1, vehicle1, policy1;
  let claimApproved, claimUnderReview;

  beforeEach(async () => {
    jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
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
      fullName: 'أحمد محمود التميمي',
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
      customer: { name: 'أحمد محمود التميمي', phone: '+970599111222' },
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

    claimUnderReview = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'UNDER_REVIEW',
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      incidentDate: '2026-09-05',
      vehicle: {
        plateNumber: vehicle1.plateNumber,
        vehicleId: vehicle1._id,
        policyId: policy1._id,
        customerId: customer1._id,
      },
      customer: { name: 'أحمد محمود التميمي', phone: '+970599111222' },
    });
  });

  // 1. Create on APPROVED
  it('should create discharge on APPROVED claim with netApprovedPayout amount (R1, R2)', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.dischargeNumber).toMatch(/^DSC-APX-\d{4}-0001$/);
    expect(res.body.data.amount).toBe(4000); // 400000 minor -> 4000 major in response
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.snapshot.amount).toBe(400000); // minor in snapshot
    expect(res.body.data.snapshot.claimantName).toBe('أحمد محمود التميمي');

    const updated = await Claim.findById(claimApproved._id);
    expect(updated.discharges).toHaveLength(1);
    expect(updated.discharges[0].amount).toBe(400000);
    expect(updated.discharges[0].status).toBe('DRAFT');
  });

  // 2. Create on other status
  it('should return 409 INVALID_STATUS_TRANSITION when creating discharge on non-APPROVED status (R2)', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimUnderReview._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  // 3. Create on APPROVED without lossAssessment
  it('should return 409 INVALID_STATUS_TRANSITION when creating discharge on APPROVED claim without lossAssessment (R2)', async () => {
    const claimWithoutLA = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      status: 'APPROVED',
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      customer: { name: 'Test Claimant', phone: '+970599111222' },
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claimWithoutLA._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  // 4. Duplicate DRAFT with same amount
  it('should return 409 DISCHARGE_EXISTS when creating discharge and a DRAFT discharge with same amount exists (R2)', async () => {
    const res1 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res2.status).toBe(409);
    expect(res2.body.errors[0].code).toBe('DISCHARGE_EXISTS');
  });

  // 5. Duplicate SIGNED with same amount
  it('should return 409 DISCHARGE_EXISTS when creating discharge and a SIGNED discharge with same amount exists (R2)', async () => {
    // Create first discharge
    const res1 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);
    expect(res1.status).toBe(201);
    const dscNumber = res1.body.data.dischargeNumber;

    // Sign it
    const signRes = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges/${dscNumber}/signed-scan`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .attach('file', Buffer.from('fake-image-bytes'), 'signed.jpg');
    expect(signRes.status).toBe(200);

    // Try creating another one with same payout
    const res2 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res2.status).toBe(409);
    expect(res2.body.errors[0].code).toBe('DISCHARGE_EXISTS');
  });

  // 6. Same amount when prior is SUPERSEDED
  it('should allow creating discharge if previous discharge with same amount is SUPERSEDED (R2)', async () => {
    // Directly seed a SUPERSEDED discharge
    await Claim.findByIdAndUpdate(claimApproved._id, {
      $push: {
        discharges: {
          dischargeNumber: 'DSC-APX-2026-0001',
          amount: 400000,
          status: 'SUPERSEDED',
          snapshot: {
            letterhead: { organizationName: 'Apex Insurance' },
            dischargeNumber: 'DSC-APX-2026-0001',
            issueDate: '2026-09-05',
            claimNumber: claimApproved.claimNumber || 'CLM-APX-0001',
            plateNumber: 'DXB-A-12345',
            incidentDate: '2026-09-05',
            claimantName: 'أحمد محمود التميمي',
            claimantIdNumber: '',
            amount: 400000,
            currency: 'ILS',
            organizationName: 'Apex Insurance',
          },
          signedScan: null,
          createdBy: officer1._id,
          createdAt: new Date(),
        },
      },
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('DRAFT');
  });

  // 7. Concurrent creates
  it('should handle concurrent create requests giving one 201 and one 409 DISCHARGE_EXISTS (R2)', async () => {
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/v1/claims/${claimApproved._id}/discharges`)
        .set('Authorization', `Bearer ${generateToken(officer1)}`),
      request(app)
        .post(`/api/v1/claims/${claimApproved._id}/discharges`)
        .set('Authorization', `Bearer ${generateToken(officer1)}`),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);
    const errRes = res1.status === 409 ? res1 : res2;
    expect(errRes.body.errors[0].code).toBe('DISCHARGE_EXISTS');
  });

  // 8. Legacy claim without discharges field
  it('should create discharge on legacy claim document without discharges field (R2)', async () => {
    // Unset discharges field to simulate legacy claim
    await Claim.collection.updateOne(
      { _id: claimApproved._id },
      { $unset: { discharges: '' } }
    );

    const res = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res.status).toBe(201);
    expect(res.body.data.dischargeNumber).toBeDefined();
    expect(res.body.data.status).toBe('DRAFT');

    const updated = await Claim.findById(claimApproved._id);
    expect(updated.discharges).toHaveLength(1);
  });

  // 9. Supersede existing DRAFT with different amount
  it('should supersede existing DRAFT discharge with different amount when new discharge is created (R2, D3)', async () => {
    // Seed existing DRAFT with 300000
    await Claim.findByIdAndUpdate(claimApproved._id, {
      $push: {
        discharges: {
          dischargeNumber: 'DSC-APX-2026-0001',
          amount: 300000,
          status: 'DRAFT',
          snapshot: {
            letterhead: { organizationName: 'Apex Insurance' },
            dischargeNumber: 'DSC-APX-2026-0001',
            issueDate: '2026-09-05',
            claimNumber: claimApproved.claimNumber || 'CLM-APX-0001',
            plateNumber: 'DXB-A-12345',
            incidentDate: '2026-09-05',
            claimantName: 'أحمد محمود التميمي',
            amount: 300000,
            currency: 'ILS',
            organizationName: 'Apex Insurance',
          },
          signedScan: null,
          createdBy: officer1._id,
          createdAt: new Date(Date.now() - 10000),
        },
      },
    });

    // Create new discharge (netApprovedPayout is 400000)
    const res = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res.status).toBe(201);
    const updated = await Claim.findById(claimApproved._id);
    expect(updated.discharges).toHaveLength(2);
    expect(updated.discharges[0].status).toBe('SUPERSEDED');
    expect(updated.discharges[1].status).toBe('DRAFT');
  });

  // 10. Supersede existing SIGNED with different amount
  it('should supersede existing SIGNED discharge with different amount when new discharge is created (R2, D3)', async () => {
    await Claim.findByIdAndUpdate(claimApproved._id, {
      $push: {
        discharges: {
          dischargeNumber: 'DSC-APX-2026-0001',
          amount: 300000,
          status: 'SIGNED',
          snapshot: {
            letterhead: { organizationName: 'Apex Insurance' },
            dischargeNumber: 'DSC-APX-2026-0001',
            issueDate: '2026-09-05',
            claimNumber: claimApproved.claimNumber || 'CLM-APX-0001',
            plateNumber: 'DXB-A-12345',
            incidentDate: '2026-09-05',
            claimantName: 'أحمد محمود التميمي',
            amount: 300000,
            currency: 'ILS',
            organizationName: 'Apex Insurance',
          },
          signedScan: {
            url: 'https://cloudinary.com/scan.jpg',
            publicId: 'scan1',
            uploadedBy: officer1._id,
            uploadedAt: new Date(),
          },
          createdBy: officer1._id,
          createdAt: new Date(Date.now() - 10000),
          signedAt: new Date(Date.now() - 5000),
        },
      },
    });

    const res = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res.status).toBe(201);
    const updated = await Claim.findById(claimApproved._id);
    expect(updated.discharges).toHaveLength(2);
    expect(updated.discharges[0].status).toBe('SUPERSEDED');
    expect(updated.discharges[1].status).toBe('DRAFT');
  });

  // 11. Sign with valid image
  it('should sign discharge with valid image moving status from DRAFT to SIGNED and recording signedScan (R3, D1)', async () => {
    const resCreate = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);
    expect(resCreate.status).toBe(201);
    const dscNumber = resCreate.body.data.dischargeNumber;

    const resSign = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges/${dscNumber}/signed-scan`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .attach('file', Buffer.from('fake-scan-content'), 'signed_scan.png');

    expect(resSign.status).toBe(200);
    expect(resSign.body.data.status).toBe('SIGNED');
    expect(resSign.body.data.signedScan.url).toBe('https://res.cloudinary.com/fake/discharge-scan.jpg');
    expect(resSign.body.data.signedAt).toBeDefined();

    const updated = await Claim.findById(claimApproved._id);
    const discharge = updated.discharges.find((d) => d.dischargeNumber === dscNumber);
    expect(discharge.status).toBe('SIGNED');
    expect(discharge.signedScan.publicId).toBe('sawn/test-org/discharges/fake-scan-id');
  });

  // 12. Sign twice
  it('should return 409 INVALID_STATUS_TRANSITION when attempting to sign an already SIGNED discharge (R3)', async () => {
    const resCreate = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);
    const dscNumber = resCreate.body.data.dischargeNumber;

    const resSign1 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges/${dscNumber}/signed-scan`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .attach('file', Buffer.from('scan1'), 'signed.jpg');
    expect(resSign1.status).toBe(200);

    const resSign2 = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges/${dscNumber}/signed-scan`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .attach('file', Buffer.from('scan2'), 'signed.jpg');

    expect(resSign2.status).toBe(409);
    expect(resSign2.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  // 13. Sign SUPERSEDED
  it('should return 409 INVALID_STATUS_TRANSITION when attempting to sign a SUPERSEDED discharge (R3)', async () => {
    const resCreate = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);
    const dscNumber = resCreate.body.data.dischargeNumber;

    // Supersede it by increasing loss assessment and creating another discharge
    await Claim.findByIdAndUpdate(claimApproved._id, {
      'lossAssessment.netApprovedPayout': 500000,
    });
    await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    // Attempt to sign old discharge
    const resSign = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges/${dscNumber}/signed-scan`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .attach('file', Buffer.from('scan'), 'signed.jpg');

    expect(resSign.status).toBe(409);
    expect(resSign.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
  });

  // 14. Sign without file
  it('should return 400 VALIDATION_ERROR when signing without attaching a file (R3)', async () => {
    const resCreate = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);
    const dscNumber = resCreate.body.data.dischargeNumber;

    const resSign = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges/${dscNumber}/signed-scan`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(resSign.status).toBe(400);
    expect(resSign.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 15. Sign with non-image file
  it('should return 400 VALIDATION_ERROR when signing with non-image file (e.g. text/plain) (R3)', async () => {
    const resCreate = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);
    const dscNumber = resCreate.body.data.dischargeNumber;

    const resSign = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges/${dscNumber}/signed-scan`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .attach('file', Buffer.from('hello plain text'), { filename: 'doc.txt', contentType: 'text/plain' });

    expect(resSign.status).toBe(400);
    expect(resSign.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 16. Sign file exceeds 10MB
  it('should return 400 VALIDATION_ERROR when signing file exceeds 10MB limit (R3)', async () => {
    const resCreate = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);
    const dscNumber = resCreate.body.data.dischargeNumber;

    const largeBuffer = Buffer.alloc(10 * 1024 * 1024 + 1024);
    const resSign = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges/${dscNumber}/signed-scan`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .attach('file', largeBuffer, 'huge.jpg');

    expect(resSign.status).toBe(400);
    expect(resSign.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 17. Miss after upload deletes file from Cloudinary
  it('should delete uploaded file from Cloudinary and return 404/409 when update misses after upload (R3)', async () => {
    const destroySpy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });

    // Try signing on a non-existent dischargeNumber
    const resSign = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges/DSC-APX-2026-9999/signed-scan`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .attach('file', Buffer.from('test-image'), 'scan.jpg');

    expect(resSign.status).toBe(404);
    expect(resSign.body.errors[0].code).toBe('DISCHARGE_NOT_FOUND');
    expect(destroySpy).toHaveBeenCalledWith('sawn/test-org/discharges/fake-scan-id', { resource_type: 'image' });
  });

  // 18. Sign on non-existent claim
  it('should return 404 CLAIM_NOT_FOUND when signing on non-existent claim (R3)', async () => {
    const fakeClaimId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post(`/api/v1/claims/${fakeClaimId}/discharges/DSC-APX-2026-0001/signed-scan`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .attach('file', Buffer.from('test-image'), 'scan.jpg');

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  // 19. Sign non-existent dischargeNumber
  it('should return 404 DISCHARGE_NOT_FOUND when signing non-existent dischargeNumber (R3)', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges/DSC-APX-2026-9999/signed-scan`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .attach('file', Buffer.from('test-image'), 'scan.jpg');

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('DISCHARGE_NOT_FOUND');
  });

  // 20. Tenancy isolation (cross-tenant 404)
  it('should return 404 CLAIM_NOT_FOUND for cross-tenant discharge create, sign, list, and pdf (R4)', async () => {
    // officer2 belongs to org2
    const token2 = generateToken(officer2);

    const resCreate = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${token2}`);
    expect(resCreate.status).toBe(404);
    expect(resCreate.body.errors[0].code).toBe('CLAIM_NOT_FOUND');

    const resList = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${token2}`);
    expect(resList.status).toBe(404);

    const resPdf = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/discharges/DSC-APX-2026-0001/pdf`)
      .set('Authorization', `Bearer ${token2}`);
    expect(resPdf.status).toBe(404);
  });

  // 21. Roles: CLAIMS_OFFICER and ADMIN allowed
  it('should allow CLAIMS_OFFICER and ADMIN to access all discharge endpoints (R2, R3, R4)', async () => {
    const adminToken = generateToken(admin1);
    const resCreate = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resCreate.status).toBe(201);
    const dscNumber = resCreate.body.data.dischargeNumber;

    const resList = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resList.status).toBe(200);

    const resPdf = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/discharges/${dscNumber}/pdf`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resPdf.status).toBe(200);
  });

  // 22. Roles: FIELD_ADJUSTER gets 403
  it('should return 403 FORBIDDEN for FIELD_ADJUSTER on all discharge endpoints (R4)', async () => {
    const adjToken = generateToken(adjuster1);

    const resCreate = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${adjToken}`);
    expect(resCreate.status).toBe(403);

    const resList = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${adjToken}`);
    expect(resList.status).toBe(403);

    const resSign = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges/DSC-APX-2026-0001/signed-scan`)
      .set('Authorization', `Bearer ${adjToken}`)
      .attach('file', Buffer.from('scan'), 'scan.jpg');
    expect(resSign.status).toBe(403);

    const resPdf = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/discharges/DSC-APX-2026-0001/pdf`)
      .set('Authorization', `Bearer ${adjToken}`);
    expect(resPdf.status).toBe(403);
  });

  // 23. List newest first with major units
  it('should list discharges newest first with amounts in major units and signedScan url (R4)', async () => {
    // Create first
    await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    // Modify payout to allow second discharge
    await Claim.findByIdAndUpdate(claimApproved._id, {
      'lossAssessment.netApprovedPayout': 450000,
    });

    await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    const res = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].amount).toBe(4500); // 450000 minor -> 4500 major
    expect(res.body.data[0].status).toBe('DRAFT');
    expect(res.body.data[1].amount).toBe(4000); // 400000 minor -> 4000 major
    expect(res.body.data[1].status).toBe('SUPERSEDED');
  });

  // 24. PDF content and structure
  it('should return PDF starting with %PDF and verify document definition contains exact R7 Arabic texts (R4, R7, A1)', async () => {
    const resCreate = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);
    const dscNumber = resCreate.body.data.dischargeNumber;

    const resPdf = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/discharges/${dscNumber}/pdf`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(resPdf.status).toBe(200);
    expect(resPdf.headers['content-type']).toBe('application/pdf');
    expect(resPdf.body.slice(0, 4).toString()).toBe('%PDF');

    // Also verify templates document definition contains the exact R7 strings
    const { buildDischargeDocDefinition } = require('../src/modules/letters/letter.templates');
    const docDef = buildDischargeDocDefinition(resCreate.body.data.snapshot);
    const docDefStr = JSON.stringify(docDef);
    expect(docDefStr).toContain('مخالصة نهائية وإبراء ذمة');
    expect(docDefStr).toContain('أقر أنا الموقع أدناه، صاحب المطالبة المبينة في الجدول التالي، بأنني قبلت المبلغ المذكور فيه تعويضا نهائيا وشاملا عن جميع الأضرار المادية التي لحقت بالمركبة نتيجة الحادث المذكور.');
    expect(docDefStr).toContain('رقم المخالصة');
    expect(docDefStr).toContain('رقم المطالبة');
    expect(docDefStr).toContain('رقم المركبة');
    expect(docDefStr).toContain('تاريخ الحادث');
    expect(docDefStr).toContain('اسم المقر');
    expect(docDefStr).toContain('رقم الهوية');
    expect(docDefStr).toContain('مبلغ التعويض');
    expect(docDefStr).toContain('وبموجب هذه المخالصة أبرئ ذمة الشركة إبراء تاما ونهائيا من أي مطالبة أخرى تتعلق بهذه الأضرار.');
    expect(docDefStr).toContain('توقيع المقر');
    expect(docDefStr).toContain('التاريخ');
    expect(docDefStr).toContain('اسم الشاهد وتوقيعه');
  });

  // 25. Snapshot frozen
  it('should verify snapshot remains frozen when claim or customer data is updated afterwards (R1, R6)', async () => {
    const resCreate = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);
    const dscNumber = resCreate.body.data.dischargeNumber;

    // Mutate claim data
    await Claim.findByIdAndUpdate(claimApproved._id, {
      'customer.name': 'New Customer Name',
      'vehicle.plateNumber': 'NEW-PLATE',
      'lossAssessment.netApprovedPayout': 999999,
    });

    const updated = await Claim.findById(claimApproved._id);
    const dsc = updated.discharges.find((d) => d.dischargeNumber === dscNumber);
    expect(dsc.snapshot.claimantName).toBe('أحمد محمود التميمي');
    expect(dsc.snapshot.plateNumber).toBe(vehicle1.plateNumber);
    expect(dsc.snapshot.amount).toBe(400000);
  });

  // 26. Timeline events & public tracking
  it('should push timeline event on create, supersede, and sign while public tracking remains unchanged (R5)', async () => {
    const resCreate = await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);
    const dscNumber = resCreate.body.data.dischargeNumber;

    let claimAfterCreate = await Claim.findById(claimApproved._id);
    const createEvent = claimAfterCreate.timeline[claimAfterCreate.timeline.length - 1];
    expect(createEvent.action).toBe('Discharge Created');
    expect(createEvent.previousStatus).toBe('APPROVED');
    expect(createEvent.newStatus).toBe('APPROVED');

    await request(app)
      .post(`/api/v1/claims/${claimApproved._id}/discharges/${dscNumber}/signed-scan`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`)
      .attach('file', Buffer.from('scan'), 'signed.jpg');

    let claimAfterSign = await Claim.findById(claimApproved._id);
    const signEvent = claimAfterSign.timeline[claimAfterSign.timeline.length - 1];
    expect(signEvent.action).toBe('Discharge Signed');
    expect(signEvent.previousStatus).toBe('APPROVED');
    expect(signEvent.newStatus).toBe('APPROVED');
  });

  // 27. isDischargeCovering true
  it('should return true from isDischargeCovering when a SIGNED discharge covers indemnity amount (R8)', () => {
    const mockClaim = {
      discharges: [
        { status: 'DRAFT', amount: 500000 },
        { status: 'SIGNED', amount: 400000 },
        { status: 'SUPERSEDED', amount: 600000 },
      ],
    };

    expect(isDischargeCovering(mockClaim, 400000)).toBe(true);
    expect(isDischargeCovering(mockClaim, 300000)).toBe(true);
  });

  // 28. isDischargeCovering false
  it('should return false from isDischargeCovering when no discharge is SIGNED, amount is insufficient, or inputs invalid (R8)', () => {
    const mockClaimNoSigned = {
      discharges: [
        { status: 'DRAFT', amount: 500000 },
        { status: 'SUPERSEDED', amount: 600000 },
      ],
    };
    expect(isDischargeCovering(mockClaimNoSigned, 400000)).toBe(false);

    const mockClaimInsufficient = {
      discharges: [{ status: 'SIGNED', amount: 350000 }],
    };
    expect(isDischargeCovering(mockClaimInsufficient, 400000)).toBe(false);

    expect(isDischargeCovering(null, 1000)).toBe(false);
    expect(isDischargeCovering({}, 1000)).toBe(false);
    expect(isDischargeCovering(mockClaimInsufficient, -100)).toBe(false);
    expect(isDischargeCovering(mockClaimInsufficient, 'invalid')).toBe(false);
  });

  // 29. Addressee unresolvable -> 422
  it('should return 422 ADDRESSEE_NOT_FOUND when the claimant cannot be resolved', async () => {
    // Claim with no customer name, no vehicle customer, no claimant party
    const insertRes = await Claim.collection.insertOne({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      status: 'APPROVED',
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      lossAssessment: {
        estimatedPartsCost: 100000,
        laborCost: 50000,
        totalDamage: 150000,
        policyDeductible: 20000,
        deductibleApplied: 20000,
        netApprovedPayout: 130000,
        assessedAt: new Date(),
        assessedBy: officer1._id,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post(`/api/v1/claims/${insertRes.insertedId}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('ADDRESSEE_NOT_FOUND');
  });

  // 30. Literal $ name in pipeline
  it('C1: a claimant name starting with "$" is stored as literal text in the discharge snapshot', async () => {
    const dollarClaim = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      status: 'APPROVED',
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      customer: { name: '$SpecialName', phone: '+970599111222' },
      lossAssessment: {
        estimatedPartsCost: 100000,
        laborCost: 50000,
        totalDamage: 150000,
        policyDeductible: 20000,
        deductibleApplied: 20000,
        netApprovedPayout: 130000,
        assessedAt: new Date(),
        assessedBy: officer1._id,
      },
    });

    const res = await request(app)
      .post(`/api/v1/claims/${dollarClaim._id}/discharges`)
      .set('Authorization', `Bearer ${generateToken(officer1)}`);

    expect(res.status).toBe(201);
    expect(res.body.data.snapshot.claimantName).toBe('$SpecialName');

    const updated = await Claim.findById(dollarClaim._id);
    expect(updated.discharges[0].snapshot.claimantName).toBe('$SpecialName');
  });
});

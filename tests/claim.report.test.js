const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Policy = require('../src/modules/policies/policy.model');
const { buildPolicy } = require('./helpers/policyFactory');
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

// 1x1 transparent PNG buffer for mocking image fetches
const samplePngBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

describe('GET /api/v1/claims/:claimId/report — Final Claim Report (PDF)', () => {
  let org1, org2;
  let admin1, officer1, officer2, adjuster1;
  let vehicle1, policy1;
  let claimApproved, claimRejected, claimClosed, claimInProgress, claimSubmitted, claimUnderReview;

  beforeEach(async () => {
    // Default fetch mock returning valid image buffer
    jest.spyOn(global, 'fetch').mockImplementation(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (header) => (header.toLowerCase() === 'content-type' ? 'image/png' : null),
      },
      arrayBuffer: async () =>
        samplePngBuffer.buffer.slice(samplePngBuffer.byteOffset, samplePngBuffer.byteOffset + samplePngBuffer.byteLength),
    }));

    org1 = await Organization.create({ name: 'Apex Insurance', code: 'APX' });
    global.__testPol = await buildPolicy({ policyNumber: 'POL-FIX-001', status: 'ACTIVE', startDate: new Date('2026-01-01'), expiryDate: new Date('2027-12-31'), organizationId: org1._id });
    org2 = await Organization.create({ name: 'Beacon Mutual', code: 'BCN' });

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

    vehicle1 = await Vehicle.create({
      plateNumber: 'DXB-A-12345',
      make: 'Toyota',
      model: 'RAV4',
      year: 2023,
      color: 'White',
      organizationId: org1._id,
    });

    policy1 = await buildPolicy({
      policyNumber: 'POL-APX-9988',
      status: 'ACTIVE',
      startDate: new Date('2026-01-01T00:00:00Z'),
      expiryDate: new Date('2027-01-01T00:00:00Z'),
      organizationId: org1._id,
    });

    // ── APPROVED Claim ──
    claimApproved = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'APPROVED',
      customer: { name: 'Sarah Connor', phone: '+971501234567' },
      incidentType: 'COLLISION',
      incidentLocation: 'Sheikh Zayed Rd, Dubai',
      vehicle: {
        plateNumber: vehicle1.plateNumber,
        vehicleId: vehicle1._id,
        policyId: policy1._id,
      },
      accident: {
        accidentType: 'COLLISION',
        accidentDate: '2026-09-05',
        accidentTime: '14:30',
        description: 'Rear-ended at traffic signal',
        damageDescription: 'Cracked rear bumper, dented tailgate',
      },
      location: {
        latitude: 25.2048,
        longitude: 55.2708,
        address: 'Downtown Dubai',
        capturedAt: new Date('2026-09-05T15:00:00Z'),
      },
      evidence: [
        {
          imageType: 'VEHICLE_REAR',
          url: 'https://res.cloudinary.com/insurflow/image/upload/v1/insurflow/org1/evidence/rear.jpg',
          publicId: 'rear_001',
          uploadedBy: adjuster1._id,
          uploadedAt: new Date('2026-09-05T15:10:00Z'),
        },
        {
          imageType: 'DAMAGE_CLOSEUP',
          url: 'https://res.cloudinary.com/insurflow/image/upload/v1/insurflow/org1/evidence/closeup.jpg',
          publicId: 'closeup_001',
          uploadedBy: adjuster1._id,
          uploadedAt: new Date('2026-09-05T15:12:00Z'),
        },
      ],
      signature: {
        url: 'https://res.cloudinary.com/insurflow/image/upload/v1/insurflow/org1/signatures/sig.jpg',
        publicId: 'sig_001',
        capturedBy: adjuster1._id,
        capturedAt: new Date('2026-09-05T15:20:00Z'),
      },
      decisionNotes: 'Full repair estimate approved under policy terms.',
      timeline: [
        {
          action: 'Claim Created',
          performedBy: officer1._id,
          role: 'CLAIMS_OFFICER',
          timestamp: new Date('2026-09-05T10:00:00Z'),
        },
        {
          action: 'Inspection Submitted',
          performedBy: adjuster1._id,
          role: 'FIELD_ADJUSTER',
          previousStatus: 'IN_PROGRESS',
          newStatus: 'SUBMITTED',
          timestamp: new Date('2026-09-05T15:30:00Z'),
        },
        {
          action: 'Claim Approved',
          performedBy: officer1._id,
          role: 'CLAIMS_OFFICER',
          previousStatus: 'UNDER_REVIEW',
          newStatus: 'APPROVED',
          notes: 'Full repair estimate approved under policy terms.',
          timestamp: new Date('2026-09-06T09:00:00Z'),
        },
      ],
    });

    // ── REJECTED Claim ──
    claimRejected = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'REJECTED',
      customer: { name: 'Bob Smith', phone: '+971509876543' },
      incidentType: 'COLLISION',
      incidentLocation: 'Al Quoz, Dubai',
      vehicle: {
        plateNumber: vehicle1.plateNumber,
        vehicleId: vehicle1._id,
        policyId: policy1._id,
      },
      decisionNotes: 'Driver not covered on policy.',
      timeline: [
        {
          action: 'Claim Created',
          performedBy: officer1._id,
          role: 'CLAIMS_OFFICER',
          timestamp: new Date('2026-09-01T10:00:00Z'),
        },
        {
          action: 'Claim Rejected',
          performedBy: officer1._id,
          role: 'CLAIMS_OFFICER',
          previousStatus: 'UNDER_REVIEW',
          newStatus: 'REJECTED',
          notes: 'Driver not covered on policy.',
          timestamp: new Date('2026-09-02T12:00:00Z'),
        },
      ],
    });

    // ── CLOSED Claim ──
    claimClosed = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'CLOSED',
      customer: { name: 'Alice Walker', phone: '+971505554433' },
      incidentType: 'PARKING_DAMAGE',
      incidentLocation: 'Dubai Marina',
      vehicle: {
        plateNumber: vehicle1.plateNumber,
        vehicleId: vehicle1._id,
        policyId: policy1._id,
      },
      closedBy: admin1._id,
      closedAt: new Date('2026-09-08T16:00:00Z'),
      closingNotes: 'Repair invoice paid in full. Case closed.',
      decisionNotes: 'Approved for settlement.',
      timeline: [
        {
          action: 'Claim Created',
          performedBy: officer1._id,
          role: 'CLAIMS_OFFICER',
          timestamp: new Date('2026-09-01T09:00:00Z'),
        },
        {
          action: 'Claim Approved',
          performedBy: officer1._id,
          role: 'CLAIMS_OFFICER',
          previousStatus: 'UNDER_REVIEW',
          newStatus: 'APPROVED',
          notes: 'Approved for settlement.',
          timestamp: new Date('2026-09-03T11:00:00Z'),
        },
        {
          action: 'Claim Closed',
          performedBy: admin1._id,
          role: 'ADMIN',
          previousStatus: 'APPROVED',
          newStatus: 'CLOSED',
          notes: 'Repair invoice paid in full. Case closed.',
          timestamp: new Date('2026-09-08T16:00:00Z'),
        },
      ],
    });

    // ── Non-Terminal Claims ──
    claimInProgress = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'IN_PROGRESS',
      customer: { name: 'Test In Progress', phone: '+971501111111' },
      incidentType: 'COLLISION',
      incidentLocation: 'Location X',
    });

    claimSubmitted = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'SUBMITTED',
      customer: { name: 'Test Submitted', phone: '+971502222222' },
      incidentType: 'COLLISION',
      incidentLocation: 'Location Y',
    });

    claimUnderReview = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'UNDER_REVIEW',
      customer: { name: 'Test Under Review', phone: '+971503333333' },
      incidentType: 'COLLISION',
      incidentLocation: 'Location Z',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('200 for ADMIN on an APPROVED claim (Content-Type, Content-Disposition with claimNumber, and %PDF magic bytes)', async () => {
    const adminToken = generateToken(admin1);

    const res = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/report`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toContain(`filename="${claimApproved.claimNumber}-report.pdf"`);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.toString('utf-8').startsWith('%PDF')).toBe(true);
  });

  test('200 for CLAIMS_OFFICER on a REJECTED claim', async () => {
    const officerToken = generateToken(officer1);

    const res = await request(app)
      .get(`/api/v1/claims/${claimRejected._id}/report`)
      .set('Authorization', `Bearer ${officerToken}`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toContain(`filename="${claimRejected.claimNumber}-report.pdf"`);
    expect(res.body.toString('utf-8').startsWith('%PDF')).toBe(true);
  });

  test('200 for CLAIMS_OFFICER on a CLOSED claim (confirms closure block renders without breaking generation)', async () => {
    const officerToken = generateToken(officer1);

    const res = await request(app)
      .get(`/api/v1/claims/${claimClosed._id}/report`)
      .set('Authorization', `Bearer ${officerToken}`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toContain(`filename="${claimClosed.claimNumber}-report.pdf"`);
    expect(res.body.toString('utf-8').startsWith('%PDF')).toBe(true);
  });

  test('200 generating PDF report for claims with THEFT, FIRE, and NATURAL_DISASTER incident types', async () => {
    const officerToken = generateToken(officer1);
    const perils = ['THEFT', 'FIRE', 'NATURAL_DISASTER'];

    for (const peril of perils) {
      const claim = await Claim.create({
        organizationId: org1._id,
        policyId: policy1._id,
        createdBy: officer1._id,
        assignedTo: adjuster1._id,
        status: 'APPROVED',
        customer: { name: `Customer ${peril}`, phone: '+971501234567' },
        incidentType: peril,
        incidentLocation: 'Test Location',
        vehicle: {
          plateNumber: vehicle1.plateNumber,
          vehicleId: vehicle1._id,
          policyId: policy1._id,
        },
      });

      const res = await request(app)
        .get(`/api/v1/claims/${claim._id}/report`)
        .set('Authorization', `Bearer ${officerToken}`)
        .buffer(true);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/);
      expect(res.body.toString('utf-8').startsWith('%PDF')).toBe(true);
    }
  });


  test('403 for FIELD_ADJUSTER, even when assigned to the APPROVED claim', async () => {
    const adjusterToken = generateToken(adjuster1);

    const res = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/report`)
      .set('Authorization', `Bearer ${adjusterToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('404 when the claim does not exist', async () => {
    const officerToken = generateToken(officer1);
    const nonExistentId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/v1/claims/${nonExistentId}/report`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  test('404 when the claim belongs to a different organization (multi-tenancy isolation)', async () => {
    const officer2Token = generateToken(officer2); // Org 2

    const res = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/report`) // Org 1 claim
      .set('Authorization', `Bearer ${officer2Token}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
  });

  test('409 INVALID_STATUS_TRANSITION when claim is in a non-terminal status (IN_PROGRESS, SUBMITTED, UNDER_REVIEW) with exact message', async () => {
    const officerToken = generateToken(officer1);
    const expectedMessage =
      'Report is only available for claims with a final decision (APPROVED, REJECTED, or CLOSED).';

    // Test IN_PROGRESS
    const res1 = await request(app)
      .get(`/api/v1/claims/${claimInProgress._id}/report`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res1.status).toBe(409);
    expect(res1.body.success).toBe(false);
    expect(res1.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    expect(res1.body.errors[0].details).toBe(expectedMessage);

    // Test SUBMITTED
    const res2 = await request(app)
      .get(`/api/v1/claims/${claimSubmitted._id}/report`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res2.status).toBe(409);
    expect(res2.body.success).toBe(false);
    expect(res2.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    expect(res2.body.errors[0].details).toBe(expectedMessage);

    // Test UNDER_REVIEW
    const res3 = await request(app)
      .get(`/api/v1/claims/${claimUnderReview._id}/report`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res3.status).toBe(409);
    expect(res3.body.success).toBe(false);
    expect(res3.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    expect(res3.body.errors[0].details).toBe(expectedMessage);
  });

  test('Graceful degradation: mock one evidence image fetch to fail (500) and confirm 200 with valid PDF returned', async () => {
    const officerToken = generateToken(officer1);

    // Make the first fetch call fail with 500, and subsequent calls succeed
    let callCount = 0;
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: { get: () => null },
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          get: (header) => (header.toLowerCase() === 'content-type' ? 'image/png' : null),
        },
        arrayBuffer: async () =>
          samplePngBuffer.buffer.slice(
            samplePngBuffer.byteOffset,
            samplePngBuffer.byteOffset + samplePngBuffer.byteLength
          ),
      };
    });

    const res = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/report`)
      .set('Authorization', `Bearer ${officerToken}`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toContain(`filename="${claimApproved.claimNumber}-report.pdf"`);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.toString('utf-8').startsWith('%PDF')).toBe(true);
  });

  test('Graceful degradation: mock image fetch rejection (network timeout) and confirm 200 with valid PDF returned', async () => {
    const officerToken = generateToken(officer1);

    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ETIMEDOUT: Connection timed out'));

    const res = await request(app)
      .get(`/api/v1/claims/${claimApproved._id}/report`)
      .set('Authorization', `Bearer ${officerToken}`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.toString('utf-8').startsWith('%PDF')).toBe(true);
  });

  test('200 on an APPROVED claim with lossAssessment including Deductible Overridden Yes and reason', async () => {
    const claimWithLossAssessment = await Claim.create({
      organizationId: org1._id,
      policyId: policy1._id,
      createdBy: officer1._id,
      assignedTo: adjuster1._id,
      status: 'APPROVED',
      customer: { name: 'Fin Test', phone: '+971501234567' },
      incidentType: 'COLLISION',
      incidentLocation: 'Test Loc',
      vehicle: { plateNumber: vehicle1.plateNumber, vehicleId: vehicle1._id, policyId: policy1._id },
      lossAssessment: {
        estimatedPartsCost: 300000,
        laborCost: 150000,
        totalDamage: 450000,
        policyDeductible: 50000,
        deductibleApplied: 0,
        deductibleOverridden: true,
        deductibleOverrideReason: 'VIP customer courtesy waiver',
        netApprovedPayout: 450000,
        assessedAt: new Date(),
        assessedBy: officer1._id,
      },
    });

    const officerToken = generateToken(officer1);
    const res = await request(app)
      .get(`/api/v1/claims/${claimWithLossAssessment._id}/report`)
      .set('Authorization', `Bearer ${officerToken}`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.toString('utf-8').startsWith('%PDF')).toBe(true);
  });

  test('buildClaimReportDocDefinition includes Deductible Overridden Yes/No row in financial table', async () => {
    const { buildClaimReportDocDefinition } = require('../src/modules/claims/claim.report.builder');

    const claimOverridden = {
      claimNumber: 'CLM-OVERRIDE-1',
      status: 'APPROVED',
      customer: { name: 'Test' },
      vehicle: { plateNumber: 'A-123' },
      timeline: [],
      lossAssessment: {
        estimatedPartsCost: 100000,
        laborCost: 50000,
        totalDamage: 150000,
        policyDeductible: 20000,
        deductibleApplied: 0,
        deductibleOverridden: true,
        deductibleOverrideReason: 'Special waiver',
        netApprovedPayout: 150000,
      },
    };

    const docDefOverridden = await buildClaimReportDocDefinition({
      claim: claimOverridden,
      organization: { name: 'Org1' },
      vehicle: null,
      policy: null,
    });

    const financialSection = docDefOverridden.content.find(
      (item) => item.text === '8. Financial Loss Assessment'
    );
    expect(financialSection).toBeDefined();

    const financialTableIndex = docDefOverridden.content.indexOf(financialSection) + 1;
    const financialTable = docDefOverridden.content[financialTableIndex].table.body;

    const overrideRow = financialTable.find((row) => row[0].text === 'Deductible Overridden');
    expect(overrideRow).toBeDefined();
    expect(overrideRow[1].text).toBe('Yes');

    const reasonRow = financialTable.find((row) => row[0].text === 'Deductible Override Reason');
    expect(reasonRow).toBeDefined();
    expect(reasonRow[1].text).toBe('Special waiver');

    // Test without override
    const claimNotOverridden = {
      ...claimOverridden,
      lossAssessment: {
        ...claimOverridden.lossAssessment,
        deductibleOverridden: false,
        deductibleOverrideReason: null,
      },
    };

    const docDefNotOverridden = await buildClaimReportDocDefinition({
      claim: claimNotOverridden,
      organization: { name: 'Org1' },
      vehicle: null,
      policy: null,
    });

    const notOverriddenTable = docDefNotOverridden.content[financialTableIndex].table.body;
    const notOverriddenRow = notOverriddenTable.find((row) => row[0].text === 'Deductible Overridden');
    expect(notOverriddenRow).toBeDefined();
    expect(notOverriddenRow[1].text).toBe('No');
  });
  test('prints money from minor units with the currency decimals', async () => {
    const { buildClaimReportDocDefinition } = require('../src/modules/claims/claim.report.builder');

    const claimMinorUnits = {
      claimNumber: 'CLM-MINOR-PDF-1',
      status: 'APPROVED',
      customer: { name: 'Test Minor' },
      vehicle: { plateNumber: 'M-123' },
      timeline: [],
      coverageSnapshot: {
        policyType: 'COMPREHENSIVE',
        deductibleAmount: 50000,
      },
      lossAssessment: {
        estimatedPartsCost: 100000,
        laborCost: 50000,
        totalDamage: 150000,
        policyDeductible: 50000,
        deductibleApplied: 50000,
        deductibleOverridden: false,
        deductibleOverrideReason: null,
        netApprovedPayout: 100000,
      },
    };

    const docDef = await buildClaimReportDocDefinition({
      claim: claimMinorUnits,
      organization: { name: 'Org1' },
      vehicle: null,
      policy: null,
    });

    const financialSection = docDef.content.find(
      (item) => item.text === '8. Financial Loss Assessment'
    );
    expect(financialSection).toBeDefined();

    const financialTableIndex = docDef.content.indexOf(financialSection) + 1;
    const financialTable = docDef.content[financialTableIndex].table.body;

    const partsRow = financialTable.find((row) => row[0].text === 'Estimated Parts Cost');
    expect(partsRow).toBeDefined();
    expect(partsRow[1].text).toBe('1000.00 ILS');

    const totalRow = financialTable.find((row) => row[0].text === 'Total Assessed Damage');
    expect(totalRow).toBeDefined();
    expect(totalRow[1].text).toBe('1500.00 ILS');
  });

  test('keeps report tables left-to-right when cells contain Arabic', async () => {
    const { buildClaimReportDocDefinition } = require('../src/modules/claims/claim.report.builder');
    const pdfMake = require('pdfmake-rtl');

    const claimArabic = {
      claimNumber: 'CLM-APX-2026-ARABIC',
      status: 'APPROVED',
      customer: { name: 'أحمد محمود التميمي', phone: '+970599123456' },
      incidentLocation: 'رام الله - شارع الإرسال',
      accident: {
        accidentType: 'COLLISION',
        accidentDate: '2026-09-15',
        accidentTime: '10:00',
        description: 'حادث سير في رام الله',
        damageDescription: 'صدمة قوية في الصدام الخلفي',
      },
      location: {
        address: 'شارع الإرسال - رام الله',
        capturedAt: new Date(),
      },
      vehicle: { plateNumber: '12-345-67' },
      timeline: [
        {
          timestamp: new Date(),
          action: 'APPROVED',
          performedBy: { name: 'عمر مأمور المطالبات' },
          notes: 'تم اعتماد المطالبة بعد تقرير الخبير',
        },
      ],
    };

    const docDef = await buildClaimReportDocDefinition({
      claim: claimArabic,
      organization: { name: 'Apex Insurance Co.', code: 'APX' },
      vehicle: { plateNumber: '12-345-67', make: 'Hyundai', model: 'Tucson', year: 2022 },
      policy: { policyNumber: 'POL-APX-2026-0089' },
    });

    const doc = pdfMake.createPdf(docDef);
    await doc.getBuffer();

    const tables = docDef.content.filter((item) => item && item.table);
    expect(tables.length).toBeGreaterThan(0);

    tables.forEach((item) => {
      expect(item.table._rtl).toBeFalsy();
    });

    // Customer Information table: label cell first
    const customerTable = tables[0].table.body;
    expect(customerTable[0][0].text).toBe('Customer Name');
    expect(customerTable[1][0].text).toBe('Phone Number');
    expect(customerTable[2][0].text).toBe('Incident Location');
  });
});

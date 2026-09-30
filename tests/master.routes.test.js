jest.mock('../src/utils/uploadToCloudinary', () =>
  jest.fn().mockResolvedValue({
    url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
    publicId: 'sample_id_123',
  })
);

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Customer = require('../src/modules/customers/customer.model');
const Policy = require('../src/modules/policies/policy.model');
const { buildPolicy } = require('./helpers/policyFactory');
const Vehicle = require('../src/modules/vehicles/vehicle.model');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  // Mock global fetch for pdfmake remote image downloading
  const samplePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  jest.spyOn(global, 'fetch').mockImplementation(async () => ({
    ok: true,
    status: 200,
    headers: {
      get: (header) => (header.toLowerCase() === 'content-type' ? 'image/png' : null),
    },
    arrayBuffer: async () =>
      samplePng.buffer.slice(samplePng.byteOffset, samplePng.byteOffset + samplePng.byteLength),
  }));
});

afterAll(async () => {
  if (global.fetch && global.fetch.mockRestore) {
    global.fetch.mockRestore();
  }
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Master Route Suite — 100% Comprehensive Coverage of All 31 Express Routes', () => {
  let org1, org2;
  let adminUser, officerUser, adjusterUser, otherOrgAdmin;
  let adminToken, officerToken, adjusterToken, otherOrgToken;
  let testCustomer, testPolicy, testVehicle;
  let createdClaimId;
  let createdUserId;

  it('Setup: Seeds Organizations, Customer, Policy, Vehicle and Baseline Users', async () => {
    org1 = await Organization.create({ name: 'Demo Insurance Co', code: 'INS-A', status: 'ACTIVE' });
    global.__testPol = await buildPolicy({ policyNumber: 'POL-FIX-001', status: 'ACTIVE', startDate: new Date('2026-01-01'), expiryDate: new Date('2027-12-31'), organizationId: org1._id });
    org2 = await Organization.create({ name: 'Competitor Insurance Co', code: 'COMP-B', status: 'ACTIVE' });

    adminUser = await User.create({
      name: 'System Admin',
      employeeCode: 'AD-001',
      password: 'Password123!',
      role: 'ADMIN',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    officerUser = await User.create({
      name: 'Claims Officer One',
      employeeCode: 'CO-001',
      password: 'Password123!',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    adjusterUser = await User.create({
      name: 'Field Adjuster One',
      employeeCode: 'FA-001',
      password: 'Password123!',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    otherOrgAdmin = await User.create({
      name: 'Other Org Admin',
      employeeCode: 'AD-999',
      password: 'Password123!',
      role: 'ADMIN',
      organizationId: org2._id,
      status: 'ACTIVE',
    });

    testCustomer = await Customer.create({
      organizationId: org1._id,
      fullName: 'Hassan Mahmoud',
      phone: '0599123456',
    });

    const now = new Date();
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oneYearLater = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    testPolicy = await buildPolicy({
      organizationId: org1._id,
      policyNumber: 'POL-DEMO-2026',
      startDate: oneMonthAgo,
      expiryDate: oneYearLater,
      status: 'ACTIVE',
    });

    testVehicle = await Vehicle.create({
      organizationId: org1._id,
      customerId: testCustomer._id,
      policyId: testPolicy._id,
      plateNumber: 'ABC-1234',
      make: 'Toyota',
      model: 'Corolla',
      year: 2022,
      color: 'Silver',
    });

    expect(org1).toBeDefined();
    expect(testCustomer.fullName).toBe('Hassan Mahmoud');
    expect(testVehicle.plateNumber).toBe('ABC-1234');
  });

  // --------------------------------------------------------------------------
  // ROUTE 1: GET /health
  // --------------------------------------------------------------------------
  it('Route 01 [GET /health]: Public health check returns 200 OK', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('running properly');
  });

  // --------------------------------------------------------------------------
  // ROUTE 2: POST /api/v1/auth/login
  // --------------------------------------------------------------------------
  it('Route 02 [POST /api/v1/auth/login]: Authenticates Admin, Officer, and Adjuster', async () => {
    // Admin login
    const resAdmin = await request(app)
      .post('/api/v1/auth/login')
      .send({ organizationCode: 'INS-A', employeeCode: 'AD-001', password: 'Password123!' });
    expect(resAdmin.status).toBe(200);
    expect(resAdmin.body.success).toBe(true);
    expect(resAdmin.body.data.user.role).toBe('ADMIN');
    adminToken = resAdmin.body.data.accessToken;

    // Officer login
    const resOfficer = await request(app)
      .post('/api/v1/auth/login')
      .send({ organizationCode: 'INS-A', employeeCode: 'CO-001', password: 'Password123!' });
    expect(resOfficer.status).toBe(200);
    officerToken = resOfficer.body.data.accessToken;

    // Adjuster login
    const resAdjuster = await request(app)
      .post('/api/v1/auth/login')
      .send({ organizationCode: 'INS-A', employeeCode: 'FA-001', password: 'Password123!' });
    expect(resAdjuster.status).toBe(200);
    adjusterToken = resAdjuster.body.data.accessToken;

    // Other org admin login
    const resOther = await request(app)
      .post('/api/v1/auth/login')
      .send({ organizationCode: 'COMP-B', employeeCode: 'AD-999', password: 'Password123!' });
    expect(resOther.status).toBe(200);
    otherOrgToken = resOther.body.data.accessToken;
  });

  // --------------------------------------------------------------------------
  // ROUTE 3: PUT /api/v1/auth/change-password
  // --------------------------------------------------------------------------
  it('Route 03 [PUT /api/v1/auth/change-password]: Updates password and validates new credential', async () => {
    const res = await request(app)
      .put('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currentPassword: 'Password123!', newPassword: 'NewSecureAdminPassword2026!' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify login with newly set password
    const reLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ organizationCode: 'INS-A', employeeCode: 'AD-001', password: 'NewSecureAdminPassword2026!' });
    expect(reLogin.status).toBe(200);
    adminToken = reLogin.body.data.accessToken;
  });

  // --------------------------------------------------------------------------
  // ROUTE 4: POST /api/v1/users
  // --------------------------------------------------------------------------
  it('Route 04 [POST /api/v1/users]: Admin creates new staff user', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Second Adjuster',
        employeeCode: 'FA-002',
        password: 'Password123!',
        role: 'FIELD_ADJUSTER',
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.employeeCode).toBe('FA-002');
    createdUserId = res.body.data.id;
  });

  // --------------------------------------------------------------------------
  // ROUTE 5: GET /api/v1/users
  // --------------------------------------------------------------------------
  it('Route 05 [GET /api/v1/users]: Admin lists organization users with pagination headers', async () => {
    const res = await request(app)
      .get('/api/v1/users?page=1&limit=10')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.headers).toHaveProperty('x-total-count');
    expect(res.headers).toHaveProperty('x-page');
  });

  // --------------------------------------------------------------------------
  // ROUTE 6: PATCH /api/v1/users/:userId
  // --------------------------------------------------------------------------
  it('Route 06 [PATCH /api/v1/users/:userId]: Admin updates user details', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Second Adjuster Updated', employeeCode: 'FA-002-UPD' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Second Adjuster Updated');
    expect(res.body.data.employeeCode).toBe('FA-002-UPD');
  });

  // --------------------------------------------------------------------------
  // ROUTE 7: PATCH /api/v1/users/:userId/status
  // --------------------------------------------------------------------------
  it('Route 07 [PATCH /api/v1/users/:userId/status]: Admin deactivates and reactivates user', async () => {
    // Deactivate
    const deactRes = await request(app)
      .patch(`/api/v1/users/${createdUserId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'INACTIVE' });
    expect(deactRes.status).toBe(200);
    expect(deactRes.body.data.status).toBe('INACTIVE');

    // Reactivate
    const reactRes = await request(app)
      .patch(`/api/v1/users/${createdUserId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' });
    expect(reactRes.status).toBe(200);
    expect(reactRes.body.data.status).toBe('ACTIVE');
  });

  // --------------------------------------------------------------------------
  // ROUTE 8: PATCH /api/v1/users/:userId/reset-password
  // --------------------------------------------------------------------------
  it('Route 08 [PATCH /api/v1/users/:userId/reset-password]: Admin resets user password', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${createdUserId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'ResetPassword2026!' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // --------------------------------------------------------------------------
  // ROUTE 9: GET /api/v1/users/adjusters
  // --------------------------------------------------------------------------
  it('Route 09 [GET /api/v1/users/adjusters]: Lists adjusters with availability and proximity sorting', async () => {
    const res = await request(app)
      .get('/api/v1/users/adjusters?status=available&latitude=31.9050&longitude=35.2040')
      .set('Authorization', `Bearer ${officerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty('availability');
    expect(res.body.data[0]).toHaveProperty('capacityLimit', 3);
  });

  // --------------------------------------------------------------------------
  // ROUTE 10: PATCH /api/v1/users/me/fcm-token
  // --------------------------------------------------------------------------
  it('Route 10 [PATCH /api/v1/users/me/fcm-token]: Adjuster registers device push token', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me/fcm-token')
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({ fcmToken: 'fcm_device_registration_token_master_123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.fcmToken).toBe('fcm_device_registration_token_master_123');
  });

  // --------------------------------------------------------------------------
  // ROUTE 11: GET /api/v1/vehicles/lookup
  // --------------------------------------------------------------------------
  it('Route 11 [GET /api/v1/vehicles/lookup]: Adjuster resolves vehicle & policy by plate number', async () => {
    const res = await request(app)
      .get('/api/v1/vehicles/lookup?plateNumber=ABC-1234')
      .set('Authorization', `Bearer ${adjusterToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.vehicle.plateNumber).toBe('ABC-1234');
    expect(res.body.data.policy.policyNumber).toBe('POL-DEMO-2026');
  });

  // --------------------------------------------------------------------------
  // ROUTE 12: POST /api/v1/policies/verify
  // --------------------------------------------------------------------------
  it('Route 12 [POST /api/v1/policies/verify]: Claims Officer verifies policy eligibility before claim creation', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyNumber: 'POL-DEMO-2026',
        plateNumber: 'ABC-1234',
        incidentDate: new Date().toISOString().slice(0, 10),
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEligible).toBe(true);
    expect(res.body.data.policy.policyNumber).toBe('POL-DEMO-2026');
    expect(res.body.data.vehicle.plateNumber).toBe('ABC-1234');
    expect(res.body.data.customer.fullName).toBe('Hassan Mahmoud');
  });

  // --------------------------------------------------------------------------
  // ROUTE 13: POST /api/v1/claims
  // --------------------------------------------------------------------------
  it('Route 13 [POST /api/v1/claims]: Claims Officer creates a new claim with incident coordinates', async () => {
    const res = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyId: testPolicy._id,
        incidentType: 'COLLISION',
        incidentLocation: 'Al-Irsal St, Ramallah',
        incidentDate: '2026-06-15',
        latitude: 31.9050,
        longitude: 35.2040,
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('NEW');
    expect(res.body.data).toHaveProperty('claimNumber');
    createdClaimId = res.body.data.id;
  });

  // --------------------------------------------------------------------------
  // ROUTE 14: GET /api/v1/claims
  // --------------------------------------------------------------------------
  it('Route 14 [GET /api/v1/claims]: Lists claims with role filtering and pagination headers', async () => {
    const res = await request(app)
      .get('/api/v1/claims?status=NEW&page=1&limit=5')
      .set('Authorization', `Bearer ${officerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.headers).toHaveProperty('x-total-count');
  });

  // --------------------------------------------------------------------------
  // ROUTE 15: GET /api/v1/claims/stats
  // --------------------------------------------------------------------------
  it('Route 15 [GET /api/v1/claims/stats]: Retrieves KPI statistics with date filtering', async () => {
    const res = await request(app)
      .get('/api/v1/claims/stats?from=2026-01-01&to=2026-12-31')
      .set('Authorization', `Bearer ${officerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('scope', 'ORGANIZATION');
    expect(res.body.data).toHaveProperty('byStatus');
    expect(res.body.data.byStatus).toHaveProperty('NEW');
  });

  // --------------------------------------------------------------------------
  // ROUTE 16: GET /api/v1/claims/:claimId
  // --------------------------------------------------------------------------
  it('Route 16 [GET /api/v1/claims/:claimId]: Retrieves detailed claim dossier', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${createdClaimId}`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(createdClaimId);
    expect(res.body.data.incidentLocation).toBe('Al-Irsal St, Ramallah');
  });

  // --------------------------------------------------------------------------
  // ROUTE 17: POST /api/v1/claims/:claimId/assign
  // --------------------------------------------------------------------------
  it('Route 17 [POST /api/v1/claims/:claimId/assign]: Officer dispatches claim (Two-Step Step 1: NEW -> PENDING_ACCEPTANCE)', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${createdClaimId}/assign`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        adjusterId: adjusterUser._id.toString(),
        priority: 'HIGH',
        notes: 'Urgent accident scene inspection',
        overrideCapacity: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('PENDING_ACCEPTANCE');
  });

  // --------------------------------------------------------------------------
  // ROUTE 18: POST /api/v1/claims/:claimId/decline-assignment
  // --------------------------------------------------------------------------
  it('Route 18 [POST /api/v1/claims/:claimId/decline-assignment]: Adjuster declines assignment (reverts to NEW)', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${createdClaimId}/decline-assignment`)
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({ reason: 'Adjuster vehicle breakdown on highway' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('NEW');
    expect(res.body.data.assignedTo).toBeNull();

    // Re-dispatch for subsequent inspection lifecycle
    const reAssign = await request(app)
      .post(`/api/v1/claims/${createdClaimId}/assign`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ adjusterId: adjusterUser._id.toString(), priority: 'HIGH' });
    expect(reAssign.status).toBe(200);
    expect(reAssign.body.data.status).toBe('PENDING_ACCEPTANCE');
  });

  // --------------------------------------------------------------------------
  // ROUTE 19: POST /api/v1/claims/:claimId/accept-assignment
  // --------------------------------------------------------------------------
  it('Route 19 [POST /api/v1/claims/:claimId/accept-assignment]: Adjuster accepts assignment (PENDING_ACCEPTANCE -> ASSIGNED)', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${createdClaimId}/accept-assignment`)
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ASSIGNED');
    expect(res.body.data.assignedTo).toBe(adjusterUser._id.toString());
  });

  // --------------------------------------------------------------------------
  // ROUTE 20: POST /api/v1/claims/:claimId/inspection/start
  // --------------------------------------------------------------------------
  it('Route 20 [POST /api/v1/claims/:claimId/inspection/start]: Adjuster starts inspection (ASSIGNED -> IN_PROGRESS)', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${createdClaimId}/inspection/start`)
      .set('Authorization', `Bearer ${adjusterToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('IN_PROGRESS');
  });

  // --------------------------------------------------------------------------
  // ROUTE 21: PUT /api/v1/claims/:claimId/vehicle
  // --------------------------------------------------------------------------
  it('Route 21 [PUT /api/v1/claims/:claimId/vehicle]: Adjuster saves verified vehicle & policy draft', async () => {
    const res = await request(app)
      .put(`/api/v1/claims/${createdClaimId}/vehicle`)
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({
        vehicleId: testVehicle._id.toString(),
        policyId: testPolicy._id.toString(),
        customerId: testCustomer._id.toString(),
        plateNumber: 'ABC-1234',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // --------------------------------------------------------------------------
  // ROUTE 22: PUT /api/v1/claims/:claimId/accident
  // --------------------------------------------------------------------------
  it('Route 22 [PUT /api/v1/claims/:claimId/accident]: Adjuster saves accident circumstances draft', async () => {
    const res = await request(app)
      .put(`/api/v1/claims/${createdClaimId}/accident`)
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({
        accidentType: 'COLLISION',
        accidentDate: '2026-09-14',
        accidentTime: '14:30',
        description: 'Intersection collision due to failure to yield right of way',
        damageDescription: 'Front bumper crushed, right headlight shattered, radiator leaking',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // --------------------------------------------------------------------------
  // ROUTE 23: PUT /api/v1/claims/:claimId/location
  // --------------------------------------------------------------------------
  it('Route 23 [PUT /api/v1/claims/:claimId/location]: Adjuster saves inspection GPS coordinates', async () => {
    const res = await request(app)
      .put(`/api/v1/claims/${createdClaimId}/location`)
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({
        latitude: 31.9052,
        longitude: 35.2045,
        address: 'Al-Irsal St, near Clock Tower, Ramallah',
        capturedAt: new Date().toISOString(),
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // --------------------------------------------------------------------------
  // ROUTE 24: POST /api/v1/claims/:claimId/evidence
  // --------------------------------------------------------------------------
  it('Route 24 [POST /api/v1/claims/:claimId/evidence]: Adjuster uploads multipart damage photo', async () => {
    const fakeImage = Buffer.from('fake-image-bytes');
    const res = await request(app)
      .post(`/api/v1/claims/${createdClaimId}/evidence`)
      .set('Authorization', `Bearer ${adjusterToken}`)
      .attach('file', fakeImage, 'front_bumper.jpg')
      .field('imageType', 'VEHICLE_FRONT');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.evidence.length).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // ROUTE 25: POST /api/v1/claims/:claimId/signature
  // --------------------------------------------------------------------------
  it('Route 25 [POST /api/v1/claims/:claimId/signature]: Adjuster uploads multipart digital signature', async () => {
    const fakeSig = Buffer.from('fake-signature-bytes');
    const res = await request(app)
      .post(`/api/v1/claims/${createdClaimId}/signature`)
      .set('Authorization', `Bearer ${adjusterToken}`)
      .attach('file', fakeSig, 'customer_signature.png');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('signature');
  });

  // --------------------------------------------------------------------------
  // ROUTE 26: POST /api/v1/claims/:claimId/inspection/submit
  // --------------------------------------------------------------------------
  it('Route 26 [POST /api/v1/claims/:claimId/inspection/submit]: Adjuster submits complete inspection (IN_PROGRESS -> SUBMITTED)', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${createdClaimId}/inspection/submit`)
      .set('Authorization', `Bearer ${adjusterToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('SUBMITTED');
  });

  // --------------------------------------------------------------------------
  // ROUTE 27: POST /api/v1/claims/:claimId/review/start
  // --------------------------------------------------------------------------
  it('Route 27 [POST /api/v1/claims/:claimId/review/start]: Claims Officer starts review (SUBMITTED -> UNDER_REVIEW)', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${createdClaimId}/review/start`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('UNDER_REVIEW');
  });

  // --------------------------------------------------------------------------
  // ROUTE 28: POST /api/v1/claims/:claimId/review/request-correction
  // --------------------------------------------------------------------------
  it('Route 28 [POST /api/v1/claims/:claimId/review/request-correction]: Officer requests correction (UNDER_REVIEW -> CORRECTION_REQUIRED)', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${createdClaimId}/review/request-correction`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ notes: 'Please upload a close-up photo of the vehicle VIN plate' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('CORRECTION_REQUIRED');

    // Cycle back: Adjuster resumes inspection, re-submits, and Officer resumes review
    const resumeRes = await request(app)
      .post(`/api/v1/claims/${createdClaimId}/inspection/start`)
      .set('Authorization', `Bearer ${adjusterToken}`);
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.data.status).toBe('IN_PROGRESS');

    const reSubmitRes = await request(app)
      .post(`/api/v1/claims/${createdClaimId}/inspection/submit`)
      .set('Authorization', `Bearer ${adjusterToken}`);
    expect(reSubmitRes.status).toBe(200);
    expect(reSubmitRes.body.data.status).toBe('SUBMITTED');

    const reReviewRes = await request(app)
      .post(`/api/v1/claims/${createdClaimId}/review/start`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(reReviewRes.status).toBe(200);
    expect(reReviewRes.body.data.status).toBe('UNDER_REVIEW');
  });

  // --------------------------------------------------------------------------
  // ROUTE 29: POST /api/v1/claims/:claimId/decision
  // --------------------------------------------------------------------------
  it('Route 29 [POST /api/v1/claims/:claimId/decision]: Claims Officer approves claim (UNDER_REVIEW -> APPROVED)', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${createdClaimId}/decision`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        decision: 'APPROVED',
        notes: 'All inspection items verified and coverage confirmed under policy',
        lossAssessment: {
          estimatedPartsCost: 500,
          laborCost: 300,
          deductibleApplied: 500,
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('APPROVED');
  });

  // --------------------------------------------------------------------------
  // ROUTE 30: POST /api/v1/claims/:claimId/close
  // --------------------------------------------------------------------------
  it('Route 30 [POST /api/v1/claims/:claimId/close]: Admin closes approved claim (APPROVED -> CLOSED)', async () => {
    const res = await request(app)
      .post(`/api/v1/claims/${createdClaimId}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        closingNotes: 'Payment disbursed and claim settlement finalized',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('CLOSED');
  });

  // --------------------------------------------------------------------------
  // ROUTE 31: GET /api/v1/claims/:claimId/report
  // --------------------------------------------------------------------------
  it('Route 31 [GET /api/v1/claims/:claimId/report]: Officer downloads final compiled PDF dossier', async () => {
    const res = await request(app)
      .get(`/api/v1/claims/${createdClaimId}/report`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBeGreaterThan(100);
  });

  // --------------------------------------------------------------------------
  // SECURITY, RBAC & MULTI-TENANCY BOUNDARIES
  // --------------------------------------------------------------------------
  describe('Security, RBAC & Multi-Tenancy Boundary Enforcement', () => {
    it('Enforces Authentication: rejects unauthenticated requests with 401 Unauthorized', async () => {
      const res = await request(app).get(`/api/v1/claims/${createdClaimId}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('Enforces Role Permissions (RBAC): Field Adjuster cannot access Admin user creation (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adjusterToken}`)
        .send({
          name: 'Hacker User',
          employeeCode: 'HCK-01',
          password: 'Password123!',
          role: 'ADMIN',
        });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('Enforces Multi-Tenant Isolation: User from Organization 2 cannot access Organization 1 claim (404 Not Found)', async () => {
      const res = await request(app)
        .get(`/api/v1/claims/${createdClaimId}`)
        .set('Authorization', `Bearer ${otherOrgToken}`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('Enforces Passive GPS Ingestion: Adjuster request with X-Latitude/X-Longitude updates user location', async () => {
      const res = await request(app)
        .get('/api/v1/claims')
        .set('Authorization', `Bearer ${adjusterToken}`)
        .set('X-Latitude', '31.9055')
        .set('X-Longitude', '35.2048');
      expect(res.status).toBe(200);

      const dbAdjuster = await User.findById(adjusterUser._id).lean();
      expect(dbAdjuster.location).toBeDefined();
      expect(dbAdjuster.location.latitude).toBeCloseTo(31.9055, 3);
      expect(dbAdjuster.location.longitude).toBeCloseTo(35.2048, 3);
    });
  });
});

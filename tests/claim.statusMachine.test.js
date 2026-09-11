const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Policy = require('../src/modules/policies/policy.model');
const Customer = require('../src/modules/customers/customer.model');
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

describe('Claim Status Machine Expansion (IN_PROGRESS + Correction Loop)', () => {
  let org1, org2;
  let admin, officer, officer2, adjuster1, adjuster2, otherOrgAdjuster, otherOrgOfficer;
  let adminToken, officerToken, adjuster1Token, adjuster2Token, otherOrgAdjusterToken, otherOrgOfficerToken;
  let customer, policy, vehicle;

  beforeEach(async () => {
    org1 = await Organization.create({ name: 'Organization 1', code: 'ORG1' });
    org2 = await Organization.create({ name: 'Organization 2', code: 'ORG2' });

    admin = await User.create({
      name: 'Admin User',
      employeeCode: 'ADM-01',
      password: 'password',
      role: 'ADMIN',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    officer = await User.create({
      name: 'Officer User',
      employeeCode: 'CO-01',
      password: 'password',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    officer2 = await User.create({
      name: 'Officer User 2',
      employeeCode: 'CO-02',
      password: 'password',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    adjuster1 = await User.create({
      name: 'Adjuster 1',
      employeeCode: 'FA-01',
      password: 'password',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    adjuster2 = await User.create({
      name: 'Adjuster 2',
      employeeCode: 'FA-02',
      password: 'password',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });

    otherOrgAdjuster = await User.create({
      name: 'Other Org Adjuster',
      employeeCode: 'FA-ORG2',
      password: 'password',
      role: 'FIELD_ADJUSTER',
      organizationId: org2._id,
      status: 'ACTIVE',
    });

    otherOrgOfficer = await User.create({
      name: 'Other Org Officer',
      employeeCode: 'CO-ORG2',
      password: 'password',
      role: 'CLAIMS_OFFICER',
      organizationId: org2._id,
      status: 'ACTIVE',
    });

    adminToken = generateToken(admin);
    officerToken = generateToken(officer);
    adjuster1Token = generateToken(adjuster1);
    adjuster2Token = generateToken(adjuster2);
    otherOrgAdjusterToken = generateToken(otherOrgAdjuster);
    otherOrgOfficerToken = generateToken(otherOrgOfficer);

    customer = await Customer.create({
      organizationId: org1._id,
      fullName: 'John Doe',
      phone: '1234567890',
    });

    policy = await Policy.create({
      organizationId: org1._id,
      policyNumber: 'POL-100',
      status: 'ACTIVE',
      customerId: customer._id,
      startDate: new Date(),
      expiryDate: new Date(Date.now() + 31536000000),
    });

    vehicle = await Vehicle.create({
      organizationId: org1._id,
      plateNumber: 'ABC-123',
      make: 'Toyota',
      model: 'Corolla',
      customerId: customer._id,
      policyId: policy._id,
    });
  });

  // ─── 1. End-to-End Happy Path Across All 9 Statuses ─────────────────────────
  describe('Full End-to-End Happy Path (All 9 Statuses + Correction Loop)', () => {
    it('should transition through NEW -> ASSIGNED -> IN_PROGRESS -> SUBMITTED -> UNDER_REVIEW -> CORRECTION_REQUIRED -> IN_PROGRESS -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> CLOSED', async () => {
      // Step 1: Create Claim -> NEW
      const createRes = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          customerName: 'John Doe',
          customerPhone: '1234567890',
          initialPlateNumber: 'ABC-123',
          incidentType: 'COLLISION',
          incidentLocation: 'Downtown',
        });
      expect(createRes.status).toBe(201);
      const claimId = createRes.body.data.id;
      expect(createRes.body.data.status).toBe('NEW');

      // Step 2: Assign Claim -> ASSIGNED
      const assignRes = await request(app)
        .post(`/api/v1/claims/${claimId}/assign`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          adjusterId: adjuster1._id.toString(),
          priority: 'HIGH',
          notes: 'Urgent inspection needed',
        });
      expect(assignRes.status).toBe(200);
      expect(assignRes.body.data.status).toBe('ASSIGNED');

      // Step 3: Start Inspection -> IN_PROGRESS ('Inspection Started')
      const startRes1 = await request(app)
        .post(`/api/v1/claims/${claimId}/inspection/start`)
        .set('Authorization', `Bearer ${adjuster1Token}`);
      expect(startRes1.status).toBe(200);
      expect(startRes1.body.data.status).toBe('IN_PROGRESS');

      // Draft inspection details while IN_PROGRESS
      const vehRes = await request(app)
        .put(`/api/v1/claims/${claimId}/vehicle`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'ABC-123',
        });
      expect(vehRes.status).toBe(200);
      expect(vehRes.body.data.status).toBe('IN_PROGRESS');

      const accRes = await request(app)
        .put(`/api/v1/claims/${claimId}/accident`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({
          accidentType: 'COLLISION',
          accidentDate: '2026-09-01',
          accidentTime: '10:00',
          description: 'Side collision',
          damageDescription: 'Right door dented',
        });
      expect(accRes.status).toBe(200);
      expect(accRes.body.data.status).toBe('IN_PROGRESS');

      const locRes = await request(app)
        .put(`/api/v1/claims/${claimId}/location`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({
          latitude: 24.7136,
          longitude: 46.6753,
          address: 'Main Highway',
          capturedAt: new Date().toISOString(),
        });
      expect(locRes.status).toBe(200);
      expect(locRes.body.data.status).toBe('IN_PROGRESS');

      // Populate evidence and signature for inspection completeness
      await Claim.findByIdAndUpdate(claimId, {
        evidence: [
          {
            imageType: 'DAMAGE_CLOSEUP',
            url: 'https://res.cloudinary.com/test/photo.jpg',
            publicId: 'pid1',
            uploadedBy: adjuster1._id,
          },
        ],
        signature: {
          url: 'https://res.cloudinary.com/test/sig.png',
          publicId: 'sig1',
          capturedBy: adjuster1._id,
          capturedAt: new Date(),
        },
      });

      // Step 4: Submit Inspection -> SUBMITTED
      const submitRes1 = await request(app)
        .post(`/api/v1/claims/${claimId}/inspection/submit`)
        .set('Authorization', `Bearer ${adjuster1Token}`);
      expect(submitRes1.status).toBe(200);
      expect(submitRes1.body.data.status).toBe('SUBMITTED');

      // Step 5: Start Review -> UNDER_REVIEW
      const reviewRes1 = await request(app)
        .post(`/api/v1/claims/${claimId}/review/start`)
        .set('Authorization', `Bearer ${officerToken}`);
      expect(reviewRes1.status).toBe(200);
      expect(reviewRes1.body.data.status).toBe('UNDER_REVIEW');

      // Step 6: Request Correction -> CORRECTION_REQUIRED
      const correctionRes = await request(app)
        .post(`/api/v1/claims/${claimId}/review/request-correction`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ notes: 'Please re-verify the damage description on front bumper' });
      expect(correctionRes.status).toBe(200);
      expect(correctionRes.body.data.status).toBe('CORRECTION_REQUIRED');

      // Step 7: Resume Inspection -> IN_PROGRESS ('Inspection Resumed')
      const startRes2 = await request(app)
        .post(`/api/v1/claims/${claimId}/inspection/start`)
        .set('Authorization', `Bearer ${adjuster1Token}`);
      expect(startRes2.status).toBe(200);
      expect(startRes2.body.data.status).toBe('IN_PROGRESS');

      // Adjuster updates damage description
      const accRes2 = await request(app)
        .put(`/api/v1/claims/${claimId}/accident`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({
          accidentType: 'COLLISION',
          accidentDate: '2026-09-01',
          accidentTime: '10:00',
          description: 'Side collision with minor bumper scratch',
          damageDescription: 'Right door dented and front bumper scratch confirmed',
        });
      expect(accRes2.status).toBe(200);

      // Step 8: Resubmit Inspection -> SUBMITTED
      const submitRes2 = await request(app)
        .post(`/api/v1/claims/${claimId}/inspection/submit`)
        .set('Authorization', `Bearer ${adjuster1Token}`);
      expect(submitRes2.status).toBe(200);
      expect(submitRes2.body.data.status).toBe('SUBMITTED');

      // Step 9: Re-start Review -> UNDER_REVIEW
      const reviewRes2 = await request(app)
        .post(`/api/v1/claims/${claimId}/review/start`)
        .set('Authorization', `Bearer ${officerToken}`);
      expect(reviewRes2.status).toBe(200);
      expect(reviewRes2.body.data.status).toBe('UNDER_REVIEW');

      // Step 10: Approve Claim -> APPROVED
      const decisionRes = await request(app)
        .post(`/api/v1/claims/${claimId}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          decision: 'APPROVED',
          notes: 'Inspection complete and verified',
        });
      expect(decisionRes.status).toBe(200);
      expect(decisionRes.body.data.status).toBe('APPROVED');

      // Step 11: Admin Closes Claim -> CLOSED
      const closeRes = await request(app)
        .post(`/api/v1/claims/${claimId}/close`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ closingNotes: 'Payout completed' });
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.data.status).toBe('CLOSED');

      // ─── Verify Complete Audit Trail ───
      const finalClaim = await Claim.findById(claimId);
      expect(finalClaim.status).toBe('CLOSED');

      const timeline = finalClaim.timeline;

      // 1. Claim Created (non-status change)
      expect(timeline[0].action).toBe('Claim Created');
      expect(timeline[0].previousStatus).toBeNull();
      expect(timeline[0].newStatus).toBeNull();
      expect(timeline[0].notes).toBeNull();

      // 2. Claim Assigned
      expect(timeline[1].action).toBe('Claim Assigned');
      expect(timeline[1].previousStatus).toBe('NEW');
      expect(timeline[1].newStatus).toBe('ASSIGNED');
      expect(timeline[1].notes).toBe('Urgent inspection needed');

      // 3. Inspection Started
      expect(timeline[2].action).toBe('Inspection Started');
      expect(timeline[2].previousStatus).toBe('ASSIGNED');
      expect(timeline[2].newStatus).toBe('IN_PROGRESS');

      // 4. Vehicle Confirmed (non-status change)
      expect(timeline[3].action).toBe('Vehicle Confirmed');
      expect(timeline[3].previousStatus).toBeNull();
      expect(timeline[3].newStatus).toBeNull();

      // 5. Accident Details Recorded (non-status change)
      expect(timeline[4].action).toBe('Accident Details Recorded');
      expect(timeline[4].previousStatus).toBeNull();
      expect(timeline[4].newStatus).toBeNull();

      // 6. Location Captured (non-status change)
      expect(timeline[5].action).toBe('Location Captured');
      expect(timeline[5].previousStatus).toBeNull();
      expect(timeline[5].newStatus).toBeNull();

      // 7. Inspection Submitted
      expect(timeline[6].action).toBe('Inspection Submitted');
      expect(timeline[6].previousStatus).toBe('IN_PROGRESS');
      expect(timeline[6].newStatus).toBe('SUBMITTED');

      // 8. Review Started
      expect(timeline[7].action).toBe('Review Started');
      expect(timeline[7].previousStatus).toBe('SUBMITTED');
      expect(timeline[7].newStatus).toBe('UNDER_REVIEW');

      // 9. Correction Requested
      expect(timeline[8].action).toBe('Correction Requested');
      expect(timeline[8].previousStatus).toBe('UNDER_REVIEW');
      expect(timeline[8].newStatus).toBe('CORRECTION_REQUIRED');
      expect(timeline[8].notes).toBe('Please re-verify the damage description on front bumper');

      // 10. Inspection Resumed
      expect(timeline[9].action).toBe('Inspection Resumed');
      expect(timeline[9].previousStatus).toBe('CORRECTION_REQUIRED');
      expect(timeline[9].newStatus).toBe('IN_PROGRESS');

      // 11. Accident Details Recorded (non-status change)
      expect(timeline[10].action).toBe('Accident Details Recorded');
      expect(timeline[10].previousStatus).toBeNull();
      expect(timeline[10].newStatus).toBeNull();

      // 12. Inspection Submitted
      expect(timeline[11].action).toBe('Inspection Submitted');
      expect(timeline[11].previousStatus).toBe('IN_PROGRESS');
      expect(timeline[11].newStatus).toBe('SUBMITTED');

      // 13. Review Started
      expect(timeline[12].action).toBe('Review Started');
      expect(timeline[12].previousStatus).toBe('SUBMITTED');
      expect(timeline[12].newStatus).toBe('UNDER_REVIEW');

      // 14. Claim Approved
      expect(timeline[13].action).toBe('Claim Approved');
      expect(timeline[13].previousStatus).toBe('UNDER_REVIEW');
      expect(timeline[13].newStatus).toBe('APPROVED');
      expect(timeline[13].notes).toBe('Inspection complete and verified');

      // 15. Claim Closed
      expect(timeline[14].action).toBe('Claim Closed');
      expect(timeline[14].previousStatus).toBe('APPROVED');
      expect(timeline[14].newStatus).toBe('CLOSED');
      expect(timeline[14].notes).toBe('Payout completed');
    });
  });

  // ─── 2. Rejection Path (UNDER_REVIEW -> REJECTED, and Terminality) ─────────
  describe('Rejection Path and REJECTED Terminality', () => {
    it('should transition UNDER_REVIEW -> REJECTED and block any transition out of REJECTED', async () => {
      const claim = await Claim.create({
        organizationId: org1._id,
        createdBy: officer._id,
        assignedTo: adjuster1._id,
        status: 'UNDER_REVIEW',
        customer: { name: 'C', phone: '1' },
        incidentType: 'COLLISION',
        incidentLocation: 'L',
      });

      // Reject claim
      const rejectRes = await request(app)
        .post(`/api/v1/claims/${claim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ decision: 'REJECTED', notes: 'Fraud suspected' });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.status).toBe('REJECTED');

      const dbClaim = await Claim.findById(claim._id);
      expect(dbClaim.status).toBe('REJECTED');
      const lastTimeline = dbClaim.timeline.slice(-1)[0];
      expect(lastTimeline.action).toBe('Claim Rejected');
      expect(lastTimeline.previousStatus).toBe('UNDER_REVIEW');
      expect(lastTimeline.newStatus).toBe('REJECTED');
      expect(lastTimeline.notes).toBe('Fraud suspected');

      // Confirm REJECTED cannot be closed
      const closeRes = await request(app)
        .post(`/api/v1/claims/${claim._id}/close`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ closingNotes: 'Attempt close rejected' });
      expect(closeRes.status).toBe(409);
      expect(closeRes.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');

      // Confirm REJECTED cannot request correction
      const corrRes = await request(app)
        .post(`/api/v1/claims/${claim._id}/review/request-correction`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ notes: 'Correction not allowed' });
      expect(corrRes.status).toBe(409);
      expect(corrRes.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');

      // Confirm REJECTED cannot start review
      const revRes = await request(app)
        .post(`/api/v1/claims/${claim._id}/review/start`)
        .set('Authorization', `Bearer ${officerToken}`);
      expect(revRes.status).toBe(409);
      expect(revRes.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  // ─── 3. Strict Precondition Checks & 409 INVALID_STATUS_TRANSITION ─────────
  describe('Prohibited Transitions Return 409 INVALID_STATUS_TRANSITION', () => {
    let testClaim;

    beforeEach(async () => {
      testClaim = await Claim.create({
        organizationId: org1._id,
        createdBy: officer._id,
        assignedTo: adjuster1._id,
        status: 'NEW',
        customer: { name: 'C', phone: '1' },
        incidentType: 'COLLISION',
        incidentLocation: 'L',
      });
    });

    it('should return 409 when calling /inspection/start on a NEW claim', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${testClaim._id}/inspection/start`)
        .set('Authorization', `Bearer ${adjuster1Token}`);
      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('should return 409 when calling /vehicle on an ASSIGNED (not yet IN_PROGRESS) claim', async () => {
      await Claim.findByIdAndUpdate(testClaim._id, { status: 'ASSIGNED' });
      const res = await request(app)
        .put(`/api/v1/claims/${testClaim._id}/vehicle`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'ABC-123',
        });
      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('should return 409 when calling /vehicle on a CORRECTION_REQUIRED (not yet resumed) claim', async () => {
      await Claim.findByIdAndUpdate(testClaim._id, { status: 'CORRECTION_REQUIRED' });
      const res = await request(app)
        .put(`/api/v1/claims/${testClaim._id}/vehicle`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'ABC-123',
        });
      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('should return 409 when calling /inspection/submit on an ASSIGNED claim', async () => {
      await Claim.findByIdAndUpdate(testClaim._id, {
        status: 'ASSIGNED',
        vehicle: { vehicleId: vehicle._id, plateNumber: 'ABC-123' },
        accident: { accidentType: 'COLLISION' },
        location: { latitude: 20, longitude: 30 },
      });
      const res = await request(app)
        .post(`/api/v1/claims/${testClaim._id}/inspection/submit`)
        .set('Authorization', `Bearer ${adjuster1Token}`);
      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('should return 409 when calling /review/start on an IN_PROGRESS claim', async () => {
      await Claim.findByIdAndUpdate(testClaim._id, { status: 'IN_PROGRESS' });
      const res = await request(app)
        .post(`/api/v1/claims/${testClaim._id}/review/start`)
        .set('Authorization', `Bearer ${officerToken}`);
      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('should return 409 when calling /review/request-correction on a SUBMITTED claim (not yet UNDER_REVIEW)', async () => {
      await Claim.findByIdAndUpdate(testClaim._id, { status: 'SUBMITTED' });
      const res = await request(app)
        .post(`/api/v1/claims/${testClaim._id}/review/request-correction`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ notes: 'Need more photos' });
      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('should return 409 when calling /decision on an IN_PROGRESS or SUBMITTED claim', async () => {
      await Claim.findByIdAndUpdate(testClaim._id, { status: 'SUBMITTED' });
      const res = await request(app)
        .post(`/api/v1/claims/${testClaim._id}/decision`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ decision: 'APPROVED' });
      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('should return 409 when calling /close on an UNDER_REVIEW claim', async () => {
      await Claim.findByIdAndUpdate(testClaim._id, { status: 'UNDER_REVIEW' });
      const res = await request(app)
        .post(`/api/v1/claims/${testClaim._id}/close`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ closingNotes: 'Too early to close' });
      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  // ─── 4. Validation Checks ───────────────────────────────────────────────────
  describe('Input Validation on New Endpoints', () => {
    it('should return 400 VALIDATION_ERROR when /review/request-correction has no notes or empty notes', async () => {
      const claim = await Claim.create({
        organizationId: org1._id,
        createdBy: officer._id,
        status: 'UNDER_REVIEW',
        customer: { name: 'C', phone: '1' },
        incidentType: 'COLLISION',
        incidentLocation: 'L',
      });

      // Missing body
      const res1 = await request(app)
        .post(`/api/v1/claims/${claim._id}/review/request-correction`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({});
      expect(res1.status).toBe(400);
      expect(res1.body.errors[0].code).toBe('VALIDATION_ERROR');

      // Empty string notes
      const res2 = await request(app)
        .post(`/api/v1/claims/${claim._id}/review/request-correction`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ notes: '   ' });
      expect(res2.status).toBe(400);
      expect(res2.body.errors[0].code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── 5. RBAC & Multi-Tenancy Isolation for New Endpoints ────────────────────
  describe('Authorization & Multi-Tenancy Isolation on New Endpoints', () => {
    let assignedClaim, underReviewClaim;

    beforeEach(async () => {
      assignedClaim = await Claim.create({
        organizationId: org1._id,
        createdBy: officer._id,
        assignedTo: adjuster1._id,
        status: 'ASSIGNED',
        customer: { name: 'C', phone: '1' },
        incidentType: 'COLLISION',
        incidentLocation: 'L',
      });

      underReviewClaim = await Claim.create({
        organizationId: org1._id,
        createdBy: officer._id,
        assignedTo: adjuster1._id,
        status: 'UNDER_REVIEW',
        customer: { name: 'C', phone: '1' },
        incidentType: 'COLLISION',
        incidentLocation: 'L',
      });
    });

    it('should return 403 when CLAIMS_OFFICER calls /inspection/start', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${assignedClaim._id}/inspection/start`)
        .set('Authorization', `Bearer ${officerToken}`);
      expect(res.status).toBe(403);
    });

    it('should return 404 when unassigned adjuster in same org calls /inspection/start', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${assignedClaim._id}/inspection/start`)
        .set('Authorization', `Bearer ${adjuster2Token}`);
      expect(res.status).toBe(404);
      expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
    });

    it('should return 404 when adjuster from other org calls /inspection/start', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${assignedClaim._id}/inspection/start`)
        .set('Authorization', `Bearer ${otherOrgAdjusterToken}`);
      expect(res.status).toBe(404);
      expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
    });

    it('should return 403 when FIELD_ADJUSTER calls /review/request-correction', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${underReviewClaim._id}/review/request-correction`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({ notes: 'Invalid role caller' });
      expect(res.status).toBe(403);
    });

    it('should return 404 when CLAIMS_OFFICER from other org calls /review/request-correction', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${underReviewClaim._id}/review/request-correction`)
        .set('Authorization', `Bearer ${otherOrgOfficerToken}`)
        .send({ notes: 'Cross-tenant request' });
      expect(res.status).toBe(404);
      expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
    });

    it('should allow any CLAIMS_OFFICER in the same org to request correction', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${underReviewClaim._id}/review/request-correction`)
        .set('Authorization', `Bearer ${generateToken(officer2)}`)
        .send({ notes: 'Peer review requested changes' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CORRECTION_REQUIRED');
    });
  });
});

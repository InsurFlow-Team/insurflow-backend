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

describe('Claim Lifecycle (Sprint 1 End-to-End)', () => {
  let org1, org2;
  let officer1, officer2, adjuster1, adjuster2;

  beforeEach(async () => {
    org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1' });
    org2 = await Organization.create({ name: 'Org 2', code: 'ORG-2' });

    officer1 = await User.create({ name: 'O1', employeeCode: 'O-1', password: 'p', role: 'CLAIMS_OFFICER', organizationId: org1._id });
    officer2 = await User.create({ name: 'O2', employeeCode: 'O-2', password: 'p', role: 'CLAIMS_OFFICER', organizationId: org1._id });

    adjuster1 = await User.create({ name: 'A1', employeeCode: 'A-1', password: 'p', role: 'FIELD_ADJUSTER', organizationId: org1._id, status: 'ACTIVE' });
    adjuster2 = await User.create({ name: 'A2', employeeCode: 'A-2', password: 'p', role: 'FIELD_ADJUSTER', organizationId: org1._id, status: 'ACTIVE' });
  });

  describe('POST /api/v1/claims/:claimId/inspection/submit', () => {
    let claim, claimNew;

    beforeEach(async () => {
      claimNew = await Claim.create({
        organizationId: org1._id,
        createdBy: officer1._id,
        status: 'NEW',
        customer: { name: 'C', phone: '1' },
        vehicle: { plateNumber: 'XYZ-123' },
        incidentType: 'COLLISION',
        incidentLocation: 'L'
      });

      claim = await Claim.create({
        organizationId: org1._id,
        createdBy: officer1._id,
        assignedTo: adjuster1._id,
        status: 'IN_PROGRESS',
        customer: { name: 'C', phone: '1' },
        vehicle: { plateNumber: 'XYZ-123', vehicleId: new mongoose.Types.ObjectId() },
        accident: { accidentType: 'COLLISION' },
        location: { latitude: 24, longitude: 46 },
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
        incidentType: 'COLLISION',
        incidentLocation: 'L'
      });
    });

    it('should successfully submit inspection when all required fields are present', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/inspection/submit`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('SUBMITTED');

      const updatedClaim = await Claim.findById(claim._id);
      expect(updatedClaim.status).toBe('SUBMITTED');
      expect(updatedClaim.timeline[updatedClaim.timeline.length - 1].action).toBe('Inspection Submitted');
    });

    it('should fail with 422 if vehicle is missing', async () => {
      await Claim.findByIdAndUpdate(claim._id, { $unset: { 'vehicle.vehicleId': 1 } });

      const token = generateToken(adjuster1);
      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/inspection/submit`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('INSPECTION_INCOMPLETE');
      expect(res.body.message).toMatch(/vehicle/);
    });

    it('should fail with 422 if vehicle, accident, and location are missing', async () => {
      await Claim.findByIdAndUpdate(claim._id, {
        $unset: { 'vehicle.vehicleId': 1, accident: 1, location: 1 }
      });

      const token = generateToken(adjuster1);
      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/inspection/submit`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('INSPECTION_INCOMPLETE');
      expect(res.body.message).toMatch(/vehicle/);
      expect(res.body.message).toMatch(/accident/);
      expect(res.body.message).toMatch(/location/);
    });

    it('should treat explicit 0 latitude/longitude as complete', async () => {
      await Claim.findByIdAndUpdate(claim._id, {
        $set: { 'location.latitude': 0, 'location.longitude': 0 }
      });

      const token = generateToken(adjuster1);
      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/inspection/submit`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('SUBMITTED');
    });

    it('should fail with 404 for a different adjuster (not assigned)', async () => {
      const token = generateToken(adjuster2);
      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/inspection/submit`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('should fail with 403 for a CLAIMS_OFFICER token', async () => {
      const token = generateToken(officer1);
      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/inspection/submit`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('should fail with 409 if claim is still NEW', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .post(`/api/v1/claims/${claimNew._id}/inspection/submit`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404); // Not assigned to this adjuster yet
    });

    it('should fail with 409 if claim is already SUBMITTED', async () => {
      await Claim.findByIdAndUpdate(claim._id, { $set: { status: 'SUBMITTED' } });

      const token = generateToken(adjuster1);
      const res = await request(app)
        .post(`/api/v1/claims/${claim._id}/inspection/submit`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  describe('POST /api/v1/claims/:claimId/review/start', () => {
    let claimAssigned, claimSubmitted, claimOrg2;

    beforeEach(async () => {
      claimAssigned = await Claim.create({
        organizationId: org1._id,
        createdBy: officer1._id,
        assignedTo: adjuster1._id,
        status: 'ASSIGNED',
        customer: { name: 'C', phone: '1' },
        vehicle: { plateNumber: 'XYZ-123' },
        incidentType: 'COLLISION',
        incidentLocation: 'L'
      });

      claimSubmitted = await Claim.create({
        organizationId: org1._id,
        createdBy: officer1._id,
        assignedTo: adjuster1._id,
        status: 'SUBMITTED',
        customer: { name: 'C', phone: '1' },
        vehicle: { plateNumber: 'XYZ-123' },
        incidentType: 'COLLISION',
        incidentLocation: 'L'
      });

      claimOrg2 = await Claim.create({
        organizationId: org2._id,
        createdBy: new mongoose.Types.ObjectId(),
        assignedTo: new mongoose.Types.ObjectId(),
        status: 'SUBMITTED',
        customer: { name: 'C', phone: '1' },
        vehicle: { plateNumber: 'XYZ-123' },
        incidentType: 'COLLISION',
        incidentLocation: 'L'
      });
    });

    it('should successfully start review for a SUBMITTED claim', async () => {
      const token = generateToken(officer1);
      const res = await request(app)
        .post(`/api/v1/claims/${claimSubmitted._id}/review/start`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('UNDER_REVIEW');

      const updatedClaim = await Claim.findById(claimSubmitted._id);
      expect(updatedClaim.status).toBe('UNDER_REVIEW');
      expect(updatedClaim.timeline[updatedClaim.timeline.length - 1].action).toBe('Review Started');
    });

    it('should allow a second CLAIMS_OFFICER in the same org to start review', async () => {
      const token = generateToken(officer2);
      const res = await request(app)
        .post(`/api/v1/claims/${claimSubmitted._id}/review/start`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('UNDER_REVIEW');
    });

    it('should fail with 403 for a FIELD_ADJUSTER token', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .post(`/api/v1/claims/${claimSubmitted._id}/review/start`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('should fail with 409 if claim is still ASSIGNED (not yet submitted)', async () => {
      const token = generateToken(officer1);
      const res = await request(app)
        .post(`/api/v1/claims/${claimAssigned._id}/review/start`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('should fail with 404 if claim belongs to a different organization', async () => {
      const token = generateToken(officer1);
      const res = await request(app)
        .post(`/api/v1/claims/${claimOrg2._id}/review/start`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  describe('End-to-End Sprint 1 Lifecycle Walkthrough', () => {
    it('should successfully walk through NEW -> ASSIGNED -> SUBMITTED -> UNDER_REVIEW', async () => {
      const officerToken = generateToken(officer1);
      const adjusterToken = generateToken(adjuster1);

      // Create mock vehicle, policy, customer for the adjuster to submit
      const vehicle = await Vehicle.create({ plateNumber: 'XYZ-123', make: 'M', model: 'M', year: 2022, color: 'W', organizationId: org1._id });
      const policy = await Policy.create({ policyNumber: 'P1', status: 'ACTIVE', startDate: '2023-01-01', expiryDate: '2024-01-01', organizationId: org1._id });
      const customer = await Customer.create({ fullName: 'C', phone: '1', organizationId: org1._id });

      // 1. Create -> NEW
      const createRes = await request(app)
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          customerName: 'C',
          customerPhone: '1',
          initialPlateNumber: 'XYZ-123',
          incidentType: 'COLLISION',
          incidentLocation: 'L'
        });
      expect(createRes.status).toBe(201);
      const claimId = createRes.body.data.id;
      expect(createRes.body.data.status).toBe('NEW');

      // 2. Assign -> PENDING_ACCEPTANCE
      const assignRes = await request(app)
        .post(`/api/v1/claims/${claimId}/assign`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ adjusterId: adjuster1._id });
      expect(assignRes.status).toBe(200);
      expect(assignRes.body.data.status).toBe('PENDING_ACCEPTANCE');

      // 2a. Accept -> ASSIGNED
      const acceptRes = await request(app)
        .post(`/api/v1/claims/${claimId}/accept-assignment`)
        .set('Authorization', `Bearer ${adjusterToken}`)
        .send({});
      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.data.status).toBe('ASSIGNED');

      // 2b. Start inspection -> IN_PROGRESS
      const startRes = await request(app)
        .post(`/api/v1/claims/${claimId}/inspection/start`)
        .set('Authorization', `Bearer ${adjusterToken}`);
      expect(startRes.status).toBe(200);
      expect(startRes.body.data.status).toBe('IN_PROGRESS');

      // 3. Fill vehicle
      const vehicleRes = await request(app)
        .put(`/api/v1/claims/${claimId}/vehicle`)
        .set('Authorization', `Bearer ${adjusterToken}`)
        .send({
          vehicleId: vehicle._id,
          policyId: policy._id,
          customerId: customer._id,
          plateNumber: 'XYZ-123'
        });
      expect(vehicleRes.status).toBe(200);

      // 4. Fill accident
      const accidentRes = await request(app)
        .put(`/api/v1/claims/${claimId}/accident`)
        .set('Authorization', `Bearer ${adjusterToken}`)
        .send({
          accidentType: 'COLLISION',
          accidentDate: '2026-08-26',
          accidentTime: '12:00',
          description: 'D',
          damageDescription: 'D'
        });
      expect(accidentRes.status).toBe(200);

      // 5. Fill location
      const locationRes = await request(app)
        .put(`/api/v1/claims/${claimId}/location`)
        .set('Authorization', `Bearer ${adjusterToken}`)
        .send({
          latitude: 24,
          longitude: 46,
          address: 'A',
          capturedAt: new Date().toISOString()
        });
      expect(locationRes.status).toBe(200);

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

      // 6. Submit -> SUBMITTED
      const submitRes = await request(app)
        .post(`/api/v1/claims/${claimId}/inspection/submit`)
        .set('Authorization', `Bearer ${adjusterToken}`);
      expect(submitRes.status).toBe(200);
      expect(submitRes.body.data.status).toBe('SUBMITTED');

      // 7. Start Review -> UNDER_REVIEW
      const reviewRes = await request(app)
        .post(`/api/v1/claims/${claimId}/review/start`)
        .set('Authorization', `Bearer ${officerToken}`);
      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body.data.status).toBe('UNDER_REVIEW');
    });
  });
});

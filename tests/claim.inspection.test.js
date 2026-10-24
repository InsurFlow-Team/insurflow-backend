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

describe('Inspection Endpoints', () => {
  let org1, org2;
  let officer;
  let adjuster1, adjuster2;
  let claimAssigned, claimNew, claimSubmitted;
  let customer, policy, vehicle;

  beforeEach(async () => {
    org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1' });
    global.__testPol = await buildPolicy({ policyNumber: 'POL-FIX-001', status: 'ACTIVE', startDate: new Date('2026-01-01'), expiryDate: new Date('2027-12-31'), organizationId: org1._id });
    org2 = await Organization.create({ name: 'Org 2', code: 'ORG-2' });

    officer = await User.create({ name: 'O', employeeCode: 'O-1', password: 'p', role: 'CLAIMS_OFFICER', organizationId: org1._id });
    adjuster1 = await User.create({ name: 'A1', employeeCode: 'A-1', password: 'p', role: 'FIELD_ADJUSTER', organizationId: org1._id, status: 'ACTIVE' });
    adjuster2 = await User.create({ name: 'A2', employeeCode: 'A-2', password: 'p', role: 'FIELD_ADJUSTER', organizationId: org1._id, status: 'ACTIVE' });

    customer = await Customer.create({ organizationId: org1._id, fullName: 'C', phone: '123' });
    policy = await buildPolicy({ organizationId: org1._id, policyNumber: 'P-123', status: 'ACTIVE', customerId: customer._id, startDate: new Date(), expiryDate: new Date(Date.now() + 31536000000) });
    vehicle = await Vehicle.create({ organizationId: org1._id, plateNumber: 'REAL-PLATE', make: 'Toyota', model: 'Camry', customerId: customer._id, complementaryPolicyId: policy._id });

    claimAssigned = await Claim.create({
      organizationId: org1._id,
      policyId: policy._id,
      createdBy: officer._id,
      status: 'IN_PROGRESS',
      assignedTo: adjuster1._id,
      customer: { name: 'C', phone: '1' },
      vehicle: { plateNumber: 'OLD-PLATE' },
      incidentType: 'COLLISION',
      incidentLocation: 'L'
    });

    claimNew = await Claim.create({
      organizationId: org1._id,
      policyId: policy._id,
      createdBy: officer._id,
      status: 'NEW',
      customer: { name: 'C', phone: '1' },
      vehicle: { plateNumber: 'OLD-PLATE' },
      incidentType: 'COLLISION',
      incidentLocation: 'L'
    });

    claimSubmitted = await Claim.create({
      organizationId: org1._id,
      policyId: policy._id,
      createdBy: officer._id,
      status: 'SUBMITTED',
      assignedTo: adjuster1._id,
      customer: { name: 'C', phone: '1' },
      vehicle: { plateNumber: 'OLD-PLATE' },
      incidentType: 'COLLISION',
      incidentLocation: 'L'
    });
  });

  describe('PUT /claims/:claimId/vehicle', () => {
    it('should successfully update vehicle and use the real DB plateNumber', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'FAKE-CLIENT-PLATE' // should be ignored in favor of 'REAL-PLATE'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('IN_PROGRESS'); // Status unchanged
      expect(res.body.data.vehicle.plateNumber).toBe('REAL-PLATE');
      expect(res.body.data.vehicle.vehicleId.toString()).toBe(vehicle._id.toString());
      
      const dbClaim = await Claim.findById(claimAssigned._id);
      expect(dbClaim.timeline.slice(-1)[0].action).toBe('Vehicle Confirmed');
    });

    it('should fail with 404 if a different adjuster tries to update it', async () => {
      const token = generateToken(adjuster2);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'REAL-PLATE'
        });

      expect(res.status).toBe(404);
    });

    it('should fail with 403 if called by a CLAIMS_OFFICER', async () => {
      const token = generateToken(officer);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'REAL-PLATE'
        });

      expect(res.status).toBe(403);
    });

    it('should fail with 404 if the claim is still NEW (not assigned to them)', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimNew._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'REAL-PLATE'
        });

      expect(res.status).toBe(404);
    });

    it('should fail with 409 if the claim is already SUBMITTED', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimSubmitted._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'REAL-PLATE'
        });

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('should fail with 404 if vehicle does not exist', async () => {
      const token = generateToken(adjuster1);
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: fakeId.toString(),
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'REAL-PLATE'
        });

      expect(res.status).toBe(404);
      expect(res.body.errors[0].code).toBe('VEHICLE_NOT_FOUND');
    });

    it('should return 400 Bad Request when vehicleId is not a valid 24-character hex ObjectId', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: 'invalid-vehicle-id',
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'REAL-PLATE'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Validation Error');
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
      expect(res.body.errors[0].details).toMatch(/Invalid ID format/i);
    });

    it('should return 400 Bad Request when policyId is not a valid 24-character hex ObjectId', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: 'invalid-policy-id',
          customerId: customer._id.toString(),
          plateNumber: 'REAL-PLATE'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Validation Error');
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
      expect(res.body.errors[0].details).toMatch(/Invalid ID format/i);
    });

    it('should return 400 Bad Request when customerId is not a valid 24-character hex ObjectId', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: policy._id.toString(),
          customerId: 'invalid-customer-id',
          plateNumber: 'REAL-PLATE'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Validation Error');
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
      expect(res.body.errors[0].details).toMatch(/Invalid ID format/i);
    });

    it('should accept valid 24-character hex ObjectIds in uppercase format', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: vehicle._id.toString().toUpperCase(),
          policyId: policy._id.toString().toUpperCase(),
          customerId: customer._id.toString().toUpperCase(),
          plateNumber: 'REAL-PLATE'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.vehicle.vehicleId.toString()).toBe(vehicle._id.toString());
    });
  });

  describe('PUT /claims/:claimId/accident', () => {
    it('should successfully update accident details', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/accident`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          accidentType: 'COLLISION',
          accidentDate: '2026-08-27',
          accidentTime: '14:30',
          description: 'Car hit a tree',
          damageDescription: 'Front bumper damaged'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('IN_PROGRESS');
      expect(res.body.data.accident.accidentType).toBe('COLLISION');
    });

    it('should return 400 if accidentDate is in wrong format', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/accident`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          accidentType: 'COLLISION',
          accidentDate: '08/27/2026',
          accidentTime: '14:30',
          description: 'Car hit a tree',
          damageDescription: 'Front bumper damaged'
        });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });
  });

  describe('FIX-01 policy integrity', () => {
    it('FIX-01 rejects with 422 POLICY_MISMATCH when policyId differs from the claim policy', async () => {
      const otherPolicy = await buildPolicy({
        organizationId: org1._id,
        policyNumber: 'P-OTHER',
        status: 'ACTIVE',
        customerId: customer._id,
        startDate: new Date(),
        expiryDate: new Date(Date.now() + 31536000000),
      });
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: otherPolicy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'REAL-PLATE',
        });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('POLICY_MISMATCH');
    });

    it('FIX-01 rejects with 422 VEHICLE_NOT_ON_CLAIM_POLICY when the vehicle belongs to another policy', async () => {
      const otherPolicy = await buildPolicy({
        organizationId: org1._id,
        policyNumber: 'P-OTHER-2',
        status: 'ACTIVE',
        customerId: customer._id,
        startDate: new Date(),
        expiryDate: new Date(Date.now() + 31536000000),
      });
      const otherVehicle = await Vehicle.create({
        organizationId: org1._id,
        plateNumber: 'OTHER-PLATE',
        make: 'Honda',
        model: 'Civic',
        customerId: customer._id,
        complementaryPolicyId: otherPolicy._id,
      });
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: otherVehicle._id.toString(),
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'OTHER-PLATE',
        });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('VEHICLE_NOT_ON_CLAIM_POLICY');
    });

    it('FIX-01 rejects with 422 VEHICLE_NOT_ON_CLAIM_POLICY when the vehicle has no policy', async () => {
      const vehicleNoPolicy = await Vehicle.create({
        organizationId: org1._id,
        plateNumber: 'NO-POL-PLATE',
        make: 'Nissan',
        model: 'Sunny',
        customerId: customer._id,
      });
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: vehicleNoPolicy._id.toString(),
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'NO-POL-PLATE',
        });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('VEHICLE_NOT_ON_CLAIM_POLICY');
    });

    it('FIX-01 rejects with 422 CUSTOMER_NOT_ON_VEHICLE when the customer is not the vehicle owner', async () => {
      const otherCustomer = await Customer.create({
        organizationId: org1._id,
        fullName: 'Other Customer',
        phone: '999999',
      });
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: policy._id.toString(),
          customerId: otherCustomer._id.toString(),
          plateNumber: 'REAL-PLATE',
        });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('CUSTOMER_NOT_ON_VEHICLE');
    });

    it('FIX-01 does not write vehicle data or a timeline entry when rejected', async () => {
      const otherPolicy = await buildPolicy({
        organizationId: org1._id,
        policyNumber: 'P-OTHER-REJECT',
        status: 'ACTIVE',
        customerId: customer._id,
        startDate: new Date(),
        expiryDate: new Date(Date.now() + 31536000000),
      });
      const claimBefore = await Claim.findById(claimAssigned._id).lean();

      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: otherPolicy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'REAL-PLATE',
        });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('POLICY_MISMATCH');

      const claimAfter = await Claim.findById(claimAssigned._id).lean();
      expect(claimAfter.vehicle).toEqual(claimBefore.vehicle);
      expect(claimAfter.timeline.length).toBe(claimBefore.timeline.length);
    });

    it('FIX-01 keeps claim.policyId and sets vehicle.policyId to it on success', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'REAL-PLATE',
        });

      expect(res.status).toBe(200);
      const updatedClaim = await Claim.findById(claimAssigned._id).lean();
      const claimPolicyId = updatedClaim.policyId?._id || updatedClaim.policyId;
      expect(claimPolicyId.toString()).toBe(policy._id.toString());
      expect(updatedClaim.vehicle.policyId.toString()).toBe(policy._id.toString());
    });

    it('FIX-01 accepts the claim policy id in uppercase hex', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: policy._id.toString().toUpperCase(),
          customerId: customer._id.toString(),
          plateNumber: 'REAL-PLATE',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('FIX-01 returns 404 for a vehicle from another organization', async () => {
      const vehicleOrg2 = await Vehicle.create({
        organizationId: org2._id,
        plateNumber: 'ORG2-PLATE',
        make: 'Ford',
        model: 'Focus',
      });
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: vehicleOrg2._id.toString(),
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'ORG2-PLATE',
        });

      expect(res.status).toBe(404);
      expect(res.body.errors[0].code).toBe('VEHICLE_NOT_FOUND');
    });
  });

  describe('PUT /claims/:claimId/location', () => {
    it('should successfully update location details', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/location`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          latitude: 40.7128,
          longitude: -74.0060,
          address: '123 Main St, NY',
          capturedAt: new Date().toISOString()
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('IN_PROGRESS');
      expect(res.body.data.location.address).toBe('123 Main St, NY');
    });

    it('should return 400 if latitude is out of range', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/location`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          latitude: 200,
          longitude: -74.0060,
          address: '123 Main St, NY',
          capturedAt: new Date().toISOString()
        });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });
    it('accepts a vehicle whose complementaryPolicyId equals the claim policy in the vehicle step', async () => {
      const token = generateToken(adjuster1);
      const res = await request(app)
        .put(`/api/v1/claims/${claimAssigned._id}/vehicle`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'REAL-PLATE',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('IN_PROGRESS');
      expect(res.body.data.vehicle.plateNumber).toBe('REAL-PLATE');
    });
  });
});

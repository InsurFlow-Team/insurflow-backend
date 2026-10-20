jest.mock('../src/utils/uploadToCloudinary', () =>
  jest.fn().mockResolvedValue({
    url: 'https://res.cloudinary.com/fake/test.jpg',
    publicId: 'fake-public-id',
  })
);

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
const uploadToCloudinary = require('../src/utils/uploadToCloudinary');

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

describe('Evidence Photos & Digital Signature (Cloudinary)', () => {
  let org1, org2;
  let officer, adjuster1, adjuster2, otherOrgAdjuster;
  let officerToken, adjuster1Token, adjuster2Token, otherOrgAdjusterToken;
  let customer, policy, vehicle;
  let inProgressClaim, assignedClaim;

  beforeEach(async () => {
    org1 = await Organization.create({ name: 'Org 1', code: 'ORG1' });
    global.__testPol = await buildPolicy({ policyNumber: 'POL-FIX-001', status: 'ACTIVE', startDate: new Date('2026-01-01'), expiryDate: new Date('2027-12-31'), organizationId: org1._id });
    org2 = await Organization.create({ name: 'Org 2', code: 'ORG2' });

    officer = await User.create({
      name: 'Officer User',
      employeeCode: 'CO-01',
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

    officerToken = generateToken(officer);
    adjuster1Token = generateToken(adjuster1);
    adjuster2Token = generateToken(adjuster2);
    otherOrgAdjusterToken = generateToken(otherOrgAdjuster);

    customer = await Customer.create({
      organizationId: org1._id,
      fullName: 'John Doe',
      phone: '0501234567',
    });

    policy = await buildPolicy({
      organizationId: org1._id,
      policyNumber: 'POL-123456',
      status: 'ACTIVE',
      customerId: customer._id,
      startDate: new Date('2026-01-01'),
      expiryDate: new Date('2027-01-01'),
    });

    vehicle = await Vehicle.create({
      organizationId: org1._id,
      plateNumber: 'ABC-1234',
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
      customerId: customer._id,
      policyId: policy._id,
    });

    inProgressClaim = await Claim.create({
      organizationId: org1._id,
      policyId: policy._id,
      createdBy: officer._id,
      assignedTo: adjuster1._id,
      assignedBy: officer._id,
      assignedAt: new Date(),
      status: 'IN_PROGRESS',
      customer: { name: 'John Doe', phone: '0501234567' },
      vehicle: { plateNumber: 'ABC-1234' },
      incidentType: 'COLLISION',
      incidentLocation: 'Main Street',
    });

    assignedClaim = await Claim.create({
      organizationId: org1._id,
      policyId: policy._id,
      createdBy: officer._id,
      assignedTo: adjuster1._id,
      assignedBy: officer._id,
      assignedAt: new Date(),
      status: 'ASSIGNED',
      customer: { name: 'Jane Doe', phone: '0507654321' },
      vehicle: { plateNumber: 'XYZ-5678' },
      incidentType: 'COLLISION',
      incidentLocation: 'Side Street',
    });
  });

  describe('POST /api/v1/claims/:claimId/evidence', () => {
    it('should upload evidence successfully (200, array has one entry, sets timeline event)', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/evidence`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .attach('file', Buffer.from('fake-bytes'), 'front.jpg')
        .field('imageType', 'VEHICLE_FRONT');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('IN_PROGRESS');
      expect(Array.isArray(res.body.data.evidence)).toBe(true);
      expect(res.body.data.evidence).toHaveLength(1);
      expect(res.body.data.evidence[0]).toMatchObject({
        imageType: 'VEHICLE_FRONT',
        url: 'https://res.cloudinary.com/fake/test.jpg',
        publicId: 'fake-public-id',
      });

      const updated = await Claim.findById(inProgressClaim._id);
      expect(updated.evidence).toHaveLength(1);
      const lastTimeline = updated.timeline[updated.timeline.length - 1];
      expect(lastTimeline.action).toBe('Evidence Uploaded');
      expect(lastTimeline.previousStatus).toBeNull();
      expect(lastTimeline.newStatus).toBeNull();
      expect(lastTimeline.notes).toBe('VEHICLE_FRONT');
      expect(lastTimeline.performedBy.toString()).toBe(adjuster1._id.toString());
    });

    it('should persist two uploads additively on the same claim', async () => {
      uploadToCloudinary
        .mockResolvedValueOnce({ url: 'https://res.cloudinary.com/fake/photo1.jpg', publicId: 'photo-1' })
        .mockResolvedValueOnce({ url: 'https://res.cloudinary.com/fake/photo2.jpg', publicId: 'photo-2' });

      const res1 = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/evidence`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .attach('file', Buffer.from('fake-bytes-1'), 'front.jpg')
        .field('imageType', 'VEHICLE_FRONT');

      expect(res1.status).toBe(200);
      expect(res1.body.data.evidence).toHaveLength(1);

      const res2 = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/evidence`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .attach('file', Buffer.from('fake-bytes-2'), 'rear.jpg')
        .field('imageType', 'VEHICLE_REAR');

      expect(res2.status).toBe(200);
      expect(res2.body.data.evidence).toHaveLength(2);
      expect(res2.body.data.evidence[0].imageType).toBe('VEHICLE_FRONT');
      expect(res2.body.data.evidence[1].imageType).toBe('VEHICLE_REAR');

      const updated = await Claim.findById(inProgressClaim._id);
      expect(updated.evidence).toHaveLength(2);
    });

    it('should return 400 VALIDATION_ERROR when no file is attached', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/evidence`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .field('imageType', 'DAMAGE_CLOSEUP');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
      expect(res.body.message).toMatch(/image file is required/i);
    });

    it('should return 400 VALIDATION_ERROR when imageType is invalid', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/evidence`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .attach('file', Buffer.from('fake-bytes'), 'test.jpg')
        .field('imageType', 'INVALID_TYPE');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 VALIDATION_ERROR when file exceeds 10MB', async () => {
      // Create a buffer larger than 10MB
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024 + 1024);

      const res = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/evidence`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .attach('file', largeBuffer, 'huge.jpg')
        .field('imageType', 'DAMAGE_CLOSEUP');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
      expect(res.body.message).toMatch(/limit/i);
    });

    it('should return 400 VALIDATION_ERROR when file type is unsupported (e.g. text file)', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/evidence`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .attach('file', Buffer.from('plain text document'), { filename: 'document.txt', contentType: 'text/plain' })
        .field('imageType', 'DAMAGE_CLOSEUP');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
      expect(res.body.message).toMatch(/Only JPEG, PNG, and WEBP/i);
    });

    it('should return 409 INVALID_STATUS_TRANSITION when claim is ASSIGNED (not IN_PROGRESS)', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${assignedClaim._id}/evidence`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .attach('file', Buffer.from('fake-bytes'), 'test.jpg')
        .field('imageType', 'DAMAGE_CLOSEUP');

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('should return 403 FORBIDDEN when called with CLAIMS_OFFICER token', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/evidence`)
        .set('Authorization', `Bearer ${officerToken}`)
        .attach('file', Buffer.from('fake-bytes'), 'test.jpg')
        .field('imageType', 'DAMAGE_CLOSEUP');

      expect(res.status).toBe(403);
    });

    it('should return 404 CLAIM_NOT_FOUND when called by a different adjuster', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/evidence`)
        .set('Authorization', `Bearer ${adjuster2Token}`)
        .attach('file', Buffer.from('fake-bytes'), 'test.jpg')
        .field('imageType', 'DAMAGE_CLOSEUP');

      expect(res.status).toBe(404);
      expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
    });

    it('should return 404 CLAIM_NOT_FOUND when called by adjuster from another organization', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/evidence`)
        .set('Authorization', `Bearer ${otherOrgAdjusterToken}`)
        .attach('file', Buffer.from('fake-bytes'), 'test.jpg')
        .field('imageType', 'DAMAGE_CLOSEUP');

      expect(res.status).toBe(404);
      expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
    });
  });

  describe('POST /api/v1/claims/:claimId/signature', () => {
    it('should upload signature successfully (200, returns singular object, sets timeline)', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/signature`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .attach('file', Buffer.from('fake-sig-bytes'), 'sig.png');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('IN_PROGRESS');
      expect(res.body.data.signature).toMatchObject({
        url: 'https://res.cloudinary.com/fake/test.jpg',
        publicId: 'fake-public-id',
      });
      expect(res.body.data.signature.capturedBy).toBeDefined();
      expect(res.body.data.signature.capturedAt).toBeDefined();

      const updated = await Claim.findById(inProgressClaim._id);
      expect(updated.signature.url).toBe('https://res.cloudinary.com/fake/test.jpg');
      const lastTimeline = updated.timeline[updated.timeline.length - 1];
      expect(lastTimeline.action).toBe('Signature Captured');
      expect(lastTimeline.previousStatus).toBeNull();
      expect(lastTimeline.newStatus).toBeNull();
      expect(lastTimeline.performedBy.toString()).toBe(adjuster1._id.toString());
    });

    it('should overwrite existing signature on a second upload instead of appending', async () => {
      uploadToCloudinary
        .mockResolvedValueOnce({ url: 'https://res.cloudinary.com/fake/sig1.png', publicId: 'sig-1' })
        .mockResolvedValueOnce({ url: 'https://res.cloudinary.com/fake/sig2.png', publicId: 'sig-2' });

      const res1 = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/signature`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .attach('file', Buffer.from('sig1'), 'sig1.png');

      expect(res1.status).toBe(200);
      expect(res1.body.data.signature.url).toBe('https://res.cloudinary.com/fake/sig1.png');

      const res2 = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/signature`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .attach('file', Buffer.from('sig2'), 'sig2.png');

      expect(res2.status).toBe(200);
      expect(res2.body.data.signature.url).toBe('https://res.cloudinary.com/fake/sig2.png');
      expect(res2.body.data.signature.publicId).toBe('sig-2');

      const updated = await Claim.findById(inProgressClaim._id);
      expect(updated.signature.url).toBe('https://res.cloudinary.com/fake/sig2.png');
    });

    it('should return 400 VALIDATION_ERROR when no file is attached for signature', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/signature`)
        .set('Authorization', `Bearer ${adjuster1Token}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
      expect(res.body.message).toMatch(/image file is required/i);
    });

    it('should return 409 INVALID_STATUS_TRANSITION when signature is uploaded on ASSIGNED claim', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${assignedClaim._id}/signature`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .attach('file', Buffer.from('sig'), 'sig.png');

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('should return 403 FORBIDDEN when signature is uploaded by CLAIMS_OFFICER', async () => {
      const res = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/signature`)
        .set('Authorization', `Bearer ${officerToken}`)
        .attach('file', Buffer.from('sig'), 'sig.png');

      expect(res.status).toBe(403);
    });

    it('should return 404 when signature is uploaded by different adjuster or cross-tenant', async () => {
      const diffAdjusterRes = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/signature`)
        .set('Authorization', `Bearer ${adjuster2Token}`)
        .attach('file', Buffer.from('sig'), 'sig.png');

      expect(diffAdjusterRes.status).toBe(404);

      const crossOrgRes = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/signature`)
        .set('Authorization', `Bearer ${otherOrgAdjusterToken}`)
        .attach('file', Buffer.from('sig'), 'sig.png');

      expect(crossOrgRes.status).toBe(404);
    });
  });

  describe('Inspection submission completeness with Evidence & Signature', () => {
    it('should return 422 INSPECTION_INCOMPLETE naming evidence and signature when vehicle/accident/location are filled but evidence/signature are missing', async () => {
      // Fill vehicle, accident, location
      await request(app)
        .put(`/api/v1/claims/${inProgressClaim._id}/vehicle`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'ABC-1234',
        });

      await request(app)
        .put(`/api/v1/claims/${inProgressClaim._id}/accident`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({
          accidentType: 'COLLISION',
          accidentDate: '2026-09-01',
          accidentTime: '14:30',
          description: 'Front collision',
          damageDescription: 'Bumper dented',
        });

      await request(app)
        .put(`/api/v1/claims/${inProgressClaim._id}/location`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({
          latitude: 24.7136,
          longitude: 46.6753,
          address: 'King Fahd Rd, Riyadh',
          capturedAt: new Date().toISOString(),
        });

      const res = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/inspection/submit`)
        .set('Authorization', `Bearer ${adjuster1Token}`);

      expect(res.status).toBe(422);
      expect(res.body.errors[0].code).toBe('INSPECTION_INCOMPLETE');
      expect(res.body.message).toMatch(/evidence/);
      expect(res.body.message).toMatch(/signature/);
    });

    it('should submit successfully (200, SUBMITTED) when all 5 elements are complete', async () => {
      // 1. Vehicle
      await request(app)
        .put(`/api/v1/claims/${inProgressClaim._id}/vehicle`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({
          vehicleId: vehicle._id.toString(),
          policyId: policy._id.toString(),
          customerId: customer._id.toString(),
          plateNumber: 'ABC-1234',
        });

      // 2. Accident
      await request(app)
        .put(`/api/v1/claims/${inProgressClaim._id}/accident`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({
          accidentType: 'COLLISION',
          accidentDate: '2026-09-01',
          accidentTime: '14:30',
          description: 'Front collision',
          damageDescription: 'Bumper dented',
        });

      // 3. Location
      await request(app)
        .put(`/api/v1/claims/${inProgressClaim._id}/location`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .send({
          latitude: 24.7136,
          longitude: 46.6753,
          address: 'King Fahd Rd, Riyadh',
          capturedAt: new Date().toISOString(),
        });

      // 4. Evidence
      await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/evidence`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .attach('file', Buffer.from('fake-photo'), 'evidence.jpg')
        .field('imageType', 'DAMAGE_CLOSEUP');

      // 5. Signature
      await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/signature`)
        .set('Authorization', `Bearer ${adjuster1Token}`)
        .attach('file', Buffer.from('fake-signature'), 'signature.png');

      // Submit
      const res = await request(app)
        .post(`/api/v1/claims/${inProgressClaim._id}/inspection/submit`)
        .set('Authorization', `Bearer ${adjuster1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUBMITTED');

      const finalClaim = await Claim.findById(inProgressClaim._id);
      expect(finalClaim.status).toBe('SUBMITTED');
    });
  });
});

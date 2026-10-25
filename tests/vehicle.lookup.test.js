const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Customer = require('../src/modules/customers/customer.model');
const Policy = require('../src/modules/policies/policy.model');
const { buildPolicy } = require('./helpers/policyFactory');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

const { MongoMemoryServer } = require('mongodb-memory-server');

describe('Vehicle Lookup API', () => {
  let mongoServer;
  let org1;
  let org2;
  let fieldAdjuster;
  let token;
  let customer1;
  let policy1;
  let vehicle1;
  let vehicleOrg2;
  let claimsOfficer;
  let officerToken;
  let expiredPolicy;
  let expiredVehicle;

  beforeAll(async () => {
    // Set up test database
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    // Create Organizations
    org1 = await Organization.create({ name: 'Org 1', code: 'ORG-1', domain: 'org1.com', status: 'ACTIVE' });
    org2 = await Organization.create({ name: 'Org 2', code: 'ORG-2', domain: 'org2.com', status: 'ACTIVE' });

    // Create Field Adjuster in Org 1
    fieldAdjuster = await User.create({
      name: 'Test Adjuster',
      employeeCode: 'FA-100',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    token = generateToken(fieldAdjuster);

    // Create Claims Officer in Org 1
    claimsOfficer = await User.create({
      name: 'Test Officer',
      employeeCode: 'CO-100',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org1._id,
      status: 'ACTIVE',
    });
    officerToken = generateToken(claimsOfficer);

    // Create Mock Data in Org 1
    customer1 = await Customer.create({
      fullName: 'Test Customer 1',
      phone: '+111111111',
      organizationId: org1._id,
    });

    policy1 = await buildPolicy({
      policyNumber: 'POL-TEST-1',
      status: 'ACTIVE',
      startDate: new Date('2026-01-01T00:00:00Z'),
      expiryDate: new Date('2026-12-31T00:00:00Z'),
      organizationId: org1._id,
    });

    vehicle1 = await Vehicle.create({
      plateNumber: 'TST-1234',
      make: 'Ford',
      model: 'Focus',
      year: 2021,
      color: 'Blue',
      customerId: customer1._id, complementaryPolicyId: policy1._id,
      organizationId: org1._id,
    });

    expiredPolicy = await buildPolicy({
      policyNumber: 'POL-EXPIRED-1',
      status: 'EXPIRED',
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2025-12-31T00:00:00Z'),
      organizationId: org1._id,
    });

    expiredVehicle = await Vehicle.create({
      plateNumber: 'XYZ-9876',
      make: 'Honda',
      model: 'Civic',
      year: 2019,
      color: 'Silver',
      customerId: customer1._id, complementaryPolicyId: expiredPolicy._id,
      organizationId: org1._id,
    });

    // Create Mock Data in Org 2
    vehicleOrg2 = await Vehicle.create({
      plateNumber: 'ORG2-999',
      make: 'Tesla',
      model: 'Model 3',
      year: 2023,
      color: 'Red',
      organizationId: org2._id,
    });
  });

  afterAll(async () => {
    // Cleanup
    await Organization.deleteMany({});
    await User.deleteMany({});
    await Customer.deleteMany({});
    await Policy.deleteMany({});
    await Vehicle.deleteMany({});
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('should return 401 if not authenticated', async () => {
    const res = await request(app).get('/api/v1/vehicles/lookup?plateNumber=TST-1234');
    expect(res.statusCode).toBe(401);
  });

  it('should return 403 if user is a CLAIMS_OFFICER', async () => {
    const res = await request(app)
      .get('/api/v1/vehicles/lookup?plateNumber=TST-1234')
      .set('Authorization', `Bearer ${officerToken}`);
    expect(res.statusCode).toBe(403);
  });

  it('should return 400 if plateNumber is missing', async () => {
    const res = await request(app)
      .get('/api/v1/vehicles/lookup')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 if unknown query parameter is passed', async () => {
    const res = await request(app)
      .get('/api/v1/vehicles/lookup?plateNumber=TST-1234&unknownParam=attack')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('should successfully look up a vehicle in the same organization', async () => {
    const res = await request(app)
      .get('/api/v1/vehicles/lookup?plateNumber=tst-1234 ') // testing lowercase and extra space (normalization)
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    
    const { vehicle, customer, policies, warnings } = res.body.data;
    
    expect(vehicle.plateNumber).toBe('TST-1234');
    expect(vehicle.make).toBe('Ford');
    expect(vehicle.year).toBe(2021);
    
    expect(customer.fullName).toBe('Test Customer 1');
    expect(customer.phone).toBe('+******111');
    
    expect(policies.complementary.policyNumber).toBe('POL-TEST-1');
    expect(policies.complementary.status).toBe('ACTIVE');
    expect(policies.complementary.startDate).toBe('2026-01-01');
    expect(policies.complementary.expiryDate).toBe('2026-12-31');
    expect(policies.compulsory).toBeNull();
    
    expect(res.body.data.policy).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it('should return warning object if policy is expired', async () => {
    const res = await request(app)
      .get('/api/v1/vehicles/lookup?plateNumber=XYZ-9876')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    
    const { vehicle, policies, warnings } = res.body.data;
    expect(vehicle.plateNumber).toBe('XYZ-9876');
    expect(policies.complementary.status).toBe('EXPIRED');
    
    expect(res.body.data.warning).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('POLICY_EXPIRED');
    expect(warnings[0].policyKind).toBe('COMPLEMENTARY');
  });

  it('should return 404 for an unknown plate number', async () => {
    const res = await request(app)
      .get('/api/v1/vehicles/lookup?plateNumber=UNKNOWN')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Vehicle not found');
  });

  it('should return 404 for a plate number that exists but belongs to a different organization (Organization Isolation)', async () => {
    const res = await request(app)
      .get('/api/v1/vehicles/lookup?plateNumber=ORG2-999')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Vehicle not found');
  });
  describe('PB-04a Policy slots & warnings', () => {
    it('returns policies.compulsory and policies.complementary and no policy key', async () => {
      const res = await request(app)
        .get('/api/v1/vehicles/lookup?plateNumber=TST-1234')
        .set('Authorization', `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.policy).toBeUndefined();
      expect(res.body.data.policies).toBeDefined();
      expect(res.body.data.policies.complementary).toMatchObject({
        policyNumber: 'POL-TEST-1',
        policyKind: 'COMPLEMENTARY',
        status: 'ACTIVE',
      });
      expect(res.body.data.policies.compulsory).toBeNull();
    });

    it('returns one POLICY_EXPIRED warning per expired policy', async () => {
      const expCompulsory = await buildPolicy({
        policyNumber: 'POL-EXP-COMPUL',
        policyKind: 'UNIFIED_COMPULSORY',
        status: 'EXPIRED',
        startDate: new Date('2024-01-01T00:00:00Z'),
        expiryDate: new Date('2024-12-31T00:00:00Z'),
        organizationId: org1._id,
        propertyDamageLimit: 10000000,
        deductibleAmount: 0,
      });

      const expComplementary = await buildPolicy({
        policyNumber: 'POL-EXP-COMPLE',
        policyKind: 'COMPLEMENTARY',
        status: 'EXPIRED',
        startDate: new Date('2024-01-01T00:00:00Z'),
        expiryDate: new Date('2024-12-31T00:00:00Z'),
        organizationId: org1._id,
        sumInsured: 5000000,
        deductibleAmount: 50000,
      });

      await Vehicle.create({
        plateNumber: 'EXP-DUAL',
        make: 'Ford',
        model: 'Fiesta',
        year: 2020,
        customerId: customer1._id,
        compulsoryPolicyId: expCompulsory._id,
        complementaryPolicyId: expComplementary._id,
        organizationId: org1._id,
      });

      const res = await request(app)
        .get('/api/v1/vehicles/lookup?plateNumber=EXP-DUAL')
        .set('Authorization', `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.warnings).toHaveLength(2);
      expect(res.body.data.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'POLICY_EXPIRED', policyKind: 'UNIFIED_COMPULSORY' }),
          expect.objectContaining({ code: 'POLICY_EXPIRED', policyKind: 'COMPLEMENTARY' }),
        ])
      );
    });

    it('returns null slots and empty warnings for a vehicle without policies', async () => {
      await Vehicle.create({
        plateNumber: 'NO-POL-VEH',
        make: 'Toyota',
        model: 'Yaris',
        year: 2020,
        organizationId: org1._id,
      });

      const res = await request(app)
        .get('/api/v1/vehicles/lookup?plateNumber=NO-POL-VEH')
        .set('Authorization', `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.policies).toEqual({
        compulsory: null,
        complementary: null,
      });
      expect(res.body.data.warnings).toEqual([]);
    });
  });
});

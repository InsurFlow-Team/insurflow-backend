const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Customer = require('../src/modules/customers/customer.model');
const Policy = require('../src/modules/policies/policy.model');
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

    // Create Mock Data in Org 1
    customer1 = await Customer.create({
      fullName: 'Test Customer 1',
      phone: '+111111111',
      organizationId: org1._id,
    });

    policy1 = await Policy.create({
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
      customerId: customer1._id,
      policyId: policy1._id,
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
    const res = await request(app).get('/api/v1/vehicles/lookup?plate_number=TST-1234');
    expect(res.statusCode).toBe(401);
  });

  it('should return 400 if plate_number is missing', async () => {
    const res = await request(app)
      .get('/api/v1/vehicles/lookup')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('should successfully look up a vehicle in the same organization', async () => {
    const res = await request(app)
      .get('/api/v1/vehicles/lookup?plate_number=tst-1234 ') // testing lowercase and extra space (normalization)
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    
    const { vehicle, customer, policy } = res.body.data;
    
    expect(vehicle.plate_number).toBe('TST-1234');
    expect(vehicle.make).toBe('Ford');
    expect(vehicle.year).toBe(2021);
    
    expect(customer.full_name).toBe('Test Customer 1');
    expect(customer.phone).toBe('+111111111');
    
    expect(policy.policy_number).toBe('POL-TEST-1');
    expect(policy.status).toBe('ACTIVE');
    expect(policy.start_date).toBe('2026-01-01');
    expect(policy.expiry_date).toBe('2026-12-31');
  });

  it('should return 404 for an unknown plate number', async () => {
    const res = await request(app)
      .get('/api/v1/vehicles/lookup?plate_number=UNKNOWN')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Vehicle not found');
  });

  it('should return 404 for a plate number that exists but belongs to a different organization (Organization Isolation)', async () => {
    const res = await request(app)
      .get('/api/v1/vehicles/lookup?plate_number=ORG2-999')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Vehicle not found');
  });
});

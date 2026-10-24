const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Customer = require('../src/modules/customers/customer.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Policy = require('../src/modules/policies/policy.model');
const Incident = require('../src/modules/incidents/incident.model');
const Claim = require('../src/modules/claims/claim.model');
const { buildPolicy } = require('./helpers/policyFactory');
const config = require('../src/config/env');

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

describe('Policy Coverage & Intake Gate (PB-04a)', () => {
  let mongoServer;
  let org, org2, officer, officerToken;
  let customer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    org = await Organization.create({
      name: 'Coverage Test Org',
      code: 'COV-ORG',
      domain: 'cov.com',
      status: 'ACTIVE',
    });

    org2 = await Organization.create({
      name: 'Other Org',
      code: 'OTHER-ORG',
      domain: 'other.com',
      status: 'ACTIVE',
    });

    officer = await User.create({
      name: 'Coverage Officer',
      employeeCode: 'COV-OF-01',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    officerToken = generateToken(officer);

    customer = await Customer.create({
      organizationId: org._id,
      fullName: 'Ahmad Customer',
      phone: '0599112233',
      nationalId: '123456789',
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  // Helper to create an incident with vehicle and policyholder party
  const createTestIncident = async ({ vehicleId, plateNumber, incidentAt = '2026-06-15T10:00:00+03:00', incidentDate, isLegacy = false }) => {
    const incidentData = {
      organizationId: org._id,
      createdBy: officer._id,
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah City Center',
      governorate: 'RAMALLAH_AL_BIREH',
      reportSource: 'PALESTINIAN_POLICE_PAPER',
      injuriesReported: false,
      vehicles: [
        {
          vehicleRole: 'INSURED',
          plateRegion: 'PALESTINIAN',
          plateNumber: plateNumber || 'COV-1111',
          vehicleId: vehicleId || null,
        },
      ],
      parties: [],
    };

    if (isLegacy) {
      incidentData.incidentDate = incidentDate || '2026-06-15';
      incidentData.incidentAt = null;
    } else {
      incidentData.incidentAt = new Date(incidentAt);
      incidentData.incidentDate = incidentDate || '2026-06-15';
    }

    const incident = await Incident.create(incidentData);

    const subjectVehicle = incident.vehicles[0];
    incident.parties.push({
      role: 'POLICYHOLDER',
      partyType: 'PERSON',
      fullName: 'Ahmad Customer',
      idType: 'PALESTINIAN_ID',
      idNumber: '123456789',
      phone: '0599112233',
      vehicleRef: subjectVehicle._id,
    });
    await incident.save();

    return {
      incident,
      subjectRef: subjectVehicle._id.toString(),
      claimantPartyId: incident.parties[0]._id.toString(),
    };
  };

  // Test 1
  it('1. creates an OWN_DAMAGE sub-claim on a COMPLEMENTARY COMPREHENSIVE policy', async () => {
    const policy = await buildPolicy({
      organizationId: org._id,
      policyKind: 'COMPLEMENTARY',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      sumInsured: 50000,
      deductibleAmount: 500,
      startDate: new Date('2026-01-01T00:00:00Z'),
      expiryDate: new Date('2026-12-31T23:59:59Z'),
    });

    const vehicle = await Vehicle.create({
      organizationId: org._id,
      plateNumber: 'T1-PLATE',
      complementaryPolicyId: policy._id,
      customerId: customer._id,
    });

    const { incident, subjectRef, claimantPartyId } = await createTestIncident({
      vehicleId: vehicle._id,
      plateNumber: vehicle.plateNumber,
      incidentAt: '2026-06-15T12:00:00+03:00',
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: vehicle.plateNumber,
        claimantPartyId,
        subjectRef,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.claimType).toBe('OWN_DAMAGE');
    expect(res.body.data.coverageSnapshot).toMatchObject({
      policyKind: 'COMPLEMENTARY',
      policyType: 'COMPREHENSIVE',
      sumInsured: 50000,
    });
  });

  // Test 2
  it('2. rejects an OWN_DAMAGE sub-claim on a UNIFIED_COMPULSORY policy with reason WRONG_POLICY_KIND', async () => {
    const policy = await buildPolicy({
      organizationId: org._id,
      policyKind: 'UNIFIED_COMPULSORY',
      propertyDamageLimit: 100000,
      deductibleAmount: 0,
      startDate: new Date('2026-01-01T00:00:00Z'),
      expiryDate: new Date('2026-12-31T23:59:59Z'),
    });

    const vehicle = await Vehicle.create({
      organizationId: org._id,
      plateNumber: 'T2-PLATE',
      compulsoryPolicyId: policy._id,
      customerId: customer._id,
    });

    const { incident, subjectRef, claimantPartyId } = await createTestIncident({
      vehicleId: vehicle._id,
      plateNumber: vehicle.plateNumber,
      incidentAt: '2026-06-15T12:00:00+03:00',
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: vehicle.plateNumber,
        claimantPartyId,
        subjectRef,
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('COVERAGE_NOT_APPLICABLE');
    expect(res.body.errors[0].reason).toBe('WRONG_POLICY_KIND');
  });

  // Test 3
  it('3. rejects a policy with policyType THIRD_PARTY at model level for both kinds', async () => {
    // COMPLEMENTARY with THIRD_PARTY
    await expect(
      Policy.create({
        organizationId: org._id,
        policyNumber: 'POL-T3-COMP',
        policyKind: 'COMPLEMENTARY',
        policyType: 'THIRD_PARTY',
        coveredPerils: ['COLLISION'],
        sumInsured: 50000,
        deductibleAmount: 500,
        startDate: new Date('2026-01-01T00:00:00Z'),
        expiryDate: new Date('2026-12-31T23:59:59Z'),
      })
    ).rejects.toThrow();

    // UNIFIED_COMPULSORY with THIRD_PARTY
    await expect(
      Policy.create({
        organizationId: org._id,
        policyNumber: 'POL-T3-COMPUL',
        policyKind: 'UNIFIED_COMPULSORY',
        policyType: 'THIRD_PARTY',
        coveredPerils: [],
        propertyDamageLimit: 100000,
        deductibleAmount: 0,
        startDate: new Date('2026-01-01T00:00:00Z'),
        expiryDate: new Date('2026-12-31T23:59:59Z'),
      })
    ).rejects.toThrow();
  });

  // Test 4
  it('4. rejects a policy without policyKind with reason POLICY_KIND_MISSING', async () => {
    const rawPolicyId = new mongoose.Types.ObjectId();
    await Policy.collection.insertOne({
      _id: rawPolicyId,
      policyNumber: 'POL-T4-NOKIND',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2026-01-01T00:00:00Z'),
      expiryDate: new Date('2026-12-31T23:59:59Z'),
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      deductibleAmount: 500,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const vehicle = await Vehicle.create({
      organizationId: org._id,
      plateNumber: 'T4-PLATE',
      complementaryPolicyId: rawPolicyId,
      customerId: customer._id,
    });

    const { incident, subjectRef, claimantPartyId } = await createTestIncident({
      vehicleId: vehicle._id,
      plateNumber: vehicle.plateNumber,
      incidentAt: '2026-06-15T12:00:00+03:00',
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: rawPolicyId.toString(),
        plateNumber: vehicle.plateNumber,
        claimantPartyId,
        subjectRef,
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('COVERAGE_NOT_APPLICABLE');
    expect(res.body.errors[0].reason).toBe('POLICY_KIND_MISSING');
  });

  // Test 5
  // C7: startDate: 2026-06-01T07:00:00.000Z (10:00 Asia/Hebron, summer offset +03:00)
  //     incidentAt: 2026-06-01T06:00:00.000Z (09:00 Asia/Hebron, summer offset +03:00, 1 hr before start)
  it('5. rejects a sub-claim whose incidentAt is one hour before the policy startDate with reason BEFORE_POLICY_START', async () => {
    const policy = await buildPolicy({
      organizationId: org._id,
      policyKind: 'COMPLEMENTARY',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      sumInsured: 50000,
      deductibleAmount: 500,
      startDate: new Date('2026-06-01T07:00:00.000Z'), // 10:00 Hebron, summer offset +03:00
      expiryDate: new Date('2026-12-31T21:59:59.999Z'), // 23:59:59 Hebron, winter offset +02:00
    });

    const vehicle = await Vehicle.create({
      organizationId: org._id,
      plateNumber: 'T5-PLATE',
      complementaryPolicyId: policy._id,
      customerId: customer._id,
    });

    const { incident, subjectRef, claimantPartyId } = await createTestIncident({
      vehicleId: vehicle._id,
      plateNumber: vehicle.plateNumber,
      incidentAt: '2026-06-01T06:00:00.000Z', // 09:00 Hebron, 1 hr before start (summer offset +03:00)
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: vehicle.plateNumber,
        claimantPartyId,
        subjectRef,
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('COVERAGE_NOT_APPLICABLE');
    expect(res.body.errors[0].reason).toBe('BEFORE_POLICY_START');
  });

  // Test 6
  // C7: expiryDate: 2026-12-31T21:59:59.999Z (23:59:59.999 Asia/Hebron, winter offset +02:00)
  //     incidentAt: 2026-12-31T21:30:00.000Z (23:30 Asia/Hebron on expiry day, winter offset +02:00)
  it('6. accepts a sub-claim at 23:30 Asia/Hebron on the policy expiry day', async () => {
    const policy = await buildPolicy({
      organizationId: org._id,
      policyKind: 'COMPLEMENTARY',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      sumInsured: 50000,
      deductibleAmount: 500,
      startDate: new Date('2026-01-01T00:00:00.000Z'), // 02:00 Hebron, winter offset +02:00
      expiryDate: new Date('2026-12-31T21:59:59.999Z'), // 23:59:59.999 Hebron, winter offset +02:00
    });

    const vehicle = await Vehicle.create({
      organizationId: org._id,
      plateNumber: 'T6-PLATE',
      complementaryPolicyId: policy._id,
      customerId: customer._id,
    });

    const { incident, subjectRef, claimantPartyId } = await createTestIncident({
      vehicleId: vehicle._id,
      plateNumber: vehicle.plateNumber,
      incidentAt: '2026-12-31T21:30:00.000Z', // 23:30 Hebron on expiry day (winter offset +02:00)
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: vehicle.plateNumber,
        claimantPartyId,
        subjectRef,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  // Test 7
  // C7: expiryDate: 2026-12-31T21:59:59.999Z (23:59:59.999 Asia/Hebron, winter offset +02:00)
  //     incidentAt: 2027-01-01T00:30:00.000Z (02:30 Asia/Hebron on day after expiry, winter offset +02:00)
  it('7. rejects a sub-claim on the day after the expiry day with reason AFTER_POLICY_EXPIRY', async () => {
    const policy = await buildPolicy({
      organizationId: org._id,
      policyKind: 'COMPLEMENTARY',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      sumInsured: 50000,
      deductibleAmount: 500,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      expiryDate: new Date('2026-12-31T21:59:59.999Z'), // 23:59:59.999 Hebron, winter offset +02:00
    });

    const vehicle = await Vehicle.create({
      organizationId: org._id,
      plateNumber: 'T7-PLATE',
      complementaryPolicyId: policy._id,
      customerId: customer._id,
    });

    const { incident, subjectRef, claimantPartyId } = await createTestIncident({
      vehicleId: vehicle._id,
      plateNumber: vehicle.plateNumber,
      incidentAt: '2027-01-01T00:30:00.000Z', // 02:30 Hebron next day (winter offset +02:00)
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: vehicle.plateNumber,
        claimantPartyId,
        subjectRef,
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('COVERAGE_NOT_APPLICABLE');
    expect(res.body.errors[0].reason).toBe('AFTER_POLICY_EXPIRY');
  });

  // Test 8
  it('8. accepts an incident inside the period on a policy whose status is EXPIRED', async () => {
    const policy = await buildPolicy({
      organizationId: org._id,
      policyKind: 'COMPLEMENTARY',
      policyType: 'COMPREHENSIVE',
      status: 'EXPIRED',
      coveredPerils: ['COLLISION'],
      sumInsured: 50000,
      deductibleAmount: 500,
      startDate: new Date('2025-01-01T00:00:00Z'),
      expiryDate: new Date('2025-12-31T23:59:59Z'),
    });

    const vehicle = await Vehicle.create({
      organizationId: org._id,
      plateNumber: 'T8-PLATE',
      complementaryPolicyId: policy._id,
      customerId: customer._id,
    });

    const { incident, subjectRef, claimantPartyId } = await createTestIncident({
      vehicleId: vehicle._id,
      plateNumber: vehicle.plateNumber,
      incidentAt: '2025-06-15T10:00:00+03:00',
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: vehicle.plateNumber,
        claimantPartyId,
        subjectRef,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  // Test 9
  it('9. uses the day rule for a sub-claim on a legacy incident without incidentAt', async () => {
    const policy = await buildPolicy({
      organizationId: org._id,
      policyKind: 'COMPLEMENTARY',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      sumInsured: 50000,
      deductibleAmount: 500,
      startDate: new Date('2026-01-01T00:00:00Z'),
      expiryDate: new Date('2026-12-31T23:59:59Z'),
    });

    const vehicle = await Vehicle.create({
      organizationId: org._id,
      plateNumber: 'T9-PLATE',
      complementaryPolicyId: policy._id,
      customerId: customer._id,
    });

    const { incident, subjectRef, claimantPartyId } = await createTestIncident({
      vehicleId: vehicle._id,
      plateNumber: vehicle.plateNumber,
      incidentDate: '2026-06-15',
      isLegacy: true,
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: vehicle.plateNumber,
        claimantPartyId,
        subjectRef,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  // Test 10
  it('10. rejects legacy POST /claims on a UNIFIED_COMPULSORY policy with 422 COVERAGE_NOT_APPLICABLE', async () => {
    const policy = await buildPolicy({
      organizationId: org._id,
      policyKind: 'UNIFIED_COMPULSORY',
      propertyDamageLimit: 100000,
      deductibleAmount: 0,
      startDate: new Date('2026-01-01T00:00:00Z'),
      expiryDate: new Date('2026-12-31T23:59:59Z'),
    });

    await Vehicle.create({
      organizationId: org._id,
      plateNumber: 'T10-PLATE',
      compulsoryPolicyId: policy._id,
      customerId: customer._id,
    });

    const res = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyId: policy._id.toString(),
        plateNumber: 'T10-PLATE',
        incidentType: 'COLLISION',
        incidentLocation: 'Ramallah',
        incidentDate: '2026-06-15',
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('COVERAGE_NOT_APPLICABLE');
    expect(res.body.errors[0].reason).toBe('WRONG_POLICY_KIND');
  });

  // Test 11
  // C7: startDate: 2026-06-01T07:00:00.000Z (10:00 Asia/Hebron, day 2026-06-01, summer offset +03:00)
  //     incidentDate: '2026-05-31' (before start day in Asia/Hebron)
  it('11. rejects legacy POST /claims with an incidentDate before the policy start day', async () => {
    const policy = await buildPolicy({
      organizationId: org._id,
      policyKind: 'COMPLEMENTARY',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      sumInsured: 50000,
      deductibleAmount: 500,
      startDate: new Date('2026-06-01T07:00:00.000Z'), // 10:00 Hebron, day 2026-06-01 (summer offset +03:00)
      expiryDate: new Date('2026-12-31T21:59:59.999Z'), // 23:59:59 Hebron, winter offset +02:00
    });

    await Vehicle.create({
      organizationId: org._id,
      plateNumber: 'T11-PLATE',
      complementaryPolicyId: policy._id,
      customerId: customer._id,
    });

    const res = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyId: policy._id.toString(),
        plateNumber: 'T11-PLATE',
        incidentType: 'COLLISION',
        incidentLocation: 'Ramallah',
        incidentDate: '2026-05-31',
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('COVERAGE_NOT_APPLICABLE');
    expect(res.body.errors[0].reason).toBe('BEFORE_POLICY_START');
  });

  // Test 12
  // C7: startDate: 2026-06-01T07:00:00.000Z (10:00 Asia/Hebron, day 2026-06-01, summer offset +03:00)
  //     incidentDate: '2026-06-01' (on the start day in Asia/Hebron)
  it('12. accepts legacy POST /claims on the policy start day', async () => {
    const policy = await buildPolicy({
      organizationId: org._id,
      policyKind: 'COMPLEMENTARY',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      sumInsured: 50000,
      deductibleAmount: 500,
      startDate: new Date('2026-06-01T07:00:00.000Z'), // 10:00 Hebron, day 2026-06-01 (summer offset +03:00)
      expiryDate: new Date('2026-12-31T21:59:59.999Z'), // 23:59:59 Hebron, winter offset +02:00
    });

    await Vehicle.create({
      organizationId: org._id,
      plateNumber: 'T12-PLATE',
      complementaryPolicyId: policy._id,
      customerId: customer._id,
    });

    const res = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyId: policy._id.toString(),
        plateNumber: 'T12-PLATE',
        incidentType: 'COLLISION',
        incidentLocation: 'Ramallah',
        incidentDate: '2026-06-01',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  // Test 13
  it('13. returns POLICY_CANCELLED before any coverage check', async () => {
    const policy = await buildPolicy({
      organizationId: org._id,
      policyKind: 'UNIFIED_COMPULSORY',
      status: 'CANCELLED',
      propertyDamageLimit: 100000,
      deductibleAmount: 0,
      startDate: new Date('2026-01-01T00:00:00Z'),
      expiryDate: new Date('2026-12-31T23:59:59Z'),
    });

    const vehicle = await Vehicle.create({
      organizationId: org._id,
      plateNumber: 'T13-PLATE',
      compulsoryPolicyId: policy._id,
      customerId: customer._id,
    });

    const { incident, subjectRef, claimantPartyId } = await createTestIncident({
      vehicleId: vehicle._id,
      plateNumber: vehicle.plateNumber,
      incidentAt: '2026-06-15T12:00:00+03:00',
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: vehicle.plateNumber,
        claimantPartyId,
        subjectRef,
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('POLICY_CANCELLED');
    expect(res.body.errors[0].reason).toBeUndefined();
  });

  // Test 14
  it('14. returns 404 POLICY_NOT_FOUND for another organization\'s policy before any coverage check', async () => {
    const otherPolicy = await buildPolicy({
      organizationId: org2._id,
      policyKind: 'UNIFIED_COMPULSORY',
      propertyDamageLimit: 100000,
      deductibleAmount: 0,
    });

    const vehicle = await Vehicle.create({
      organizationId: org._id,
      plateNumber: 'T14-PLATE',
      customerId: customer._id,
    });

    const { incident, subjectRef, claimantPartyId } = await createTestIncident({
      vehicleId: vehicle._id,
      plateNumber: vehicle.plateNumber,
      incidentAt: '2026-06-15T12:00:00+03:00',
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: otherPolicy._id.toString(),
        plateNumber: vehicle.plateNumber,
        claimantPartyId,
        subjectRef,
      });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('POLICY_NOT_FOUND');
    expect(res.body.errors[0].reason).toBeUndefined();
  });

  // Test 15
  it('15. returns CLAIM_TYPE_NOT_SUPPORTED for THIRD_PARTY_PD before any coverage check', async () => {
    const { incident, subjectRef, claimantPartyId } = await createTestIncident({
      incidentAt: '2026-06-15T12:00:00+03:00',
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'THIRD_PARTY_PD',
        policyId: new mongoose.Types.ObjectId().toString(),
        plateNumber: 'COV-1111',
        claimantPartyId,
        subjectRef,
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('CLAIM_TYPE_NOT_SUPPORTED');
    expect(res.body.errors[0].reason).toBeUndefined();
  });

  // Test 16
  it('16. stores policyKind and sumInsured in coverageSnapshot', async () => {
    const policy = await buildPolicy({
      organizationId: org._id,
      policyKind: 'COMPLEMENTARY',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      sumInsured: 75000,
      deductibleAmount: 250,
      startDate: new Date('2026-01-01T00:00:00Z'),
      expiryDate: new Date('2026-12-31T23:59:59Z'),
    });

    const vehicle = await Vehicle.create({
      organizationId: org._id,
      plateNumber: 'T16-PLATE',
      complementaryPolicyId: policy._id,
      customerId: customer._id,
    });

    const { incident, subjectRef, claimantPartyId } = await createTestIncident({
      vehicleId: vehicle._id,
      plateNumber: vehicle.plateNumber,
      incidentAt: '2026-06-15T12:00:00+03:00',
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: vehicle.plateNumber,
        claimantPartyId,
        subjectRef,
      });

    expect(res.status).toBe(201);
    const claimDoc = await Claim.findById(res.body.data.id).lean();
    expect(claimDoc.coverageSnapshot).toMatchObject({
      policyKind: 'COMPLEMENTARY',
      sumInsured: 75000,
      policyType: 'COMPREHENSIVE',
      deductibleAmount: 250,
    });
  });

  // Test 17
  it('17. does not find a vehicle through compulsoryPolicyId for a COMPLEMENTARY policy and returns NO_VEHICLE_ON_POLICY', async () => {
    const compPolicy = await buildPolicy({
      organizationId: org._id,
      policyKind: 'COMPLEMENTARY',
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      sumInsured: 50000,
      deductibleAmount: 500,
      startDate: new Date('2026-01-01T00:00:00Z'),
      expiryDate: new Date('2026-12-31T23:59:59Z'),
    });

    // Linked vehicle only on compulsoryPolicyId
    const vehicle = await Vehicle.create({
      organizationId: org._id,
      plateNumber: 'T17-PLATE',
      compulsoryPolicyId: compPolicy._id,
      customerId: customer._id,
    });

    const { incident, subjectRef, claimantPartyId } = await createTestIncident({
      vehicleId: vehicle._id,
      plateNumber: vehicle.plateNumber,
      incidentAt: '2026-06-15T12:00:00+03:00',
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: compPolicy._id.toString(),
        plateNumber: vehicle.plateNumber,
        claimantPartyId,
        subjectRef,
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('NO_VEHICLE_ON_POLICY');
  });

  // Test 18
  it('18. rejects a UNIFIED_COMPULSORY policy with policyType or coveredPerils at model level', async () => {
    // UNIFIED_COMPULSORY with policyType
    await expect(
      Policy.create({
        organizationId: org._id,
        policyNumber: 'POL-T18-TYPE',
        policyKind: 'UNIFIED_COMPULSORY',
        policyType: 'COMPREHENSIVE',
        coveredPerils: [],
        propertyDamageLimit: 100000,
        deductibleAmount: 0,
        startDate: new Date('2026-01-01T00:00:00Z'),
        expiryDate: new Date('2026-12-31T23:59:59Z'),
      })
    ).rejects.toThrow();

    // UNIFIED_COMPULSORY with coveredPerils
    await expect(
      Policy.create({
        organizationId: org._id,
        policyNumber: 'POL-T18-PERIL',
        policyKind: 'UNIFIED_COMPULSORY',
        policyType: null,
        coveredPerils: ['COLLISION'],
        propertyDamageLimit: 100000,
        deductibleAmount: 0,
        startDate: new Date('2026-01-01T00:00:00Z'),
        expiryDate: new Date('2026-12-31T23:59:59Z'),
      })
    ).rejects.toThrow();
  });

  // Test 19
  it('19. rejects a COMPLEMENTARY policy without sumInsured and a UNIFIED_COMPULSORY policy without propertyDamageLimit at model level', async () => {
    // COMPLEMENTARY without sumInsured
    await expect(
      Policy.create({
        organizationId: org._id,
        policyNumber: 'POL-T19-NOSUM',
        policyKind: 'COMPLEMENTARY',
        policyType: 'COMPREHENSIVE',
        coveredPerils: ['COLLISION'],
        deductibleAmount: 500,
        startDate: new Date('2026-01-01T00:00:00Z'),
        expiryDate: new Date('2026-12-31T23:59:59Z'),
      })
    ).rejects.toThrow();

    // UNIFIED_COMPULSORY without propertyDamageLimit
    await expect(
      Policy.create({
        organizationId: org._id,
        policyNumber: 'POL-T19-NOLIMIT',
        policyKind: 'UNIFIED_COMPULSORY',
        policyType: null,
        coveredPerils: [],
        deductibleAmount: 0,
        startDate: new Date('2026-01-01T00:00:00Z'),
        expiryDate: new Date('2026-12-31T23:59:59Z'),
      })
    ).rejects.toThrow();
  });

  // Test 20
  it('20. keeps the error shape without reason for errors that carry none', async () => {
    const res = await request(app)
      .get('/api/v1/claims/000000000000000000000000')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
    expect(res.body.errors[0].reason).toBeUndefined();
    expect(Object.keys(res.body.errors[0]).sort()).toEqual(['code', 'details'].sort());
  });
});

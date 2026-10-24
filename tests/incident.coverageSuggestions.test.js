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
const Claim = require('../src/modules/claims/claim.model');
const Incident = require('../src/modules/incidents/incident.model');
const { buildPolicy } = require('./helpers/policyFactory');
const config = require('../src/config/env');

jest.mock('../src/modules/notifications/notification.service', () => ({
  createAndSendNotification: jest.fn().mockResolvedValue({}),
  sendToOrganization: jest.fn().mockResolvedValue({}),
}));

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
};

describe('PB-04b Incident Coverage Suggestions & accidentArea', () => {
  let mongoServer;
  let org, officer, officerToken, adjuster, adjusterToken;
  let otherOrg, otherOfficer, otherOfficerToken;
  let customer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany();
    }

    org = await Organization.create({ name: 'Test Org', code: 'TST', status: 'ACTIVE' });

    officer = await User.create({
      name: 'Test Officer',
      employeeCode: 'OF-TST-01',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    officerToken = generateToken(officer);

    adjuster = await User.create({
      name: 'Test Adjuster',
      employeeCode: 'ADJ-TST-01',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    adjusterToken = generateToken(adjuster);

    otherOrg = await Organization.create({ name: 'Other Org', code: 'OTH', status: 'ACTIVE' });
    otherOfficer = await User.create({
      name: 'Other Officer',
      employeeCode: 'OF-OTH-01',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: otherOrg._id,
      status: 'ACTIVE',
    });
    otherOfficerToken = generateToken(otherOfficer);

    customer = await Customer.create({
      fullName: 'Ahmad Customer',
      phone: '0599123456',
      organizationId: org._id,
    });
  });

  const validIncidentPayload = (overrides = {}) => ({
    incidentType: 'COLLISION',
    incidentLocation: 'Ramallah Main St',
    incidentAt: '2026-06-15T10:00:00+03:00',
    governorate: 'RAMALLAH_AL_BIREH',
    reportSource: 'NONE',
    injuriesReported: false,
    description: 'Two vehicle collision',
    vehicles: [
      {
        vehicleRole: 'INSURED',
        plateRegion: 'PALESTINIAN',
        plateNumber: '1234-A',
      },
    ],
    parties: [
      {
        role: 'POLICYHOLDER',
        fullName: 'Ahmad Customer',
        vehicleIndex: 0,
      },
    ],
    ...overrides,
  });

  // 1. returns ALLOWED OWN_DAMAGE with valid complementary policy and eligible claimant, and populates claimantPartyIds
  it('1. returns ALLOWED OWN_DAMAGE with valid complementary policy and eligible claimant, and populates claimantPartyIds', async () => {
    const compPolicy = await buildPolicy({
      policyNumber: 'POL-COMPL-001',
      policyKind: 'COMPLEMENTARY',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2026-01-01'),
      expiryDate: new Date('2026-12-31'),
    });

    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      make: 'Toyota',
      model: 'Corolla',
      year: 2022,
      organizationId: org._id,
      customerId: customer._id,
      complementaryPolicyId: compPolicy._id,
    });

    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
        })
      );
    expect(incRes.status).toBe(201);
    const incidentId = incRes.body.data.id;
    const vehicleRef = incRes.body.data.vehicles[0].id;
    const partyId = incRes.body.data.parties[0].id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.incidentId).toBe(incidentId);
    expect(data.vehicles).toHaveLength(1);

    const v = data.vehicles[0];
    expect(v.vehicleRef).toBe(vehicleRef);
    expect(v.vehicleId).toBe(veh._id.toString());
    expect(v.inOurBook).toBe(true);
    expect(v.policies.complementary).toEqual({
      id: compPolicy._id.toString(),
      policyNumber: compPolicy.policyNumber,
      policyKind: 'COMPLEMENTARY',
      status: 'ACTIVE',
      check: 'VALID',
    });

    const ownDamage = v.suggestions.find((s) => s.claimType === 'OWN_DAMAGE');
    expect(ownDamage).toBeDefined();
    expect(ownDamage.result).toBe('ALLOWED');
    expect(ownDamage.reason).toBeNull();
    expect(ownDamage.policyId).toBe(compPolicy._id.toString());
    expect(ownDamage.claimantPartyIds).toEqual([partyId]);
    expect(ownDamage.warnings).toEqual([]);
  });

  // 2. returns NOT_APPLICABLE with reason NOT_IN_OUR_BOOK for INSURED vehicle without vehicleId or belonging to another organization
  it('2. returns NOT_APPLICABLE with reason NOT_IN_OUR_BOOK for INSURED vehicle without vehicleId or belonging to another organization', async () => {
    const otherVeh = await Vehicle.create({
      plateNumber: 'OTH-999',
      make: 'Ford',
      organizationId: otherOrg._id,
    });

    const incident = await Incident.create({
      organizationId: org._id,
      incidentDate: '2026-06-15',
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      createdBy: officer._id,
      vehicles: [
        {
          _id: new mongoose.Types.ObjectId(),
          vehicleRole: 'INSURED',
          plateRegion: 'PALESTINIAN',
          plateNumber: 'NO-ID-1',
          vehicleId: null,
        },
        {
          _id: new mongoose.Types.ObjectId(),
          vehicleRole: 'INSURED',
          plateRegion: 'PALESTINIAN',
          plateNumber: 'CROSS-ORG-1',
          vehicleId: otherVeh._id,
        },
      ],
      parties: [],
    });

    const res = await request(app)
      .get(`/api/v1/incidents/${incident._id}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const v1 = res.body.data.vehicles[0];
    expect(v1.inOurBook).toBe(false);
    expect(v1.policies.compulsory).toBeNull();
    expect(v1.policies.complementary).toBeNull();
    expect(v1.suggestions).toEqual([
      {
        claimType: 'OWN_DAMAGE',
        result: 'NOT_APPLICABLE',
        reason: 'NOT_IN_OUR_BOOK',
        policyId: null,
        claimantPartyIds: [],
        warnings: [],
      },
    ]);
    expect(v1.bodilyInjury.cover).toBe('OUTSIDE_OUR_BOOK');

    const v2 = res.body.data.vehicles[1];
    expect(v2.inOurBook).toBe(false);
    expect(v2.policies.compulsory).toBeNull();
    expect(v2.policies.complementary).toBeNull();
    expect(v2.suggestions).toEqual([
      {
        claimType: 'OWN_DAMAGE',
        result: 'NOT_APPLICABLE',
        reason: 'NOT_IN_OUR_BOOK',
        policyId: null,
        claimantPartyIds: [],
        warnings: [],
      },
    ]);
    expect(v2.bodilyInjury.cover).toBe('OUTSIDE_OUR_BOOK');
  });

  // 3. returns NOT_APPLICABLE with reason NO_COMPLEMENTARY_POLICY when complementaryPolicyId is null
  it('3. returns NOT_APPLICABLE with reason NO_COMPLEMENTARY_POLICY when complementaryPolicyId is null', async () => {
    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      organizationId: org._id,
      customerId: customer._id,
      complementaryPolicyId: null,
    });

    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const v = res.body.data.vehicles[0];
    expect(v.inOurBook).toBe(true);
    expect(v.policies.complementary).toBeNull();
    const ownDamage = v.suggestions.find((s) => s.claimType === 'OWN_DAMAGE');
    expect(ownDamage.result).toBe('NOT_APPLICABLE');
    expect(ownDamage.reason).toBe('NO_COMPLEMENTARY_POLICY');
    expect(ownDamage.policyId).toBeNull();
  });

  // 4. returns NOT_APPLICABLE with reason POLICY_NOT_FOUND when complementaryPolicyId does not exist in tenant org and sets slot check POLICY_NOT_FOUND
  it('4. returns NOT_APPLICABLE with reason POLICY_NOT_FOUND when complementaryPolicyId does not exist in tenant org and sets slot check POLICY_NOT_FOUND', async () => {
    const fakePolicyId = new mongoose.Types.ObjectId();
    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      organizationId: org._id,
      customerId: customer._id,
      complementaryPolicyId: fakePolicyId,
    });

    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const v = res.body.data.vehicles[0];
    expect(v.policies.complementary).toEqual({
      id: fakePolicyId.toString(),
      policyNumber: null,
      policyKind: null,
      status: null,
      check: 'POLICY_NOT_FOUND',
    });
    const ownDamage = v.suggestions.find((s) => s.claimType === 'OWN_DAMAGE');
    expect(ownDamage.result).toBe('NOT_APPLICABLE');
    expect(ownDamage.reason).toBe('POLICY_NOT_FOUND');
    expect(ownDamage.policyId).toBe(fakePolicyId.toString());
  });

  // 5. returns NOT_APPLICABLE with reason POLICY_CANCELLED when complementary policy status is CANCELLED
  it('5. returns NOT_APPLICABLE with reason POLICY_CANCELLED when complementary policy status is CANCELLED', async () => {
    const policy = await buildPolicy({
      policyNumber: 'POL-CANCEL-001',
      policyKind: 'COMPLEMENTARY',
      status: 'CANCELLED',
      organizationId: org._id,
      startDate: new Date('2026-01-01'),
      expiryDate: new Date('2026-12-31'),
    });

    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      organizationId: org._id,
      customerId: customer._id,
      complementaryPolicyId: policy._id,
    });

    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const v = res.body.data.vehicles[0];
    expect(v.policies.complementary.check).toBe('POLICY_CANCELLED');
    const ownDamage = v.suggestions.find((s) => s.claimType === 'OWN_DAMAGE');
    expect(ownDamage.result).toBe('NOT_APPLICABLE');
    expect(ownDamage.reason).toBe('POLICY_CANCELLED');
  });

  // 6. returns NOT_APPLICABLE with reason POLICY_KIND_MISSING when complementary policy has no policyKind
  it('6. returns NOT_APPLICABLE with reason POLICY_KIND_MISSING when complementary policy has no policyKind', async () => {
    const rawPolicyId = new mongoose.Types.ObjectId();
    await Policy.collection.insertOne({
      _id: rawPolicyId,
      policyNumber: 'POL-NO-KIND',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2026-01-01'),
      expiryDate: new Date('2026-12-31'),
    });

    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      organizationId: org._id,
      customerId: customer._id,
      complementaryPolicyId: rawPolicyId,
    });

    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const v = res.body.data.vehicles[0];
    expect(v.policies.complementary.check).toBe('POLICY_KIND_MISSING');
    const ownDamage = v.suggestions.find((s) => s.claimType === 'OWN_DAMAGE');
    expect(ownDamage.result).toBe('NOT_APPLICABLE');
    expect(ownDamage.reason).toBe('POLICY_KIND_MISSING');
  });

  // 7. returns NOT_APPLICABLE with reason BEFORE_POLICY_START when incident is before policy startDate
  it('7. returns NOT_APPLICABLE with reason BEFORE_POLICY_START when incident is before policy startDate', async () => {
    const policy = await buildPolicy({
      policyNumber: 'POL-FUTURE-START',
      policyKind: 'COMPLEMENTARY',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2026-08-01'),
      expiryDate: new Date('2027-08-01'),
    });

    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      organizationId: org._id,
      customerId: customer._id,
      complementaryPolicyId: policy._id,
    });

    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          incidentAt: '2026-06-15T10:00:00+03:00',
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const v = res.body.data.vehicles[0];
    expect(v.policies.complementary.check).toBe('BEFORE_POLICY_START');
    const ownDamage = v.suggestions.find((s) => s.claimType === 'OWN_DAMAGE');
    expect(ownDamage.result).toBe('NOT_APPLICABLE');
    expect(ownDamage.reason).toBe('BEFORE_POLICY_START');
  });

  // 8. returns NOT_APPLICABLE with reason AFTER_POLICY_EXPIRY when incident is after policy expiryDate
  it('8. returns NOT_APPLICABLE with reason AFTER_POLICY_EXPIRY when incident is after policy expiryDate', async () => {
    const policy = await buildPolicy({
      policyNumber: 'POL-PAST-EXPIRY',
      policyKind: 'COMPLEMENTARY',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2025-01-01'),
      expiryDate: new Date('2026-01-01'),
    });

    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      organizationId: org._id,
      customerId: customer._id,
      complementaryPolicyId: policy._id,
    });

    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          incidentAt: '2026-06-15T10:00:00+03:00',
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const v = res.body.data.vehicles[0];
    expect(v.policies.complementary.check).toBe('AFTER_POLICY_EXPIRY');
    const ownDamage = v.suggestions.find((s) => s.claimType === 'OWN_DAMAGE');
    expect(ownDamage.result).toBe('NOT_APPLICABLE');
    expect(ownDamage.reason).toBe('AFTER_POLICY_EXPIRY');
  });

  // 9. returns BLOCKED with reason NO_ELIGIBLE_CLAIMANT when no POLICYHOLDER/AUTHORIZED_REPRESENTATIVE links to vehicleRef
  it('9. returns BLOCKED with reason NO_ELIGIBLE_CLAIMANT when no POLICYHOLDER/AUTHORIZED_REPRESENTATIVE links to vehicleRef', async () => {
    const compPolicy = await buildPolicy({
      policyNumber: 'POL-VALID-001',
      policyKind: 'COMPLEMENTARY',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2026-01-01'),
      expiryDate: new Date('2026-12-31'),
    });

    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      organizationId: org._id,
      customerId: customer._id,
      complementaryPolicyId: compPolicy._id,
    });

    // Party is only INSURED_DRIVER, not POLICYHOLDER or AUTHORIZED_REPRESENTATIVE
    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
          parties: [
            {
              role: 'INSURED_DRIVER',
              fullName: 'Just Driver',
              vehicleIndex: 0,
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const ownDamage = res.body.data.vehicles[0].suggestions.find((s) => s.claimType === 'OWN_DAMAGE');
    expect(ownDamage.result).toBe('BLOCKED');
    expect(ownDamage.reason).toBe('NO_ELIGIBLE_CLAIMANT');
    expect(ownDamage.claimantPartyIds).toEqual([]);
  });

  // 10. returns ALREADY_OPEN with reason DUPLICATE_SUB_CLAIM when OWN_DAMAGE claim already exists for vehicleId in this incident
  it('10. returns ALREADY_OPEN with reason DUPLICATE_SUB_CLAIM when OWN_DAMAGE claim already exists for vehicleId in this incident', async () => {
    const compPolicy = await buildPolicy({
      policyNumber: 'POL-COMPL-DUPE',
      policyKind: 'COMPLEMENTARY',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2026-01-01'),
      expiryDate: new Date('2026-12-31'),
    });

    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      organizationId: org._id,
      customerId: customer._id,
      complementaryPolicyId: compPolicy._id,
    });

    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;
    const vehicleRef = incRes.body.data.vehicles[0].id;
    const claimantPartyId = incRes.body.data.parties[0].id;

    // Open one claim
    const subRes = await request(app)
      .post(`/api/v1/incidents/${incidentId}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: compPolicy._id.toString(),
        claimantPartyId,
        subjectRef: vehicleRef,
      });
    expect(subRes.status).toBe(201);

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const ownDamage = res.body.data.vehicles[0].suggestions.find((s) => s.claimType === 'OWN_DAMAGE');
    expect(ownDamage.result).toBe('ALREADY_OPEN');
    expect(ownDamage.reason).toBe('DUPLICATE_SUB_CLAIM');
  });

  // 11. Gate Consistency: ALLOWED suggestion succeeds on POST /incidents/:incidentId/claims with 201
  it('11. Gate Consistency: ALLOWED suggestion succeeds on POST /incidents/:incidentId/claims with 201', async () => {
    const compPolicy = await buildPolicy({
      policyNumber: 'POL-ALLOWED-CONSISTENCY',
      policyKind: 'COMPLEMENTARY',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2026-01-01'),
      expiryDate: new Date('2026-12-31'),
    });

    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      organizationId: org._id,
      customerId: customer._id,
      complementaryPolicyId: compPolicy._id,
    });

    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;

    const suggRes = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(suggRes.status).toBe(200);

    const vSugg = suggRes.body.data.vehicles[0];
    const ownDamage = vSugg.suggestions.find((s) => s.claimType === 'OWN_DAMAGE');
    expect(ownDamage.result).toBe('ALLOWED');

    const postClaimRes = await request(app)
      .post(`/api/v1/incidents/${incidentId}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: ownDamage.policyId,
        claimantPartyId: ownDamage.claimantPartyIds[0],
        subjectRef: vSugg.vehicleRef,
      });

    expect(postClaimRes.status).toBe(201);
    expect(postClaimRes.body.data.claimType).toBe('OWN_DAMAGE');
  });

  // 12. Gate Consistency: NOT_APPLICABLE suggestion fails on POST /incidents/:incidentId/claims with 422 and matching reason
  it('12. Gate Consistency: NOT_APPLICABLE suggestion fails on POST /incidents/:incidentId/claims with 422 and matching reason', async () => {
    const policy = await buildPolicy({
      policyNumber: 'POL-BEFORE-START',
      policyKind: 'COMPLEMENTARY',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2026-09-01'),
      expiryDate: new Date('2027-09-01'),
    });

    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      organizationId: org._id,
      customerId: customer._id,
      complementaryPolicyId: policy._id,
    });

    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          incidentAt: '2026-06-15T10:00:00+03:00',
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;

    const suggRes = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(suggRes.status).toBe(200);

    const vSugg = suggRes.body.data.vehicles[0];
    const ownDamage = vSugg.suggestions.find((s) => s.claimType === 'OWN_DAMAGE');
    expect(ownDamage.result).toBe('NOT_APPLICABLE');
    expect(ownDamage.reason).toBe('BEFORE_POLICY_START');

    const postRes = await request(app)
      .post(`/api/v1/incidents/${incidentId}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: ownDamage.policyId,
        claimantPartyId: incRes.body.data.parties[0].id,
        subjectRef: vSugg.vehicleRef,
      });

    expect(postRes.status).toBe(422);
    expect(postRes.body.errors[0].code).toBe('COVERAGE_NOT_APPLICABLE');
    expect(postRes.body.errors[0].reason).toBe(ownDamage.reason);
  });

  // 13. returns THIRD_PARTY_PD entry with result NOT_SUPPORTED, reason CLAIM_TYPE_NOT_SUPPORTED, and dependsOnLiability true
  it('13. returns THIRD_PARTY_PD entry with result NOT_SUPPORTED, reason CLAIM_TYPE_NOT_SUPPORTED, and dependsOnLiability true', async () => {
    const compPolicy = await buildPolicy({
      policyNumber: 'POL-COMPL-TPPD',
      policyKind: 'COMPLEMENTARY',
      organizationId: org._id,
    });
    const compulsoryPolicy = await buildPolicy({
      policyNumber: 'POL-COMPULSORY-TPPD',
      policyKind: 'UNIFIED_COMPULSORY',
      organizationId: org._id,
    });

    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      organizationId: org._id,
      customerId: customer._id,
      complementaryPolicyId: compPolicy._id,
      compulsoryPolicyId: compulsoryPolicy._id,
    });

    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const tppd = res.body.data.vehicles[0].suggestions.find((s) => s.claimType === 'THIRD_PARTY_PD');
    expect(tppd).toEqual({
      claimType: 'THIRD_PARTY_PD',
      result: 'NOT_SUPPORTED',
      reason: 'CLAIM_TYPE_NOT_SUPPORTED',
      policyId: compulsoryPolicy._id.toString(),
      dependsOnLiability: true,
    });
  });

  // 14. returns bodilyInjury OUR_COMPULSORY when compulsory policy slot is valid, fundMayApply false
  it('14. returns bodilyInjury OUR_COMPULSORY when compulsory policy slot is valid, fundMayApply false', async () => {
    const compulsoryPolicy = await buildPolicy({
      policyNumber: 'POL-COMPULSORY-VALID',
      policyKind: 'UNIFIED_COMPULSORY',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2026-01-01'),
      expiryDate: new Date('2026-12-31'),
    });

    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      organizationId: org._id,
      customerId: customer._id,
      compulsoryPolicyId: compulsoryPolicy._id,
    });

    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const bi = res.body.data.vehicles[0].bodilyInjury;
    expect(bi).toEqual({
      cover: 'OUR_COMPULSORY',
      policyId: compulsoryPolicy._id.toString(),
      dependsOnFault: false,
      fundMayApply: false,
    });
  });

  // 15. returns bodilyInjury OUR_COMPULSORY_NOT_VALID when compulsory policy check fails, fundMayApply true
  it('15. returns bodilyInjury OUR_COMPULSORY_NOT_VALID when compulsory policy check fails, fundMayApply true', async () => {
    const compulsoryPolicy = await buildPolicy({
      policyNumber: 'POL-COMPULSORY-CANCELLED',
      policyKind: 'UNIFIED_COMPULSORY',
      status: 'CANCELLED',
      organizationId: org._id,
      startDate: new Date('2026-01-01'),
      expiryDate: new Date('2026-12-31'),
    });

    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      organizationId: org._id,
      customerId: customer._id,
      compulsoryPolicyId: compulsoryPolicy._id,
    });

    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const bi = res.body.data.vehicles[0].bodilyInjury;
    expect(bi).toEqual({
      cover: 'OUR_COMPULSORY_NOT_VALID',
      policyId: compulsoryPolicy._id.toString(),
      dependsOnFault: false,
      fundMayApply: true,
    });
  });

  // 16. returns bodilyInjury NO_COMPULSORY_WITH_US when vehicle in our book has no compulsoryPolicyId, fundMayApply false
  it('16. returns bodilyInjury NO_COMPULSORY_WITH_US when vehicle in our book has no compulsoryPolicyId, fundMayApply false', async () => {
    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      organizationId: org._id,
      customerId: customer._id,
      compulsoryPolicyId: null,
    });

    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const bi = res.body.data.vehicles[0].bodilyInjury;
    expect(bi).toEqual({
      cover: 'NO_COMPULSORY_WITH_US',
      policyId: null,
      dependsOnFault: false,
      fundMayApply: false,
    });
  });

  // 17. returns bodilyInjury OUTSIDE_OUR_BOOK for THIRD_PARTY or OTHER vehicle, fundMayApply false
  it('17. returns bodilyInjury OUTSIDE_OUR_BOOK for THIRD_PARTY or OTHER vehicle, fundMayApply false', async () => {
    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          vehicles: [
            {
              vehicleRole: 'THIRD_PARTY',
              plateRegion: 'PALESTINIAN',
              plateNumber: 'TP-100',
            },
          ],
          parties: [
            {
              role: 'THIRD_PARTY_DRIVER',
              fullName: 'TP Driver',
              vehicleIndex: 0,
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const v = res.body.data.vehicles[0];
    expect(v.inOurBook).toBe(false);
    expect(v.suggestions).toEqual([]);
    expect(v.bodilyInjury).toEqual({
      cover: 'OUTSIDE_OUR_BOOK',
      policyId: null,
      dependsOnFault: false,
      fundMayApply: false,
    });
  });

  // 18. flags ACCIDENT_IN_ISRAEL when accidentArea is ISRAEL with Paris Protocol explanation
  it('18. flags ACCIDENT_IN_ISRAEL when accidentArea is ISRAEL with Paris Protocol explanation', async () => {
    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validIncidentPayload({ accidentArea: 'ISRAEL' }));
    const incidentId = incRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const flag = res.body.data.flags.find((f) => f.code === 'ACCIDENT_IN_ISRAEL');
    expect(flag).toBeDefined();
    expect(flag.details).toMatch(/Paris Protocol/);
  });

  // 19. flags ACCIDENT_AREA_UNKNOWN when accidentArea is null or UNKNOWN
  it('19. flags ACCIDENT_AREA_UNKNOWN when accidentArea is null or UNKNOWN', async () => {
    const incRes1 = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validIncidentPayload({ accidentArea: null }));

    const res1 = await request(app)
      .get(`/api/v1/incidents/${incRes1.body.data.id}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(res1.body.data.flags.some((f) => f.code === 'ACCIDENT_AREA_UNKNOWN')).toBe(true);

    const incRes2 = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validIncidentPayload({ accidentArea: 'UNKNOWN' }));

    const res2 = await request(app)
      .get(`/api/v1/incidents/${incRes2.body.data.id}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(res2.body.data.flags.some((f) => f.code === 'ACCIDENT_AREA_UNKNOWN')).toBe(true);
  });

  // 20. flags JERUSALEM_COVERAGE_UNCONFIRMED when governorate is JERUSALEM
  it('20. flags JERUSALEM_COVERAGE_UNCONFIRMED when governorate is JERUSALEM', async () => {
    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validIncidentPayload({ governorate: 'JERUSALEM', accidentArea: 'PALESTINIAN_AREA' }));

    const res = await request(app)
      .get(`/api/v1/incidents/${incRes.body.data.id}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const flag = res.body.data.flags.find((f) => f.code === 'JERUSALEM_COVERAGE_UNCONFIRMED');
    expect(flag).toBeDefined();
    expect(typeof flag.details).toBe('string');
  });

  // 21. flags ISRAELI_VEHICLE_INVOLVED when any vehicle has plateRegion ISRAELI
  it('21. flags ISRAELI_VEHICLE_INVOLVED when any vehicle has plateRegion ISRAELI', async () => {
    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          accidentArea: 'PALESTINIAN_AREA',
          vehicles: [
            {
              vehicleRole: 'THIRD_PARTY',
              plateRegion: 'ISRAELI',
              plateNumber: 'IL-1234',
            },
          ],
          parties: [
            {
              role: 'THIRD_PARTY_DRIVER',
              fullName: 'Israeli Plate Driver',
              vehicleIndex: 0,
            },
          ],
        })
      );

    const res = await request(app)
      .get(`/api/v1/incidents/${incRes.body.data.id}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const flag = res.body.data.flags.find((f) => f.code === 'ISRAELI_VEHICLE_INVOLVED');
    expect(flag).toBeDefined();
    expect(typeof flag.details).toBe('string');
  });

  // 22. returns empty flags array when no conditions are triggered
  it('22. returns empty flags array when no conditions are triggered', async () => {
    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          accidentArea: 'PALESTINIAN_AREA',
          governorate: 'RAMALLAH_AL_BIREH',
          vehicles: [
            {
              vehicleRole: 'THIRD_PARTY',
              plateRegion: 'PALESTINIAN',
              plateNumber: 'TP-1234',
            },
          ],
          parties: [
            {
              role: 'THIRD_PARTY_DRIVER',
              fullName: 'Pal Driver',
              vehicleIndex: 0,
            },
          ],
        })
      );

    const res = await request(app)
      .get(`/api/v1/incidents/${incRes.body.data.id}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.flags).toEqual([]);
  });

  // 23. adds COMPLEMENTARY_TERRITORY_CHECK warning when accidentArea is ISRAEL while OWN_DAMAGE result remains ALLOWED
  it('23. adds COMPLEMENTARY_TERRITORY_CHECK warning when accidentArea is ISRAEL while OWN_DAMAGE result remains ALLOWED', async () => {
    const compPolicy = await buildPolicy({
      policyNumber: 'POL-TERRITORY-TEST',
      policyKind: 'COMPLEMENTARY',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2026-01-01'),
      expiryDate: new Date('2026-12-31'),
    });

    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      organizationId: org._id,
      customerId: customer._id,
      complementaryPolicyId: compPolicy._id,
    });

    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          accidentArea: 'ISRAEL',
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const ownDamage = res.body.data.vehicles[0].suggestions.find((s) => s.claimType === 'OWN_DAMAGE');
    expect(ownDamage.result).toBe('ALLOWED');
    expect(ownDamage.warnings).toContain('COMPLEMENTARY_TERRITORY_CHECK');
  });

  // 24. handles legacy incident (POST /claims): returns vehicles empty array and ACCIDENT_AREA_UNKNOWN flag
  it('24. handles legacy incident (POST /claims): returns vehicles empty array and ACCIDENT_AREA_UNKNOWN flag', async () => {
    const policy = await buildPolicy({
      policyNumber: 'POL-LEGACY-INC',
      organizationId: org._id,
    });
    await Vehicle.create({
      plateNumber: 'LEG-100',
      organizationId: org._id,
      customerId: customer._id,
      complementaryPolicyId: policy._id,
    });

    const claimRes = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyId: policy._id.toString(),
        plateNumber: 'LEG-100',
        incidentType: 'COLLISION',
        incidentLocation: 'Old Road',
        incidentDate: '2026-06-15',
      });

    const incidentId = claimRes.body.data.incidentId;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.vehicles).toEqual([]);
    expect(res.body.data.accidentArea).toBeNull();
    expect(res.body.data.flags.some((f) => f.code === 'ACCIDENT_AREA_UNKNOWN')).toBe(true);
  });

  // 25. returns 404 INCIDENT_NOT_FOUND when requesting another organization's incident
  it('25. returns 404 INCIDENT_NOT_FOUND when requesting another organization\'s incident', async () => {
    const otherIncident = await Incident.create({
      organizationId: otherOrg._id,
      incidentDate: '2026-06-15',
      incidentType: 'COLLISION',
      incidentLocation: 'Other Location',
      createdBy: otherOfficer._id,
    });

    const res = await request(app)
      .get(`/api/v1/incidents/${otherIncident._id}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('INCIDENT_NOT_FOUND');
  });

  // 26. returns 403 Forbidden for FIELD_ADJUSTER role
  it('26. returns 403 Forbidden for FIELD_ADJUSTER role', async () => {
    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validIncidentPayload());
    const incidentId = incRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${adjusterToken}`);

    expect(res.status).toBe(403);
  });

  // 27. POST /incidents stores and returns accidentArea when provided, defaults to null when absent
  it('27. POST /incidents stores and returns accidentArea when provided, defaults to null when absent', async () => {
    const resWith = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validIncidentPayload({ accidentArea: 'PALESTINIAN_AREA' }));
    expect(resWith.status).toBe(201);
    expect(resWith.body.data.accidentArea).toBe('PALESTINIAN_AREA');

    const resWithout = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validIncidentPayload());
    expect(resWithout.status).toBe(201);
    expect(resWithout.body.data.accidentArea).toBeNull();
  });

  // 28. GET /incidents/:incidentId includes accidentArea
  it('28. GET /incidents/:incidentId includes accidentArea', async () => {
    const resCreate = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validIncidentPayload({ accidentArea: 'ISRAEL' }));
    const incidentId = resCreate.body.data.id;

    const resGet = await request(app)
      .get(`/api/v1/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(resGet.status).toBe(200);
    expect(resGet.body.data.accidentArea).toBe('ISRAEL');
  });

  // 29. PATCH /incidents/:incidentId/report fills accidentArea from null or UNKNOWN to PALESTINIAN_AREA or ISRAEL
  it('29. PATCH /incidents/:incidentId/report fills accidentArea from null or UNKNOWN to PALESTINIAN_AREA or ISRAEL', async () => {
    const inc1 = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validIncidentPayload({ accidentArea: null }));
    const patch1 = await request(app)
      .patch(`/api/v1/incidents/${inc1.body.data.id}/report`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ accidentArea: 'PALESTINIAN_AREA' });
    expect(patch1.status).toBe(200);
    expect(patch1.body.data.accidentArea).toBe('PALESTINIAN_AREA');

    const inc2 = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validIncidentPayload({ accidentArea: 'UNKNOWN' }));
    const patch2 = await request(app)
      .patch(`/api/v1/incidents/${inc2.body.data.id}/report`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ accidentArea: 'ISRAEL' });
    expect(patch2.status).toBe(200);
    expect(patch2.body.data.accidentArea).toBe('ISRAEL');
  });

  // 30. PATCH report returns 409 REPORT_FIELD_ALREADY_SET when accidentArea is already set to PALESTINIAN_AREA or ISRAEL
  it('30. PATCH report returns 409 REPORT_FIELD_ALREADY_SET when accidentArea is already set to PALESTINIAN_AREA or ISRAEL', async () => {
    const inc = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validIncidentPayload({ accidentArea: 'PALESTINIAN_AREA' }));
    const incidentId = inc.body.data.id;

    const res = await request(app)
      .patch(`/api/v1/incidents/${incidentId}/report`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ accidentArea: 'ISRAEL' });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('REPORT_FIELD_ALREADY_SET');
  });

  // 31. PATCH report returns 400 VALIDATION_ERROR when accidentArea is UNKNOWN
  it('31. PATCH report returns 400 VALIDATION_ERROR when accidentArea is UNKNOWN', async () => {
    const inc = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validIncidentPayload({ accidentArea: null }));
    const incidentId = inc.body.data.id;

    const res = await request(app)
      .patch(`/api/v1/incidents/${incidentId}/report`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ accidentArea: 'UNKNOWN' });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 32. PII Safety: coverage suggestions response never leaks party idNumber, phone, nationalId or personal data
  it('32. PII Safety: coverage suggestions response never leaks party idNumber, phone, nationalId or personal data', async () => {
    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          parties: [
            {
              role: 'POLICYHOLDER',
              fullName: 'Ahmad Customer',
              idType: 'PALESTINIAN_ID',
              idNumber: '123456789',
              phone: '0599123456',
              vehicleIndex: 0,
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('123456789');
    expect(text).not.toContain('0599123456');
    expect(text).not.toContain('Ahmad Customer');
    expect(text).not.toContain('nationalId');
  });

  // 33. ALREADY_OPEN suggestion matches 409 DUPLICATE_SUB_CLAIM on POST
  it('33. ALREADY_OPEN suggestion matches 409 DUPLICATE_SUB_CLAIM on POST', async () => {
    const compPolicy = await buildPolicy({
      policyNumber: 'POL-DUP-MATCH',
      policyKind: 'COMPLEMENTARY',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2026-01-01'),
      expiryDate: new Date('2026-12-31'),
    });

    const veh = await Vehicle.create({
      plateNumber: '1234-A',
      organizationId: org._id,
      customerId: customer._id,
      complementaryPolicyId: compPolicy._id,
    });

    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validIncidentPayload({
          vehicles: [
            {
              vehicleRole: 'INSURED',
              plateRegion: 'PALESTINIAN',
              plateNumber: '1234-A',
              vehicleId: veh._id.toString(),
            },
          ],
        })
      );
    const incidentId = incRes.body.data.id;
    const vehicleRef = incRes.body.data.vehicles[0].id;
    const claimantPartyId = incRes.body.data.parties[0].id;

    // First POST succeeds
    const post1 = await request(app)
      .post(`/api/v1/incidents/${incidentId}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: compPolicy._id.toString(),
        claimantPartyId,
        subjectRef: vehicleRef,
      });
    expect(post1.status).toBe(201);

    // Read suggestion -> ALREADY_OPEN
    const suggRes = await request(app)
      .get(`/api/v1/incidents/${incidentId}/coverage-suggestions`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(suggRes.status).toBe(200);
    const ownDamage = suggRes.body.data.vehicles[0].suggestions.find((s) => s.claimType === 'OWN_DAMAGE');
    expect(ownDamage.result).toBe('ALREADY_OPEN');

    // Second POST gives 409 DUPLICATE_SUB_CLAIM
    const post2 = await request(app)
      .post(`/api/v1/incidents/${incidentId}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: compPolicy._id.toString(),
        claimantPartyId,
        subjectRef: vehicleRef,
      });
    expect(post2.status).toBe(409);
    expect(post2.body.errors[0].code).toBe('DUPLICATE_SUB_CLAIM');
  });

  // 34. concurrent PATCH report of accidentArea gives one 200 and one 409
  it('34. concurrent PATCH report of accidentArea gives one 200 and one 409', async () => {
    const incRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validIncidentPayload({ accidentArea: null }));
    const incidentId = incRes.body.data.id;

    const patchReq = (area) =>
      request(app)
        .patch(`/api/v1/incidents/${incidentId}/report`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ accidentArea: area });

    const [resA, resB] = await Promise.all([
      patchReq('PALESTINIAN_AREA'),
      patchReq('ISRAEL'),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const conflictRes = resA.status === 409 ? resA : resB;
    expect(conflictRes.body.errors[0].code).toBe('REPORT_FIELD_ALREADY_SET');

    const doc = await Incident.findById(incidentId).lean();
    expect(['PALESTINIAN_AREA', 'ISRAEL']).toContain(doc.accidentArea);
  });
});

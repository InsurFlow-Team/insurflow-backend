const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Customer = require('../src/modules/customers/customer.model');
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

describe('PB-02a Incident Parties, Vehicles, Report Source and Damaged Items', () => {
  let mongoServer;
  let org, officer, officerToken, adjuster, adjusterToken;
  let otherOrg, otherOfficer, otherOfficerToken;
  let policy, customer, insuredVehicle;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

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

  const setupBaseFixture = async () => {
    org = await Organization.create({ name: 'Test Org', code: 'TST', status: 'ACTIVE' });

    officer = await User.create({
      name: 'Officer User',
      employeeCode: 'OF-TST-01',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    officerToken = generateToken(officer);

    adjuster = await User.create({
      name: 'Adjuster User',
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

    policy = await buildPolicy({
      policyNumber: 'POL-TST-001',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2025-01-01'),
      expiryDate: new Date('2027-12-31'),
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      deductibleAmount: 500,
    });

    customer = await Customer.create({
      fullName: 'Ahmad Fake',
      phone: '+970001234567',
      organizationId: org._id,
    });

    insuredVehicle = await Vehicle.create({
      plateNumber: 'TST-100',
      make: 'Toyota',
      model: 'Corolla',
      year: 2023,
      organizationId: org._id,
      complementaryPolicyId: policy._id,
      customerId: customer._id,
    });
  };

  const validPayload = (overrides = {}) => ({
    incidentType: 'COLLISION',
    incidentLocation: 'Al-Irsal St, Ramallah',
    incidentAt: '2026-06-15T10:00:00+03:00',
    governorate: 'RAMALLAH_AL_BIREH',
    reportSource: 'NONE',
    injuriesReported: false,
    description: 'Collision with barrier',
    latitude: 31.905,
    longitude: 35.204,
    vehicles: [
      {
        vehicleRole: 'THIRD_PARTY',
        plateRegion: 'PALESTINIAN',
        plateNumber: 'TP-1234',
        make: 'Hyundai',
        model: 'Elantra',
        year: 2022,
      },
    ],
    parties: [
      {
        role: 'THIRD_PARTY_DRIVER',
        partyType: 'PERSON',
        fullName: 'Driver Fake',
        idType: 'PALESTINIAN_ID',
        idNumber: '000123456',
        phone: '+970001111111',
        licenseClass: 'b',
        licenseExpiry: '2028-01-01',
        vehicleIndex: 0,
      },
    ],
    damagedItems: [],
    ...overrides,
  });

  // 1. creates an incident with one vehicle and one party and returns both with ids
  it('1. creates an incident with one vehicle and one party and returns both with ids', async () => {
    await setupBaseFixture();
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload());

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.id).toBeDefined();
    expect(data.incidentNumber).toBe('INC-TST-0001');
    expect(data.incidentDate).toBe('2026-06-15');
    expect(data.incidentAt).toBeDefined();
    expect(data.reportedAt).toBeDefined();
    expect(data.governorate).toBe('RAMALLAH_AL_BIREH');
    expect(data.reportSource).toBe('NONE');
    expect(data.injuriesReported).toBe(false);

    expect(data.vehicles).toHaveLength(1);
    expect(data.vehicles[0].id).toBeDefined();
    expect(data.vehicles[0]._id).toBeUndefined();
    expect(data.vehicles[0].vehicleRole).toBe('THIRD_PARTY');
    expect(data.vehicles[0].plateNumber).toBe('TP-1234');

    expect(data.parties).toHaveLength(1);
    expect(data.parties[0].id).toBeDefined();
    expect(data.parties[0]._id).toBeUndefined();
    expect(data.parties[0].role).toBe('THIRD_PARTY_DRIVER');
    expect(data.parties[0].fullName).toBe('Driver Fake');
    expect(data.parties[0].partyType).toBe('PERSON');
    expect(data.parties[0].idType).toBe('PALESTINIAN_ID');
    expect(data.parties[0].idNumber).toBe('000123456');
    expect(data.parties[0].nationalId).toBeUndefined();
    expect(data.parties[0].vehicleRef).toBe(data.vehicles[0].id);
  });

  // 2. rejects an incident without vehicles
  it('2. rejects an incident without vehicles', async () => {
    await setupBaseFixture();
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ vehicles: [] }));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 3. rejects an incident without parties
  it('3. rejects an incident without parties', async () => {
    await setupBaseFixture();
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ parties: [] }));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 4. derives incidentDate in Asia/Hebron from incidentAt (2026-10-20T22:30:00Z gives 2026-10-21)
  it('4. derives incidentDate in Asia/Hebron from incidentAt (2026-10-20T22:30:00Z gives 2026-10-21)', async () => {
    await setupBaseFixture();
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ incidentAt: '2026-10-20T22:30:00Z' }));

    expect(res.status).toBe(201);
    expect(res.body.data.incidentDate).toBe('2026-10-21');
  });

  // 5. rejects incidentAt more than 5 minutes in the future
  it('5. rejects incidentAt more than 5 minutes in the future', async () => {
    await setupBaseFixture();
    const futureDate = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ incidentAt: futureDate }));

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('INVALID_INCIDENT_DATE');
  });

  // 6. rejects reportedAt and incidentDate sent by the client
  it('6. rejects reportedAt and incidentDate sent by the client', async () => {
    await setupBaseFixture();
    const resDate = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ incidentDate: '2026-06-15' }));
    expect(resDate.status).toBe(400);
    expect(resDate.body.errors[0].code).toBe('VALIDATION_ERROR');

    const resReported = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ reportedAt: new Date().toISOString() }));
    expect(resReported.status).toBe(400);
    expect(resReported.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 7. sets reportedAt on the server
  it('7. sets reportedAt on the server', async () => {
    await setupBaseFixture();
    const before = Date.now();
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload());

    expect(res.status).toBe(201);
    const after = Date.now();
    const reportedAtTime = new Date(res.body.data.reportedAt).getTime();
    expect(reportedAtTime).toBeGreaterThanOrEqual(before - 2000);
    expect(reportedAtTime).toBeLessThanOrEqual(after + 2000);
  });

  // 8. rejects eKrokaReference unless reportSource is PALESTINIAN_POLICE_EKROKA
  it('8. rejects eKrokaReference unless reportSource is PALESTINIAN_POLICE_EKROKA', async () => {
    await setupBaseFixture();
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ reportSource: 'AGREED_STATEMENT', eKrokaReference: 'EK-12345' }));

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 9. rejects policeReportNumber unless reportSource is a paper or Israeli police report
  it('9. rejects policeReportNumber unless reportSource is a paper or Israeli police report', async () => {
    await setupBaseFixture();
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ reportSource: 'AGREED_STATEMENT', policeReportNumber: 'PR-12345' }));

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 10. requires a vehicle link for drivers, owner and passenger
  it('10. requires a vehicle link for drivers, owner and passenger', async () => {
    await setupBaseFixture();
    for (const role of ['INSURED_DRIVER', 'THIRD_PARTY_DRIVER', 'OWNER', 'PASSENGER']) {
      const party = {
        role,
        fullName: 'Driver Role Test',
        licenseClass: role.includes('DRIVER') ? 'B' : undefined,
      };
      const res = await request(app)
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${officerToken}`)
        .send(validPayload({ parties: [party] }));

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    }
  });

  // 11. rejects a vehicle link for pedestrian and witness
  it('11. rejects a vehicle link for pedestrian and witness', async () => {
    await setupBaseFixture();
    for (const role of ['PEDESTRIAN', 'WITNESS']) {
      const party = {
        role,
        fullName: 'Pedestrian Test',
        vehicleIndex: 0,
      };
      const res = await request(app)
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${officerToken}`)
        .send(validPayload({ parties: [party] }));

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    }
  });

  // 12. rejects a vehicleIndex outside the vehicles array with 422 INVALID_VEHICLE_REF
  it('12. rejects a vehicleIndex outside the vehicles array with 422 INVALID_VEHICLE_REF', async () => {
    await setupBaseFixture();
    const payload = validPayload({
      parties: [
        {
          role: 'THIRD_PARTY_DRIVER',
          fullName: 'Driver Test',
          vehicleIndex: 5,
        },
      ],
    });
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(payload);

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('INVALID_VEHICLE_REF');
  });

  // 13. requires plateNumber unless plateRegion is UNKNOWN and requires null when UNKNOWN
  it('13. requires plateNumber unless plateRegion is UNKNOWN and requires null when UNKNOWN', async () => {
    await setupBaseFixture();
    // 1. Missing plateNumber when plateRegion is PALESTINIAN -> 400
    const resMissing = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validPayload({
          vehicles: [{ vehicleRole: 'THIRD_PARTY', plateRegion: 'PALESTINIAN' }],
        })
      );
    expect(resMissing.status).toBe(400);
    expect(resMissing.body.errors[0].code).toBe('VALIDATION_ERROR');

    // 2. plateNumber present when plateRegion is UNKNOWN -> 400
    const resUnknownWithPlate = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validPayload({
          vehicles: [{ vehicleRole: 'THIRD_PARTY', plateRegion: 'UNKNOWN', plateNumber: 'PLATE-1' }],
        })
      );
    expect(resUnknownWithPlate.status).toBe(400);
    expect(resUnknownWithPlate.body.errors[0].code).toBe('VALIDATION_ERROR');

    // 3. plateRegion is UNKNOWN and plateNumber is null -> 201
    const resValid = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        validPayload({
          vehicles: [{ vehicleRole: 'THIRD_PARTY', plateRegion: 'UNKNOWN', plateNumber: null }],
        })
      );
    expect(resValid.status).toBe(201);
    expect(resValid.body.data.vehicles[0].plateNumber).toBeNull();
  });

  // 14. rejects vehicleId on a non-INSURED vehicle
  it('14. rejects vehicleId on a non-INSURED vehicle', async () => {
    await setupBaseFixture();
    const payload = validPayload({
      vehicles: [
        {
          vehicleRole: 'THIRD_PARTY',
          plateRegion: 'PALESTINIAN',
          plateNumber: 'TP-1234',
          vehicleId: insuredVehicle._id.toString(),
        },
      ],
    });
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 15. returns 404 VEHICLE_NOT_FOUND for a vehicleId from another organization
  it('15. returns 404 VEHICLE_NOT_FOUND for a vehicleId from another organization', async () => {
    await setupBaseFixture();
    const otherVehicle = await Vehicle.create({
      plateNumber: 'OTH-100',
      make: 'Nissan',
      organizationId: otherOrg._id,
    });

    const payload = validPayload({
      vehicles: [
        {
          vehicleRole: 'INSURED',
          plateRegion: 'PALESTINIAN',
          plateNumber: 'OTH-100',
          vehicleId: otherVehicle._id.toString(),
        },
      ],
      parties: [
        {
          role: 'INSURED_DRIVER',
          fullName: 'Insured Driver',
          vehicleIndex: 0,
        },
      ],
    });

    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(payload);

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('VEHICLE_NOT_FOUND');
  });

  // 16. rejects licenseClass for a non-driver role
  it('16. rejects licenseClass for a non-driver role', async () => {
    await setupBaseFixture();
    const payload = validPayload({
      parties: [
        {
          role: 'OWNER',
          fullName: 'Owner Person',
          licenseClass: 'B',
          vehicleIndex: 0,
        },
      ],
    });
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 17. rejects a nationalId that is not exactly 9 digits
  it('17. rejects a nationalId that is not exactly 9 digits', async () => {
    await setupBaseFixture();
    const payload = validPayload({
      parties: [
        {
          role: 'THIRD_PARTY_DRIVER',
          partyType: 'PERSON',
          fullName: 'Driver Person',
          idType: 'PALESTINIAN_ID',
          idNumber: '12345',
          vehicleIndex: 0,
        },
      ],
    });
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 18. appends a party linked to an existing vehicle and shows it in incident details
  it('18. appends a party linked to an existing vehicle and shows it in incident details', async () => {
    await setupBaseFixture();
    const createRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload());
    expect(createRes.status).toBe(201);
    const incidentId = createRes.body.data.id;
    const vehicleId = createRes.body.data.vehicles[0].id;

    const appendRes = await request(app)
      .post(`/api/v1/incidents/${incidentId}/parties`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        role: 'PASSENGER',
        partyType: 'PERSON',
        fullName: 'Passenger Fake',
        idType: 'PALESTINIAN_ID',
        idNumber: '000789123',
        phone: '+970002222222',
        vehicleRef: vehicleId,
      });

    expect(appendRes.status).toBe(201);
    expect(appendRes.body.data.id).toBeDefined();
    expect(appendRes.body.data.fullName).toBe('Passenger Fake');
    expect(appendRes.body.data.vehicleRef).toBe(vehicleId);

    const getRes = await request(app)
      .get(`/api/v1/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.parties).toHaveLength(2);
    expect(getRes.body.data.parties[1].fullName).toBe('Passenger Fake');
  });

  // 19. rejects an appended party whose vehicleRef belongs to another incident with 422 INVALID_VEHICLE_REF
  it('19. rejects an appended party whose vehicleRef belongs to another incident with 422 INVALID_VEHICLE_REF', async () => {
    await setupBaseFixture();
    const res1 = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload());
    const res2 = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload());

    const inc1Id = res1.body.data.id;
    const inc2VehicleId = res2.body.data.vehicles[0].id;

    const appendRes = await request(app)
      .post(`/api/v1/incidents/${inc1Id}/parties`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        role: 'PASSENGER',
        fullName: 'Passenger Foreign',
        vehicleRef: inc2VehicleId,
      });

    expect(appendRes.status).toBe(422);
    expect(appendRes.body.errors[0].code).toBe('INVALID_VEHICLE_REF');
  });

  // 20. returns 404 INCIDENT_NOT_FOUND when appending to another organization's incident
  it('20. returns 404 INCIDENT_NOT_FOUND when appending to another organization\'s incident', async () => {
    await setupBaseFixture();
    const createRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload());
    const incidentId = createRes.body.data.id;

    const appendRes = await request(app)
      .post(`/api/v1/incidents/${incidentId}/vehicles`)
      .set('Authorization', `Bearer ${otherOfficerToken}`)
      .send({
        vehicleRole: 'THIRD_PARTY',
        plateRegion: 'PALESTINIAN',
        plateNumber: 'OTH-222',
      });

    expect(appendRes.status).toBe(404);
    expect(appendRes.body.errors[0].code).toBe('INCIDENT_NOT_FOUND');
  });

  // 21. returns 422 INCIDENT_LIMIT_REACHED when the vehicles cap is reached
  it('21. returns 422 INCIDENT_LIMIT_REACHED when the vehicles cap is reached', async () => {
    await setupBaseFixture();
    const createRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload());
    const incidentId = createRes.body.data.id;

    // Append up to 10 vehicles
    for (let i = 2; i <= 10; i++) {
      const res = await request(app)
        .post(`/api/v1/incidents/${incidentId}/vehicles`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          vehicleRole: 'THIRD_PARTY',
          plateRegion: 'PALESTINIAN',
          plateNumber: `TP-${1000 + i}`,
        });
      expect(res.status).toBe(201);
    }

    // 11th vehicle rejected with 422
    const overflowRes = await request(app)
      .post(`/api/v1/incidents/${incidentId}/vehicles`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        vehicleRole: 'THIRD_PARTY',
        plateRegion: 'PALESTINIAN',
        plateNumber: 'TP-OVERFLOW',
      });

    expect(overflowRes.status).toBe(422);
    expect(overflowRes.body.errors[0].code).toBe('INCIDENT_LIMIT_REACHED');
  });

  // 22. never exceeds the vehicles cap under concurrent appends
  it('22. never exceeds the vehicles cap under concurrent appends', async () => {
    await setupBaseFixture();
    // Seed an incident with 9 vehicles
    const vehiclesSeed = Array.from({ length: 9 }, (_, i) => ({
      vehicleRole: 'THIRD_PARTY',
      plateRegion: 'PALESTINIAN',
      plateNumber: `TP-SEED-${i + 1}`,
    }));
    const createRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ vehicles: vehiclesSeed }));
    expect(createRes.status).toBe(201);
    const incidentId = createRes.body.data.id;

    // Fire 5 concurrent appends
    const sendAppend = (idx) =>
      request(app)
        .post(`/api/v1/incidents/${incidentId}/vehicles`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          vehicleRole: 'THIRD_PARTY',
          plateRegion: 'PALESTINIAN',
          plateNumber: `TP-RACE-${idx}`,
        });

    const results = await Promise.all([
      sendAppend(1),
      sendAppend(2),
      sendAppend(3),
      sendAppend(4),
      sendAppend(5),
    ]);

    const statuses = results.map((r) => r.status);
    const successCount = statuses.filter((s) => s === 201).length;
    const limitCount = statuses.filter((s) => s === 422).length;

    expect(successCount).toBe(1);
    expect(limitCount).toBe(4);

    const doc = await Incident.findById(incidentId).lean();
    expect(doc.vehicles).toHaveLength(10);
  });

  // 23. fills an empty report field once and returns 409 REPORT_FIELD_ALREADY_SET on the second try
  it('23. fills an empty report field once and returns 409 REPORT_FIELD_ALREADY_SET on the second try', async () => {
    await setupBaseFixture();
    const createRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ reportSource: 'NONE' }));
    const incidentId = createRes.body.data.id;

    const patch1 = await request(app)
      .patch(`/api/v1/incidents/${incidentId}/report`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        reportSource: 'PALESTINIAN_POLICE_EKROKA',
        eKrokaReference: 'EK-998877',
      });
    expect(patch1.status).toBe(200);
    expect(patch1.body.data.reportSource).toBe('PALESTINIAN_POLICE_EKROKA');
    expect(patch1.body.data.eKrokaReference).toBe('EK-998877');

    const patch2 = await request(app)
      .patch(`/api/v1/incidents/${incidentId}/report`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        eKrokaReference: 'EK-NEW',
      });
    expect(patch2.status).toBe(409);
    expect(patch2.body.errors[0].code).toBe('REPORT_FIELD_ALREADY_SET');
  });

  // 24. lets exactly one of two concurrent report fills succeed
  it('24. lets exactly one of two concurrent report fills succeed', async () => {
    await setupBaseFixture();
    const createRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ reportSource: 'NONE' }));
    const incidentId = createRes.body.data.id;

    const patchA = () =>
      request(app)
        .patch(`/api/v1/incidents/${incidentId}/report`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          reportSource: 'PALESTINIAN_POLICE_PAPER',
          policeReportNumber: 'PR-A-01',
        });

    const patchB = () =>
      request(app)
        .patch(`/api/v1/incidents/${incidentId}/report`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          reportSource: 'ISRAELI_POLICE',
          policeReportNumber: 'PR-B-02',
        });

    const [resA, resB] = await Promise.all([patchA(), patchB()]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const conflictRes = resA.status === 409 ? resA : resB;
    expect(conflictRes.body.errors[0].code).toBe('REPORT_FIELD_ALREADY_SET');

    const doc = await Incident.findById(incidentId).lean();
    expect(['PALESTINIAN_POLICE_PAPER', 'ISRAELI_POLICE']).toContain(doc.reportSource);
  });

  // 25. changes reportSource only from NONE
  it('25. changes reportSource only from NONE', async () => {
    await setupBaseFixture();
    const createRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ reportSource: 'AGREED_STATEMENT' }));
    const incidentId = createRes.body.data.id;

    const res = await request(app)
      .patch(`/api/v1/incidents/${incidentId}/report`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ reportSource: 'ISRAELI_POLICE' });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('REPORT_FIELD_ALREADY_SET');
  });

  // 26. returns 403 for FIELD_ADJUSTER on every new endpoint
  it('26. returns 403 for FIELD_ADJUSTER on every new endpoint', async () => {
    await setupBaseFixture();
    const createRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload());
    const incidentId = createRes.body.data.id;

    const pVehicle = await request(app)
      .post(`/api/v1/incidents/${incidentId}/vehicles`)
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({ vehicleRole: 'OTHER', plateRegion: 'UNKNOWN', plateNumber: null });
    expect(pVehicle.status).toBe(403);

    const pParty = await request(app)
      .post(`/api/v1/incidents/${incidentId}/parties`)
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({ role: 'WITNESS', fullName: 'Witness Fake' });
    expect(pParty.status).toBe(403);

    const pItem = await request(app)
      .post(`/api/v1/incidents/${incidentId}/damaged-items`)
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({ itemType: 'BUILDING', description: 'Wall damage' });
    expect(pItem.status).toBe(403);

    const pReport = await request(app)
      .patch(`/api/v1/incidents/${incidentId}/report`)
      .set('Authorization', `Bearer ${adjusterToken}`)
      .send({ injuriesReported: true });
    expect(pReport.status).toBe(403);
  });

  // 27. lists incidents without party, vehicle or item content and without nationalId or phone
  it('27. lists incidents without party, vehicle or item content and without nationalId or phone', async () => {
    await setupBaseFixture();
    await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload());

    const res = await request(app)
      .get('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const item = res.body.data[0];

    expect(item.vehiclesCount).toBe(1);
    expect(item.partiesCount).toBe(1);
    expect(item.incidentAt).toBeDefined();
    expect(item.governorate).toBe('RAMALLAH_AL_BIREH');
    expect(item.reportSource).toBe('NONE');
    expect(item.injuriesReported).toBe(false);

    expect(item.vehicles).toBeUndefined();
    expect(item.parties).toBeUndefined();
    expect(item.damagedItems).toBeUndefined();
    expect(item.nationalId).toBeUndefined();
    expect(item.phone).toBeUndefined();
  });

  // 28. legacy POST /claims still creates an incident with empty arrays and null intake fields
  it('28. legacy POST /claims still creates an incident with empty arrays and null intake fields', async () => {
    await setupBaseFixture();
    const res = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyId: policy._id.toString(),
        plateNumber: 'TST-100',
        incidentType: 'COLLISION',
        incidentLocation: 'Old Main Rd',
        incidentDate: '2026-06-15',
        description: 'Legacy claim incident',
      });

    expect(res.status).toBe(201);
    const incidentId = res.body.data.incidentId;
    expect(incidentId).toBeDefined();

    const incident = await Incident.findById(incidentId).lean();
    expect(incident.incidentDate).toBe('2026-06-15');
    expect(incident.incidentAt).toBeNull();
    expect(incident.governorate).toBeNull();
    expect(incident.reportSource).toBeNull();
    expect(incident.injuriesReported).toBeNull();
    expect(incident.reportedAt).toBeDefined();
    expect(incident.vehicles).toEqual([]);
    expect(incident.parties).toEqual([]);
    expect(incident.damagedItems).toEqual([]);
  });

  // 29. rejects a report fill whose reference does not match the new reportSource
  it('29. rejects a report fill whose reference does not match the new reportSource', async () => {
    await setupBaseFixture();
    const createRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ reportSource: 'NONE' }));
    const incidentId = createRes.body.data.id;

    const res = await request(app)
      .patch(`/api/v1/incidents/${incidentId}/report`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        reportSource: 'AGREED_STATEMENT',
        eKrokaReference: 'EK-INVALID',
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 30. rejects an empty report body and injuriesReported false
  it('30. rejects an empty report body and injuriesReported false', async () => {
    await setupBaseFixture();
    const createRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ reportSource: 'NONE' }));
    const incidentId = createRes.body.data.id;

    const emptyRes = await request(app)
      .patch(`/api/v1/incidents/${incidentId}/report`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({});
    expect(emptyRes.status).toBe(400);
    expect(emptyRes.body.errors[0].code).toBe('VALIDATION_ERROR');

    const falseRes = await request(app)
      .patch(`/api/v1/incidents/${incidentId}/report`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ injuriesReported: false });
    expect(falseRes.status).toBe(400);
    expect(falseRes.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 31. rejects incidentAt without a timezone offset
  it('31. rejects incidentAt without a timezone offset', async () => {
    await setupBaseFixture();
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ incidentAt: '2026-06-15T10:00:00' }));

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 32. rejects plateNumber with plateRegion UNKNOWN on the append endpoint
  it('32. rejects plateNumber with plateRegion UNKNOWN on the append endpoint', async () => {
    await setupBaseFixture();
    const createRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload());
    const incidentId = createRes.body.data.id;

    const res = await request(app)
      .post(`/api/v1/incidents/${incidentId}/vehicles`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        vehicleRole: 'THIRD_PARTY',
        plateRegion: 'UNKNOWN',
        plateNumber: 'ILLEGAL-PLATE',
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  // 33. rejects a report fill that carries both eKrokaReference and policeReportNumber
  it('33. rejects a report fill that carries both eKrokaReference and policeReportNumber', async () => {
    await setupBaseFixture();
    const createRes = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ reportSource: 'PALESTINIAN_POLICE_PAPER' }));
    const incidentId = createRes.body.data.id;

    const res = await request(app)
      .patch(`/api/v1/incidents/${incidentId}/report`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        eKrokaReference: 'EK-1',
        policeReportNumber: 'PR-1',
      });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');

    const doc = await Incident.findById(incidentId).lean();
    expect(doc.eKrokaReference).toBeNull();
    expect(doc.policeReportNumber).toBeNull();
  });

  // 34. rejects an incidentAt that is not a real time
  it('34. rejects an incidentAt that is not a real time', async () => {
    await setupBaseFixture();
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({ incidentAt: '2026-10-21T25:61:00Z' }));

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('accepts a COMPANY POLICYHOLDER with a COMPANY_REGISTRATION id', async () => {
    await setupBaseFixture();
    const payload = validPayload({
      parties: [
        {
          role: 'POLICYHOLDER',
          partyType: 'COMPANY',
          fullName: 'Al-Quds Transport Co',
          idType: 'COMPANY_REGISTRATION',
          idNumber: 'CR-98765-X',
          vehicleIndex: 0,
        },
      ],
    });
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const p = res.body.data.parties[0];
    expect(p.role).toBe('POLICYHOLDER');
    expect(p.partyType).toBe('COMPANY');
    expect(p.idType).toBe('COMPANY_REGISTRATION');
    expect(p.idNumber).toBe('CR-98765-X');
    expect(p.nationalId).toBeUndefined();
  });

  it('accepts a PERSON party with a PASSPORT id and an ISRAELI_ID party', async () => {
    await setupBaseFixture();
    const payload = validPayload({
      vehicles: [
        {
          vehicleRole: 'THIRD_PARTY',
          plateRegion: 'PALESTINIAN',
          plateNumber: 'TP-1234',
        },
        {
          vehicleRole: 'OTHER',
          plateRegion: 'ISRAELI',
          plateNumber: 'IL-5678',
        },
      ],
      parties: [
        {
          role: 'THIRD_PARTY_DRIVER',
          partyType: 'PERSON',
          fullName: 'Foreign Driver',
          idType: 'PASSPORT',
          idNumber: 'A12345678',
          vehicleIndex: 0,
        },
        {
          role: 'WITNESS',
          partyType: 'PERSON',
          fullName: 'Jerusalem Resident',
          idType: 'ISRAELI_ID',
          idNumber: '000987654',
        },
      ],
    });
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.parties).toHaveLength(2);
    expect(res.body.data.parties[0].idType).toBe('PASSPORT');
    expect(res.body.data.parties[0].idNumber).toBe('A12345678');
    expect(res.body.data.parties[1].idType).toBe('ISRAELI_ID');
    expect(res.body.data.parties[1].idNumber).toBe('000987654');
  });

  it('rejects nationalId in the body', async () => {
    await setupBaseFixture();
    const payload = validPayload({
      parties: [
        {
          role: 'THIRD_PARTY_DRIVER',
          partyType: 'PERSON',
          fullName: 'Driver Fake',
          nationalId: '000123456',
          vehicleIndex: 0,
        },
      ],
    });
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('rejects idNumber without idType and idType without idNumber', async () => {
    await setupBaseFixture();
    const res1 = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({
        parties: [
          {
            role: 'THIRD_PARTY_DRIVER',
            partyType: 'PERSON',
            fullName: 'Driver Fake',
            idNumber: '000123456',
            vehicleIndex: 0,
          },
        ],
      }));
    expect(res1.status).toBe(400);
    expect(res1.body.errors[0].code).toBe('VALIDATION_ERROR');

    const res2 = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload({
        parties: [
          {
            role: 'THIRD_PARTY_DRIVER',
            partyType: 'PERSON',
            fullName: 'Driver Fake',
            idType: 'PALESTINIAN_ID',
            vehicleIndex: 0,
          },
        ],
      }));
    expect(res2.status).toBe(400);
    expect(res2.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('rejects a COMPANY party with a driver or passenger role', async () => {
    await setupBaseFixture();
    const payload = validPayload({
      parties: [
        {
          role: 'THIRD_PARTY_DRIVER',
          partyType: 'COMPANY',
          fullName: 'Driver Company Ltd',
          idType: 'COMPANY_REGISTRATION',
          idNumber: 'CR-12345',
          vehicleIndex: 0,
        },
      ],
    });
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('rejects a PERSON party with a COMPANY_REGISTRATION id', async () => {
    await setupBaseFixture();
    const payload = validPayload({
      parties: [
        {
          role: 'OWNER',
          partyType: 'PERSON',
          fullName: 'Individual Owner',
          idType: 'COMPANY_REGISTRATION',
          idNumber: 'CR-12345',
          vehicleIndex: 0,
        },
      ],
    });
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('requires a vehicle link for POLICYHOLDER, AUTHORIZED_REPRESENTATIVE and LIENHOLDER', async () => {
    await setupBaseFixture();
    for (const role of ['POLICYHOLDER', 'AUTHORIZED_REPRESENTATIVE', 'LIENHOLDER']) {
      const resCreate = await request(app)
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${officerToken}`)
        .send(validPayload({
          parties: [
            {
              role,
              partyType: role === 'LIENHOLDER' ? 'COMPANY' : 'PERSON',
              fullName: 'Party Name',
            },
          ],
        }));
      expect(resCreate.status).toBe(400);
      expect(resCreate.body.errors[0].code).toBe('VALIDATION_ERROR');
    }

    const baseIncident = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${officerToken}`)
      .send(validPayload());
    const incidentId = baseIncident.body.data.id;

    for (const role of ['POLICYHOLDER', 'AUTHORIZED_REPRESENTATIVE', 'LIENHOLDER']) {
      const resAppend = await request(app)
        .post(`/api/v1/incidents/${incidentId}/parties`)
        .set('Authorization', `Bearer ${officerToken}`)
        .send({
          role,
          partyType: role === 'LIENHOLDER' ? 'COMPANY' : 'PERSON',
          fullName: 'Appended Party',
        });
      expect(resAppend.status).toBe(400);
      expect(resAppend.body.errors[0].code).toBe('VALIDATION_ERROR');
    }
  });
});

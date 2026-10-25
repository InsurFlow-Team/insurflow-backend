const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Customer = require('../src/modules/customers/customer.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Incident = require('../src/modules/incidents/incident.model');
const Claim = require('../src/modules/claims/claim.model');
const { buildPolicy } = require('./helpers/policyFactory');
const { buildClaimReportDocDefinition } = require('../src/modules/claims/claim.report.builder');
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

describe('PB-02b Claimant & Subject Vehicle on Sub-Claims & PII Masking', () => {
  let mongoServer;
  let org, otherOrg;
  let officer, officerToken;
  let admin, adminToken;
  let adjuster, adjusterToken;
  let otherOfficer, otherOfficerToken;
  let customer, policy, vehicle, otherVehicle;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Organization.deleteMany({});
    await User.deleteMany({});
    await Customer.deleteMany({});
    await Vehicle.deleteMany({});
    await Incident.deleteMany({});
    await Claim.deleteMany({});

    org = await Organization.create({ name: 'Sawn Insurance', code: 'SWN', status: 'ACTIVE' });
    otherOrg = await Organization.create({ name: 'Other Insurance', code: 'OTH', status: 'ACTIVE' });

    officer = await User.create({
      name: 'Claims Officer',
      employeeCode: 'OF-001',
      password: 'password123',
      role: 'CLAIMS_OFFICER',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    officerToken = generateToken(officer);

    admin = await User.create({
      name: 'Admin User',
      employeeCode: 'AD-001',
      password: 'password123',
      role: 'ADMIN',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    adminToken = generateToken(admin);

    adjuster = await User.create({
      name: 'Field Adjuster',
      employeeCode: 'FA-001',
      password: 'password123',
      role: 'FIELD_ADJUSTER',
      organizationId: org._id,
      status: 'ACTIVE',
    });
    adjusterToken = generateToken(adjuster);

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
      fullName: 'Mohammed Policyholder',
      phone: '+970001234567',
      organizationId: org._id,
    });

    policy = await buildPolicy({
      policyNumber: 'POL-SWN-001',
      status: 'ACTIVE',
      organizationId: org._id,
      startDate: new Date('2026-01-01'),
      expiryDate: new Date('2027-12-31'),
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['COLLISION'],
      deductibleAmount: 50000,
    });

    vehicle = await Vehicle.create({
      plateNumber: '1234-A',
      make: 'Hyundai',
      model: 'Ioniq',
      year: 2023,
      organizationId: org._id,
      complementaryPolicyId: policy._id,
      customerId: customer._id,
    });

    otherVehicle = await Vehicle.create({
      plateNumber: '5678-B',
      make: 'Kia',
      model: 'Sportage',
      year: 2022,
      organizationId: org._id,
      complementaryPolicyId: policy._id,
      customerId: customer._id,
    });
  });

  const createIncidentWithSubject = async (partyOverrides = {}, vehicleOverrides = {}) => {
    const subjectRef = new mongoose.Types.ObjectId();
    const claimantPartyId = new mongoose.Types.ObjectId();

    const incident = await Incident.create({
      organizationId: org._id,
      incidentDate: '2026-06-15',
      incidentType: 'COLLISION',
      incidentLocation: 'Al-Irsal St, Ramallah',
      incidentDescription: 'Collision at intersection',
      createdBy: officer._id,
      vehicles: [
        {
          _id: subjectRef,
          vehicleRole: 'INSURED',
          plateRegion: 'PALESTINIAN',
          plateNumber: '1234-A',
          vehicleId: vehicle._id,
          ...vehicleOverrides,
        },
      ],
      parties: [
        {
          _id: claimantPartyId,
          role: 'POLICYHOLDER',
          partyType: 'PERSON',
          fullName: 'Mohammed Policyholder',
          idType: 'PALESTINIAN_ID',
          idNumber: '000123456',
          phone: '+970001234567',
          vehicleRef: subjectRef,
          ...partyOverrides,
        },
      ],
    });

    return { incident, subjectRef, claimantPartyId };
  };

  it('11. creates an OWN_DAMAGE sub-claim with a POLICYHOLDER claimant linked to the INSURED subject vehicle', async () => {
    const { incident, subjectRef, claimantPartyId } = await createIncidentWithSubject();

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        claimantPartyId: claimantPartyId.toString(),
        subjectRef: subjectRef.toString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.claimantPartyId).toBe(claimantPartyId.toString());
    expect(res.body.data.subjectRef).toBe(subjectRef.toString());

    const saved = await Claim.findById(res.body.data.id).lean();
    expect(saved.claimantPartyId.toString()).toBe(claimantPartyId.toString());
    expect(saved.subjectRef.toString()).toBe(subjectRef.toString());
  });

  it('12. accepts an AUTHORIZED_REPRESENTATIVE claimant linked to the subject vehicle', async () => {
    const { incident, subjectRef, claimantPartyId } = await createIncidentWithSubject({
      role: 'AUTHORIZED_REPRESENTATIVE',
      fullName: 'Lawyer Representative',
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        claimantPartyId: claimantPartyId.toString(),
        subjectRef: subjectRef.toString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.claimantPartyId).toBe(claimantPartyId.toString());
    expect(res.body.data.subjectRef).toBe(subjectRef.toString());
  });

  it('13. rejects a missing claimantPartyId or subjectRef with 400', async () => {
    const { incident, subjectRef, claimantPartyId } = await createIncidentWithSubject();

    // Missing claimantPartyId
    const res1 = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        subjectRef: subjectRef.toString(),
      });
    expect(res1.status).toBe(400);
    expect(res1.body.errors[0].code).toBe('VALIDATION_ERROR');

    // Missing subjectRef
    const res2 = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        claimantPartyId: claimantPartyId.toString(),
      });
    expect(res2.status).toBe(400);
    expect(res2.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('14. rejects a subjectRef that is a THIRD_PARTY vehicle with 422 INVALID_SUBJECT_VEHICLE', async () => {
    const { incident, claimantPartyId } = await createIncidentWithSubject();
    const tpVehicleId = new mongoose.Types.ObjectId();

    await Incident.findByIdAndUpdate(incident._id, {
      $push: {
        vehicles: {
          _id: tpVehicleId,
          vehicleRole: 'THIRD_PARTY',
          plateRegion: 'PALESTINIAN',
          plateNumber: 'TP-999',
        },
      },
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        claimantPartyId: claimantPartyId.toString(),
        subjectRef: tpVehicleId.toString(),
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('INVALID_SUBJECT_VEHICLE');
  });

  it('15. rejects a subjectRef from another incident with 422 INVALID_SUBJECT_VEHICLE', async () => {
    const { incident, claimantPartyId } = await createIncidentWithSubject();
    const unrelatedVehicleRef = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        claimantPartyId: claimantPartyId.toString(),
        subjectRef: unrelatedVehicleRef.toString(),
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('INVALID_SUBJECT_VEHICLE');
  });

  it('16. rejects an OWNER or INSURED_DRIVER claimant with 422 INVALID_CLAIMANT', async () => {
    // 1. OWNER
    const ownerIncident = await createIncidentWithSubject({ role: 'OWNER' });
    const res1 = await request(app)
      .post(`/api/v1/incidents/${ownerIncident.incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        claimantPartyId: ownerIncident.claimantPartyId.toString(),
        subjectRef: ownerIncident.subjectRef.toString(),
      });
    expect(res1.status).toBe(422);
    expect(res1.body.errors[0].code).toBe('INVALID_CLAIMANT');

    // 2. INSURED_DRIVER
    const driverIncident = await createIncidentWithSubject({ role: 'INSURED_DRIVER' });
    const res2 = await request(app)
      .post(`/api/v1/incidents/${driverIncident.incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        claimantPartyId: driverIncident.claimantPartyId.toString(),
        subjectRef: driverIncident.subjectRef.toString(),
      });
    expect(res2.status).toBe(422);
    expect(res2.body.errors[0].code).toBe('INVALID_CLAIMANT');
  });

  it('17. rejects a POLICYHOLDER claimant linked to a different vehicle with 422 INVALID_CLAIMANT', async () => {
    const otherVehicleRef = new mongoose.Types.ObjectId();
    const { incident, subjectRef, claimantPartyId } = await createIncidentWithSubject({
      vehicleRef: otherVehicleRef,
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        claimantPartyId: claimantPartyId.toString(),
        subjectRef: subjectRef.toString(),
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('INVALID_CLAIMANT');
  });

  it('18. rejects a subject vehicle without vehicleId with 422 SUBJECT_VEHICLE_MISMATCH', async () => {
    const { incident, subjectRef, claimantPartyId } = await createIncidentWithSubject(
      {},
      { vehicleId: null }
    );

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        claimantPartyId: claimantPartyId.toString(),
        subjectRef: subjectRef.toString(),
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('SUBJECT_VEHICLE_MISMATCH');
  });

  it('19. rejects a subject vehicle whose vehicleId is not the policy vehicle with 422 SUBJECT_VEHICLE_MISMATCH', async () => {
    const { incident, subjectRef, claimantPartyId } = await createIncidentWithSubject(
      {},
      { vehicleId: otherVehicle._id }
    );

    const res = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        claimantPartyId: claimantPartyId.toString(),
        subjectRef: subjectRef.toString(),
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('SUBJECT_VEHICLE_MISMATCH');
  });

  it('20. returns 404 INCIDENT_NOT_FOUND for another organization\'s incident before any claimant check', async () => {
    const otherIncident = await Incident.create({
      organizationId: otherOrg._id,
      incidentDate: '2026-06-15',
      incidentType: 'COLLISION',
      incidentLocation: 'Ramallah',
      createdBy: otherOfficer._id,
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${otherIncident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        claimantPartyId: new mongoose.Types.ObjectId().toString(),
        subjectRef: new mongoose.Types.ObjectId().toString(),
      });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('INCIDENT_NOT_FOUND');
  });

  it('21. legacy POST /claims stores claimantPartyId and subjectRef as null', async () => {
    const res = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        incidentDate: '2026-06-15',
        incidentType: 'COLLISION',
        incidentLocation: 'Main St, Ramallah',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.claimantPartyId).toBeUndefined();
    expect(res.body.data.subjectRef).toBeUndefined();

    const saved = await Claim.findById(res.body.data.id).lean();
    expect(saved.claimantPartyId).toBeNull();
    expect(saved.subjectRef).toBeNull();
  });

  it('22. claim details show the full claimant to CLAIMS_OFFICER and ADMIN', async () => {
    const { incident, subjectRef, claimantPartyId } = await createIncidentWithSubject();

    const createRes = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        claimantPartyId: claimantPartyId.toString(),
        subjectRef: subjectRef.toString(),
      });
    expect(createRes.status).toBe(201);
    const claimId = createRes.body.data.id;

    // Claims Officer
    const officerRes = await request(app)
      .get(`/api/v1/claims/${claimId}`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(officerRes.status).toBe(200);
    const officerClaimant = officerRes.body.data.claimant;
    expect(officerClaimant).not.toBeNull();
    expect(officerClaimant.id).toBe(claimantPartyId.toString());
    expect(officerClaimant.partyType).toBe('PERSON');
    expect(officerClaimant.role).toBe('POLICYHOLDER');
    expect(officerClaimant.fullName).toBe('Mohammed Policyholder');
    expect(officerClaimant.idType).toBe('PALESTINIAN_ID');
    expect(officerClaimant.idNumber).toBe('000123456');
    expect(officerClaimant.phone).toBe('+970001234567');

    // Admin
    const adminRes = await request(app)
      .get(`/api/v1/claims/${claimId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminRes.status).toBe(200);
    const adminClaimant = adminRes.body.data.claimant;
    expect(adminClaimant.idNumber).toBe('000123456');
    expect(adminClaimant.phone).toBe('+970001234567');
  });

  it('23. claim details show the full phone and a masked PERSON idNumber to the assigned FIELD_ADJUSTER', async () => {
    const { incident, subjectRef, claimantPartyId } = await createIncidentWithSubject({
      idNumber: '000123456',
      phone: '+970001234567',
    });

    const createRes = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        claimantPartyId: claimantPartyId.toString(),
        subjectRef: subjectRef.toString(),
      });
    const claimId = createRes.body.data.id;

    // Assign claim to adjuster
    await Claim.findByIdAndUpdate(claimId, { assignedTo: adjuster._id, status: 'ASSIGNED' });

    const res = await request(app)
      .get(`/api/v1/claims/${claimId}`)
      .set('Authorization', `Bearer ${adjusterToken}`);

    expect(res.status).toBe(200);
    const claimant = res.body.data.claimant;
    expect(claimant).not.toBeNull();
    // Phone stays full inside assigned claim (A1, D2)
    expect(claimant.phone).toBe('+970001234567');
    // Person idNumber is masked (A1, D3)
    expect(claimant.idNumber).toBe('*****3456');
  });

  it('24. claim details show a COMPANY claimant idNumber unmasked to the assigned FIELD_ADJUSTER', async () => {
    const { incident, subjectRef, claimantPartyId } = await createIncidentWithSubject({
      partyType: 'COMPANY',
      fullName: 'Al-Quds Transport Co',
      idType: 'COMPANY_REGISTRATION',
      idNumber: 'CR-987654',
      phone: '+970001234567',
    });

    const createRes = await request(app)
      .post(`/api/v1/incidents/${incident._id}/claims`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        claimType: 'OWN_DAMAGE',
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        claimantPartyId: claimantPartyId.toString(),
        subjectRef: subjectRef.toString(),
      });
    const claimId = createRes.body.data.id;

    await Claim.findByIdAndUpdate(claimId, { assignedTo: adjuster._id, status: 'ASSIGNED' });

    const res = await request(app)
      .get(`/api/v1/claims/${claimId}`)
      .set('Authorization', `Bearer ${adjusterToken}`);

    expect(res.status).toBe(200);
    const claimant = res.body.data.claimant;
    expect(claimant.partyType).toBe('COMPANY');
    expect(claimant.idNumber).toBe('CR-987654');
  });

  it('25. claim details return claimant null for a legacy claim', async () => {
    const createRes = await request(app)
      .post('/api/v1/claims')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyId: policy._id.toString(),
        plateNumber: '1234-A',
        incidentDate: '2026-06-15',
        incidentType: 'COLLISION',
        incidentLocation: 'Ramallah',
      });
    const claimId = createRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/claims/${claimId}`)
      .set('Authorization', `Bearer ${officerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.claimantPartyId).toBeNull();
    expect(res.body.data.subjectRef).toBeNull();
    expect(res.body.data.claimant).toBeNull();
  });

  it('26. vehicle lookup masks the customer phone for FIELD_ADJUSTER', async () => {
    const res = await request(app)
      .get('/api/v1/vehicles/lookup?plateNumber=1234-A')
      .set('Authorization', `Bearer ${adjusterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Customer phone was '+970001234567' -> masked keeps '+' and last 3 digits ('567')
    expect(res.body.data.customer.phone).toBe('+*********567');
  });

  it('27. policy verification still returns the full customer phone to CLAIMS_OFFICER', async () => {
    const res = await request(app)
      .post('/api/v1/policies/verify')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        policyNumber: 'POL-SWN-001',
        plateNumber: '1234-A',
        incidentDate: '2026-06-15',
        incidentType: 'COLLISION',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.customer.phone).toBe('+970001234567');
  });

  it('28. the PDF report still prints the full customer phone for CLAIMS_OFFICER (choose the least brittle assertion and say which)', async () => {
    // Least brittle assertion: call buildClaimReportDocDefinition directly and inspect the table cells
    // for the 'Phone Number' row. This directly verifies the customer phone value provided to pdfmake
    // without suffering from binary PDF compression or stream parsing flakiness.
    const fakeClaim = {
      claimNumber: 'CLM-SWN-0001',
      status: 'APPROVED',
      customer: {
        name: 'Mohammed Policyholder',
        phone: '+970001234567',
      },
      vehicle: { plateNumber: '1234-A' },
      timeline: [],
    };

    const docDef = await buildClaimReportDocDefinition({
      claim: fakeClaim,
      organization: { name: 'Sawn Insurance' },
      vehicle: null,
      timelineEvents: [],
      evidencePhotos: [],
    });

    const findRowByLabel = (elements, label) => {
      for (const el of elements) {
        if (el && el.table && Array.isArray(el.table.body)) {
          for (const row of el.table.body) {
            if (Array.isArray(row) && row.length >= 2) {
              if (row[0] && row[0].text === label) {
                return row[1].text;
              }
            }
          }
        }
        if (el && Array.isArray(el.content)) {
          const found = findRowByLabel(el.content, label);
          if (found) return found;
        }
      }
      return null;
    };

    const phoneText = findRowByLabel(docDef.content, 'Phone Number');
    expect(phoneText).toBe('+970001234567');
  });
});

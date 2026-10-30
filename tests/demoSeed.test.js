const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcrypt');

jest.setTimeout(60000);

const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Customer = require('../src/modules/customers/customer.model');
const Vehicle = require('../src/modules/vehicles/vehicle.model');
const Policy = require('../src/modules/policies/policy.model');
const Garage = require('../src/modules/garages/garage.model');
const Incident = require('../src/modules/incidents/incident.model');
const Claim = require('../src/modules/claims/claim.model');
const Letter = require('../src/modules/letters/letter.model');
const Notification = require('../src/modules/notifications/notification.model');
const Counter = require('../src/utils/counter.model');
const { buildPolicy } = require('./helpers/policyFactory');

// Dynamic requires with fallback so Stage A executes each test and reports failures cleanly
let seedModule = {};
let guardModule = {};
let demoAssetsModule = {};
let resetModule = {};
let fakeIdentityModule = {};
let buildReferenceDataModule = {};

try {
  seedModule = require('../src/scripts/demo/seedDemo');
} catch (e) {
  seedModule = { loadError: e.message };
}

try {
  guardModule = require('../src/scripts/demo/guard');
} catch (e) {
  guardModule = { loadError: e.message };
}

try {
  demoAssetsModule = require('../src/scripts/demo/demoAssets');
} catch (e) {
  demoAssetsModule = { loadError: e.message };
}

try {
  resetModule = require('../src/scripts/demo/resetTenant');
} catch (e) {
  resetModule = { loadError: e.message };
}

try {
  fakeIdentityModule = require('../src/scripts/demo/fakeIdentity');
} catch (e) {
  fakeIdentityModule = { loadError: e.message };
}

try {
  buildReferenceDataModule = require('../src/scripts/demo/buildReferenceData');
} catch (e) {
  buildReferenceDataModule = { loadError: e.message };
}

const TEST_PASSWORD = 'TestPassword123!';
const TEST_NOW = new Date('2026-10-27T10:00:00.000Z');

const TEST_ASSETS = Object.freeze({
  damageFront: { url: 'https://res.cloudinary.com/demo/image/upload/front.jpg', publicId: 'demo/front' },
  damageRear: { url: 'https://res.cloudinary.com/demo/image/upload/rear.jpg', publicId: 'demo/rear' },
  damageSide: { url: 'https://res.cloudinary.com/demo/image/upload/side.jpg', publicId: 'demo/side' },
  damageCloseup1: { url: 'https://res.cloudinary.com/demo/image/upload/c1.jpg', publicId: 'demo/c1' },
  damageCloseup2: { url: 'https://res.cloudinary.com/demo/image/upload/c2.jpg', publicId: 'demo/c2' },
  damageCloseup3: { url: 'https://res.cloudinary.com/demo/image/upload/c3.jpg', publicId: 'demo/c3' },
  signature: { url: 'https://res.cloudinary.com/demo/image/upload/sig.png', publicId: 'demo/sig' },
  dischargeScan: { url: 'https://res.cloudinary.com/demo/image/upload/disc.jpg', publicId: 'demo/disc' },
});

describe('PB-03 Demo Tenant Seed, Guard, Reset & Scenario Suite', () => {
  let mongoServer;
  let seededSummary;
  let outputLogs = [];
  let prevAllowDemoSeed;

  const captureLog = (...args) => {
    outputLogs.push(args.join(' '));
  };

  beforeAll(async () => {
    prevAllowDemoSeed = process.env.ALLOW_DEMO_SEED;
    process.env.ALLOW_DEMO_SEED = 'true';

    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    if (typeof seedModule.runDemoSeed === 'function') {
      seededSummary = await seedModule.runDemoSeed({
        isReset: false,
        isConfirm: false,
        now: TEST_NOW,
        password: TEST_PASSWORD,
        assets: TEST_ASSETS,
        log: captureLog,
      });
    }
  });

  afterAll(async () => {
    if (prevAllowDemoSeed === undefined) {
      delete process.env.ALLOW_DEMO_SEED;
    } else {
      process.env.ALLOW_DEMO_SEED = prevAllowDemoSeed;
    }

    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // Test 1: R13, B3
  test('demo.seed.guard.refusesWithoutEnv', () => {
    if (!guardModule.checkDemoGuard) {
      throw new Error(`guard module not loaded: ${guardModule.loadError}`);
    }
    expect(() => {
      guardModule.checkDemoGuard({ ALLOW_DEMO_SEED: 'false', NODE_ENV: 'test', DEMO_SEED_PASSWORD: TEST_PASSWORD });
    }).toThrow(/ALLOW_DEMO_SEED/);

    expect(() => {
      guardModule.checkDemoGuard({ ALLOW_DEMO_SEED: undefined, NODE_ENV: 'test', DEMO_SEED_PASSWORD: TEST_PASSWORD });
    }).toThrow(/ALLOW_DEMO_SEED/);

    expect(() => {
      guardModule.checkDemoGuard({ ALLOW_DEMO_SEED: 'true', NODE_ENV: 'production', DEMO_SEED_PASSWORD: TEST_PASSWORD });
    }).toThrow(/production/);
  });

  // Test 2: R3, A3
  test('demo.seed.guard.refusesShortPassword', () => {
    if (!guardModule.checkDemoGuard) {
      throw new Error(`guard module not loaded: ${guardModule.loadError}`);
    }
    expect(() => {
      guardModule.checkDemoGuard({ ALLOW_DEMO_SEED: 'true', NODE_ENV: 'test', DEMO_SEED_PASSWORD: 'short' });
    }).toThrow(/DEMO_SEED_PASSWORD/);

    expect(() => {
      guardModule.checkDemoGuard({ ALLOW_DEMO_SEED: 'true', NODE_ENV: 'test', DEMO_SEED_PASSWORD: undefined });
    }).toThrow(/DEMO_SEED_PASSWORD/);
  });

  // Test 3: C10
  test('demo.seed.guard.refusesPlaceholderAsset', () => {
    if (!guardModule.checkDemoGuard) {
      throw new Error(`guard module not loaded: ${guardModule.loadError}`);
    }
    expect(() => {
      guardModule.checkDemoGuard(
        { ALLOW_DEMO_SEED: 'true', NODE_ENV: 'test', DEMO_SEED_PASSWORD: TEST_PASSWORD },
        { assets: { ...TEST_ASSETS, damageFront: { url: 'PLACEHOLDER_FRONT_URL', publicId: 'p1' } } }
      );
    }).toThrow(/placeholder/i);
  });

  // Test 3: R1, R2, R4, R7, R11, C6
  test('demo.seed.execution.exactDocumentCounts', async () => {
    if (!seededSummary) {
      throw new Error(`seed failed or not loaded: ${seedModule.loadError}`);
    }

    const org = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    expect(org).toBeTruthy();
    expect(org.name).toBe('شركة صَوْن التجريبية للتأمين');
    expect(org.settings.vatRatePercent).toBe(16);

    const userCount = await User.countDocuments({ organizationId: org._id });
    expect(userCount).toBe(9);

    const adminCount = await User.countDocuments({ organizationId: org._id, role: 'ADMIN' });
    const officerCount = await User.countDocuments({ organizationId: org._id, role: 'CLAIMS_OFFICER' });
    const adjusterCount = await User.countDocuments({ organizationId: org._id, role: 'FIELD_ADJUSTER' });
    expect(adminCount).toBe(1);
    expect(officerCount).toBe(2);
    expect(adjusterCount).toBe(6);

    const garageCount = await Garage.countDocuments({ organizationId: org._id });
    const approvedGarageCount = await Garage.countDocuments({ organizationId: org._id, approved: true });
    const unapprovedGarageCount = await Garage.countDocuments({ organizationId: org._id, approved: false });
    expect(garageCount).toBe(12);
    expect(approvedGarageCount).toBe(10);
    expect(unapprovedGarageCount).toBe(2);

    const customerCount = await Customer.countDocuments({ organizationId: org._id });
    expect(customerCount).toBe(250);

    const vehicleCount = await Vehicle.countDocuments({ organizationId: org._id });
    expect(vehicleCount).toBe(250);

    const policyCount = await Policy.countDocuments({ organizationId: org._id });
    expect(policyCount).toBe(400);

    const compulsoryCount = await Policy.countDocuments({ organizationId: org._id, policyKind: 'UNIFIED_COMPULSORY' });
    const complementaryCount = await Policy.countDocuments({ organizationId: org._id, policyKind: 'COMPLEMENTARY' });
    expect(compulsoryCount).toBe(250);
    expect(complementaryCount).toBe(150);

    const activePolicyCount = await Policy.countDocuments({ organizationId: org._id, status: 'ACTIVE' });
    const expiredPolicyCount = await Policy.countDocuments({ organizationId: org._id, status: 'EXPIRED' });
    const cancelledPolicyCount = await Policy.countDocuments({ organizationId: org._id, status: 'CANCELLED' });
    expect(activePolicyCount).toBe(340);
    expect(expiredPolicyCount).toBe(40);
    expect(cancelledPolicyCount).toBe(20);

    const claimCount = await Claim.countDocuments({ organizationId: org._id });
    expect(claimCount).toBe(39);

    const statuses = [
      'NEW',
      'PENDING_ACCEPTANCE',
      'ASSIGNED',
      'IN_PROGRESS',
      'SUBMITTED',
      'UNDER_REVIEW',
      'CORRECTION_REQUIRED',
      'APPROVED',
      'REJECTED',
      'CLOSED',
    ];

    for (const st of statuses) {
      const countForStatus = await Claim.countDocuments({ organizationId: org._id, status: st });
      expect(countForStatus).toBeGreaterThanOrEqual(3);
    }
  });

  // Test 4: B3, R12
  test('demo.seed.idempotency.secondRunNoOp', async () => {
    if (!seedModule.runDemoSeed) {
      throw new Error(`seedModule not loaded: ${seedModule.loadError}`);
    }

    const org = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    expect(org).toBeTruthy();

    const claimsBefore = await Claim.find({ organizationId: org._id }).select('claimNumber status').sort('claimNumber').lean();

    const secondRunLogs = [];
    const result = await seedModule.runDemoSeed({
      isReset: false,
      isConfirm: false,
      now: TEST_NOW,
      password: TEST_PASSWORD,
      assets: TEST_ASSETS,
      log: (...args) => secondRunLogs.push(args.join(' ')),
    });

    expect(result.alreadySeeded).toBe(true);

    const claimsAfter = await Claim.find({ organizationId: org._id }).select('claimNumber status').sort('claimNumber').lean();
    expect(claimsAfter).toEqual(claimsBefore);
  });

  // Test 5: R8
  test('demo.seed.determinism.identicalRuns', async () => {
    if (!seedModule.runDemoSeed) {
      throw new Error(`seedModule not loaded: ${seedModule.loadError}`);
    }

    const mainOrg = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    const mainClaims = await Claim.find({ organizationId: mainOrg._id })
      .select('claimNumber status lossAssessment.netApprovedPayout')
      .sort('claimNumber')
      .lean();
    const mainVehicles = await Vehicle.find({ organizationId: mainOrg._id })
      .select('plateNumber make model')
      .sort('plateNumber')
      .lean();

    // Reset cleanly to have an empty tenant
    await resetModule.resetTenant({ confirm: true, log: () => {} });

    // Seed again with the exact same injected now
    await seedModule.runDemoSeed({
      isReset: false,
      isConfirm: false,
      now: TEST_NOW,
      password: TEST_PASSWORD,
      assets: TEST_ASSETS,
      log: () => {},
    });

    const secondOrg = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    const secondClaims = await Claim.find({ organizationId: secondOrg._id })
      .select('claimNumber status lossAssessment.netApprovedPayout')
      .sort('claimNumber')
      .lean();
    const secondVehicles = await Vehicle.find({ organizationId: secondOrg._id })
      .select('plateNumber make model')
      .sort('plateNumber')
      .lean();

    expect(secondClaims.map((c) => ({ num: c.claimNumber, st: c.status, amt: c.lossAssessment?.netApprovedPayout })))
      .toEqual(mainClaims.map((c) => ({ num: c.claimNumber, st: c.status, amt: c.lossAssessment?.netApprovedPayout })));

    expect(secondVehicles.map((v) => ({ plate: v.plateNumber, make: v.make, model: v.model })))
      .toEqual(mainVehicles.map((v) => ({ plate: v.plateNumber, make: v.make, model: v.model })));
  });

  // Test 6: D1, R12, C9
  test('demo.seed.isolation.resetPreservesOtherTenants', async () => {
    if (!resetModule.resetTenant) {
      throw new Error(`resetModule not loaded: ${resetModule.loadError}`);
    }

    const otherOrg = await Organization.create({
      name: 'Other Insurer',
      code: 'OTHER-INS',
      settings: { vatRatePercent: 16 },
    });

    const otherUser = await User.create({
      name: 'Other User',
      employeeCode: 'OT-001',
      password: 'Password12345!',
      role: 'ADMIN',
      organizationId: otherOrg._id,
      status: 'ACTIVE',
    });

    const otherCounter = await Counter.create({
      _id: `claimNumber_${otherOrg._id}`,
      seq: 42,
    });

    const otherPolicy = await buildPolicy({
      organizationId: otherOrg._id,
    });

    const otherLetterCounter = await Counter.create({
      _id: `letter:${otherOrg._id}:2026`,
      seq: 5,
    });

    const otherPaymentCounter = await Counter.create({
      _id: `payment:${otherOrg._id}:2026`,
      seq: 7,
    });

    await resetModule.resetTenant({
      confirm: true,
      log: () => {},
    });

    const checkOtherOrg = await Organization.findById(otherOrg._id).lean();
    const checkOtherUser = await User.findById(otherUser._id).lean();
    const checkOtherPolicy = await Policy.findById(otherPolicy._id).lean();
    const checkOtherCounter = await Counter.findById(otherCounter._id).lean();
    const checkOtherLetterCounter = await Counter.findById(otherLetterCounter._id).lean();
    const checkOtherPaymentCounter = await Counter.findById(otherPaymentCounter._id).lean();

    expect(checkOtherOrg).toBeTruthy();
    expect(checkOtherUser).toBeTruthy();
    expect(checkOtherPolicy).toBeTruthy();
    expect(checkOtherCounter).toBeTruthy();
    expect(checkOtherCounter.seq).toBe(42);
    expect(checkOtherLetterCounter).toBeTruthy();
    expect(checkOtherLetterCounter.seq).toBe(5);
    expect(checkOtherPaymentCounter).toBeTruthy();
    expect(checkOtherPaymentCounter.seq).toBe(7);

    // Rebuild SAWN-DEMO for subsequent tests
    await seedModule.runDemoSeed({
      isReset: false,
      isConfirm: false,
      now: TEST_NOW,
      password: TEST_PASSWORD,
      assets: TEST_ASSETS,
      log: () => {},
    });
  });

  // Test 7: R12
  test('demo.seed.reset.dryRunDeletesNothing', async () => {
    if (!resetModule.resetTenant) {
      throw new Error(`resetModule not loaded: ${resetModule.loadError}`);
    }

    const org = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    expect(org).toBeTruthy();

    const countsBefore = await Claim.countDocuments({ organizationId: org._id });
    expect(countsBefore).toBe(39);

    const dryRunResult = await resetModule.resetTenant({
      confirm: false,
      log: () => {},
    });

    expect(dryRunResult.dryRun).toBe(true);

    const countsAfter = await Claim.countDocuments({ organizationId: org._id });
    expect(countsAfter).toBe(39);
  });

  // Test 8: B4, R6, C8
  test('demo.seed.security.usesFakeIdentityPrefixes', async () => {
    if (!fakeIdentityModule.generateFakePhone) {
      throw new Error(`fakeIdentityModule not loaded: ${fakeIdentityModule.loadError}`);
    }

    expect(() => fakeIdentityModule.generateFakePhone(10000)).toThrow();
    expect(fakeIdentityModule.generateFakePhone(0)).toMatch(/^\+97050000\d{4}$/);
    expect(fakeIdentityModule.generateFakePhone(9999)).toMatch(/^\+97050000\d{4}$/);

    const org = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    expect(org).toBeTruthy();

    const customers = await Customer.find({ organizationId: org._id }).lean();
    for (const c of customers) {
      expect(c.phone).toMatch(/^\+97050000\d{4}$/);
    }

    const incidents = await Incident.find({ organizationId: org._id }).lean();
    for (const inc of incidents) {
      for (const p of inc.parties || []) {
        if (p.idType === 'PALESTINIAN_ID') {
          expect(p.idNumber).toMatch(/^000\d{6}$/);
          expect(p.idNumber.length).toBe(9);
        }
        if (p.phone) {
          expect(p.phone).toMatch(/^\+97050000\d{4}$/);
        }
      }
    }
  });

  // Test 9: R5, C7
  test('demo.seed.plates.formatAndGovernorateMatching', async () => {
    const org = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    expect(org).toBeTruthy();

    const vehicles = await Vehicle.find({ organizationId: org._id }).lean();
    expect(vehicles.length).toBe(250);

    const plateSet = new Set();
    const govLetterMap = {
      JENIN: 'A',
      TULKARM: 'B',
      TUBAS: 'C',
      NABLUS: 'D',
      QALQILYA: 'E',
      SALFIT: 'F',
      JERICHO: 'G',
      RAMALLAH_AL_BIREH: 'H',
      JERUSALEM: 'J',
      BETHLEHEM: 'K',
      HEBRON: ['L', 'M', 'N'],
    };

    for (const v of vehicles) {
      expect(v.plateNumber).toMatch(/^\d-\d{4}-[A-HJ-N]$/);
      expect(plateSet.has(v.plateNumber)).toBe(false);
      plateSet.add(v.plateNumber);
    }

    const incidentsWithIsraeliPlates = await Incident.find({
      organizationId: org._id,
      'vehicles.plateRegion': 'ISRAELI',
    }).lean();

    expect(incidentsWithIsraeliPlates.length).toBeGreaterThanOrEqual(6);
    for (const inc of incidentsWithIsraeliPlates) {
      const tpVehicles = (inc.vehicles || []).filter((v) => v.plateRegion === 'ISRAELI');
      for (const tp of tpVehicles) {
        expect(tp.plateNumber).toMatch(/^\d{3}-\d{2}-\d{3}$/);
        expect(tp.vehicleId).toBeNull();
      }
    }
  });

  // Test 10: R10
  test('demo.seed.scenario.s1ToS9Lifecycle', async () => {
    const org = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    expect(org).toBeTruthy();

    const claims = await Claim.find({ organizationId: org._id }).sort('createdAt').lean();

    // S1 to S9 are the first 9 claims seeded for scenario 1
    const s1 = claims.find((c) => c.status === 'NEW' && c.timeline?.some((t) => t.action === 'Claim Created'));
    expect(s1).toBeTruthy();

    const s2 = claims.find((c) => c.status === 'ASSIGNED');
    expect(s2).toBeTruthy();

    const s3 = claims.find((c) => c.status === 'IN_PROGRESS');
    expect(s3).toBeTruthy();
    expect(s3.evidence.length).toBeGreaterThanOrEqual(1);

    const s4 = claims.find((c) => c.status === 'SUBMITTED');
    expect(s4).toBeTruthy();
    expect(s4.signature?.url).toBeTruthy();

    const s5 = claims.find((c) => c.status === 'UNDER_REVIEW');
    expect(s5).toBeTruthy();
    expect(s5.estimates.length).toBe(2);

    const s6 = claims.find((c) => c.status === 'APPROVED' && c.repairOrders?.[0]?.status === 'AUTHORIZED');
    expect(s6).toBeTruthy();
    const ltr6 = await Letter.findOne({ organizationId: org._id, claimId: s6._id, type: 'APPROVAL' }).lean();
    expect(ltr6).toBeTruthy();

    const s7 = claims.find((c) => c.status === 'APPROVED' && c.repairOrders?.[0]?.status === 'DELIVERED');
    expect(s7).toBeTruthy();
    const dsc7 = (s7.discharges || []).find((d) => d.status === 'SIGNED');
    expect(dsc7).toBeTruthy();
    expect(dsc7.signedScan?.url).toBeTruthy();

    const s8 = claims.find((c) => c.status === 'APPROVED' && c.paidTotals?.indemnity > 0 && c.paidTotals?.indemnity < c.lossAssessment?.netApprovedPayout);
    expect(s8).toBeTruthy();

    const s9 = claims.find((c) => c.status === 'CLOSED');
    expect(s9).toBeTruthy();
    expect(s9.paidTotals?.indemnity).toBe(s9.lossAssessment?.netApprovedPayout);
    expect(s9.reserve?.indemnity).toBe(0);
    expect(s9.reserve?.expense).toBe(0);
    const zeroHistory = (s9.reserve?.history || []).filter((h) => h.source === 'STATUS_ZERO');
    expect(zeroHistory.length).toBeGreaterThanOrEqual(2);
  });

  // Test 11: R2
  test('demo.seed.staff.permissionsAndLicenses', async () => {
    const org = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    expect(org).toBeTruthy();

    const officer1 = await User.findOne({ organizationId: org._id, employeeCode: 'DM-CO-001' }).lean();
    const officer2 = await User.findOne({ organizationId: org._id, employeeCode: 'DM-CO-002' }).lean();
    expect(officer1.canRecordPayments).toBe(true);
    expect(officer2.canRecordPayments).toBe(false);

    const expiredAdjuster = await User.findOne({ organizationId: org._id, employeeCode: 'DM-FA-006' }).lean();
    expect(expiredAdjuster).toBeTruthy();
    expect(new Date(expiredAdjuster.surveyorLicenseExpiry).getTime()).toBeLessThan(TEST_NOW.getTime());
  });

  // Test 12: R10, C4
  test('demo.seed.scenario.cleanLiveRunVehicle', async () => {
    const org = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    expect(org).toBeTruthy();

    const cleanVehicle = await Vehicle.findOne({
      organizationId: org._id,
      plateNumber: '1-1000-H',
    }).populate('compulsoryPolicyId complementaryPolicyId').lean();

    expect(cleanVehicle).toBeTruthy();
    expect(cleanVehicle.compulsoryPolicyId.status).toBe('ACTIVE');
    expect(cleanVehicle.complementaryPolicyId.status).toBe('ACTIVE');

    const claimsOnCleanVehicle = await Claim.countDocuments({
      organizationId: org._id,
      'vehicle.vehicleId': cleanVehicle._id,
    });
    expect(claimsOnCleanVehicle).toBe(0);
  });

  // Test 13: R14
  test('demo.seed.security.noPiiOrSecretsInOutput', () => {
    expect(outputLogs.length).toBeGreaterThan(0);
    const combinedOutput = outputLogs.join('\n');
    expect(combinedOutput).not.toContain(TEST_PASSWORD);
    expect(combinedOutput).not.toMatch(/\+97050000\d{4}/);
    expect(combinedOutput).not.toMatch(/000\d{6}/);
  });

  // Test 14: C2
  test('demo.seed.staff.passwordsHashed', async () => {
    const org = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    expect(org).toBeTruthy();

    const users = await User.find({ organizationId: org._id }).select('+password').lean();
    expect(users.length).toBe(9);

    for (const u of users) {
      expect(u.password).not.toBe(TEST_PASSWORD);
      const isMatch = await bcrypt.compare(TEST_PASSWORD, u.password);
      expect(isMatch).toBe(true);
    }
  });

  // Test 15: C6
  test('demo.seed.reset.incompleteTenantRefused', async () => {
    if (!seedModule.runDemoSeed) {
      throw new Error(`seedModule not loaded: ${seedModule.loadError}`);
    }

    const org = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    expect(org).toBeTruthy();

    // Delete one policy to make tenant incomplete
    await Policy.findOneAndDelete({ organizationId: org._id });

    await expect(
      seedModule.runDemoSeed({
        isReset: false,
        isConfirm: false,
        now: TEST_NOW,
        password: TEST_PASSWORD,
        assets: TEST_ASSETS,
        log: () => {},
      })
    ).rejects.toThrow(/SAWN-DEMO is incomplete/);

    // Restore tenant by resetting with confirm and re-seeding
    await resetModule.resetTenant({ confirm: true, log: () => {} });
    await seedModule.runDemoSeed({
      isReset: false,
      isConfirm: false,
      now: TEST_NOW,
      password: TEST_PASSWORD,
      assets: TEST_ASSETS,
      log: () => {},
    });
  });

  // Test 16: C3, C4
  test('demo.seed.scenario.distinctVehiclesAndAdjusterCaps', async () => {
    const org = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    expect(org).toBeTruthy();

    const fa1 = await User.findOne({ organizationId: org._id, employeeCode: 'DM-FA-001' }).lean();
    const fa2 = await User.findOne({ organizationId: org._id, employeeCode: 'DM-FA-002' }).lean();
    const fa3 = await User.findOne({ organizationId: org._id, employeeCode: 'DM-FA-003' }).lean();
    const fa4 = await User.findOne({ organizationId: org._id, employeeCode: 'DM-FA-004' }).lean();
    const fa5 = await User.findOne({ organizationId: org._id, employeeCode: 'DM-FA-005' }).lean();
    const fa6 = await User.findOne({ organizationId: org._id, employeeCode: 'DM-FA-006' }).lean();

    const activeStatuses = ['ASSIGNED', 'IN_PROGRESS', 'CORRECTION_REQUIRED'];

    const countFa1 = await Claim.countDocuments({ organizationId: org._id, assignedTo: fa1._id, status: { $in: activeStatuses } });
    const countFa2 = await Claim.countDocuments({ organizationId: org._id, assignedTo: fa2._id, status: { $in: activeStatuses } });
    const countFa3 = await Claim.countDocuments({ organizationId: org._id, assignedTo: fa3._id, status: { $in: activeStatuses } });
    const countFa4 = await Claim.countDocuments({ organizationId: org._id, assignedTo: fa4._id, status: { $in: activeStatuses } });
    const countFa5 = await Claim.countDocuments({ organizationId: org._id, assignedTo: fa5._id, status: { $in: activeStatuses } });
    const countFa6 = await Claim.countDocuments({ organizationId: org._id, assignedTo: fa6._id });

    expect(countFa1).toBeLessThanOrEqual(3);
    expect(countFa2).toBeLessThanOrEqual(3);
    expect(countFa3).toBeLessThanOrEqual(3);
    expect(countFa4).toBeLessThanOrEqual(3);
    expect(countFa5).toBe(0); // Reserved for live run
    expect(countFa6).toBe(0); // Expired license

    // Distinct vehicles for S1 to S9 + Live Run (10 total)
    const scenarioPlates = ['1-1000-H']; // Live run
    for (let i = 1; i <= 9; i++) {
      scenarioPlates.push(`1-100${i}-H`);
    }

    const uniquePlates = new Set(scenarioPlates);
    expect(uniquePlates.size).toBe(10);

    for (const plate of scenarioPlates) {
      const v = await Vehicle.findOne({ organizationId: org._id, plateNumber: plate }).lean();
      expect(v).toBeTruthy();
    }
  });

  // Test 17: C5
  test('demo.seed.policies.realisticCoverage', async () => {
    const org = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    expect(org).toBeTruthy();

    const vehicles = await Vehicle.find({ organizationId: org._id })
      .populate('compulsoryPolicyId complementaryPolicyId')
      .lean();

    for (const v of vehicles) {
      if (v.complementaryPolicyId && v.complementaryPolicyId.status === 'ACTIVE') {
        expect(v.compulsoryPolicyId).toBeTruthy();
        expect(v.compulsoryPolicyId.status).toBe('ACTIVE');
      }
    }

    const activePolicies = await Policy.find({ organizationId: org._id, status: 'ACTIVE' }).lean();
    const minStart = new Date(TEST_NOW.getTime() - 120 * 86400000);
    const minExpiry = new Date(TEST_NOW.getTime() + 180 * 86400000);

    for (const pol of activePolicies) {
      expect(new Date(pol.startDate).getTime()).toBeLessThanOrEqual(minStart.getTime());
      expect(new Date(pol.expiryDate).getTime()).toBeGreaterThanOrEqual(minExpiry.getTime());
    }

    const claims = await Claim.find({ organizationId: org._id }).populate('policyId').lean();
    for (const clm of claims) {
      expect(clm.policyId).toBeTruthy();
      expect(clm.policyId.status).toBe('ACTIVE');
      const incDate = new Date(clm.incidentDate || clm.createdAt);
      expect(incDate.getTime()).toBeGreaterThanOrEqual(new Date(clm.policyId.startDate).getTime());
      expect(incDate.getTime()).toBeLessThanOrEqual(new Date(clm.policyId.expiryDate).getTime());
    }
  });

  // Test 19: F5
  test('demo.seed.guard.runDemoSeedRefusesWithoutEnv', async () => {
    if (!seedModule.runDemoSeed) {
      throw new Error(`seedModule not loaded: ${seedModule.loadError}`);
    }

    const org = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    expect(org).toBeTruthy();
    const claimsBefore = await Claim.countDocuments({ organizationId: org._id });

    const savedEnv = process.env.ALLOW_DEMO_SEED;
    delete process.env.ALLOW_DEMO_SEED;

    try {
      await expect(
        seedModule.runDemoSeed({
          isReset: false,
          isConfirm: false,
          now: TEST_NOW,
          password: TEST_PASSWORD,
          assets: TEST_ASSETS,
          log: () => {},
        })
      ).rejects.toThrow(/ALLOW_DEMO_SEED/);

      const claimsAfter = await Claim.countDocuments({ organizationId: org._id });
      expect(claimsAfter).toBe(claimsBefore);
    } finally {
      if (savedEnv !== undefined) {
        process.env.ALLOW_DEMO_SEED = savedEnv;
      }
    }
  });

  // Test 20: F5
  test('demo.seed.staff.noPasswordFallback', async () => {
    const buildRef = typeof buildReferenceDataModule === 'function'
      ? buildReferenceDataModule
      : buildReferenceDataModule?.buildReferenceData;
    if (!buildRef) {
      throw new Error(`buildReferenceData not loaded: ${buildReferenceDataModule.loadError}`);
    }

    const org = await Organization.findOne({ code: 'SAWN-DEMO' }).lean();
    expect(org).toBeTruthy();
    const usersBefore = await User.countDocuments();

    // Call without a password
    await expect(
      buildRef({
        now: TEST_NOW,
      })
    ).rejects.toThrow(/password is required/);

    // Call with a 5-character password
    await expect(
      buildRef({
        password: 'short',
        now: TEST_NOW,
      })
    ).rejects.toThrow(/password is required/);

    const usersAfter = await User.countDocuments();
    expect(usersAfter).toBe(usersBefore);
  });
});

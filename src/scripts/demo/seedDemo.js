const mongoose = require('mongoose');
const config = require('../../config/env');
const Organization = require('../../modules/organizations/organization.model');
const User = require('../../modules/users/user.model');
const Garage = require('../../modules/garages/garage.model');
const Customer = require('../../modules/customers/customer.model');
const Vehicle = require('../../modules/vehicles/vehicle.model');
const Policy = require('../../modules/policies/policy.model');
const Incident = require('../../modules/incidents/incident.model');
const Claim = require('../../modules/claims/claim.model');
const Letter = require('../../modules/letters/letter.model');
const Notification = require('../../modules/notifications/notification.model');

const { checkDemoGuard } = require('./guard');
const { DEMO_ASSET_URLS, validateDemoAssets } = require('./demoAssets');
const { createPrng, createRandomHelpers } = require('./random');
const { buildReferenceData } = require('./buildReferenceData');
const { buildScenario } = require('./buildScenario');
const { buildDashboardClaims } = require('./buildDashboardClaims');
const { resetTenant } = require('./resetTenant');

const getModel = (conn, name, defaultModel) => {
  if (!conn || conn === mongoose || conn === mongoose.connection) {
    return defaultModel;
  }
  if (conn.models && conn.models[name]) {
    return conn.models[name];
  }
  if (typeof conn.model === 'function') {
    try {
      return conn.model(name);
    } catch {
      return conn.model(name, defaultModel.schema);
    }
  }
  return defaultModel;
};

/**
 * Runs the demo seed or reset process programmatically.
 * Callable from CLI or test suites without process.exit.
 */
const runDemoSeed = async ({
  connection = mongoose.connection,
  isReset = false,
  isConfirm = false,
  now = new Date(),
  password = process.env.DEMO_SEED_PASSWORD,
  assets = DEMO_ASSET_URLS,
  log = console.log,
} = {}) => {
  // 1. Guard checks
  checkDemoGuard({ ...process.env, DEMO_SEED_PASSWORD: password }, { checkAssets: false });

  // Validate asset URLs
  validateDemoAssets(assets);

  const conn = connection || mongoose.connection;
  const OrgModel = getModel(conn, 'Organization', Organization);
  const UserModel = getModel(conn, 'User', User);
  const GarageModel = getModel(conn, 'Garage', Garage);
  const CustomerModel = getModel(conn, 'Customer', Customer);
  const VehicleModel = getModel(conn, 'Vehicle', Vehicle);
  const PolicyModel = getModel(conn, 'Policy', Policy);
  const IncidentModel = getModel(conn, 'Incident', Incident);
  const ClaimModel = getModel(conn, 'Claim', Claim);

  // 2. Handle reset mode
  if (isReset) {
    const resetResult = await resetTenant({
      confirm: isConfirm,
      connection: conn,
      log,
    });

    if (!isConfirm) {
      return {
        dryRun: true,
        deletedCounts: resetResult.deletedCounts,
      };
    }
    log('[RESET] SAWN-DEMO tenant wiped cleanly. Proceeding with fresh build...');
  } else {
    // 3. Normal seed: check existing tenant
    const existingOrg = await OrgModel.findOne({ code: 'SAWN-DEMO' }).lean();

    if (existingOrg) {
      const [uCount, gCount, cuCount, vCount, pCount, clCount] = await Promise.all([
        UserModel.countDocuments({ organizationId: existingOrg._id }),
        GarageModel.countDocuments({ organizationId: existingOrg._id }),
        CustomerModel.countDocuments({ organizationId: existingOrg._id }),
        VehicleModel.countDocuments({ organizationId: existingOrg._id }),
        PolicyModel.countDocuments({ organizationId: existingOrg._id }),
        ClaimModel.countDocuments({ organizationId: existingOrg._id }),
      ]);

      const isComplete =
        uCount === 9 &&
        gCount === 12 &&
        cuCount === 250 &&
        vCount === 250 &&
        pCount === 400 &&
        clCount === 39;

      if (isComplete) {
        log('SAWN-DEMO already seeded. Use seed:demo:reset to rebuild.');
        return {
          alreadySeeded: true,
          counts: {
            users: uCount,
            garages: gCount,
            customers: cuCount,
            vehicles: vCount,
            policies: pCount,
            claims: clCount,
          },
        };
      }

      // C6: Incomplete tenant refuses to write and exits 1
      log('SAWN-DEMO is incomplete. Run npm run seed:demo:reset -- --confirm.');
      throw new Error('SAWN-DEMO is incomplete. Run npm run seed:demo:reset -- --confirm.');
    }
  }

  // 4. Seeding Pipeline
  const rnd = createPrng(0x5a1711);
  const rndHelpers = createRandomHelpers(rnd);

  // Phase 1: Reference Data
  const refData = await buildReferenceData({
    password,
    rndHelpers,
    now,
    connection: conn,
    conn,
  });

  // Phase 2: Scenario 1 (S1 to S9)
  const scenarioResult = await buildScenario({
    refData,
    assets,
    rndHelpers,
    now,
  });

  // Phase 3: Dashboard Claims (30 claims, 3 per status)
  const dashboardClaims = await buildDashboardClaims({
    refData,
    assets,
    rndHelpers,
    now,
  });

  const scenarioClaims = {
    s1: scenarioResult.s1.claimNumber,
    s2: scenarioResult.s2.claimNumber,
    s3: scenarioResult.s3.claimNumber,
    s4: scenarioResult.s4.claimNumber,
    s5: scenarioResult.s5.claimNumber,
    s6: scenarioResult.s6.claimNumber,
    s7: scenarioResult.s7.claimNumber,
    s8: scenarioResult.s8.claimNumber,
    s9: scenarioResult.s9.claimNumber,
  };

  const orgCount = await OrgModel.countDocuments({ code: 'SAWN-DEMO' });
  const [uCount, gCount, cuCount, vCount, pCount, incCount, clCount] = await Promise.all([
    UserModel.countDocuments({ organizationId: refData.organization._id }),
    GarageModel.countDocuments({ organizationId: refData.organization._id }),
    CustomerModel.countDocuments({ organizationId: refData.organization._id }),
    VehicleModel.countDocuments({ organizationId: refData.organization._id }),
    PolicyModel.countDocuments({ organizationId: refData.organization._id }),
    IncidentModel.countDocuments({ organizationId: refData.organization._id }),
    ClaimModel.countDocuments({ organizationId: refData.organization._id }),
  ]);

  const finalCounts = {
    organization: orgCount,
    users: uCount,
    garages: gCount,
    customers: cuCount,
    vehicles: vCount,
    policies: pCount,
    incidents: incCount,
    claims: clCount,
  };

  // 5. Output Summary (R14: no PII, no password, no ID numbers, no phones)
  log('==================================================');
  log('SAWN-DEMO Seed Summary');
  log('==================================================');
  log(`Tenant: ${refData.organization.name} (${refData.organization.code})`);
  log(`Organizations: ${finalCounts.organization}`);
  log(`Users: ${finalCounts.users}`);
  log(`Garages: ${finalCounts.garages}`);
  log(`Customers: ${finalCounts.customers}`);
  log(`Vehicles: ${finalCounts.vehicles}`);
  log(`Policies: ${finalCounts.policies}`);
  log(`Incidents: ${finalCounts.incidents}`);
  log(`Claims: ${finalCounts.claims}`);
  log('--------------------------------------------------');
  log('Scenario 1 Claims:');
  log(`  S1 (NEW): ${scenarioClaims.s1}`);
  log(`  S2 (ASSIGNED): ${scenarioClaims.s2}`);
  log(`  S3 (IN_PROGRESS): ${scenarioClaims.s3}`);
  log(`  S4 (SUBMITTED): ${scenarioClaims.s4}`);
  log(`  S5 (UNDER_REVIEW): ${scenarioClaims.s5}`);
  log(`  S6 (APPROVED, RO AUTHORIZED): ${scenarioClaims.s6}`);
  log(`  S7 (APPROVED, RO DELIVERED, SIGNED DISCHARGE): ${scenarioClaims.s7}`);
  log(`  S8 (APPROVED, PARTIALLY_PAID): ${scenarioClaims.s8}`);
  log(`  S9 (CLOSED, PAID): ${scenarioClaims.s9}`);
  log('--------------------------------------------------');
  log(`Live-run vehicle plate: 1-1000-H (clean, 0 claims)`);
  log('==================================================');

  return {
    success: true,
    counts: finalCounts,
    scenarioClaims,
    liveRunPlate: '1-1000-H',
  };
};

/**
 * Main CLI executor.
 */
const main = async () => {
  const args = process.argv.slice(2);
  const isReset = args.includes('--reset');
  const isConfirm = args.includes('--confirm');

  // Guard assertion before database connection
  try {
    checkDemoGuard(process.env, { checkAssets: !isReset });
  } catch (guardErr) {
    console.error(guardErr.message);
    process.exit(1);
  }

  try {
    await mongoose.connect(config.databaseUrl);
    await runDemoSeed({
      connection: mongoose.connection,
      isReset,
      isConfirm,
      now: new Date(),
      password: process.env.DEMO_SEED_PASSWORD,
      assets: DEMO_ASSET_URLS,
      log: console.log,
    });
    process.exit(0);
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(1);
  } finally {
    try {
      await mongoose.disconnect();
    } catch {
      // Disconnect safely
    }
  }
};

if (require.main === module) {
  main();
}

module.exports = {
  runDemoSeed,
};

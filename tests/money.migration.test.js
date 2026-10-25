const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const migrateMoneyToMinorUnits = require('../src/scripts/migrateMoneyToMinorUnits');

jest.setTimeout(30000);

describe('migrateMoneyToMinorUnits script (PB-39)', () => {
  let mongoServer;
  let policiesColl;
  let claimsColl;
  const orgId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
    policiesColl = mongoose.connection.db.collection('policies');
    claimsColl = mongoose.connection.db.collection('claims');
  });

  afterEach(async () => {
    await policiesColl.deleteMany({});
    await claimsColl.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  test('MIG-01 dry run changes no document', async () => {
    const policyId = new mongoose.Types.ObjectId();
    await policiesColl.insertOne({
      _id: policyId,
      policyNumber: 'POL-LEGACY-01',
      deductibleAmount: 500,
      sumInsured: 50000,
      organizationId: orgId,
    });

    const claimId = new mongoose.Types.ObjectId();
    await claimsColl.insertOne({
      _id: claimId,
      claimNumber: 'CLM-LEGACY-01',
      coverageSnapshot: { deductibleAmount: 500, sumInsured: 50000 },
      lossAssessment: {
        estimatedPartsCost: 1000,
        laborCost: 500,
        totalDamage: 1500,
        policyDeductible: 500,
        deductibleApplied: 500,
        netApprovedPayout: 1000,
      },
      organizationId: orgId,
    });

    const result = await migrateMoneyToMinorUnits({ apply: false, disconnect: false });

    expect(result.isDryRun).toBe(true);
    expect(result.policies.found).toBe(1);
    expect(result.policies.updated).toBe(0);
    expect(result.claims.found).toBe(1);
    expect(result.claims.updated).toBe(0);

    const docPolicy = await policiesColl.findOne({ _id: policyId });
    expect(docPolicy.moneyUnit).toBeUndefined();
    expect(docPolicy.deductibleAmount).toBe(500);

    const docClaim = await claimsColl.findOne({ _id: claimId });
    expect(docClaim.moneyUnit).toBeUndefined();
    expect(docClaim.coverageSnapshot.deductibleAmount).toBe(500);
    expect(docClaim.lossAssessment.totalDamage).toBe(1500);
  });

  test('MIG-02 apply converts a legacy policy and a legacy claim and sets moneyUnit', async () => {
    const policyId = new mongoose.Types.ObjectId();
    await policiesColl.insertOne({
      _id: policyId,
      policyNumber: 'POL-LEGACY-02',
      deductibleAmount: 500,
      sumInsured: 50000,
      organizationId: orgId,
    });

    const claimId = new mongoose.Types.ObjectId();
    await claimsColl.insertOne({
      _id: claimId,
      claimNumber: 'CLM-LEGACY-02',
      coverageSnapshot: { deductibleAmount: 500, sumInsured: 50000 },
      lossAssessment: {
        estimatedPartsCost: 1000,
        laborCost: 500,
        totalDamage: 1500,
        policyDeductible: 500,
        deductibleApplied: 500,
        netApprovedPayout: 1000,
      },
      organizationId: orgId,
    });

    const result = await migrateMoneyToMinorUnits({ apply: true, disconnect: false });

    expect(result.isDryRun).toBe(false);
    expect(result.policies.found).toBe(1);
    expect(result.policies.updated).toBe(1);
    expect(result.claims.found).toBe(1);
    expect(result.claims.updated).toBe(1);

    const docPolicy = await policiesColl.findOne({ _id: policyId });
    expect(docPolicy.moneyUnit).toBe('MINOR');
    expect(docPolicy.deductibleAmount).toBe(50000);
    expect(docPolicy.sumInsured).toBe(5000000);

    const docClaim = await claimsColl.findOne({ _id: claimId });
    expect(docClaim.moneyUnit).toBe('MINOR');
    expect(docClaim.coverageSnapshot.deductibleAmount).toBe(50000);
    expect(docClaim.coverageSnapshot.sumInsured).toBe(5000000);
    expect(docClaim.lossAssessment.estimatedPartsCost).toBe(100000);
    expect(docClaim.lossAssessment.laborCost).toBe(50000);
    expect(docClaim.lossAssessment.totalDamage).toBe(150000);
    expect(docClaim.lossAssessment.policyDeductible).toBe(50000);
    expect(docClaim.lossAssessment.deductibleApplied).toBe(50000);
    expect(docClaim.lossAssessment.netApprovedPayout).toBe(100000);
  });

  test('MIG-03 a second apply updates nothing', async () => {
    const policyId = new mongoose.Types.ObjectId();
    await policiesColl.insertOne({
      _id: policyId,
      policyNumber: 'POL-LEGACY-03',
      deductibleAmount: 250,
      organizationId: orgId,
    });

    const firstRun = await migrateMoneyToMinorUnits({ apply: true, disconnect: false });
    expect(firstRun.policies.updated).toBe(1);

    const secondRun = await migrateMoneyToMinorUnits({ apply: true, disconnect: false });
    expect(secondRun.policies.found).toBe(0);
    expect(secondRun.policies.updated).toBe(0);
    expect(secondRun.claims.found).toBe(0);
    expect(secondRun.claims.updated).toBe(0);
  });

  test('MIG-04 a document already marked MINOR is untouched', async () => {
    const policyId = new mongoose.Types.ObjectId();
    await policiesColl.insertOne({
      _id: policyId,
      policyNumber: 'POL-ALREADY-MINOR',
      deductibleAmount: 50000,
      moneyUnit: 'MINOR',
      organizationId: orgId,
    });

    const result = await migrateMoneyToMinorUnits({ apply: true, disconnect: false });
    expect(result.policies.found).toBe(0);
    expect(result.policies.updated).toBe(0);

    const doc = await policiesColl.findOne({ _id: policyId });
    expect(doc.deductibleAmount).toBe(50000);
    expect(doc.moneyUnit).toBe('MINOR');
  });

  test('MIG-05 a document with an invalid value is reported and skipped, and the other documents are still converted (C1)', async () => {
    const validPolicyId = new mongoose.Types.ObjectId();
    await policiesColl.insertOne({
      _id: validPolicyId,
      policyNumber: 'POL-VALID-MIG',
      deductibleAmount: 500,
      organizationId: orgId,
    });

    const badPolicyId = new mongoose.Types.ObjectId();
    await policiesColl.insertOne({
      _id: badPolicyId,
      policyNumber: 'POL-BAD-MIG',
      deductibleAmount: 12.3456, // exceeds ILS 2 decimals
      organizationId: orgId,
    });

    const result = await migrateMoneyToMinorUnits({ apply: true, disconnect: false });

    expect(result.policies.found).toBe(2);
    expect(result.policies.updated).toBe(1);
    expect(result.policies.failed).toBe(1);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0]._id.toString()).toBe(badPolicyId.toString());

    // Valid doc was converted
    const validDoc = await policiesColl.findOne({ _id: validPolicyId });
    expect(validDoc.deductibleAmount).toBe(50000);
    expect(validDoc.moneyUnit).toBe('MINOR');

    // Bad doc was skipped and untouched
    const badDoc = await policiesColl.findOne({ _id: badPolicyId });
    expect(badDoc.deductibleAmount).toBe(12.3456);
    expect(badDoc.moneyUnit).toBeUndefined();
  });
});

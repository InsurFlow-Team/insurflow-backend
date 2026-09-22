const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Organization = require('../src/modules/organizations/organization.model');
const User = require('../src/modules/users/user.model');
const Claim = require('../src/modules/claims/claim.model');
const Counter = require('../src/utils/counter.model');

const Policy = require('../src/modules/policies/policy.model');
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
});

/**
 * Helper: extract sequence number from claim number string.
 * Example: 'CLM-ORG-1-0003' → 3
 */
const getSeq = (claimNumber) => parseInt(claimNumber.split('-').pop(), 10);

describe('Tenant-Scoped Claim Numbering (CLM-<ORG_CODE>-NNNN)', () => {
  let orgA, orgB;
  let officerA, officerB;

  beforeEach(async () => {
    orgA = await Organization.create({ name: 'Alpha Insurance', code: 'ALPHA' });
    global.__testPol = await Policy.create({ policyNumber: 'POL-FIX-001', status: 'ACTIVE', startDate: new Date('2026-01-01'), expiryDate: new Date('2027-12-31'), organizationId: orgA._id });
    orgB = await Organization.create({ name: 'Beta Corp', code: 'BETA' });

    officerA = await User.create({
      name: 'Officer A',
      employeeCode: 'CO-A',
      password: 'password',
      role: 'CLAIMS_OFFICER',
      organizationId: orgA._id,
      status: 'ACTIVE',
    });

    officerB = await User.create({
      name: 'Officer B',
      employeeCode: 'CO-B',
      password: 'password',
      role: 'CLAIMS_OFFICER',
      organizationId: orgB._id,
      status: 'ACTIVE',
    });
  });

  const createClaimForOrg = (orgId, createdById) => {
    return Claim.create({
      organizationId: orgId,
      policyId: global.__testPol._id,
      createdBy: createdById,
      status: 'NEW',
      customer: { name: 'Customer', phone: '0500000000' },
      incidentType: 'COLLISION',
      incidentLocation: 'Test Location',
    });
  };

  it('should generate claim numbers with the correct org-code format', async () => {
    const claimA = await createClaimForOrg(orgA._id, officerA._id);
    const claimB = await createClaimForOrg(orgB._id, officerB._id);

    expect(claimA.claimNumber).toMatch(/^CLM-ALPHA-\d{4}$/);
    expect(claimB.claimNumber).toMatch(/^CLM-BETA-\d{4}$/);
  });

  it('should start each organization sequence independently at 0001', async () => {
    const claimA = await createClaimForOrg(orgA._id, officerA._id);
    const claimB = await createClaimForOrg(orgB._id, officerB._id);

    expect(claimA.claimNumber).toBe('CLM-ALPHA-0001');
    expect(claimB.claimNumber).toBe('CLM-BETA-0001');
  });

  it('should increment sequence within a single tenant', async () => {
    const c1 = await createClaimForOrg(orgA._id, officerA._id);
    const c2 = await createClaimForOrg(orgA._id, officerA._id);
    const c3 = await createClaimForOrg(orgA._id, officerA._id);

    expect(c1.claimNumber).toBe('CLM-ALPHA-0001');
    expect(c2.claimNumber).toBe('CLM-ALPHA-0002');
    expect(c3.claimNumber).toBe('CLM-ALPHA-0003');
  });

  it('should NOT consume a new sequence number when an existing claim is updated via save()', async () => {
    const c1 = await createClaimForOrg(orgA._id, officerA._id);
    expect(c1.claimNumber).toBe('CLM-ALPHA-0001');

    // Simulate an update via Mongoose save() — must NOT increment the counter
    const claimDoc = await Claim.findById(c1._id);
    claimDoc.incidentLocation = 'Updated Location';
    await claimDoc.save();

    // Counter should still be at 1
    const counter = await Counter.findById(`claimNumber_${orgA._id}`);
    expect(counter.seq).toBe(1);

    // Next new claim should be 0002, not 0003
    const c2 = await createClaimForOrg(orgA._id, officerA._id);
    expect(c2.claimNumber).toBe('CLM-ALPHA-0002');
  });

  it('should maintain completely independent counters across organizations', async () => {
    // Create 3 claims in Org A, 2 claims in Org B
    await createClaimForOrg(orgA._id, officerA._id);
    await createClaimForOrg(orgA._id, officerA._id);
    await createClaimForOrg(orgA._id, officerA._id);

    await createClaimForOrg(orgB._id, officerB._id);
    await createClaimForOrg(orgB._id, officerB._id);

    // Next claim in Org A should be 0004 (not 0006)
    const nextA = await createClaimForOrg(orgA._id, officerA._id);
    expect(nextA.claimNumber).toBe('CLM-ALPHA-0004');

    // Next claim in Org B should be 0003 (not 0006)
    const nextB = await createClaimForOrg(orgB._id, officerB._id);
    expect(nextB.claimNumber).toBe('CLM-BETA-0003');
  });

  it('should produce 15 unique sequential numbers under concurrent creation within a single tenant', async () => {
    const promises = Array.from({ length: 15 }, () =>
      createClaimForOrg(orgA._id, officerA._id)
    );

    const claims = await Promise.all(promises);

    // All claim numbers must be unique
    const claimNumbers = claims.map((c) => c.claimNumber);
    const uniqueNumbers = new Set(claimNumbers);
    expect(uniqueNumbers.size).toBe(15);

    // All must match format
    claimNumbers.forEach((cn) => {
      expect(cn).toMatch(/^CLM-ALPHA-\d{4}$/);
    });

    // Extract and sort sequences — should be contiguous 1..15
    const sequences = claimNumbers.map(getSeq).sort((a, b) => a - b);
    const expectedSequences = Array.from({ length: 15 }, (_, i) => i + 1);
    expect(sequences).toEqual(expectedSequences);
  });

  it('should produce independent unique sequences when two tenants create claims concurrently', async () => {
    // 15 concurrent claims for Org A + 15 concurrent claims for Org B simultaneously
    const promisesA = Array.from({ length: 15 }, () =>
      createClaimForOrg(orgA._id, officerA._id)
    );
    const promisesB = Array.from({ length: 15 }, () =>
      createClaimForOrg(orgB._id, officerB._id)
    );

    const allClaims = await Promise.all([...promisesA, ...promisesB]);

    const claimsA = allClaims.filter((c) => c.organizationId.toString() === orgA._id.toString());
    const claimsB = allClaims.filter((c) => c.organizationId.toString() === orgB._id.toString());

    expect(claimsA.length).toBe(15);
    expect(claimsB.length).toBe(15);

    // Org A: all unique, correct format, contiguous 1..15
    const numbersA = claimsA.map((c) => c.claimNumber);
    expect(new Set(numbersA).size).toBe(15);
    numbersA.forEach((cn) => expect(cn).toMatch(/^CLM-ALPHA-\d{4}$/));
    const seqsA = numbersA.map(getSeq).sort((a, b) => a - b);
    expect(seqsA).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));

    // Org B: all unique, correct format, contiguous 1..15
    const numbersB = claimsB.map((c) => c.claimNumber);
    expect(new Set(numbersB).size).toBe(15);
    numbersB.forEach((cn) => expect(cn).toMatch(/^CLM-BETA-\d{4}$/));
    const seqsB = numbersB.map(getSeq).sort((a, b) => a - b);
    expect(seqsB).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  it('should use the compound unique index to prevent duplicate claim numbers within a tenant', async () => {
    // Verify the unique index exists on { organizationId, claimNumber }
    const indexes = await Claim.collection.indexes();
    const compoundIndex = indexes.find(
      (idx) => idx.key.organizationId === 1 && idx.key.claimNumber === 1
    );
    expect(compoundIndex).toBeDefined();
    expect(compoundIndex.unique).toBe(true);
  });
});

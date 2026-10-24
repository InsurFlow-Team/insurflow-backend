const Policy = require('../../src/modules/policies/policy.model');

/**
 * Generates valid default policy payload attributes without persisting to DB.
 *
 * @param {object} overrides - Custom field overrides
 * @returns {object} The complete policy payload
 */
const buildPolicyPayload = (overrides = {}) => {
  const policyKind =
    overrides.policyKind ||
    (overrides.policyType === 'THIRD_PARTY' ? 'UNIFIED_COMPULSORY' : 'COMPLEMENTARY');

  let defaultPolicyType;
  let defaultCoveredPerils;
  let defaultSumInsured;
  let defaultPropertyDamageLimit;
  let defaultDeductibleAmount;

  if (policyKind === 'UNIFIED_COMPULSORY') {
    defaultPolicyType = null;
    defaultCoveredPerils = [];
    defaultSumInsured = null;
    defaultPropertyDamageLimit = 100000;
    defaultDeductibleAmount = 0;
  } else {
    // COMPLEMENTARY
    defaultPolicyType = 'COMPREHENSIVE';
    defaultCoveredPerils = ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'];
    defaultSumInsured = 50000;
    defaultPropertyDamageLimit = null;
    defaultDeductibleAmount = 500;
  }

  const defaults = {
    policyNumber: `POL-AUTO-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    policyKind,
    status: 'ACTIVE',
    startDate: new Date('2025-01-01T00:00:00.000Z'),
    expiryDate: new Date('2026-12-31T23:59:59.999Z'),
    policyType: defaultPolicyType,
    coveredPerils: defaultCoveredPerils,
    deductibleAmount: defaultDeductibleAmount,
    sumInsured: defaultSumInsured,
    propertyDamageLimit: defaultPropertyDamageLimit,
  };

  const payload = {
    ...defaults,
    ...overrides,
  };

  // If UNIFIED_COMPULSORY and policyType was passed as THIRD_PARTY, clear policyType to null per A14
  if (payload.policyKind === 'UNIFIED_COMPULSORY' && payload.policyType === 'THIRD_PARTY') {
    payload.policyType = null;
  }

  return payload;
};

/**
 * Builds and persists a Policy document with guaranteed valid default values.
 *
 * @param {object} overrides - Custom field overrides
 * @returns {Promise<Document>} The persisted Mongoose Policy document
 */
const buildPolicy = async (overrides = {}) => {
  const payload = buildPolicyPayload(overrides);
  return await Policy.create(payload);
};

module.exports = {
  buildPolicy,
  buildPolicyPayload,
};

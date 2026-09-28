const Policy = require('../../src/modules/policies/policy.model');

/**
 * Generates valid default policy payload attributes without persisting to DB.
 *
 * @param {object} overrides - Custom field overrides
 * @returns {object} The complete policy payload
 */
const buildPolicyPayload = (overrides = {}) => {
  const defaultPolicyType = overrides.policyType || 'COMPREHENSIVE';
  const defaultCoveredPerils =
    overrides.coveredPerils !== undefined
      ? overrides.coveredPerils
      : defaultPolicyType === 'COMPREHENSIVE'
      ? ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER']
      : [];

  const defaultDeductibleAmount =
    overrides.deductibleAmount !== undefined
      ? overrides.deductibleAmount
      : defaultPolicyType === 'COMPREHENSIVE'
      ? 500
      : 0;

  const defaults = {
    policyNumber: `POL-AUTO-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    status: 'ACTIVE',
    startDate: new Date('2025-01-01T00:00:00.000Z'),
    expiryDate: new Date('2026-12-31T23:59:59.999Z'),
    policyType: defaultPolicyType,
    coveredPerils: defaultCoveredPerils,
    deductibleAmount: defaultDeductibleAmount,
  };

  return {
    ...defaults,
    ...overrides,
  };
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

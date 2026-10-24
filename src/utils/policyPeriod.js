const { toHebronDate } = require('./hebronDate');

/**
 * Evaluates policy period validity against an incident.
 *
 * Rules:
 *  - When incidentAt is provided: Instant rule.
 *    Valid if incidentAt >= policy.startDate and Hebron date of incidentAt <= Hebron date of policy.expiryDate.
 *  - When incidentAt is omitted: Day rule (using incidentDate).
 *    Valid if Hebron date of policy.startDate <= incidentDate <= Hebron date of policy.expiryDate.
 *
 * @param {object} params
 * @param {object} params.policy
 * @param {Date|string|null} [params.incidentAt]
 * @param {string|null} [params.incidentDate] - YYYY-MM-DD
 * @returns {string|null} null when covered, else 'BEFORE_POLICY_START' or 'AFTER_POLICY_EXPIRY'
 */
const getPolicyPeriodViolation = ({ policy, incidentAt, incidentDate }) => {
  if (!policy || !policy.startDate || !policy.expiryDate) {
    return null;
  }

  if (incidentAt) {
    // Instant rule
    const incidentInstant = new Date(incidentAt);
    const startInstant = new Date(policy.startDate);
    if (incidentInstant < startInstant) {
      return 'BEFORE_POLICY_START';
    }

    const incidentHebronDate = toHebronDate(incidentInstant);
    const expiryHebronDate = toHebronDate(policy.expiryDate);
    if (incidentHebronDate > expiryHebronDate) {
      return 'AFTER_POLICY_EXPIRY';
    }

    return null;
  }

  // Day rule
  if (incidentDate) {
    const startHebronDate = toHebronDate(policy.startDate);
    const expiryHebronDate = toHebronDate(policy.expiryDate);

    if (incidentDate < startHebronDate) {
      return 'BEFORE_POLICY_START';
    }
    if (incidentDate > expiryHebronDate) {
      return 'AFTER_POLICY_EXPIRY';
    }

    return null;
  }

  return null;
};

module.exports = {
  getPolicyPeriodViolation,
};

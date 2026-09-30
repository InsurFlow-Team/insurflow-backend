const { ELIGIBILITY_HINTS } = require('../modules/policies/policy.model');

/**
 * Pure function to compute eligibility hint based on policy coverage and incident details.
 * Evaluates policy type presence, validity period against incident date, and covered perils.
 *
 * @param {Object} params
 * @param {Object} params.policy - The policy document or object
 * @param {string|null} [params.incidentType] - Peril type of the incident
 * @param {string|null} [params.incidentDate] - Incident date as YYYY-MM-DD
 * @param {Date} [params.now=new Date()] - Reference date fallback when incidentDate is omitted
 * @returns {string|null} ELIGIBILITY_HINTS value or null
 */
const computeEligibilityHint = ({ policy, incidentType, incidentDate, now = new Date() }) => {
  // 1. If an incident type is supplied but the policy lacks a policyType (legacy unmigrated policy), coverage is unknown.
  if (incidentType && !policy.policyType) {
    return ELIGIBILITY_HINTS.COVERAGE_UNKNOWN;
  }

  // 2. Determine reference date and compare against policy validity period (inclusive).
  const refDateStr = incidentDate || new Date(now).toISOString().split('T')[0];
  const startDateStr = policy.startDate
    ? new Date(policy.startDate).toISOString().split('T')[0]
    : null;
  const expiryDateStr = policy.expiryDate
    ? new Date(policy.expiryDate).toISOString().split('T')[0]
    : null;

  if (startDateStr && expiryDateStr) {
    if (refDateStr < startDateStr || refDateStr > expiryDateStr) {
      return ELIGIBILITY_HINTS.INCIDENT_OUTSIDE_POLICY_PERIOD;
    }
  }

  // 3. If no incident type was provided, no peril-level eligibility hint applies.
  if (!incidentType) {
    return null;
  }

  // 4. Verify whether the incident peril is covered by the policy's coveredPerils array.
  const coveredPerils = Array.isArray(policy.coveredPerils) ? policy.coveredPerils : [];
  if (!coveredPerils.includes(incidentType)) {
    return ELIGIBILITY_HINTS.NOT_COVERED_BY_POLICY_TYPE;
  }

  // 5. When all criteria pass, the claim is eligible for review.
  return ELIGIBILITY_HINTS.ELIGIBLE_FOR_REVIEW;
};

module.exports = computeEligibilityHint;

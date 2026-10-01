const { ELIGIBILITY_HINTS } = require('../modules/policies/policy.model');

/**
 * Mapping between granular claim incident types and core policy covered perils.
 * Granular collision variants map to the canonical COLLISION peril.
 * Unmapped perils (THEFT, FIRE, NATURAL_DISASTER) pass through unchanged.
 * OTHER explicitly maps to null as it does not correspond to a standard peril.
 */
const CLAIM_TYPE_TO_PERIL = Object.freeze({
  COLLISION: 'COLLISION',
  REAR_END_COLLISION: 'COLLISION',
  SIDE_IMPACT: 'COLLISION',
  PARKING_DAMAGE: 'COLLISION',
  OTHER: null,
});

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

  // 4. Map the claim incident type to its policy covered peril.
  const mappedPeril = Object.prototype.hasOwnProperty.call(CLAIM_TYPE_TO_PERIL, incidentType)
    ? CLAIM_TYPE_TO_PERIL[incidentType]
    : incidentType;

  if (mappedPeril === null) {
    return null;
  }

  // 5. Verify whether the mapped peril is covered by the policy's coveredPerils array.
  const coveredPerils = Array.isArray(policy.coveredPerils) ? policy.coveredPerils : [];
  if (!coveredPerils.includes(mappedPeril)) {
    return ELIGIBILITY_HINTS.NOT_COVERED_BY_POLICY_TYPE;
  }

  // 6. When all criteria pass, the claim is eligible for review.
  return ELIGIBILITY_HINTS.ELIGIBLE_FOR_REVIEW;
};

computeEligibilityHint.CLAIM_TYPE_TO_PERIL = CLAIM_TYPE_TO_PERIL;

module.exports = computeEligibilityHint;

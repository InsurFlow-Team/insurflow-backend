/**
 * Pure timing helpers for assignment acceptance expiration and adjuster location staleness.
 * Imports no models and contains no side effects.
 */

/**
 * Returns true when a PENDING_ACCEPTANCE claim is past its acceptance window.
 * A null acceptanceDueAt on a PENDING_ACCEPTANCE claim counts as expired (legacy data).
 * Outside PENDING_ACCEPTANCE, returns false.
 *
 * @param {Object} claim - Plain claim document or object
 * @param {Date} [now=new Date()] - Reference time
 * @param {number} [acceptanceMinutes=5] - Allowed acceptance window in minutes
 * @returns {boolean}
 */
const isAssignmentExpired = (claim, now = new Date(), acceptanceMinutes = 5) => {
  if (!claim || claim.status !== 'PENDING_ACCEPTANCE') {
    return false;
  }
  if (!claim.acceptanceDueAt) {
    return true;
  }
  return new Date(claim.acceptanceDueAt).getTime() <= new Date(now).getTime();
};

/**
 * Returns true when location.updatedAt is null or older than staleMinutes.
 *
 * @param {Object|null} location - Location subdocument with updatedAt
 * @param {Date} [now=new Date()] - Reference time
 * @param {number} [staleMinutes=15] - Staleness threshold in minutes
 * @returns {boolean}
 */
const isLocationStale = (location, now = new Date(), staleMinutes = 15) => {
  if (!location || !location.updatedAt) {
    return true;
  }
  const ageMs = new Date(now).getTime() - new Date(location.updatedAt).getTime();
  return ageMs > staleMinutes * 60 * 1000;
};

module.exports = {
  isAssignmentExpired,
  isLocationStale,
};

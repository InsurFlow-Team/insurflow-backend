/**
 * Stage timing, status history, and SLA calculation utilities for claims.
 */

const DEFAULT_STATUS_SLA_HOURS = Object.freeze({
  NEW: 24,
  PENDING_ACCEPTANCE: 4,
  ASSIGNED: 48,
  IN_PROGRESS: 48,
  SUBMITTED: 24,
  UNDER_REVIEW: 120,
  CORRECTION_REQUIRED: 48,
  APPROVED: 720,
});

/**
 * Checks whether a timeline event represents a true status transition.
 * A transition event must have a non-null/non-undefined newStatus that differs from previousStatus.
 *
 * @param {Object} event
 * @returns {boolean}
 */
function isStatusTransition(event) {
  if (!event || event.newStatus === null || event.newStatus === undefined) {
    return false;
  }
  return event.newStatus !== event.previousStatus;
}

/**
 * Resolves SLA threshold in calendar hours for a given status.
 *
 * @param {Object|null|undefined} statusSlaHours - The organization's settings.statusSlaHours object
 * @param {string} status - Claim status
 * @returns {number|null} SLA hours or null if status has no threshold (REJECTED, CLOSED, unknown)
 */
function resolveSlaHours(statusSlaHours, status) {
  if (status === 'REJECTED' || status === 'CLOSED') {
    return null;
  }

  const override = statusSlaHours?.[status];
  if (typeof override === 'number' && Number.isInteger(override) && override >= 1) {
    return override;
  }

  return DEFAULT_STATUS_SLA_HOURS[status] ?? null;
}

/**
 * Computes statusDueAt date by adding SLA calendar hours to statusEnteredAt.
 *
 * @param {Date|string|null} enteredAt
 * @param {number|null} slaHours
 * @returns {Date|null}
 */
function computeStatusDueAt(enteredAt, slaHours) {
  if (!enteredAt || typeof slaHours !== 'number' || !Number.isFinite(slaHours) || slaHours <= 0) {
    return null;
  }

  const enteredTime = enteredAt instanceof Date ? enteredAt.getTime() : new Date(enteredAt).getTime();
  if (Number.isNaN(enteredTime)) {
    return null;
  }

  return new Date(enteredTime + slaHours * 3600 * 1000);
}

/**
 * Resolves the Date when the claim entered its current status.
 *
 * Rule A1:
 * - Last status transition event whose newStatus equals currentStatus.
 * - If status is NEW and no transition event found: 'Claim Created' timestamp, else createdAt.
 * - If status is not NEW and no transition event found: null (never fall back to createdAt).
 *
 * @param {string} currentStatus
 * @param {Array<Object>} timeline
 * @param {Date|string|null} createdAt
 * @returns {Date|null}
 */
function resolveStatusEnteredAt(currentStatus, timeline = [], createdAt = null) {
  if (Array.isArray(timeline) && timeline.length > 0) {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const event = timeline[i];
      if (isStatusTransition(event) && event.newStatus === currentStatus) {
        return event.timestamp ? new Date(event.timestamp) : null;
      }
    }
  }

  if (currentStatus === 'NEW') {
    if (Array.isArray(timeline)) {
      const createdEvent = timeline.find((e) => e.action === 'Claim Created');
      if (createdEvent?.timestamp) {
        return new Date(createdEvent.timestamp);
      }
    }
    return createdAt ? new Date(createdAt) : null;
  }

  return null;
}

/**
 * Formats enteredBy user info matching timeline.performedBy shape.
 * Rule C2: enteredBy.role is the role recorded on the event (event.role).
 * Use performedBy.role only when event.role is missing.
 *
 * @param {Object} performedBy
 * @param {string|null|undefined} eventRole
 * @returns {Object|null}
 */
function formatEnteredBy(performedBy, eventRole) {
  if (!performedBy) return null;

  const id = performedBy._id ?? performedBy.id ?? (typeof performedBy === 'object' ? null : performedBy);
  const role = (eventRole !== null && eventRole !== undefined)
    ? eventRole
    : (performedBy.role ?? null);

  return {
    id: id ? id.toString() : null,
    name: performedBy.name ?? null,
    employeeCode: performedBy.employeeCode ?? null,
    role,
  };
}

/**
 * Builds chronological status history for claim detail.
 *
 * Rules A3 + C2:
 * - First entry is NEW from 'Claim Created' (or createdAt).
 * - Every status transition event (isStatusTransition) starts a new entry, in timeline order.
 * - Same-status events never start an entry.
 * - exitedAt is the next entry's enteredAt, null for the last one.
 * - enteredBy is { id, name, employeeCode, role } or null.
 *
 * @param {Array<Object>} timeline
 * @param {Date|string|null} createdAt
 * @returns {Array<Object>}
 */
function buildStatusHistory(timeline = [], createdAt = null) {
  const history = [];

  const safeTimeline = Array.isArray(timeline) ? timeline : [];
  const createdEvent = safeTimeline.find((e) => e.action === 'Claim Created');

  let initialTimestamp = null;
  if (createdEvent?.timestamp) {
    initialTimestamp = new Date(createdEvent.timestamp);
  } else if (createdAt) {
    initialTimestamp = new Date(createdAt);
  } else if (safeTimeline.length > 0 && safeTimeline[0]?.timestamp) {
    initialTimestamp = new Date(safeTimeline[0].timestamp);
  }

  if (initialTimestamp) {
    const initialEnteredBy = createdEvent
      ? formatEnteredBy(createdEvent.performedBy, createdEvent.role)
      : null;

    history.push({
      status: 'NEW',
      enteredAt: initialTimestamp,
      exitedAt: null,
      action: 'Claim Created',
      enteredBy: initialEnteredBy,
    });
  }

  for (const event of safeTimeline) {
    if (isStatusTransition(event)) {
      const enteredAt = new Date(event.timestamp);

      if (history.length > 0) {
        history[history.length - 1].exitedAt = enteredAt;
      }

      history.push({
        status: event.newStatus,
        enteredAt,
        exitedAt: null,
        action: event.action,
        enteredBy: formatEnteredBy(event.performedBy, event.role),
      });
    }
  }

  return history;
}

module.exports = {
  DEFAULT_STATUS_SLA_HOURS,
  isStatusTransition,
  resolveSlaHours,
  computeStatusDueAt,
  resolveStatusEnteredAt,
  buildStatusHistory,
};

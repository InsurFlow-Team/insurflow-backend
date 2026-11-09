const {
  DEFAULT_STATUS_SLA_HOURS,
  isStatusTransition,
  resolveSlaHours,
  computeStatusDueAt,
  resolveStatusEnteredAt,
  buildStatusHistory,
} = require('../src/utils/statusTiming');

describe('src/utils/statusTiming.js Unit Tests', () => {
  const t0 = new Date('2026-06-01T08:00:00.000Z');
  const t1 = new Date('2026-06-01T09:00:00.000Z');
  const t2 = new Date('2026-06-01T10:00:00.000Z');
  const t3 = new Date('2026-06-01T11:00:00.000Z');
  const t4 = new Date('2026-06-01T12:00:00.000Z');
  const t5 = new Date('2026-06-01T13:00:00.000Z');
  const t6 = new Date('2026-06-01T14:00:00.000Z');

  const officerUser = {
    _id: '60d0fe4f5311236168a109ca',
    name: 'Officer Alice',
    employeeCode: 'OF-01',
    role: 'CURRENT_OFFICER_ROLE',
  };

  const adjusterUser = {
    _id: '60d0fe4f5311236168a109cb',
    name: 'Adjuster Bob',
    employeeCode: 'ADJ-01',
    role: 'CURRENT_ADJUSTER_ROLE',
  };

  describe('DEFAULT_STATUS_SLA_HOURS constant', () => {
    it('should have the exact D6 thresholds and be frozen', () => {
      expect(DEFAULT_STATUS_SLA_HOURS).toEqual({
        NEW: 24,
        PENDING_ACCEPTANCE: 4,
        ASSIGNED: 48,
        IN_PROGRESS: 48,
        SUBMITTED: 24,
        UNDER_REVIEW: 120,
        CORRECTION_REQUIRED: 48,
        APPROVED: 720,
      });
      expect(Object.isFrozen(DEFAULT_STATUS_SLA_HOURS)).toBe(true);
      expect(DEFAULT_STATUS_SLA_HOURS.REJECTED).toBeUndefined();
      expect(DEFAULT_STATUS_SLA_HOURS.CLOSED).toBeUndefined();
    });
  });

  describe('isStatusTransition', () => {
    it('returns true when newStatus is not null/undefined and differs from previousStatus', () => {
      expect(isStatusTransition({ previousStatus: 'NEW', newStatus: 'PENDING_ACCEPTANCE' })).toBe(true);
      expect(isStatusTransition({ previousStatus: null, newStatus: 'NEW' })).toBe(true);
      expect(isStatusTransition({ previousStatus: 'UNDER_REVIEW', newStatus: 'APPROVED' })).toBe(true);
    });

    it('returns false for null/undefined events, null newStatus, or same-status events', () => {
      expect(isStatusTransition(null)).toBe(false);
      expect(isStatusTransition(undefined)).toBe(false);
      expect(isStatusTransition({ previousStatus: null, newStatus: null })).toBe(false);
      expect(isStatusTransition({ action: 'Claim Created', previousStatus: null, newStatus: null })).toBe(false);
      expect(isStatusTransition({ action: 'Payment Recorded', previousStatus: 'APPROVED', newStatus: 'APPROVED' })).toBe(false);
      expect(isStatusTransition({ previousStatus: 'UNDER_REVIEW', newStatus: 'UNDER_REVIEW' })).toBe(false);
    });
  });

  describe('resolveSlaHours', () => {
    it('returns null for REJECTED, CLOSED, or unknown status', () => {
      expect(resolveSlaHours(null, 'REJECTED')).toBeNull();
      expect(resolveSlaHours({ REJECTED: 10 }, 'REJECTED')).toBeNull();
      expect(resolveSlaHours(null, 'CLOSED')).toBeNull();
      expect(resolveSlaHours({ CLOSED: 5 }, 'CLOSED')).toBeNull();
      expect(resolveSlaHours(null, 'NON_EXISTENT')).toBeNull();
    });

    it('returns code default when statusSlaHours is null, undefined, or missing the status', () => {
      expect(resolveSlaHours(null, 'NEW')).toBe(24);
      expect(resolveSlaHours(undefined, 'PENDING_ACCEPTANCE')).toBe(4);
      expect(resolveSlaHours({}, 'ASSIGNED')).toBe(48);
      expect(resolveSlaHours({ NEW: null }, 'NEW')).toBe(24);
      expect(resolveSlaHours({ IN_PROGRESS: undefined }, 'IN_PROGRESS')).toBe(48);
    });

    it('organization override beats default when it is a positive integer', () => {
      expect(resolveSlaHours({ IN_PROGRESS: 72 }, 'IN_PROGRESS')).toBe(72);
      expect(resolveSlaHours({ NEW: 12 }, 'NEW')).toBe(12);
      expect(resolveSlaHours({ APPROVED: 360 }, 'APPROVED')).toBe(360);
    });

    it('resolveSlaHours ignores a non-integer or zero override and uses the default', () => {
      expect(resolveSlaHours({ IN_PROGRESS: 0 }, 'IN_PROGRESS')).toBe(48);
      expect(resolveSlaHours({ IN_PROGRESS: -5 }, 'IN_PROGRESS')).toBe(48);
      expect(resolveSlaHours({ IN_PROGRESS: 12.5 }, 'IN_PROGRESS')).toBe(48);
      expect(resolveSlaHours({ IN_PROGRESS: '72' }, 'IN_PROGRESS')).toBe(48);
      expect(resolveSlaHours({ IN_PROGRESS: NaN }, 'IN_PROGRESS')).toBe(48);
    });
  });

  describe('computeStatusDueAt', () => {
    it('computes enteredAt + slaHours correctly in calendar hours', () => {
      const enteredAt = new Date('2026-06-01T10:00:00.000Z');
      const dueAt = computeStatusDueAt(enteredAt, 24);
      expect(dueAt).toEqual(new Date('2026-06-02T10:00:00.000Z'));

      const due4Hours = computeStatusDueAt(enteredAt, 4);
      expect(due4Hours).toEqual(new Date('2026-06-01T14:00:00.000Z'));
    });

    it('accepts ISO string as enteredAt', () => {
      const dueAt = computeStatusDueAt('2026-06-01T10:00:00.000Z', 48);
      expect(dueAt).toEqual(new Date('2026-06-03T10:00:00.000Z'));
    });

    it('returns null when enteredAt is null or invalid', () => {
      expect(computeStatusDueAt(null, 24)).toBeNull();
      expect(computeStatusDueAt(undefined, 24)).toBeNull();
      expect(computeStatusDueAt('invalid-date', 24)).toBeNull();
    });

    it('returns null when slaHours is null, non-positive, or non-numeric', () => {
      const enteredAt = new Date('2026-06-01T10:00:00.000Z');
      expect(computeStatusDueAt(enteredAt, null)).toBeNull();
      expect(computeStatusDueAt(enteredAt, 0)).toBeNull();
      expect(computeStatusDueAt(enteredAt, -1)).toBeNull();
      expect(computeStatusDueAt(enteredAt, undefined)).toBeNull();
    });
  });

  describe('resolveStatusEnteredAt', () => {
    it('finds the timestamp of the LAST status transition event whose newStatus equals currentStatus', () => {
      const timeline = [
        { action: 'Claim Created', previousStatus: null, newStatus: null, timestamp: t0 },
        { action: 'Assignment Pending Acceptance', previousStatus: 'NEW', newStatus: 'PENDING_ACCEPTANCE', timestamp: t1 },
        { action: 'Assignment Accepted', previousStatus: 'PENDING_ACCEPTANCE', newStatus: 'ASSIGNED', timestamp: t2 },
        { action: 'Inspection Started', previousStatus: 'ASSIGNED', newStatus: 'IN_PROGRESS', timestamp: t3 },
      ];

      expect(resolveStatusEnteredAt('IN_PROGRESS', timeline, t0)).toEqual(t3);
      expect(resolveStatusEnteredAt('ASSIGNED', timeline, t0)).toEqual(t2);
      expect(resolveStatusEnteredAt('PENDING_ACCEPTANCE', timeline, t0)).toEqual(t1);
    });

    it('ignores same-status events such as Payment Recorded (APPROVED to APPROVED)', () => {
      const timeline = [
        { action: 'Claim Approved', previousStatus: 'UNDER_REVIEW', newStatus: 'APPROVED', timestamp: t1 },
        { action: 'Payment Recorded', previousStatus: 'APPROVED', newStatus: 'APPROVED', timestamp: t2 },
        { action: 'Repair Order Created', previousStatus: 'APPROVED', newStatus: 'APPROVED', timestamp: t3 },
      ];

      expect(resolveStatusEnteredAt('APPROVED', timeline, t0)).toEqual(t1);
    });

    it('returns decline event timestamp for NEW status if assignment was declined', () => {
      const timeline = [
        { action: 'Claim Created', previousStatus: null, newStatus: null, timestamp: t0 },
        { action: 'Assignment Pending Acceptance', previousStatus: 'NEW', newStatus: 'PENDING_ACCEPTANCE', timestamp: t1 },
        { action: 'Assignment Declined', previousStatus: 'PENDING_ACCEPTANCE', newStatus: 'NEW', timestamp: t2 },
      ];

      expect(resolveStatusEnteredAt('NEW', timeline, t0)).toEqual(t2);
    });

    it('for NEW with no transition event, falls back to Claim Created timestamp, else createdAt', () => {
      const timelineWithCreate = [
        { action: 'Claim Created', previousStatus: null, newStatus: null, timestamp: t1 },
      ];
      expect(resolveStatusEnteredAt('NEW', timelineWithCreate, t0)).toEqual(t1);

      const emptyTimeline = [];
      expect(resolveStatusEnteredAt('NEW', emptyTimeline, t0)).toEqual(t0);
    });

    it('for any status other than NEW with no matching event, returns null (never falls back to createdAt)', () => {
      const timeline = [
        { action: 'Claim Created', previousStatus: null, newStatus: null, timestamp: t0 },
      ];

      expect(resolveStatusEnteredAt('ASSIGNED', timeline, t0)).toBeNull();
      expect(resolveStatusEnteredAt('IN_PROGRESS', timeline, t0)).toBeNull();
      expect(resolveStatusEnteredAt('UNDER_REVIEW', timeline, t0)).toBeNull();
      expect(resolveStatusEnteredAt('APPROVED', timeline, t0)).toBeNull();
      expect(resolveStatusEnteredAt('REJECTED', timeline, t0)).toBeNull();
      expect(resolveStatusEnteredAt('CLOSED', timeline, t0)).toBeNull();
    });
  });

  describe('buildStatusHistory', () => {
    it('history for a straight approval path', () => {
      const timeline = [
        { action: 'Claim Created', previousStatus: null, newStatus: null, timestamp: t0, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
        { action: 'Assignment Pending Acceptance', previousStatus: 'NEW', newStatus: 'PENDING_ACCEPTANCE', timestamp: t1, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
        { action: 'Assignment Accepted', previousStatus: 'PENDING_ACCEPTANCE', newStatus: 'ASSIGNED', timestamp: t2, performedBy: adjusterUser, role: 'FIELD_ADJUSTER' },
        { action: 'Inspection Started', previousStatus: 'ASSIGNED', newStatus: 'IN_PROGRESS', timestamp: t3, performedBy: adjusterUser, role: 'FIELD_ADJUSTER' },
        { action: 'Inspection Submitted', previousStatus: 'IN_PROGRESS', newStatus: 'SUBMITTED', timestamp: t4, performedBy: adjusterUser, role: 'FIELD_ADJUSTER' },
        { action: 'Review Started', previousStatus: 'SUBMITTED', newStatus: 'UNDER_REVIEW', timestamp: t5, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
        { action: 'Claim Approved', previousStatus: 'UNDER_REVIEW', newStatus: 'APPROVED', timestamp: t6, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
      ];

      const history = buildStatusHistory(timeline, t0);
      expect(history.length).toBe(7);

      expect(history.map((h) => h.status)).toEqual([
        'NEW',
        'PENDING_ACCEPTANCE',
        'ASSIGNED',
        'IN_PROGRESS',
        'SUBMITTED',
        'UNDER_REVIEW',
        'APPROVED',
      ]);

      // Check contiguous exit and enter times
      for (let i = 0; i < history.length - 1; i++) {
        expect(history[i].exitedAt).toEqual(history[i + 1].enteredAt);
      }
      expect(history[history.length - 1].exitedAt).toBeNull();

      // Check enteredBy fields
      expect(history[0].enteredBy).toEqual({
        id: officerUser._id,
        name: 'Officer Alice',
        employeeCode: 'OF-01',
        role: 'CLAIMS_OFFICER',
      });
      expect(history[0].action).toBe('Claim Created');

      expect(history[2].enteredBy).toEqual({
        id: adjusterUser._id,
        name: 'Adjuster Bob',
        employeeCode: 'ADJ-01',
        role: 'FIELD_ADJUSTER',
      });
      expect(history[2].action).toBe('Assignment Accepted');
    });

    it('history for a rejection path', () => {
      const timeline = [
        { action: 'Claim Created', previousStatus: null, newStatus: null, timestamp: t0, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
        { action: 'Assignment Pending Acceptance', previousStatus: 'NEW', newStatus: 'PENDING_ACCEPTANCE', timestamp: t1, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
        { action: 'Assignment Accepted', previousStatus: 'PENDING_ACCEPTANCE', newStatus: 'ASSIGNED', timestamp: t2, performedBy: adjusterUser, role: 'FIELD_ADJUSTER' },
        { action: 'Inspection Started', previousStatus: 'ASSIGNED', newStatus: 'IN_PROGRESS', timestamp: t3, performedBy: adjusterUser, role: 'FIELD_ADJUSTER' },
        { action: 'Inspection Submitted', previousStatus: 'IN_PROGRESS', newStatus: 'SUBMITTED', timestamp: t4, performedBy: adjusterUser, role: 'FIELD_ADJUSTER' },
        { action: 'Review Started', previousStatus: 'SUBMITTED', newStatus: 'UNDER_REVIEW', timestamp: t5, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
        { action: 'Claim Rejected', previousStatus: 'UNDER_REVIEW', newStatus: 'REJECTED', timestamp: t6, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
      ];

      const history = buildStatusHistory(timeline, t0);
      expect(history[history.length - 1]).toEqual({
        status: 'REJECTED',
        enteredAt: t6,
        exitedAt: null,
        action: 'Claim Rejected',
        enteredBy: {
          id: officerUser._id,
          name: 'Officer Alice',
          employeeCode: 'OF-01',
          role: 'CLAIMS_OFFICER',
        },
      });
    });

    it('history for a correction loop (UNDER_REVIEW to CORRECTION_REQUIRED to IN_PROGRESS to SUBMITTED to UNDER_REVIEW)', () => {
      const timeline = [
        { action: 'Claim Created', previousStatus: null, newStatus: null, timestamp: t0, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
        { action: 'Review Started', previousStatus: 'SUBMITTED', newStatus: 'UNDER_REVIEW', timestamp: t1, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
        { action: 'Correction Requested', previousStatus: 'UNDER_REVIEW', newStatus: 'CORRECTION_REQUIRED', timestamp: t2, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
        { action: 'Inspection Resumed', previousStatus: 'CORRECTION_REQUIRED', newStatus: 'IN_PROGRESS', timestamp: t3, performedBy: adjusterUser, role: 'FIELD_ADJUSTER' },
        { action: 'Inspection Submitted', previousStatus: 'IN_PROGRESS', newStatus: 'SUBMITTED', timestamp: t4, performedBy: adjusterUser, role: 'FIELD_ADJUSTER' },
        { action: 'Review Started', previousStatus: 'SUBMITTED', newStatus: 'UNDER_REVIEW', timestamp: t5, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
      ];

      const history = buildStatusHistory(timeline, t0);
      expect(history.map((h) => h.status)).toEqual([
        'NEW',
        'UNDER_REVIEW',
        'CORRECTION_REQUIRED',
        'IN_PROGRESS',
        'SUBMITTED',
        'UNDER_REVIEW',
      ]);
      expect(history[5].status).toBe('UNDER_REVIEW');
      expect(history[5].action).toBe('Review Started');
      expect(history[5].enteredAt).toEqual(t5);
      expect(history[5].exitedAt).toBeNull();
    });

    it('history for a declined assignment (PENDING_ACCEPTANCE to NEW)', () => {
      const timeline = [
        { action: 'Claim Created', previousStatus: null, newStatus: null, timestamp: t0, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
        { action: 'Assignment Pending Acceptance', previousStatus: 'NEW', newStatus: 'PENDING_ACCEPTANCE', timestamp: t1, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
        { action: 'Assignment Declined', previousStatus: 'PENDING_ACCEPTANCE', newStatus: 'NEW', timestamp: t2, performedBy: adjusterUser, role: 'FIELD_ADJUSTER' },
      ];

      const history = buildStatusHistory(timeline, t0);
      expect(history.map((h) => h.status)).toEqual(['NEW', 'PENDING_ACCEPTANCE', 'NEW']);
      expect(history[2].action).toBe('Assignment Declined');
      expect(history[2].enteredAt).toEqual(t2);
      expect(history[2].exitedAt).toBeNull();
    });

    it('non-status events are ignored (evidence, accident, location, signature, estimates, payments)', () => {
      const timeline = [
        { action: 'Claim Created', previousStatus: null, newStatus: null, timestamp: t0, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
        { action: 'Vehicle Confirmed', previousStatus: null, newStatus: null, timestamp: t1, performedBy: adjusterUser, role: 'FIELD_ADJUSTER' },
        { action: 'Accident Details Recorded', previousStatus: null, newStatus: null, timestamp: t2, performedBy: adjusterUser, role: 'FIELD_ADJUSTER' },
        { action: 'Location Captured', previousStatus: null, newStatus: null, timestamp: t3, performedBy: adjusterUser, role: 'FIELD_ADJUSTER' },
        { action: 'Evidence Uploaded', previousStatus: null, newStatus: null, timestamp: t4, performedBy: adjusterUser, role: 'FIELD_ADJUSTER' },
        { action: 'Signature Captured', previousStatus: null, newStatus: null, timestamp: t5, performedBy: adjusterUser, role: 'FIELD_ADJUSTER' },
      ];

      const history = buildStatusHistory(timeline, t0);
      expect(history.length).toBe(1);
      expect(history[0].status).toBe('NEW');
    });

    it('same-status events (e.g. Payment Recorded APPROVED to APPROVED) do not start a history entry', () => {
      const timeline = [
        { action: 'Claim Created', previousStatus: null, newStatus: null, timestamp: t0, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
        { action: 'Claim Approved', previousStatus: 'UNDER_REVIEW', newStatus: 'APPROVED', timestamp: t1, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
        { action: 'Payment Recorded', previousStatus: 'APPROVED', newStatus: 'APPROVED', timestamp: t2, performedBy: officerUser, role: 'CLAIMS_OFFICER' },
      ];

      const history = buildStatusHistory(timeline, t0);
      expect(history.length).toBe(2);
      expect(history[1].status).toBe('APPROVED');
      expect(history[1].action).toBe('Claim Approved');
      expect(history[1].enteredAt).toEqual(t1);
    });

    it('enteredBy.role is the event role, not the user current role (C2)', () => {
      const userWhoseRoleChanged = {
        _id: '60d0fe4f5311236168a109cc',
        name: 'Promoted User',
        employeeCode: 'PR-01',
        role: 'ADMIN', // current role in DB
      };

      const timeline = [
        {
          action: 'Claim Created',
          previousStatus: null,
          newStatus: null,
          timestamp: t0,
          performedBy: userWhoseRoleChanged,
          role: 'CLAIMS_OFFICER', // historic role at time of creation
        },
        {
          action: 'Assignment Accepted',
          previousStatus: 'PENDING_ACCEPTANCE',
          newStatus: 'ASSIGNED',
          timestamp: t1,
          performedBy: {
            _id: '60d0fe4f5311236168a109cd',
            name: 'Legacy Adjuster',
            employeeCode: 'LEG-01',
            role: 'FIELD_ADJUSTER', // fallback if event.role missing
          },
          role: undefined, // missing event.role
        },
      ];

      const history = buildStatusHistory(timeline, t0);
      expect(history[0].enteredBy.role).toBe('CLAIMS_OFFICER'); // preferred event.role
      expect(history[1].enteredBy.role).toBe('FIELD_ADJUSTER'); // fallback to performedBy.role
    });
  });
});

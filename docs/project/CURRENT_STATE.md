# Sawn Current State
Updated: 2026-10-14
Branch: main
Tests: 39 suites, 616 tests, all passing

## Closed
- Sprint 1 and Sprint 2 core: auth, claims, assignment, inspection, review, decision, closure, users, pagination, rate limiting
- F15 evidence photos and digital signature
- F16 dashboard KPI stats
- F17 final claim report PDF
- F18 map dispatch and two-step assignment
- F19 push notifications with FCM
- F20 policy verification gate and coverage snapshot
- F21 dashboard notification center
- F22 financial loss assessment. Spec: docs/features/10-claim-decision-engine.md
- F23 public claim tracking. Spec: docs/features/23-public-claim-tracking.md
- Stage 4A to 4C contract alignment

## Claim lifecycle
Ten statuses: NEW, PENDING_ACCEPTANCE, ASSIGNED, IN_PROGRESS, SUBMITTED, UNDER_REVIEW, CORRECTION_REQUIRED, APPROVED, REJECTED, CLOSED.

## Open
- Flutter app integration
- Web dashboard integration
- Dashboard real-time delivery: polling or Pusher Channels, undecided

## Known gaps
- Policy test fixtures expire on 2026-12-31. Update the dates.
- Rename to Sawn pending in docs, package metadata and report header.
- Absolute file:// links remain in docs/features files.
- tests/user.fcmToken.test.js failed once with EACCES on a random port inside a Windows excluded range. A rerun passed.

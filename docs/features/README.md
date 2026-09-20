# InsurFlow — Backend Feature Specifications Index

> **Authoritative Architectural & Functional Specifications**  
> This directory houses the complete, deep, production-grade technical specification for every feature in the InsurFlow backend. Each document is self-contained with full architecture diagrams, API contracts, multi-tenancy invariants, database schemas, and test coverage matrices.

---

## Complete Feature Matrix

| # | Feature Specification Document | Core Domains Covered | Key Roles Involved | Primary Endpoints |
|---|--------------------------------|----------------------|--------------------|-------------------|
| **01** | [01-authentication-and-sessions.md](./01-authentication-and-sessions.md) | Multi-tenant login, JWT tokens, bcrypt password hashing, password change, brute-force defense | All Roles (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`) | `POST /api/v1/auth/login`<br>`PUT /api/v1/auth/change-password` |
| **02** | [02-user-management-and-rbac.md](./02-user-management-and-rbac.md) | Administrative staff onboarding, user listing, account deactivation, password resets | `ADMIN` only | `POST /api/v1/users`<br>`GET /api/v1/users`<br>`PATCH /api/v1/users/:id/status`<br>`PATCH /api/v1/users/:id/reset-password` |
| **03** | [03-claim-intake-and-creation.md](./03-claim-intake-and-creation.md) | Claim intake form, customer & incident capture, initial `NEW` status, audit timeline initiation | `CLAIMS_OFFICER`, `ADMIN` | `POST /api/v1/claims` |
| **04** | [04-tenant-scoped-claim-numbering.md](./04-tenant-scoped-claim-numbering.md) | `CLM-<ORG>-0001` format, isolated atomic Counter model, Mongoose pre-save hook, compound unique index | System / All Roles | Automatic on `Claim.create()` |
| **05** | [05-adjuster-workload-and-availability.md](./05-adjuster-workload-and-availability.md) | Real-time availability calculation, single MongoDB `$lookup` aggregation pipeline, N+1 query elimination | `CLAIMS_OFFICER`, `ADMIN` | `GET /api/v1/users/adjusters?status=available` |
| **06** | [06-claim-assignment.md](./06-claim-assignment.md) | Dispatching claims to available adjusters, `NEW` → `ASSIGNED` transition, atomic concurrency protection | `CLAIMS_OFFICER`, `ADMIN` | `POST /api/v1/claims/:claimId/assign` |
| **07** | [07-vehicle-and-policy-lookup.md](./07-vehicle-and-policy-lookup.md) | License plate lookup, underwriting policy resolution, customer details, expired policy warning | `FIELD_ADJUSTER` | `GET /api/v1/vehicles/lookup?plateNumber=...` |
| **08** | [08-field-inspection-workflow.md](./08-field-inspection-workflow.md) | Partial draft updates (Vehicle, Accident narrative, GPS coordinates & address) in `IN_PROGRESS`, assigned adjuster write locks | Assigned `FIELD_ADJUSTER` | `PUT /api/v1/claims/:id/vehicle`<br>`PUT /api/v1/claims/:id/accident`<br>`PUT /api/v1/claims/:id/location` |
| **09** | [09-inspection-submission-and-review.md](./09-inspection-submission-and-review.md) | Five-pillar validation (Vehicle, Accident, Location, Evidence, Signature), `IN_PROGRESS` → `SUBMITTED` transition, `SUBMITTED` → `UNDER_REVIEW` transition | `FIELD_ADJUSTER`<br>`CLAIMS_OFFICER` | `POST /api/v1/claims/:id/inspection/submit`<br>`POST /api/v1/claims/:id/review/start` |
| **10** | [10-claim-decision-engine.md](./10-claim-decision-engine.md) | Final adjudication, `UNDER_REVIEW` → `APPROVED` \| `REJECTED`, atomic state mutation, 409 conflict handling | `CLAIMS_OFFICER`, `ADMIN` | `POST /api/v1/claims/:claimId/decision` |
| **11** | [11-claim-closure.md](./11-claim-closure.md) | Administrative case closure, `APPROVED` → `CLOSED`, closedBy & closingNotes tracking, audit trail logging | `ADMIN` only | `POST /api/v1/claims/:claimId/close` |
| **12** | [12-pagination-and-query-limits.md](./12-pagination-and-query-limits.md) | Standardized listing pagination, default 50 / max 100, HTTP response headers (`X-Total-Count`, etc.), CORS exposure | `ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER` | `GET /api/v1/claims`<br>`GET /api/v1/users` |
| **13** | [13-rate-limiting-and-security.md](./13-rate-limiting-and-security.md) | Multi-tiered rate limiting (`loginLimiter` & `apiLimiter`), production override protection, trust proxy, error masking | Global Infrastructure | Applied across all `/api/v1` routes |
| **14** | [14-status-machine-expansion.md](./14-status-machine-expansion.md) | 9-status lifecycle, IN_PROGRESS state, correction loop, audit trail metadata (previousStatus, newStatus, notes) | `FIELD_ADJUSTER`, `CLAIMS_OFFICER` | `POST /api/v1/claims/:claimId/inspection/start`<br>`POST /api/v1/claims/:claimId/review/request-correction` |
| **15** | [15-evidence-photos-and-digital-signature.md](./15-evidence-photos-and-digital-signature.md) | Photo evidence capture (additive array, categorized imageType), digital signature sign-off, Cloudinary storage, 5-pillar inspection completeness | Assigned `FIELD_ADJUSTER` | `POST /api/v1/claims/:claimId/evidence`<br>`POST /api/v1/claims/:claimId/signature` |
| **16** | [16-dashboard-kpi-aggregation.md](./16-dashboard-kpi-aggregation.md) | Dashboard KPI metrics, role-scoped envelopes (`ORGANIZATION` vs `ASSIGNED`), adjuster workload distribution, date-filtered aggregation | `ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER` | `GET /api/v1/claims/stats` |
| **17** | [17-final-claim-report.md](./17-final-claim-report.md) | Final claim PDF dossier, full domain hydration, Cloudinary transform & graceful degradation, in-memory buffering | `CLAIMS_OFFICER`, `ADMIN` | `GET /api/v1/claims/:claimId/report` |
| **18** | [18-adjuster-map-dispatch-and-location-tracking.md](./18-adjuster-map-dispatch-and-location-tracking.md) | Passive HTTP header GPS capture, server-side Haversine distance, proximity-sorted adjuster dispatch, two-step assignment (`PENDING_ACCEPTANCE`), accept/decline workflow, advisory capacity with explicit override | `CLAIMS_OFFICER`, `ADMIN`, `FIELD_ADJUSTER` | `GET /api/v1/users/adjusters`<br>`POST /api/v1/claims/:claimId/assign`<br>`POST /api/v1/claims/:claimId/accept-assignment`<br>`POST /api/v1/claims/:claimId/decline-assignment` |
| **19** | [19-push-notifications.md](./19-push-notifications.md) | Firebase Admin SDK integration, reusable push service, Notification schema, User device-token registration, and domain lifecycle trigger wiring (`ASSIGNED`, `CORRECTION_REQUIRED`, `APPROVED`, `REJECTED`) | All Authenticated Roles | `PATCH /api/v1/users/me/fcm-token` |


---

## Test Suite Status

All features are backed by an automated integration test suite executing with isolated in-memory MongoDB instances, Firebase mocks, and Cloudinary streaming mocks:
* **Test Suites:** 25 passed, 25 total
* **Tests:** 321 passed, 321 total (0 failures)

---

## Architectural Principles Enforced Across All Features

1. **Multi-Tenancy by Default:** Tenant identity is derived exclusively from `req.user.organizationId` via JWT. Request bodies and query parameters referencing tenancy are discarded. Cross-tenant access returns stealth `404 Not Found`.
2. **Layered Architecture:** Routes (`.routes.js`) → Controllers (`.controller.js`) → Services (`.service.js`) → Repositories (`.repository.js`) → Models (`.model.js`).
3. **Atomic State Mutations:** State transitions use atomic `findOneAndUpdate({ _id, organizationId, status: expectedStatus })` to eliminate Time-of-Check to Time-of-Use (TOCTOU) race conditions.
4. **Zero Unvalidated Inputs:** Every incoming payload and query string is strictly validated using Joi schemas before touching business logic.

# InsurFlow — Current Project State & Progress Tracking

> **Last Updated:** 2026-09-28  
> **Document Purpose:** Single source of truth for current project status, completed work, active blockers, and immediate next steps. Consult this document at the start of any new session or task.

---

## 1. Project Phase & Milestones

| Metric | Status |
|---|---|
| **Current Project Phase** | Active Development / Frontend & Mobile Integration Phase |
| **Current Sprint** | **Sprint 1, Sprint 2, Features 18-23 (Public Claim Tracking), Stage 4A-4C Contract Alignment Completed** |
| **Architectural Health** | Structurally Sound (Modular 5-layer architecture, 100% test passing) |
| **Overall Readiness** | **Backend Core & Lifecycle Deliverables: 100% Complete & Verified (38 Suites / 596 Tests - 100% Pass)** |

---

## 2. Completed Milestones (`What is Done`)

- [x] **Backend Foundation & Security:**
  - Express 5 REST application with Helmet security headers, cookie parser, Morgan logging, and global error handling (`errorHandler.js`, `notFound.js`, `asyncWrapper.js`).
  - Standardized JSON envelope (`src/utils/apiResponse.js`) for all endpoints.
  - Multi-tiered rate limiting with `loginLimiter` (brute-force defense: 5 attempts/15min) and `apiLimiter` (general endpoint protection: 100 req/15min).
- [x] **Authentication & Session:**
  - Tenant-scoped login (`organizationCode`, `employeeCode`, `password`) via `POST /api/v1/auth/login`.
  - Stateless HS256 JWT generation with 8-hour expiration and dual extraction (Bearer header + httpOnly cookie).
  - Password hashing with bcrypt (10 rounds) and `select: false` on Mongoose schema.
  - Self-service password change (`PUT /api/v1/auth/change-password`) with Joi validation middleware.
  - Active user verification at login.
- [x] **Role-Based Access Control (RBAC):**
  - Factory middleware `authorizeRole(...)` enforcing role permissions across `ADMIN`, `CLAIMS_OFFICER`, and `FIELD_ADJUSTER`.
- [x] **Multi-Tenancy Foundation:**
  - Server-side derivation of `organizationId` from authenticated token context.
  - Compound unique indexes on `{ organizationId, ... }` across Claims, Users, Vehicles, and Policies.
  - Tenant-scoped sequential claim counter (`claimNumber_<orgId>`) generating `CLM-<ORG_CODE>-NNNN`.
- [x] **Claims Intake & Assignment:**
  - Claim creation accessible to `CLAIMS_OFFICER` and `ADMIN` (`POST /api/v1/claims`).
  - Single-query MongoDB `$lookup` aggregation for adjuster availability eliminating N+1 queries.
  - Adjuster workload capacity rule: adjusters with $\le 3$ active claims (`ASSIGNED`, `IN_PROGRESS`, `CORRECTION_REQUIRED`) remain `AVAILABLE`; more than 3 active claims transitions them to `UNAVAILABLE`. Exposes explicit numeric `capacityLimit` alongside `activeTasksCount` in `GET /api/v1/users/adjusters` for frontend workload rendering.
  - Adjuster dispatch with atomic assignment checks (`POST /api/v1/claims/:claimId/assign`) accessible to both `CLAIMS_OFFICER` and `ADMIN`.
  - **Field Adjuster Visibility & Filtering on Claims Listing (`GET /api/v1/claims`):** Populates assigned Field Adjuster identity (`id` and `name`) in both `assignedTo` and `fieldAdjuster` fields (or `null` if unassigned) across all claims returned by `GET /api/v1/claims`. Supports filtering by assigned adjuster via `adjusterId` and alias `assignedTo` query parameters with Joi ObjectId validation. Tested in `tests/claim.read.test.js`.
- [x] **Vehicle & Policy Lookup:**
  - Plate lookup (`GET /api/v1/vehicles/lookup`) with normalization and policy expiration warning (`POLICY_EXPIRED`).
- [x] **Field Inspection & 9-Status Lifecycle Machine:**
  - Field inspection start endpoint: `POST /api/v1/claims/:claimId/inspection/start` (transitions `ASSIGNED` or `CORRECTION_REQUIRED` → `IN_PROGRESS`).
  - Incremental inspection saves while in `IN_PROGRESS` (`PUT /api/v1/claims/:id/vehicle`, `PUT /api/v1/claims/:id/accident`, `PUT /api/v1/claims/:id/location`).
  - Five-pillar mandatory completeness validation (Vehicle, Accident, Location, Evidence Photos $\ge 1$, Digital Signature) on `POST /api/v1/claims/:id/inspection/submit` (transitions `IN_PROGRESS` → `SUBMITTED`).
  - Claim review initiation by claims officer (`POST /api/v1/claims/:id/review/start` → `UNDER_REVIEW`).
  - Iterative correction loop: `POST /api/v1/claims/:claimId/review/request-correction` (transitions `UNDER_REVIEW` → `CORRECTION_REQUIRED` with mandatory notes).
  - Claim adjudication engine: `POST /api/v1/claims/:claimId/decision` (transitions `UNDER_REVIEW` → `APPROVED` \| `REJECTED`).
  - Admin claim closure: `POST /api/v1/claims/:claimId/close` (transitions `APPROVED` → `CLOSED`).
  - Timeline audit trail metadata: extended with `previousStatus`, `newStatus`, and `notes`.
- [x] **Evidence Photos & Digital Signature (Cloudinary Integration):**
  - Multer memory storage middleware (`src/middlewares/upload.middleware.js`) with 10MB limit and JPEG/PNG/WEBP whitelist.
  - Cloudinary streaming utility (`src/utils/uploadToCloudinary.js`) with tenant-isolated folders (`insurflow/${orgId}/evidence`, `insurflow/${orgId}/signatures`).
  - Photo evidence endpoint: `POST /api/v1/claims/:claimId/evidence` (repeatable, additive array, categorized `imageType`).
  - Digital signature endpoint: `POST /api/v1/claims/:claimId/signature` (singular, overwritable).
  - Global error handler support for Multer's `LIMIT_FILE_SIZE` mapped to `400 VALIDATION_ERROR`.
  - Comprehensive unit & integration tests (`tests/claim.evidence.test.js`) with Cloudinary fully mocked.
- [x] **Dashboard KPI Aggregation (Feature 16):**
  - Consolidated metrics endpoint: `GET /api/v1/claims/stats` with strict tenant isolation (`req.user.organizationId`).
  - Role-scoped envelopes: `ORGANIZATION` scope (`ADMIN`, `CLAIMS_OFFICER`) with 9-status breakdown, review queues, and adjuster workload counts; `ASSIGNED` scope (`FIELD_ADJUSTER`) with self-assigned workload and active capacity tracking (`max: 3`).
  - Date range filtering (`from`, `to`) supporting ISO 8601 timestamps and `YYYY-MM-DD` expansion, with future `to` auto-capping and 5-year maximum window validation.
  - High-efficiency MongoDB aggregation pipeline and compound indexes (`{ organizationId: 1, createdAt: -1, status: 1 }`, `{ organizationId: 1, assignedTo: 1, createdAt: -1 }`).
  - Fully tested (`tests/claim.stats.test.js`) across 6 test suites covering RBAC, envelopes, multi-tenancy, date filtering, and validation error branches.
- [x] **Final Claim Report PDF Dossier (Feature 17):**
  - Downloadable publication-grade PDF report endpoint: `GET /api/v1/claims/:claimId/report` powered by `pdfmake`.
  - Restricted strictly to `ADMIN` and `CLAIMS_OFFICER` roles (`FIELD_ADJUSTER` receives 403).
  - Enforces 404-before-409 precedence and terminal status invariant (`APPROVED`, `REJECTED`, `CLOSED`).
  - Full domain hydration across 4 models (`Claim` with populated user references, `Vehicle`, `Policy`, and `Organization`).
  - Resilient image pipeline: Cloudinary on-the-fly resizing (`w_800,c_limit,q_auto:good,f_jpg`) and graceful degradation fallback placeholder blocks on network timeout or fetch failures.
  - In-memory Buffer-then-send delivery model preserving standard JSON error envelope on failure.
  - Fully tested (`tests/claim.report.test.js`, 9/9 passing) with in-memory MongoDB and mocked remote asset fetchers.
- [x] **User Administration APIs (`ADMIN` only):**
  - Create staff user (`POST /api/v1/users`), list users with pagination (`GET /api/v1/users`), update user details (`PATCH /api/v1/users/:id`), toggle user status (`PATCH /api/v1/users/:id/status`), administrative password reset (`PATCH /api/v1/users/:id/reset-password`).
- [x] **Pagination & Header Exposure:**
  - Standardized pagination headers (`X-Total-Count`, `X-Page`, `X-Limit`, `X-Total-Pages`) on `GET /api/v1/claims` and `GET /api/v1/users`.
- [x] **Map-Based Adjuster Dispatch & Location Tracking (Feature 18):**
  - Passive GPS capture for Field Adjusters via `X-Latitude` / `X-Longitude` HTTP headers handled by non-blocking `adjusterLocation.middleware.js`.
  - Incident GPS capture at creation in `claim.incidentCoordinates: { latitude, longitude, capturedAt }` (optional `latitude`/`longitude` in `POST /claims`), preserving required text address `claim.incidentLocation` and strictly separated from inspection GPS `claim.location`. Resolves Section 21 of `docs/API_CONTRACT.md`.
  - Geodesic proximity sorting via server-side Haversine engine (`src/utils/geo.utils.js`) on `GET /api/v1/users/adjusters` supporting `claimId` or direct coordinates.
  - 11 initial integration tests in `tests/adjusterMapDispatch.test.js`.
- [x] **Two-Step Claim Assignment & PENDING_ACCEPTANCE Lifecycle (Feature 18 Upgrade):**
  - Upgraded assignment workflow: `POST /api/v1/claims/:claimId/assign` transitions claim from `NEW` → `PENDING_ACCEPTANCE`.
  - Added adjuster explicit response endpoints:
    - `POST /api/v1/claims/:claimId/accept-assignment`: Transitions `PENDING_ACCEPTANCE` → `ASSIGNED`, appends `[ASSIGNMENT ACCEPTED] by <employeeCode>` timeline entry, and fires notification.
    - `POST /api/v1/claims/:claimId/decline-assignment`: Transitions `PENDING_ACCEPTANCE` → `NEW`, unsets assignment fields, requires `reason` (1-300 chars), and appends `[ASSIGNMENT DECLINED] by <employeeCode> — <reason>` timeline entry.
  - State guard: `POST /api/v1/claims/:claimId/inspection/start` returns 409 `INVALID_STATUS_TRANSITION` if claim is in `PENDING_ACCEPTANCE`.
  - Adjuster capacity invariant: `PENDING_ACCEPTANCE` claims do **not** count toward the adjuster active task quota (`ASSIGNED`, `IN_PROGRESS`, `CORRECTION_REQUIRED`).
  - Claims listing projection (`GET /api/v1/claims`): now returns `incidentCoordinates: { latitude, longitude, capturedAt } | null` for map marker rendering.
  - Dedicated test suite `tests/claim.twoStepAssignment.test.js` (13 tests), bringing total suite count to 25 suites / 321 tests (100% pass).
- [x] **Push Notifications & Device Token Management (Feature 19 — Increments 1, 2 & 3 Completed):**
  - Firebase Admin SDK initialization (`src/config/firebase.js`) loading local service account credential.
  - Reusable push notification sender (`src/services/push.service.js`) with FCM data payload normalization (guaranteed string values) and error isolation.
  - Notification persistence model (`src/modules/notifications/notification.model.js`) with enums (`ASSIGNED`, `CORRECTION_REQUIRED`, `APPROVED`, `REJECTED`), tenant compound index, and defaults.
  - Unified notification service (`src/modules/notifications/notification.service.js`) with `createAndSendNotification`, ensuring push failures are caught and logged without propagating or failing caller actions.
  - Added `fcmToken: { type: String, default: null }` attribute to `User` model (`src/modules/users/user.model.js`).
  - Device token registration endpoint `PATCH /api/v1/users/me/fcm-token` available to all authenticated roles with Joi validation and tenant/identity self-scoping.
  - Domain lifecycle trigger wiring (`src/modules/claims/claim.service.js`) connecting `createAndSendNotification` to 4 atomic state transitions (`ASSIGNED`, `CORRECTION_REQUIRED`, `APPROVED`, `REJECTED`) with strict call-site `try/catch` error isolation.
  - Automated test coverage across 4 dedicated suites (`tests/push.service.test.js`, `tests/notification.service.test.js`, `tests/user.fcmToken.test.js`, `tests/claim.notificationTriggers.test.js`), bringing total coverage to 24 suites / 307 tests (100% pass).
- [x] **Policy Verification / Intake Gate & Coverage Snapshot (Feature 20 Completed & Verified):**
  - Mandatory eligibility check endpoint `POST /api/v1/policies/verify` implemented before claim intake.
  - Restricted strictly to `CLAIMS_OFFICER` and `ADMIN` roles (`FIELD_ADJUSTER` receives 403).
  - Business validations: tenant isolation, dual search support by `policyNumber` or `plateNumber` (or both), active status check (`422 POLICY_CANCELLED`, `422 POLICY_EXPIRED`), calendar expiration comparison, future incident date prevention (`400 INVALID_INCIDENT_DATE`), date range check against `[startDate, expiryDate]` (`422 POLICY_NOT_ACTIVE_ON_DATE`), and plate cross-matching with missing vehicle safety checks (`422 VEHICLE_MISMATCH`).
  - **Coverage Snapshot & Eligibility Hint:** Returns `policyType` (`COMPREHENSIVE` | `THIRD_PARTY`), `coveredPerils`, and `deductibleAmount`. Accepts optional `incidentType` (`COLLISION`, `THEFT`, `FIRE`, `NATURAL_DISASTER`) and returns `eligibilityHint` (`ELIGIBLE_FOR_REVIEW`, `NOT_COVERED_BY_POLICY_TYPE`, `COVERAGE_UNKNOWN`, or `null`).
  - **Own-Damage Domain Scope:** `coveredPerils` strictly models physical own-damage perils for the insured vehicle; `THIRD_PARTY` covers third-party liability only and excludes own damage with advisory hint: "الضرر الذاتي غير مشمول".
  - **Idempotent Migration Script (`src/scripts/migrateLegacyPolicies.js`):** Default dry-run mode, `--apply` requirement, masked host/db logging, safely backfills `THIRD_PARTY`, `coveredPerils: []`, `deductibleAmount: 0`.
  - Dedicated 39 integration tests (`tests/policy.verification.test.js`), bringing system test coverage to **28 Suites / 431 Tests (100% Pass Rate)**.
- [x] **Claim Intake Coverage Snapshot Subdocument (Feature 20 Extension / Commit 1 Completed):**
  - Stored immutable `coverageSnapshot` (`policyType`, `coveredPerils`, `deductibleAmount`, `capturedAt`) inside `Claim` subdocument populated automatically during claim creation (`createClaim`).
  - Added coverage snapshot header block to PDF claim report (`GET /claims/:claimId/report`).
  - Fully verified across automated tests (`tests/claim.coverageSnapshot.test.js`).
- [x] **Financial Loss Assessment Adjudication & Feature Flag Guard (Feature 22 / Commit 2 Completed):**
  - Integrated `lossAssessment` subdocument schema (`estimatedPartsCost`, `laborCost`, `totalDamage`, `policyDeductible`, `deductibleApplied`, `deductibleOverrideReason`, `netApprovedPayout`, `assessedAt`, `assessedBy`) into `Claim`.
  - Financial adjudication in `POST /claims/:claimId/decision` when `decision === 'APPROVED'`.
  - (Historical note: Initially introduced behind feature flag `REQUIRE_LOSS_ASSESSMENT`; flag subsequently removed in Stage 4A making `lossAssessment` unconditionally mandatory for approvals).
  - Strict validation: numbers must be JSON numeric primitives (`.strict()`), max 2 decimal places, bounds `[0, 1000000]`, and rejection of unrecognized/computed keys (e.g. `netApprovedPayout`, `totalDamage`).
  - Strict tenant-scoped pre-read helper `handleClaimNotFoundOrStateError` (404 `CLAIM_NOT_FOUND`, 409 `INVALID_STATUS_TRANSITION`) used exclusively in `APPROVED` branch; zero extra queries on `REJECTED`.
  - Deductible hierarchy: snapshot deductible -> fallback to live policy query only when snapshot is null -> 0.
  - Integer cents arithmetic (`Math.round(amount * 100)`), 422 `DAMAGE_BELOW_DEDUCTIBLE` validation when `totalDamage <= deductibleApplied` with zero database mutation.
  - Deductible override validation: 422 `OVERRIDE_REASON_REQUIRED` when `deductibleApplied !== policyDeductible` and reason is missing/invalid. `deductibleOverrideReason` stored as `null` when no override (i.e., deductible matches policy).
  - `twoDecimalValidator` uses `Math.round(v * 100) / 100 !== v` (handles IEEE 754 artifacts and exponential notation like `1e-7`).
  - Formatted Section 8 "Financial Loss Assessment" table in PDF report dossier (`claim.report.builder.js`) with configured currency (`ILS`).
  - 25 comprehensive integration tests in `tests/claim.lossAssessment.test.js` (including exponential notation rejection, IEEE 754 artifact rejection, null-deductible policy snapshot, and DB-level override reason assertions), bringing total test count to **30 Suites / 461 Tests (100% Pass Rate)**.
- [x] **Dashboard Notification Center (Feature 21 Completed & Verified):**
  - Notification persistence model updated with `readAt: Date` (default `null`) replacing boolean `read`, type enum extended to 8 types, and compound index `{ organizationId: 1, recipientId: 1, readAt: 1 }`.
  - In-app notification center endpoints for all authenticated roles (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`):
    - `GET /api/v1/notifications`: Paginated listing, newest first, standard pagination headers (`X-Total-Count`, `X-Page`, `X-Limit`, `X-Total-Pages`), read-time resolution of `relatedClaimId.claimNumber`, and optional `?unreadOnly=true` filter.
    - `GET /api/v1/notifications/unread-count`: Lightweight counter endpoint returning `{ count }` for header badge rendering.
    - `PATCH /api/v1/notifications/:id/read`: Idempotent read-status marking with `readAt` timestamp and stealth-tenancy 404 on cross-user or cross-tenant access.
  - Loop-per-recipient organization notification fan-out helper (`sendToOrganization`) delivering 1 document per active `CLAIMS_OFFICER` and `ADMIN` (empty array if none exist, never throws).
  - Three new isolated lifecycle notification triggers in `src/modules/claims/claim.service.js`:
    - `NEW_CLAIM`: Triggered in `createClaim` to all active officers/admins excluding the creator.
    - `ASSIGNMENT_DECLINED`: Triggered in `declineAssignment` to all active officers/admins.
    - `INSPECTION_COMPLETED`: Triggered in `submitInspection` to all active officers/admins.
  - Zero-failure isolation guarantee: all notification dispatches are independently try/catch-isolated and never fail the parent claim transaction.
  - Dedicated unit and integration test suites (`tests/notification.api.test.js`, `tests/claim.notificationTriggers.test.js`).
- [x] **Claim Detail Refactoring (Single Source of Truth):**
  - Refactored `GET /api/v1/claims/:claimId` to return comprehensive 12-section response covering all claim data in a single request.
  - Deep population of Policy (policyNumber, status, startDate, expiryDate), Vehicle (make, model, year, color), and Customer data via Mongoose populate chain.
  - All user references (`assignedTo`, `assignedBy`, `createdBy`, `timeline[].performedBy`, `evidence[].uploadedBy`) resolved to `{ id, name, employeeCode }` objects — no secondary lookups required by frontend.
  - Null-safe response: all optional sections return explicit `null` (assignment, accident, location, signature, decision/closure) or `[]` (evidence) when data not yet populated.
  - Hardened `createClaim` with mandatory `policyId` validation, policy status/expiry gates, vehicle cross-matching, ambiguous vehicle selection protection (422 `AMBIGUOUS_VEHICLE_SELECTION` when policy has multiple vehicles and no plate provided), and auto-fill of customer/vehicle data from verified policy. Stores `vehicle.vehicleId` and `vehicle.customerId` at creation time.
  - Updated `claim.read.test.js` with Policy/Vehicle/Customer fixtures and verified populated vehicle details on API-created claims (18 tests passing).
- [x] **Integration Artifacts & Frontend Guides:**
  - Comprehensive Admin API guide for frontend developers (`docs/ADMIN_API_FOR_FRONTEND.md`).
  - Comprehensive Mobile API guide for Flutter / Mobile developers (`docs/MOBILE_API_FOR_FRONTEND.md`) detailing the field adjuster inspection workflow, in-app notification center integration (`GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`), 5-pillar completeness rules, and exact `multipart/form-data` request bodies with Flutter (Dio) code snippets for evidence photo uploads and digital signature capture.
  - **100% Complete & Synchronized Postman Collections:** All 34 Express 5 application routes are fully mapped and covered across 69 distinct requests, covering all positive flows, role authorizations, pagination, and negative test branches.
    - **Comprehensive Mobile Suite & Dual-State Postman Alignment:** The `Mobile (Field Adjuster)` folder has been fully consolidated and organized into a comprehensive 25-request end-to-end suite covering the entire Flutter mobile app lifecycle (Auth, Password Change, FCM Push Token, In-App Notifications List, Unread Notifications Count Badge, Mark Notification as Read, Assigned KPI Stats, Real-Time Passive GPS Location, Assigned Claims Queue & Tab Filtering, Claim Details, Two-Step Accept/Decline Assignment, On-Site Inspection Start, Vehicle/Policy Lookup, Draft PUTs for Vehicle/Accident/Location, Evidence & Digital Signature Uploads, Final 5-Pillar Submission, and 4 dedicated Negative Validation Tests). Request bodies for `Upload Evidence Photo` and `Upload Digital Signature` have been enriched with field descriptions, validation enums, Postman test assertions (`capturedAt`, `capturedBy`), and example response mock definitions synchronized across both local repository JSON and Postman Cloud.
    - **Postman Collection Pruning & Sequential Intake Flow:** Standardized and organized all 69 requests into 5 clearly numbered folders: `1. Authentication & Security`, `2. User Management`, `3. Claims Lifecycle & Operations`, `4. Field Adjuster (Mobile Workflow)`, and `5. Adjuster Dispatch & Location Tracking`. Embedded collection-level variables (`URL: http://localhost:5000/`, auto-injected auth tokens, `notificationId`, and dynamic claim IDs) allowing zero-config manual and automated test execution. Both local repository collection (`InsurFlow.postman_collection.json`) and Postman Cloud workspace are 100% synchronized with unique UUIDs.
  - **Full Request Body Audit & Schema Validation:** Systematically audited all 69 requests across the collection against backend Joi schemas (`auth.validation.js`, `user.validation.js`, `claim.validation.js`, `vehicle.validation.js`, `policy.validation.js`, `notification.validation.js`). 100% of request bodies now pass validation without schema errors (`scripts/validate_all_postman_bodies.js`).
  - Added dedicated route coverage validation utility (`scripts/verify_routes_coverage.js`) confirming 100% coverage across all 31 routes.
  - **Comprehensive Master Route Testing Suite (`tests/master.routes.test.js`):** End-to-end integration tests executing all 31 Express routes in continuous sequence, asserting role-based authorization (RBAC), multi-tenant data isolation, full claim lifecycle progression (intake verification, claim creation, dispatch, decline, accept, inspection, evidence upload, correction loop, decision, closure, and compiled PDF report generation), and passive GPS coordinate ingestion. Total system test suite: **28 Suites / 428 Tests (100% Pass Rate)**.
  - Team collaboration protocol (`docs/project/COLLABORATION_PROTOCOL.md`).
- [x] **Public Claim Tracking (Feature 23):**
  - Public, read-only claim status endpoint: `GET /api/v1/public/claims/track/:trackingToken` — no authentication required.
  - Cryptographically random 256-bit tracking tokens (64-char hex) generated automatically at claim creation, returned in `POST /api/v1/claims` response.
  - Customer-friendly status mapping: 10 internal statuses → 5 customer-facing statuses (`RECEIVED`, `IN_PROGRESS`, `IN_REVIEW`, `APPROVED/REJECTED`, `CLOSED`) with human-readable descriptions.
  - Simplified public timeline: only customer-visible milestones (Claim Received, Inspector Assigned, Inspection Started/Submitted, Review Started, Approved/Declined, Closed).
  - Dedicated public DTO with strict data exposure controls — no internal IDs, user references, evidence URLs, financials, notes, coordinates, phone numbers, or tracking tokens in response.
  - Security: opaque unguessable tokens, identical 404 for all invalid/malformed/unknown tokens (no enumeration), `Cache-Control: no-store` headers, rate-limited via existing `apiLimiter`.
  - Sparse unique index on `trackingToken` for O(1) lookups with backward compatibility for existing claims.
  - Dedicated test suite (`tests/claim.publicTracking.test.js`) with 30 tests covering functional, security (7 data leakage tests), status mapping (all 10 statuses), timeline filtering, cross-org isolation, regression, and rate limiting, bringing total to **31 Suites / 491 Tests (100% Pass Rate)**.
- [x] **Intake Incident Date Persistence (GAP-05 Completed & Verified):**
  - Added `incidentDate: { type: String, default: null }` attribute to `Claim` schema ([claim.model.js](../../src/modules/claims/claim.model.js)).
  - Persisted validated `incidentDate: incidentDate || null` during claim creation in `createClaim` ([claim.service.js](../../src/modules/claims/claim.service.js)).
  - Exposed `incidentDate: claim.incidentDate ?? null` in Section 1 (Claim Information) of `GET /api/v1/claims/:claimId`.
  - Maintained strict domain distinction from inspection-stage `accident.accidentDate`.
  - Full backward compatibility for legacy claims without `incidentDate` returning explicit `null`.
  - Added 3 automated tests in `tests/claim.read.test.js`, bringing total test count to 31 Suites / 497 Tests.
- [x] **Coverage Verification & Coverage Applicability (GAP-02 Completed & Verified):**
  - Enhanced existing `POST /api/v1/policies/verify` endpoint response to return dedicated `coverage` object containing authoritative coverage details for the incident being verified.
  - Maps `policyType` (`COMPREHENSIVE` | `THIRD_PARTY`), `effectiveFrom`, `effectiveTo`, `deductible` (policy-level, never per-peril), and `incidents` (peril applicability matrix dynamically derived from canonical `Policy.COVERED_PERILS`).
  - Strict data fidelity: does not fabricate currency (omitted since not in Policy schema) or coverage limits.
  - Safe legacy policy handling: policies missing coverage structure return `coverage: null` without guessing.
  - Maintains 100% backward compatibility of existing response fields (`isEligible`, `eligibilityHint`, `policy`, `vehicle`, `customer`).
  - Added 9 dedicated integration tests in `tests/policy.verification.test.js` (48 tests in suite), bringing total system coverage to **31 Suites / 506 Tests (100% Pass Rate)**.
- [x] **Stage 4A: Intake and Money (Advisory Eligibility, Required Incident Date, & Financial Decision Engine - Completed & Verified):**
  - **Advisory Policy Verification:** Period mismatch and expired status transformed to advisory hint (`INCIDENT_OUTSIDE_POLICY_PERIOD`) via pure utility `computeEligibilityHint.js`. Hard 422 errors removed for expired/date mismatch, while `POLICY_CANCELLED` and vehicle mismatches remain strict 422 blocks. Customer object returns strictly `['id', 'fullName', 'phone']`.
  - **Claim Intake Expansion (`POST /api/v1/claims`):** Required `incidentDate` (`YYYY-MM-DD`, not in future), optional `description` stored as `incidentDescription`, advisory `eligibilityHint` computed on creation, and enhanced response containing `trackingToken`, `trackingUrl`, `eligibilityHint`, and `coverageSnapshot`. Flat `latitude` and `longitude` request shape.
  - **Financial Adjudication Engine (`POST /api/v1/claims/:claimId/decision`):**
    - Removed `REQUIRE_LOSS_ASSESSMENT` feature flag; `lossAssessment` is unconditionally mandatory for `APPROVED` and strictly forbidden for `REJECTED` (both return 400 `VALIDATION_ERROR`).
    - Validates `totalDamage <= 0` prior to deductible check (returns 400 `VALIDATION_ERROR` with `"totalDamage must be greater than zero"`).
    - `totalDamage <= deductibleApplied` returns 422 `DAMAGE_BELOW_DEDUCTIBLE`.
    - Deductible override rules: `overridden = appliedCents !== policyDeductibleCents`. When overridden, requires 10-300 char reason (else 422 `OVERRIDE_REASON_REQUIRED`) and appends `[DEDUCTIBLE OVERRIDE] policy deductible <X>, applied <Y>. Reason: <reason>` to timeline note. When not overridden, non-empty reason returns 422 `OVERRIDE_REASON_NOT_ALLOWED`. Persists `deductibleOverridden` boolean in `lossAssessment`.
    - Both `CLAIMS_OFFICER` and `ADMIN` authorized to override deductible.
  - **Public Tracking & Frontend Alignment (Stages 4B & 4C):** Forward-only timeline, dedicated tracking rate limiter, plate number masking, tracking token restricted to officers/admins, decision accepts null lossAssessment on rejection (F4), contract key locks locked in `tests/contract.keys.test.js`, and full Arabic frontend handoff in `docs/FRONTEND_HANDOFF.md`.
  - Total automated test suites: **38 Suites / 596 Tests (100% Pass Rate)** across 38 suites with 100% pass rate.

---

## 3. Current Work & Immediate Priorities (`What's Next`)

### Immediate Frontend Integration Tasks:
1. **Mobile (Flutter) Field Inspection Integration:**
   - Field adjuster authentication (`/auth/login`).
   - Assigned claims display (`/claims`).
   - Inspection initiation (`POST /claims/:id/inspection/start`).
   - Vehicle & policy lookup (`/vehicles/lookup`).
   - Step-by-step inspection draft updates (`/claims/:id/vehicle`, `/accident`, `/location`).
   - Final inspection submission (`/claims/:id/inspection/submit`).
   - Resuming inspections on correction requests (`POST /claims/:id/inspection/start`).
2. **Web Dashboard Integration:**
   - Back-office login (`/auth/login`).
   - Claims intake form (`POST /claims`).
   - Field adjuster dispatch screen (`GET /users/adjusters?status=available`, `POST /claims/:id/assign`).
   - Inspection report review interface (`POST /claims/:id/review/start`).
   - Correction request interface (`POST /claims/:id/review/request-correction`).
   - Claim approval/rejection decision buttons (`POST /claims/:id/decision`).
   - Admin claim final closure (`POST /claims/:id/close`).
   - Admin user administration screen (`/users`).
   - Dashboard KPI overview cards and workload distribution charts (`GET /claims/stats`).

---

## 4. Sprint 2 Scope & Resolutions (`COMPLETED`)

| Item | Classification | Resolution Status |
|---|---|---|
| **Global Claim Counter** | Technical Debt | ✅ **RESOLVED:** Tenant-scoped counter (`claimNumber_<orgId>`) generating `CLM-<ORG>-NNNN`. |
| **Claim Decision Engine** | Functional Scope | ✅ **RESOLVED:** Implemented `POST /claims/:claimId/decision` (`UNDER_REVIEW` → `APPROVED` \| `REJECTED`). |
| **Admin Claim Closure** | Functional Scope | ✅ **RESOLVED:** Implemented `POST /claims/:claimId/close` (`APPROVED` → `CLOSED`, ADMIN only). |
| **Status Machine Expansion** | Functional Scope | ✅ **RESOLVED:** 9-status lifecycle with `IN_PROGRESS` and `CORRECTION_REQUIRED` loop. |
| **Adjuster Capacity Upgrade** | Business Rule | ✅ **RESOLVED:** Adjusters remain available with up to 3 active claims (`activeTasksCount <= 3`). |
| **N+1 Query in `getAdjusters`** | Performance Optimization | ✅ **RESOLVED:** Replaced `Promise.all` loop with single MongoDB `$lookup` aggregation pipeline. |
| **Pagination on Listings** | Scalability Enhancement | ✅ **RESOLVED:** Header-based pagination (`X-Total-Count`, `X-Page`, `X-Limit`, `X-Total-Pages`) on `GET /claims` and `GET /users`. |
| **API & Login Rate Limiting** | Security Hardening | ✅ **RESOLVED:** Multi-tiered rate limiting with `loginLimiter` (brute-force defense) and `apiLimiter` (DoS/scraping defense). |
| **Express 5 Query Validation Masking** | Architectural Defect (Sprint 1) | ✅ **RESOLVED:** Discovered and fixed prototype getter bug in `validate.middleware.js` using `Object.defineProperty` to ensure Joi type casting, trimming, and default values properly populate `req.query`. |
| **Dashboard KPI Aggregation** | Functional Scope / Analytics | ✅ **RESOLVED:** Implemented `GET /claims/stats` with role-scoped envelopes (`ORGANIZATION` vs `ASSIGNED`), date filtering, and workload distribution metrics. |
| **Final Claim Report (PDF)** | Functional Scope / Document Generation | ✅ **RESOLVED:** Implemented `GET /claims/:claimId/report` with `pdfmake`, Cloudinary image resizing, graceful degradation, and full domain hydration. |

---

## 5. Architectural & Testing Notes (Known Constraints)

- **Test Fixture Expiry Date Notice:** All test fixtures across the automated test suites currently set policy expiration to `2026-12-31`. Because `verifyPolicy` evaluates expiration against current system time (`now > expiryDate` triggers 422 `POLICY_EXPIRED`), these automated test suites will begin failing if executed after `2026-12-31` unless test system clocks or fixture dates are updated. This is acknowledged technical debt to be addressed in future maintenance.



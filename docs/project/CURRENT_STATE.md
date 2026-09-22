# InsurFlow — Current Project State & Progress Tracking

> **Last Updated:** 2026-09-22  
> **Document Purpose:** Single source of truth for current project status, completed work, active blockers, and immediate next steps. Consult this document at the start of any new session or task.

---

## 1. Project Phase & Milestones

| Metric | Status |
|---|---|
| **Current Project Phase** | Active Development / Frontend Integration Phase |
| **Current Sprint** | **Sprint 1, Sprint 2 & Features 18, 19, 20 (Policy Verification Intake Gate) Completed & Verified** |
| **Architectural Health** | Structurally Sound (Modular 5-layer architecture, 100% test passing) |
| **Overall Readiness** | **Backend Core & Lifecycle Deliverables: 100% Complete & Verified (27 Suites / 383 Tests - 100% Pass)** |

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
- [x] **Policy Verification / Intake Gate (Feature 20 Completed & Verified):**
  - Mandatory eligibility check endpoint `POST /api/v1/policies/verify` implemented before claim intake.
  - Restricted strictly to `CLAIMS_OFFICER` and `ADMIN` roles (`FIELD_ADJUSTER` receives 403).
  - Business validations: tenant isolation, dual search support by `policyNumber` or `plateNumber` (or both), active status check (`422 POLICY_CANCELLED`, `422 POLICY_EXPIRED`), calendar expiration comparison, future incident date prevention (`400 INVALID_INCIDENT_DATE`), date range check against `[startDate, expiryDate]` (`422 POLICY_NOT_ACTIVE_ON_DATE`), and plate cross-matching with missing vehicle safety checks (`422 VEHICLE_MISMATCH`).
  - Cross-tenant stealth rejection returning `404 POLICY_NOT_FOUND` to protect tenant isolation.
  - Optimized database query performance via compound index `{ organizationId: 1, policyId: 1 }` on `Vehicle`.
  - Dedicated 20 integration tests (`tests/policy.verification.test.js`), bringing system test coverage to **27 Suites / 378 Tests (100% Pass Rate)**.
- [x] **Claim Detail Refactoring (Single Source of Truth):**
  - Refactored `GET /api/v1/claims/:claimId` to return comprehensive 12-section response covering all claim data in a single request.
  - Deep population of Policy (policyNumber, status, startDate, expiryDate), Vehicle (make, model, year, color), and Customer data via Mongoose populate chain.
  - All user references (`assignedTo`, `assignedBy`, `createdBy`, `timeline[].performedBy`, `evidence[].uploadedBy`) resolved to `{ id, name, employeeCode }` objects — no secondary lookups required by frontend.
  - Null-safe response: all optional sections return explicit `null` (assignment, accident, location, signature, decision/closure) or `[]` (evidence) when data not yet populated.
  - Hardened `createClaim` with mandatory `policyId` validation, policy status/expiry gates, vehicle cross-matching, and auto-fill of customer/vehicle data from verified policy.
  - Updated `claim.read.test.js` with Policy/Vehicle/Customer fixtures (17 tests passing).
- [x] **Integration Artifacts & Frontend Guides:**
  - Comprehensive Admin API guide for frontend developers (`docs/ADMIN_API_FOR_FRONTEND.md`).
  - **100% Complete & Synchronized Postman Collections:** All 31 Express 5 application routes are fully mapped and covered across 66 distinct requests, covering all positive flows, role authorizations, pagination, and negative test branches.
    - **Comprehensive Mobile Suite & Dual-State Postman Alignment:** The `Mobile (Field Adjuster)` folder has been fully consolidated and organized into a comprehensive 22-request end-to-end suite covering the entire Flutter mobile app lifecycle (Auth, Password Change, FCM Push Token, Assigned KPI Stats, Real-Time Passive GPS Location, Assigned Claims Queue & Tab Filtering, Claim Details, Two-Step Accept/Decline Assignment, On-Site Inspection Start, Vehicle/Policy Lookup, Draft PUTs for Vehicle/Accident/Location, Evidence & Digital Signature Uploads, Final 5-Pillar Submission, and 4 dedicated Negative Validation Tests). The `Claims` folder was simultaneously cleaned of mobile duplicates, dedicating it strictly to Back-Office Web Dashboard operations.
    - **Postman Collection Pruning & Sequential Intake Flow:** The `Claims` folder begins with the new `1. Verify Policy Eligibility / Intake Gate (Officer/Admin)` step followed by sequentially indexed requests (1 to 14, including negative vehicle mismatch and expired policy tests). Both local repository collection (`InsurFlow.postman_collection.json`) and automated validation scripts are 100% synchronized with unique UUIDs.
  - **Full Request Body Audit & Schema Validation:** Systematically audited all 66 requests across the collection against backend Joi schemas (`auth.validation.js`, `user.validation.js`, `claim.validation.js`, `vehicle.validation.js`, `policy.validation.js`). 100% of request bodies now pass validation without schema errors (`scripts/validate_all_postman_bodies.js`).
  - Added dedicated route coverage validation utility (`scripts/verify_routes_coverage.js`) confirming 100% coverage across all 31 routes.
  - **Comprehensive Master Route Testing Suite (`tests/master.routes.test.js`):** 36 end-to-end integration tests executing all 31 Express routes in continuous sequence, asserting role-based authorization (RBAC), multi-tenant data isolation, full claim lifecycle progression (intake verification, claim creation, dispatch, decline, accept, inspection, evidence upload, correction loop, decision, closure, and compiled PDF report generation), and passive GPS coordinate ingestion. Total system test suite: **27 Suites / 383 Tests (100% Pass Rate)**.
  - Team collaboration protocol (`docs/project/COLLABORATION_PROTOCOL.md`).

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



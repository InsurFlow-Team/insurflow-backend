# InsurFlow — Current Project State & Progress Tracking

> **Last Updated:** 2026-09-12  
> **Document Purpose:** Single source of truth for current project status, completed work, active blockers, and immediate next steps. Consult this document at the start of any new session or task.

---

## 1. Project Phase & Milestones

| Metric | Status |
|---|---|
| **Current Project Phase** | Active Development / Frontend Integration Phase |
| **Current Sprint** | **Sprint 1 & Sprint 2 Completed & Verified** |
| **Architectural Health** | Structurally Sound (Modular 5-layer architecture, 100% test passing) |
| **Overall Readiness** | **Backend Core & Lifecycle Deliverables: 100% Complete & Verified (18 Suites / 241 Tests)** |

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
  - Claim creation restricted to `CLAIMS_OFFICER` (`POST /api/v1/claims`).
  - Single-query MongoDB `$lookup` aggregation for adjuster availability eliminating N+1 queries.
  - Adjuster workload capacity rule: adjusters with $\le 3$ active claims (`ASSIGNED`, `IN_PROGRESS`, `CORRECTION_REQUIRED`) remain `AVAILABLE`; more than 3 active claims transitions them to `UNAVAILABLE`.
  - Adjuster dispatch with atomic assignment checks (`POST /api/v1/claims/:claimId/assign`).
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
- [x] **User Administration APIs (`ADMIN` only):**
  - Create staff user (`POST /api/v1/users`), list users with pagination (`GET /api/v1/users`), update user details (`PATCH /api/v1/users/:id`), toggle user status (`PATCH /api/v1/users/:id/status`), administrative password reset (`PATCH /api/v1/users/:id/reset-password`).
- [x] **Pagination & Header Exposure:**
  - Standardized pagination headers (`X-Total-Count`, `X-Page`, `X-Limit`, `X-Total-Pages`) on `GET /api/v1/claims` and `GET /api/v1/users`.
- [x] **Integration Artifacts & Frontend Guides:**
  - Comprehensive Admin API guide for frontend developers (`docs/ADMIN_API_FOR_FRONTEND.md`).
  - Complete, updated Postman collection (`InsurFlow.postman_collection.json`) covering all auth, claim lifecycle, inspection, decision, and admin flows.
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



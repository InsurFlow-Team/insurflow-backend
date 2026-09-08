# InsurFlow — Current Project State & Progress Tracking

> **Last Updated:** 2026-09-07  
> **Document Purpose:** Single source of truth for current project status, completed work, active blockers, and immediate next steps. Consult this document at the start of any new session or task.

---

## 1. Project Phase & Milestones

| Metric | Status |
|---|---|
| **Current Project Phase** | Active Development |
| **Current Sprint** | **Sprint 1 (Claim Intake & Field Inspection Flow)** |
| **Architectural Health** | Structurally Sound (Preserve existing modular architecture) |
| **Overall Readiness** | **Backend Sprint 1 Deliverables: 100% Complete & Verified** |

---

## 2. Completed Milestones (`What is Done`)

- [x] **Backend Foundation:**
  - Express 5 REST application with Helmet security headers, cookie parser, Morgan logging, and global error handling (`errorHandler.js`, `notFound.js`, `asyncWrapper.js`).
  - Standardized JSON envelope (`src/utils/apiResponse.js`) for all endpoints.
- [x] **Authentication & Session:**
  - Tenant-scoped login (`organizationCode`, `employeeCode`, `password`) via `POST /api/v1/auth/login`.
  - Stateless HS256 JWT generation with 8-hour expiration and dual extraction (Bearer header + httpOnly cookie).
  - Password hashing with bcrypt (10 rounds) and `select: false` on Mongoose schema.
  - Self-service password change (`PUT /api/v1/auth/change-password`) with standardized route-level Joi middleware.
  - Active user verification at login.
- [x] **Role-Based Access Control (RBAC):**
  - Factory middleware `authorizeRole(...)` enforcing role permissions (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`).
- [x] **Multi-Tenancy Foundation:**
  - Server-side derivation of `organizationId` from authenticated token context.
  - Compound unique indexes on `{ organizationId, ... }` across Claims, Users, Vehicles, and Policies.
- [x] **Claims Intake & Assignment:**
  - Claim creation restricted to `CLAIMS_OFFICER` (`POST /api/v1/claims`).
  - Adjuster availability computation (`GET /api/v1/users/adjusters?status=available`).
  - Adjuster dispatch with workload capacity checks (`POST /api/v1/claims/:claimId/assign`).
- [x] **Vehicle & Policy Lookup:**
  - Plate lookup (`GET /api/v1/vehicles/lookup`) with normalization and policy expiration warning (`POLICY_EXPIRED`).
- [x] **Field Inspection & Lifecycle:**
  - Incremental inspection saves (`PUT /claims/:id/vehicle`, `PUT /claims/:id/accident`, `PUT /claims/:id/location`).
  - Mandatory inspection completeness validation (Vehicle, Accident, Location) on `POST /claims/:id/inspection/submit`.
  - Claim review initiation by claims officer (`POST /claims/:id/review/start`).
- [x] **Comprehensive Codebase Audit:**
  - Independent verification of all findings from Flash 3.8 audit.
  - Elimination of false positives and confirmation that `APPROVED`/`REJECTED`/`CLOSED` belong to Sprint 2.
- [x] **Environment & Secret Hardening (Phase 2):**
  - Verified `.env` was never committed to Git history.
  - Fail-fast validation in `src/config/env.js` ensuring required environment variables (`JWT_SECRET`, `DATABASE_URL`) are present at startup.
- [x] **Repository Atomic Mutation Refactoring (Phase 1):**
  - Refactored all 6 mutation methods in `src/modules/claims/claim.repository.js` (`assignClaim`, `updateVehicle`, `updateAccident`, `updateLocation`, `submitInspection`, `startReview`) to use atomic `findOneAndUpdate` with `organizationId` and expected `status` in the query filter.
  - Service layer updated to pass tenant and role context directly into atomic mutations.
- [x] **ObjectId Path Parameter Validation:**
  - Reusable `validateObjectId` Joi middleware applied to all routes with `:claimId` and `:userId`.
  - Malformed IDs now consistently return `400 Bad Request` with code `VALIDATION_ERROR` and message `"Invalid ID format"`.
- [x] **Concurrency Race Automated Testing:**
  - Automated integration test in `tests/claim.assignment.test.js` validating simultaneous assignment calls (`Promise.all`) safely allow exactly one winner (200) and reject the conflicting duplicate (409).
- [x] **API Contract Alignment:**
  - Updated `docs/API_CONTRACT.md` with `claimNumber` on claim creation and listing responses.
  - Explicitly flagged `decision` and `close` endpoints as deferred to Sprint 2.
  - Fully documented all 4 Admin user management endpoints (`/users`, `/users/:userId/status`, `/users/:userId/reset-password`).

---

## 3. Current Work & Immediate Priorities (`What's Next`)

### Immediate Frontend Integration Tasks:
1. **Mobile (Flutter) Field Inspection Integration:**
   - Field adjuster authentication (`/auth/login`).
   - Assigned claims display (`/claims`).
   - Vehicle & policy lookup (`/vehicles/lookup`).
   - Step-by-step inspection draft updates (`/claims/:id/vehicle`, `/accident`, `/location`).
   - Final inspection submission (`/claims/:id/inspection/submit`).
2. **Web Dashboard Integration:**
   - Back-office login (`/auth/login`).
   - Claims intake form (`POST /claims`).
   - Field adjuster dispatch screen (`GET /users/adjusters?status=available`, `POST /claims/:id/assign`).
   - Inspection report review interface (`POST /claims/:id/review/start`).
   - Admin user administration screen (`/users`).

---

## 4. Sprint 2 Scope & Resolutions (`COMPLETED`)

| Item | Classification | Resolution Status |
|---|---|---|
| **Global Claim Counter** | Technical Debt | ✅ **RESOLVED:** Tenant-scoped counter (`claimNumber_<orgId>`) generating `CLM-<ORG>-NNNN`. |
| **Claim Decision Engine** | Functional Scope | ✅ **RESOLVED:** Implemented `POST /claims/:claimId/decision` (`UNDER_REVIEW` → `APPROVED` \| `REJECTED`). |
| **Admin Claim Closure** | Functional Scope | ✅ **RESOLVED:** Implemented `POST /claims/:claimId/close` (`APPROVED` → `CLOSED`, ADMIN only). |
| **N+1 Query in `getAdjusters`** | Performance Optimization | ✅ **RESOLVED:** Replaced `Promise.all` loop with single MongoDB `$lookup` aggregation pipeline. |
| **Pagination on Listings** | Scalability Enhancement | ✅ **RESOLVED:** Header-based pagination (`X-Total-Count`, `X-Page`, `X-Limit`, `X-Total-Pages`) on `GET /claims` and `GET /users`. |
| **API & Login Rate Limiting** | Security Hardening | ✅ **RESOLVED:** Multi-tiered rate limiting with `loginLimiter` (brute-force defense) and `apiLimiter` (DoS/scraping defense). |


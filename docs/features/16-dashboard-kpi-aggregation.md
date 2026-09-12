# Feature Specification: Dashboard KPI Aggregation

## 1. Feature Overview
The Dashboard KPI Aggregation service provides a unified, role-scoped metrics endpoint (`GET /api/v1/claims/stats`) designed to power the primary overview screens of both the back-office Web Dashboard and the mobile Field Adjuster application.

To maximize performance and prevent data leakage:
1. **Multi-Tenancy Isolation:** All metrics and aggregations are strictly filtered by the authenticated user's `organizationId` derived directly from JWT claims.
2. **Role-Scoped Envelopes:**
   - **`ADMIN` and `CLAIMS_OFFICER`** receive an `ORGANIZATION`-scoped envelope containing organization-wide claim volumes across all 9 lifecycle statuses, actionable review counts, and field adjuster workload distribution metrics.
   - **`FIELD_ADJUSTER`** receives an `ASSIGNED`-scoped envelope containing personal caseload metrics, inspection action breakdowns, and current active capacity versus maximum task limits (`MAX_ACTIVE_CLAIMS_PER_ADJUSTER = 3`).
3. **Optimized Aggregation & Indexing:** Built on a single MongoDB aggregation pipeline with compound indexes, avoiding full collection scans and eliminating N+1 lookups.

---

## 2. Endpoint Specification

### `GET /api/v1/claims/stats`
- **Purpose:** Retrieve aggregated KPI metrics and status counts for the dashboard.
- **Authentication:** Required (JWT via Bearer header or cookie).
- **Authorized Roles:** `ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`.
- **Query Parameters:**

| Parameter | Type | Required | Default | Validation & Expansion Rules |
|:---|:---|:---|:---|:---|
| `from` | String (ISO 8601 / `YYYY-MM-DD`) | No | None (all-time start) | Parses ISO date or expands `YYYY-MM-DD` to `00:00:00.000Z`. Cannot be in the future. |
| `to` | String (ISO 8601 / `YYYY-MM-DD`) | No | Current timestamp (`now`) | Parses ISO date or expands `YYYY-MM-DD` to `23:59:59.999Z`. If in future, silently capped to `now`. |

### Validation Rules & Exact Error Responses (HTTP 400)
Input validation is handled by Joi in `claim.validation.js` using `getClaimStatsQuerySchema`:
- **Future `from` date:** If `from > now`, rejects with:
  ```json
  {
    "success": false,
    "message": "Validation error",
    "errors": [{ "code": "VALIDATION_ERROR", "details": "from date cannot be in the future" }]
  }
  ```
- **Inverted date range:** If `from > to` (when `to` is explicitly supplied), rejects with:
  ```json
  {
    "success": false,
    "message": "Validation error",
    "errors": [{ "code": "VALIDATION_ERROR", "details": "from date must be before or equal to to date" }]
  }
  ```
- **Excessive date range (> 5 years):** If the resolved date range exceeds 5 calendar years (either explicit `to - from > 5 years` or only `from` is supplied and `now - from > 5 years`), rejects with:
  ```json
  {
    "success": false,
    "message": "Validation error",
    "errors": [{ "code": "VALIDATION_ERROR", "details": "date range cannot exceed 5 years" }]
  }
  ```
- **Invalid date format:** If `from` or `to` is not a valid ISO date string, rejects with:
  ```json
  {
    "success": false,
    "message": "Validation error",
    "errors": [{ "code": "VALIDATION_ERROR", "details": "\"from\" must be in ISO 8601 date format" }]
  }
  ```
- **Unknown query parameters:** Unknown parameters trigger strict schema rejection with code `VALIDATION_ERROR`.
- **Future `to` date capping:** If `to` is in the future, it is **silently capped** to the current server timestamp (`now`) without rejecting the request, ensuring smooth UX for end-of-day or current-year selections.

---

## 3. Response Shapes & Data Contracts

### 3.1 Shape A: `ORGANIZATION` Scope (`ADMIN`, `CLAIMS_OFFICER`)
Returned when the caller is an `ADMIN` or `CLAIMS_OFFICER`. Provides global operational metrics across the tenant organization.

```json
{
  "success": true,
  "message": "Claim statistics retrieved successfully",
  "data": {
    "scope": "ORGANIZATION",
    "totalClaims": 13,
    "byStatus": {
      "NEW": 2,
      "ASSIGNED": 3,
      "IN_PROGRESS": 2,
      "SUBMITTED": 1,
      "UNDER_REVIEW": 1,
      "CORRECTION_REQUIRED": 1,
      "APPROVED": 1,
      "REJECTED": 1,
      "CLOSED": 1
    },
    "pendingActionCount": 4,
    "actionableBreakdown": {
      "unassigned": 2,
      "readyForReview": 2
    },
    "adjustersWorkload": {
      "totalActive": 3,
      "available": 3,
      "nearCapacity": 1,
      "atCapacity": 1
    }
  }
}
```

#### Field Semantics:
- `scope`: Always `"ORGANIZATION"`.
- `totalClaims`: Total claims created within the tenant matching the date range filter.
- `byStatus`: Uniform dictionary containing counts for all 9 statuses in the lifecycle. Any status with no claims is explicitly represented as `0`.
- `pendingActionCount`: Total actionable claims requiring office intervention:
  $$\text{pendingActionCount} = \text{NEW} + \text{SUBMITTED} + \text{UNDER_REVIEW}$$
- `actionableBreakdown`:
  - `unassigned`: Claims in `NEW` awaiting assignment.
  - `readyForReview`: Claims in `SUBMITTED` + `UNDER_REVIEW` awaiting claims officer review and decision.
- `adjustersWorkload`: Real-time capacity distribution across all `ACTIVE` adjusters in the organization (inactive staff excluded):
  - `totalActive`: Number of active field adjusters in the tenant.
  - `available`: Adjusters with `availability === 'AVAILABLE'` ($\le 3$ active tasks).
  - `nearCapacity`: Adjusters with exactly 2 active tasks ($\text{maxWorkload} - 1$).
  - `atCapacity`: Adjusters with 3 or more active tasks ($\ge \text{maxWorkload}$).
- Note: The `capacity` field is omitted (`undefined`) for this scope.

---

### 3.2 Shape B: `ASSIGNED` Scope (`FIELD_ADJUSTER`)
Returned when the caller is a `FIELD_ADJUSTER`. Scoped strictly to claims where `assignedTo === req.user.userId`.

```json
{
  "success": true,
  "message": "Claim statistics retrieved successfully",
  "data": {
    "scope": "ASSIGNED",
    "totalClaims": 6,
    "byStatus": {
      "NEW": 0,
      "ASSIGNED": 2,
      "IN_PROGRESS": 1,
      "SUBMITTED": 1,
      "UNDER_REVIEW": 0,
      "CORRECTION_REQUIRED": 1,
      "APPROVED": 1,
      "REJECTED": 0,
      "CLOSED": 0
    },
    "pendingActionCount": 4,
    "actionableBreakdown": {
      "toStart": 2,
      "inProgress": 1,
      "needsCorrection": 1
    },
    "capacity": {
      "active": 4,
      "max": 3
    }
  }
}
```

#### Field Semantics:
- `scope`: Always `"ASSIGNED"`.
- `totalClaims`: Total claims assigned to this adjuster within the tenant matching the date range filter.
- `byStatus`: Uniform dictionary of status counts. `NEW` is always `0` since unassigned claims have no assignee.
- `pendingActionCount`: Total claims currently in the adjuster's active queue:
  $$\text{pendingActionCount} = \text{ASSIGNED} + \text{IN_PROGRESS} + \text{CORRECTION_REQUIRED}$$
- `actionableBreakdown`:
  - `toStart`: Claims in `ASSIGNED` awaiting inspection start.
  - `inProgress`: Claims in `IN_PROGRESS` currently being inspected.
  - `needsCorrection`: Claims in `CORRECTION_REQUIRED` awaiting re-inspection or additional evidence.
- `capacity`:
  - `active`: Current active workload ($\text{pendingActionCount}$).
  - `max`: Constant ceiling (3, defined by `Claim.MAX_ACTIVE_CLAIMS_PER_ADJUSTER`).
- Note: The `adjustersWorkload` field is omitted (`undefined`) for this scope, and the adjusters workload query is completely bypassed in the backend.

---

## 4. Critical Domain Caveat: Non-Mutually Exclusive Metrics

> [!WARNING]
> **Important Note for Frontend Developers Building KPI Dashboard Cards:**
> In `adjustersWorkload`, the metrics **`available`** and **`atCapacity`** are **NOT mutually exclusive**.
>
> **Domain Rule Background:**
> Under InsurFlow Business Rules ([BUSINESS_RULES.md](../project/BUSINESS_RULES.md) Rule BR-ASSIGN-4) and `Claim.MAX_ACTIVE_CLAIMS_PER_ADJUSTER = 3`:
> 1. An adjuster is marked `AVAILABLE` if $\text{activeTasksCount} \le 3$ across active statuses (`ASSIGNED`, `IN_PROGRESS`, `CORRECTION_REQUIRED`).
> 2. An adjuster is marked `atCapacity` if $\text{activeTasksCount} \ge 3$ ($\ge \text{maxWorkload}$).
>
> Consequently, an adjuster with **exactly 3 active claims** is:
> - Counted in `available` (because $3 \le 3$).
> - Counted in `atCapacity` (because $3 \ge 3$).
>
> **UI Implementation Directive:**
> Do **NOT** render `available`, `nearCapacity`, and `atCapacity` as slices of a single 100% pie chart or stacked bar chart. They will sum to more than `totalActive`. Instead, render them as **individual KPI metric cards** or distinct counters.

---

## 5. Architectural Implementation & Database Indexes

### 5.1 5-Layer Pattern Architecture
- **Router ([src/modules/claims/claim.routes.js](../../src/modules/claims/claim.routes.js)):**
  - Mounts `GET /stats` before `GET /:claimId` to avoid route parameter collision.
  - Middleware pipeline: `authenticate` → `authorizeRole(['CLAIMS_OFFICER', 'FIELD_ADJUSTER', 'ADMIN'])` → `validate(getClaimStatsQuerySchema, 'query')` → `claimController.getClaimStats`.
- **Controller ([src/modules/claims/claim.controller.js](../../src/modules/claims/claim.controller.js)):**
  - Extracts `req.user` and validated `req.query`, invokes `claimService.getClaimStats(req.user, req.query)`.
- **Service ([src/modules/claims/claim.service.js](../../src/modules/claims/claim.service.js)):**
  - For `FIELD_ADJUSTER`: Calls `claimRepository.getClaimStats` scoped to `assignedTo: userId`. Skips adjuster workload queries entirely.
  - For `ADMIN` / `CLAIMS_OFFICER`: Concurrently executes `claimRepository.getClaimStats` and `userRepository.findAdjustersWithWorkload` via `Promise.all`.
- **Repository ([src/modules/claims/claim.repository.js](../../src/modules/claims/claim.repository.js)):**
  - Executes single-stage aggregation pipeline:
    ```javascript
    const pipeline = [
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ];
    return await Claim.aggregate(pipeline);
    ```
- **User Repository ([src/modules/users/user.repository.js](../../src/modules/users/user.repository.js)):**
  - Reuses optimized `$lookup` aggregation to compute `activeTasksCount` and `availability` across active adjusters.

### 5.2 Compound Index Optimization ([src/modules/claims/claim.model.js](../../src/modules/claims/claim.model.js))
To guarantee instantaneous aggregation even under large multi-tenant datasets, two targeted compound indexes are maintained on the `claims` collection:

1. **Organization Date & Status Index:**
   ```javascript
   claimSchema.index({ organizationId: 1, createdAt: -1, status: 1 });
   ```
   Directly satisfies the `{ organizationId, createdAt: { $gte, $lte } }` match filter and supports `{ $group: { _id: '$status' } }` sorting.

2. **Adjuster Assigned Date Index:**
   ```javascript
   claimSchema.index({ organizationId: 1, assignedTo: 1, createdAt: -1 });
   ```
   Satisfies the `{ organizationId, assignedTo, createdAt: { $gte, $lte } }` filter for adjuster-scoped queries.

---

## 6. Multi-Tenancy & Edge-Case Guarantees

1. **Strict Multi-Tenancy:**
   - Tenant boundaries cannot be breached. Aggregations match strictly on `orgObjectId = new mongoose.Types.ObjectId(authUser.organizationId)`.
   - Cross-tenant requests or attempts to query another tenant's metrics are impossible.
2. **Zero-Claim Tenants:**
   - If an organization has zero claims or zero active adjusters, the endpoint returns HTTP 200 with all status counts and metrics initialized to `0` without throwing errors or returning `null`.
3. **Open-Ended Boundaries:**
   - Supplying only `from` aggregates from that timestamp up to `now`.
   - Supplying only `to` aggregates from the beginning of tenant history up to `to`.
   - Supplying neither aggregates all-time tenant claims.

---

## 7. Verification & Automated Test Coverage

Automated integration tests for Feature 16 are consolidated in [tests/claim.stats.test.js](../../tests/claim.stats.test.js) (615 lines, 22 integration tests across 6 test suites):
- **Suite 1:** Authentication & RBAC (401 without token, 200 for `ADMIN`, `CLAIMS_OFFICER`, and `FIELD_ADJUSTER`).
- **Suite 2:** `ADMIN` / `CLAIMS_OFFICER` response envelope, status dictionary completeness, pending action sums, and adjuster workload categorization.
- **Suite 3:** `FIELD_ADJUSTER` assigned-only scoping, exclusion of `adjustersWorkload`, capacity calculations, and isolation between adjusters.
- **Suite 4:** Multi-tenancy isolation (Org 1 vs Org 2) and zero-claim tenant handling.
- **Suite 5:** Date range filtering (`from`/`to`), inclusive date-only expansion, open-ended bounds, ISO parsing, and future date capping.
- **Suite 6:** Query validation error handling (future `from`, `from > to`, range $> 5$ years, invalid format, unknown parameters).

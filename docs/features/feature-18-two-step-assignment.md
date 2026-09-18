# Feature Specification: Two-Step Claim Assignment (PENDING_ACCEPTANCE)

## 1. Feature Overview
The **Two-Step Claim Assignment** upgrade transforms the legacy single-step assignment (`POST /claims/:claimId/assign` → instant `ASSIGNED`) into an explicit two-step workflow:
1. **Dispatch (Officer):** Claims Officer assigns a claim to an active Field Adjuster. The claim transitions from **`NEW` → `PENDING_ACCEPTANCE`**.
2. **Adjuster Response (Adjuster):** The target Field Adjuster explicitly accepts or declines the dispatched claim:
   - **Accept (`POST /claims/:claimId/accept-assignment`):** Transitions **`PENDING_ACCEPTANCE` → `ASSIGNED`**.
   - **Decline (`POST /claims/:claimId/decline-assignment`):** Transitions **`PENDING_ACCEPTANCE` → `NEW`** with an audit reason and clears assignment metadata.

In addition, `incidentCoordinates: { latitude, longitude, capturedAt } | null` is projected in claim listings (`GET /api/v1/claims`).

---

## 2. Business & State Machine Rules

### Status Invariants & Capacity Rules
1. **Status Transition Matrix:**
   - `NEW` ──(Officer `/assign`)──▶ `PENDING_ACCEPTANCE`
   - `PENDING_ACCEPTANCE` ──(Adjuster `/accept-assignment`)──▶ `ASSIGNED`
   - `PENDING_ACCEPTANCE` ──(Adjuster `/decline-assignment`)──▶ `NEW`
   - `ASSIGNED` ──(Adjuster `/inspection/start`)──▶ `IN_PROGRESS`
   - `CORRECTION_REQUIRED` ──(Adjuster `/inspection/start`)──▶ `IN_PROGRESS`
2. **Inspection Guard:**
   `POST /claims/:claimId/inspection/start` rejects claims in `PENDING_ACCEPTANCE` with `409 Conflict` (`INVALID_STATUS_TRANSITION`). An adjuster cannot start inspecting a claim they have not yet accepted.
3. **Adjuster Capacity Invariant:**
   Claims in `PENDING_ACCEPTANCE` do **NOT** count towards the adjuster's active workload capacity.
   `Claim.ACTIVE_ADJUSTER_STATUSES` remains strictly:
   ```javascript
   ['ASSIGNED', 'IN_PROGRESS', 'CORRECTION_REQUIRED']
   ```
4. **Advisory Capacity Rule & Override:**
   During initial dispatch (`POST /assign`), if target adjuster has `activeTasksCount > 3` (across `ASSIGNED`, `IN_PROGRESS`, `CORRECTION_REQUIRED`), assignment returns `409 ADJUSTER_UNAVAILABLE` unless `overrideCapacity: true` is supplied.
5. **Dashboard Statistics Integration (`GET /claims/stats`):**
   - All 10 statuses are reflected in `byStatus`, including `PENDING_ACCEPTANCE`.
   - For `ADMIN` / `CLAIMS_OFFICER`:
     - `pendingActionCount` includes `byStatus.PENDING_ACCEPTANCE`.
     - `actionableBreakdown.pendingAcceptance = byStatus.PENDING_ACCEPTANCE`.

---

## 3. Endpoints & API Contracts

### 3.1 POST `/api/v1/claims/:claimId/assign`
* **Role:** `CLAIMS_OFFICER`
* **Precondition:** Claim `status: 'NEW'`
* **Request Body:**
  ```json
  {
    "adjusterId": "651a1f8b7f1d2c001f8d4e92",
    "priority": "HIGH",
    "notes": "Urgent inspection required",
    "overrideCapacity": false
  }
  ```
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Assignment pending acceptance",
    "data": {
      "id": "60d0fe4f5311236168a109cc",
      "claimNumber": "CLM-INS-0001",
      "status": "PENDING_ACCEPTANCE",
      "assignedTo": "651a1f8b7f1d2c001f8d4e92",
      "priority": "HIGH"
    }
  }
  ```
* **Notification:** Fired with type `'PENDING_ACCEPTANCE'` to the assigned adjuster.

### 3.2 POST `/api/v1/claims/:claimId/accept-assignment`
* **Role:** `FIELD_ADJUSTER` (strictly the assigned adjuster)
* **Precondition:** Claim `status: 'PENDING_ACCEPTANCE'`
* **Request Body:** `{}` (empty object)
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Assignment accepted",
    "data": {
      "id": "60d0fe4f5311236168a109cc",
      "claimNumber": "CLM-INS-0001",
      "status": "ASSIGNED",
      "assignedTo": "651a1f8b7f1d2c001f8d4e92"
    }
  }
  ```
* **Timeline Event:**
  - `action`: `'Assignment Accepted'`
  - `previousStatus`: `'PENDING_ACCEPTANCE'`
  - `newStatus`: `'ASSIGNED'`
  - `notes`: `"[ASSIGNMENT ACCEPTED] by <employeeCode>"`
* **Notification:** Fired with type `'ASSIGNED'` to the assigning officer.

### 3.3 POST `/api/v1/claims/:claimId/decline-assignment`
* **Role:** `FIELD_ADJUSTER` (strictly the assigned adjuster)
* **Precondition:** Claim `status: 'PENDING_ACCEPTANCE'`
* **Request Body:**
  ```json
  {
    "reason": "Inspection site outside scheduled operational route"
  }
  ```
* **Validation:** `reason` is required string, trimmed, 1 to 300 characters.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Assignment declined successfully",
    "data": {
      "status": "NEW",
      "assignedTo": null,
      "assignedBy": null,
      "assignedAt": null,
      "assignmentNotes": null
    }
  }
  ```
* **Timeline Event:**
  - `action`: `'Assignment Declined'`
  - `previousStatus`: `'PENDING_ACCEPTANCE'`
  - `newStatus`: `'NEW'`
  - `notes`: `"[ASSIGNMENT DECLINED] by <employeeCode> — <reason>"`

### 3.4 GET `/api/v1/claims` (Listing Response Projection)
In addition to standard fields, every claim in the listing now returns:
```json
"incidentCoordinates": {
  "latitude": 31.9050,
  "longitude": 35.2040,
  "capturedAt": "2026-09-14T07:27:55.000Z"
}
```
*(or `null` if no coordinates were provided at creation time).*

---

## 4. Multi-Tenancy & Security
* Multi-tenancy isolation is strictly enforced via `req.user.organizationId`.
* Stealth 404: Calling accept/decline on a claim belonging to another tenant or assigned to another adjuster returns `404 Not Found`.
* Role enforcement: Non-adjusters calling accept/decline receive `403 Forbidden`. Non-officers calling assign receive `403 Forbidden`.

---

## 5. Automated Test Coverage
Dedicated test suite: [tests/claim.twoStepAssignment.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/claim.twoStepAssignment.test.js) (13 tests):
1. `assignClaim` sets `PENDING_ACCEPTANCE` and logs timeline.
2. `assignClaim` sends `'PENDING_ACCEPTANCE'` notification.
3. `acceptAssignment` succeeds for assigned adjuster (`PENDING_ACCEPTANCE` → `ASSIGNED`).
4. `acceptAssignment` appends timeline `[ASSIGNMENT ACCEPTED] by <employeeCode>`.
5. `acceptAssignment` fires `'ASSIGNED'` notification.
6. `acceptAssignment` returns 409 if claim is not in `PENDING_ACCEPTANCE`.
7. `acceptAssignment` returns 404 if calling adjuster is not the assigned adjuster.
8. `acceptAssignment` returns 403 for non-adjuster roles.
9. `declineAssignment` succeeds from `PENDING_ACCEPTANCE` (`PENDING_ACCEPTANCE` → `NEW`).
10. `declineAssignment` returns 409 if claim is in `ASSIGNED` or `NEW`.
11. `startInspection` fails with 409 when claim is in `PENDING_ACCEPTANCE`.
12. `PENDING_ACCEPTANCE` does not count toward adjuster active workload capacity.
13. `GET /claims` includes `incidentCoordinates` in listing items.

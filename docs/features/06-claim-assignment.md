# Feature Specification: Claim Assignment (Two-Step Workflow)

## 1. Feature Overview
The **Claim Assignment** feature enables a Claims Officer or Admin to dispatch a newly created claim to an active, available Field Adjuster for on-site physical inspection using a **two-step workflow**:
1. Dispatch: Claims Officer or Admin assigns the claim: **`NEW` → `PENDING_ACCEPTANCE`**.
2. Explicit Response: Target Field Adjuster accepts (**`PENDING_ACCEPTANCE` → `ASSIGNED`**) or declines (**`PENDING_ACCEPTANCE` → `NEW`**).

Key operational requirements:
1. Only claims currently in status **`NEW`** can be dispatched for assignment.
2. The target adjuster must belong to the same tenant, have role **`FIELD_ADJUSTER`**, and have status **`ACTIVE`**.
3. The target adjuster must be available with **3 or fewer active tasks** (`activeTasksCount <= 3`), or the officer/admin must explicitly provide `overrideCapacity: true`.
4. Claims in `PENDING_ACCEPTANCE` do **NOT** count towards adjuster capacity (`Claim.ACTIVE_ADJUSTER_STATUSES` strictly remains `['ASSIGNED', 'IN_PROGRESS', 'CORRECTION_REQUIRED']`).
5. Assignment dispatch, acceptance, and decline must execute **atomically** with optimistic concurrency checks to prevent race conditions.

---

## 2. Architecture & Design Patterns

### Sequence Flow
```
[Claims Officer / Admin]
   │
   ▼ POST /api/v1/claims/:claimId/assign
[role.middleware(['CLAIMS_OFFICER', 'ADMIN'])] ──▶ 403 Forbidden for Adjusters
   │
   ▼
[validateObjectId('claimId')] ──▶ 400 Bad Request on malformed ObjectId
   │
   ▼
[validate(assignClaimSchema)] ──▶ 400 Bad Request on invalid body
   │
   ▼
[claimController.assignClaim]
   │
   ▼
[claimService.assignClaim]
   ├── 1. Query adjuster in tenant: User.findOne({ _id: adjusterId, organizationId })
   │      └── Throws 404 ADJUSTER_NOT_FOUND if invalid, wrong role, or inactive
   ├── 2. Query adjuster active workload: countActiveClaimsByAssignee(adjusterId)
   │      └── Throws 409 ADJUSTER_UNAVAILABLE if activeTasksCount > 3 and !overrideCapacity
   ├── 3. Atomic Assignment Query:
   │      Claim.findOneAndUpdate(
   │        { _id: claimId, organizationId, status: 'NEW' },
   │        { $set: { status: 'PENDING_ACCEPTANCE', assignedTo, assignedBy, assignedAt, priority, assignmentNotes },
   │          $push: { timeline: timelineEvent } },
   │        { new: true }
   │      )
   │      └── Throws 409 INVALID_STATUS_TRANSITION if claim was already assigned
   └── 4. Send PENDING_ACCEPTANCE push notification to assigned adjuster
```

```
[Field Adjuster]
   │
   ├──▶ POST /api/v1/claims/:claimId/accept-assignment
   │    ├── Atomic Transition: PENDING_ACCEPTANCE ──▶ ASSIGNED
   │    ├── Appends timeline: [ASSIGNMENT ACCEPTED] by <employeeCode>
   │    └── Fires ASSIGNED push notification
   │
   └──▶ POST /api/v1/claims/:claimId/decline-assignment
        ├── Body: { "reason": "..." } (max 300 chars)
        ├── Atomic Transition: PENDING_ACCEPTANCE ──▶ NEW (resets assignedTo, assignedBy, assignedAt, assignmentNotes)
        └── Appends timeline: [ASSIGNMENT DECLINED] by <employeeCode> — <reason>
```

---

## 3. API Contract & Endpoints

### POST `/api/v1/claims/:claimId/assign`
* **Authorized Roles:** `CLAIMS_OFFICER`, `ADMIN`.
* **Authentication:** Required (JWT).
* **URL Parameters:** `claimId` (24-character hexadecimal ObjectId).
* **Request Body:**
  ```json
  {
    "adjusterId": "60d0fe4f5311236168a109cd",
    "priority": "HIGH",
    "notes": "Vehicle is blocking the main roundabout.",
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
      "assignedTo": "60d0fe4f5311236168a109cd",
      "priority": "HIGH"
    }
  }
  ```

### POST `/api/v1/claims/:claimId/accept-assignment`
* **Authorized Roles:** `FIELD_ADJUSTER` (strictly the assigned adjuster).
* **Authentication:** Required (JWT).
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Assignment accepted",
    "data": {
      "id": "60d0fe4f5311236168a109cc",
      "claimNumber": "CLM-INS-0001",
      "status": "ASSIGNED",
      "assignedTo": "60d0fe4f5311236168a109cd"
    }
  }
  ```

### POST `/api/v1/claims/:claimId/decline-assignment`
* **Authorized Roles:** `FIELD_ADJUSTER` (strictly the assigned adjuster).
* **Authentication:** Required (JWT).
* **Request Body:** `{ "reason": "Severe mechanical breakdown" }`
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Assignment declined successfully",
    "data": {
      "id": "60d0fe4f5311236168a109cc",
      "claimNumber": "CLM-INS-0001",
      "status": "NEW",
      "assignedTo": null,
      "assignedBy": null,
      "assignedAt": null,
      "assignmentNotes": null
    }
  }
  ```

---

## 4. Multi-Tenancy & Concurrency Invariants

1. **Atomic State Check:**
   Assignment dispatch updates `{ _id: claimId, organizationId, status: 'NEW' }` to `PENDING_ACCEPTANCE`. Acceptance atomically updates `{ _id: claimId, organizationId, status: 'PENDING_ACCEPTANCE', assignedTo }` to `ASSIGNED`. Decline atomically updates `{ _id: claimId, organizationId, status: 'PENDING_ACCEPTANCE', assignedTo }` back to `NEW`.
2. **Cross-Tenant & Unassigned Adjuster Stealth 404:**
   Attempting to accept or decline a claim belonging to another tenant or assigned to another adjuster returns `404 Not Found`.

---

## 5. Automated Testing Suites
* [tests/claim.assignment.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/claim.assignment.test.js) (15 tests)
* [tests/claim.twoStepAssignment.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/claim.twoStepAssignment.test.js) (13 tests)
* [tests/adjusterMapDispatch.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/adjusterMapDispatch.test.js) (19 tests)

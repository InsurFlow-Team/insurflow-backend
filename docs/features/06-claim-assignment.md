# Feature Specification: Claim Assignment

## 1. Feature Overview
The **Claim Assignment** feature enables a Claims Officer to dispatch a newly created claim to an active, available Field Adjuster for on-site physical inspection.

Key operational requirements:
1. Only claims currently in status **`NEW`** can be assigned.
2. The target adjuster must belong to the same tenant, have role **`FIELD_ADJUSTER`**, and have status **`ACTIVE`**.
3. The target adjuster must have **0 active tasks** currently assigned.
4. Assignment must execute **atomically** to prevent race conditions (e.g. two officers simultaneously assigning the same claim).
5. The claim transitions: **`NEW` → `ASSIGNED`**.

---

## 2. Architecture & Design Patterns

### Sequence Flow
```
[Claims Officer]
   │
   ▼ POST /api/v1/claims/:claimId/assign
[role.middleware(['CLAIMS_OFFICER'])] ──▶ 403 Forbidden for Adjusters/Admins
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
   │      └── Throws 409 ADJUSTER_UNAVAILABLE if activeTasksCount > 0
   └── 3. Atomic Assignment Query:
          Claim.findOneAndUpdate(
            { _id: claimId, organizationId, status: 'NEW' },
            { $set: { status: 'ASSIGNED', assignedTo, assignedBy, assignedAt, priority, assignmentNotes },
              $push: { timeline: timelineEvent } },
            { new: true }
          )
          └── Throws 409 INVALID_STATUS_TRANSITION if claim was already assigned
```

---

## 3. API Contract & Endpoints

### POST `/api/v1/claims/:claimId/assign`
* **Authorized Roles:** `CLAIMS_OFFICER` only.
* **Authentication:** Required (JWT).
* **URL Parameters:** `claimId` (24-character hexadecimal ObjectId).
* **Request Body:**
  ```json
  {
    "adjusterId": "60d0fe4f5311236168a109cd",
    "priority": "HIGH",
    "notes": "Vehicle is blocking the main roundabout."
  }
  ```
* **Validation Rules:**
  * `adjusterId`: Valid 24-character hex ObjectId string, required.
  * `priority`: Optional enum: `['LOW', 'MEDIUM', 'HIGH']` (default: `'MEDIUM'`).
  * `notes`: Optional string, trimmed.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Claim assigned successfully",
    "data": {
      "id": "60d0fe4f5311236168a109cc",
      "claimNumber": "CLM-INS-0001",
      "status": "ASSIGNED",
      "assignedTo": "60d0fe4f5311236168a109cd",
      "priority": "HIGH"
    }
  }
  ```
* **Error Responses:**
  * `400 Bad Request`: `VALIDATION_ERROR` (invalid ObjectId format or invalid priority).
  * `404 Not Found`: `CLAIM_NOT_FOUND` or `ADJUSTER_NOT_FOUND`.
  * `409 Conflict`:
    * `ADJUSTER_UNAVAILABLE`: Target adjuster already has 1 or more active assigned tasks.
    * `INVALID_STATUS_TRANSITION`: Claim is not in `NEW` status.

---

## 4. Multi-Tenancy & Concurrency Invariants

1. **Atomic State Check:**
   The update filter enforces `{ _id: claimId, organizationId, status: 'NEW' }`.
   If two officers simultaneously attempt to assign the same claim, MongoDB executes the write operations sequentially. The first succeeds and transitions the claim to `ASSIGNED`; the second matches 0 documents and returns `409 INVALID_STATUS_TRANSITION`.
2. **Cross-Tenant Stealth 404:**
   Attempting to assign a claim or assign to an adjuster belonging to another organization returns `404 Not Found`.

---

## 5. Automated Testing Suite

Tested in [tests/claim.assignment.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/claim.assignment.test.js) (14 tests):
* Successful assignment transitions status to `ASSIGNED`.
* Correct timeline event logged (`action: 'Claim Assigned'`).
* Blocking assignment to unavailable adjusters (409).
* Blocking assignment on claims not in `NEW` status (409).
* Role enforcement (403 for non-officers).
* Tenant boundary isolation (404 for cross-tenant adjuster or claim).

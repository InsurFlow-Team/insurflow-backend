# Feature Specification: Claim Decision Engine

## 1. Feature Overview
The **Claim Decision Engine** enables authorized personnel to adjudicate claims that have completed field investigation and back-office review.

Key operational characteristics:
1. **Source State:** Claims must currently be in status **`UNDER_REVIEW`**.
2. **Terminal Decisions:** Claims can transition to **`APPROVED`** or **`REJECTED`**.
3. **Authorized Roles (Ratified):** Both **`CLAIMS_OFFICER`** and **`ADMIN`** hold adjudication authority.
4. **Concurrency Safety:** Simultaneous conflicting decisions (e.g. concurrent approval vs rejection) are resolved atomically: exactly one succeeds; competing requests fail with `409 Conflict`.

---

## 2. Technical Architecture & Implementation

### Endpoint Definition & Middleware
Defined in [src/modules/claims/claim.routes.js:L91-L97](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.routes.js#L91-L97):
```javascript
router.post(
  '/:claimId/decision',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validateObjectId('claimId'),
  validate(decisionSchema),
  claimController.decideClaim
);
```

### Atomic Repository Query
Implemented in [src/modules/claims/claim.repository.js:L118-L127](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.repository.js#L118-L127):
```javascript
const makeDecision = async (claimId, organizationId, decision, decisionNotes, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'UNDER_REVIEW' },
    {
      $set: { status: decision, decisionNotes },
      $push: { timeline: timelineEvent },
    },
    { new: true }
  ).lean();
};
```

### Fallback Error Discrimination
If the atomic update matches zero documents, the service in [src/modules/claims/claim.service.js:L340-L347](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.service.js#L340-L347) discriminates between non-existence and state mismatch:
```javascript
if (!updatedClaim) {
  const existing = await claimRepository.findByIdAndOrganization(claimId, organizationId);
  if (!existing) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }
  throw new AppError('Claim is not in UNDER_REVIEW status', 409, 'INVALID_STATUS_TRANSITION');
}
```

---

## 3. API Contract & Endpoints

### POST `/api/v1/claims/:claimId/decision`
* **Authorized Roles:** `CLAIMS_OFFICER`, `ADMIN`.
* **Authentication:** Required (JWT).
* **URL Parameters:** `claimId` (24-character hexadecimal ObjectId).
* **Request Body:**
  ```json
  {
    "decision": "APPROVED",
    "notes": "Police report and damage photographs match coverage requirements."
  }
  ```
* **Validation Rules:**
  * `decision`: Required enum: `'APPROVED'` or `'REJECTED'`.
  * `notes`: Optional string, trimmed.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Decision recorded successfully",
    "data": {
      "id": "60d0fe4f5311236168a109cc",
      "claimNumber": "CLM-INS-0001",
      "status": "APPROVED",
      "decisionNotes": "Police report and damage photographs match coverage requirements."
    }
  }
  ```
* **Error Responses:**
  * `400 Bad Request`: `VALIDATION_ERROR` (missing decision or invalid value).
  * `401 Unauthorized`: Unauthenticated.
  * `403 Forbidden`: Authenticated user is a `FIELD_ADJUSTER`.
  * `404 Not Found`: `CLAIM_NOT_FOUND` (claim does not exist or belongs to another tenant).
  * `409 Conflict`: `INVALID_STATUS_TRANSITION` (claim is not in `UNDER_REVIEW`).

---

## 4. Audit Trail Logging

The decision appends a definitive audit entry to `claim.timeline`:
```javascript
{
  action: decision === 'APPROVED' ? 'Claim Approved' : 'Claim Rejected',
  performedBy: authUser.userId,
  role: authUser.role, // 'CLAIMS_OFFICER' or 'ADMIN'
  timestamp: new Date()
}
```

---

## 5. Automated Testing Suite

Tested in [tests/claim.decision.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/claim.decision.test.js) (15 comprehensive tests):
* Happy path: `APPROVED` by `CLAIMS_OFFICER`.
* Happy path: `REJECTED` by `CLAIMS_OFFICER`.
* Happy path: Decision by `ADMIN`.
* Optionality of notes field.
* RBAC: `FIELD_ADJUSTER` returns 403.
* Tenant isolation: Cross-tenant claim returns 404.
* Status invariants: Rejecting decisions on `NEW`, `ASSIGNED`, `SUBMITTED`, or already `APPROVED` claims with 409.
* Race condition test: Two simultaneous requests (`Promise.all`) on same claim — exactly one succeeds (200), competitor receives 409.

# Feature Specification: Claim Closure (Admin Final Sign-Off)

## 1. Feature Overview
The **Claim Closure** endpoint represents the terminal administrative action in the claim lifecycle. After a claim has been approved, financial payout scheduled, and all legal documentation finalized, the Organization Administrator closes and archives the case.

Key business rules:
1. **Source State:** Claims can only be closed if they are currently in status **`APPROVED`**.
2. **Authorized Role:** Restricted exclusively to **`ADMIN`**. Claims Officers and Field Adjusters are forbidden from closing claims.
3. **State Transition:** **`APPROVED` → `CLOSED`**.
4. **Metadata Captured:** Atomically records `closedBy`, `closedAt`, optional `closingNotes`, and appends an immutable timeline event (`'Claim Closed'`).
5. **Concurrency Safety:** Simultaneous close calls against the same claim resolve atomically: exactly one succeeds; the other returns `409 Conflict`.

---

## 2. Technical Architecture & Implementation

### Endpoint Definition & Middleware
Defined in [src/modules/claims/claim.routes.js:L99-L106](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.routes.js#L99-L106):
```javascript
router.post(
  '/:claimId/close',
  authorizeRole(['ADMIN']),
  validateObjectId('claimId'),
  validate(closeClaimSchema),
  claimController.closeClaim
);
```

### Atomic Repository Mutation
Implemented in [src/modules/claims/claim.repository.js:L129-L143](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.repository.js#L129-L143):
```javascript
const closeClaim = async (claimId, organizationId, closedBy, closingNotes, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'APPROVED' },
    {
      $set: {
        status: 'CLOSED',
        closedBy,
        closedAt: timelineEvent.timestamp || new Date(),
        closingNotes,
      },
      $push: { timeline: timelineEvent },
    },
    { new: true }
  ).lean();
};
```

---

## 3. API Contract & Endpoints

### POST `/api/v1/claims/:claimId/close`
* **Authorized Roles:** `ADMIN` only.
* **Authentication:** Required (JWT).
* **URL Parameters:** `claimId` (24-character hexadecimal ObjectId).
* **Request Body:**
  ```json
  {
    "closingNotes": "Payout of AED 12,500 issued to insured. Case archived."
  }
  ```
* **Validation Rules:**
  * `closingNotes`: Optional string, trimmed.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Claim closed",
    "data": {
      "id": "60d0fe4f5311236168a109cc",
      "claimNumber": "CLM-INS-0001",
      "status": "CLOSED",
      "closedBy": "60d0fe4f5311236168a109ca",
      "closedAt": "2026-09-08T11:00:00.000Z",
      "closingNotes": "Payout of AED 12,500 issued to insured. Case archived."
    }
  }
  ```
* **Error Responses:**
  * `400 Bad Request`: `VALIDATION_ERROR` (malformed ObjectId or invalid notes datatype).
  * `401 Unauthorized`: Unauthenticated.
  * `403 Forbidden`: Authenticated user is `CLAIMS_OFFICER` or `FIELD_ADJUSTER`.
  * `404 Not Found`: `CLAIM_NOT_FOUND` (claim does not exist or belongs to another tenant).
  * `409 Conflict`: `INVALID_STATUS_TRANSITION` (claim is in `NEW`, `ASSIGNED`, `SUBMITTED`, `UNDER_REVIEW`, `REJECTED`, or already `CLOSED`).

---

## 4. Multi-Tenancy & Audit Invariants

1. **Strict Tenant Scoping:** The atomic update query includes `organizationId`. An administrator in Tenant A cannot close or observe claims in Tenant B.
2. **Audit Timeline Integration:** Appends:
   ```javascript
   {
     action: 'Claim Closed',
     performedBy: authUser.userId,
     role: 'ADMIN',
     timestamp: new Date()
   }
   ```
3. **Database Fields Populated on Claim:**
   * `status: 'CLOSED'`
   * `closedBy: ObjectId` (references User)
   * `closedAt: Date`
   * `closingNotes: String`

---

## 5. Automated Testing Suite

Tested in [tests/claim.closure.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/claim.closure.test.js) (17 comprehensive tests):
* Successful closure with `closingNotes`.
* Successful closure without notes.
* RBAC rejection: `CLAIMS_OFFICER` returns 403.
* RBAC rejection: `FIELD_ADJUSTER` returns 403.
* Tenant isolation: Cross-tenant closure returns 404.
* Comprehensive status rejection (409 on `NEW`, `ASSIGNED`, `SUBMITTED`, `UNDER_REVIEW`, `REJECTED`, `CLOSED`).
* Concurrency race condition: Concurrent requests (`Promise.all`) on same claim — exactly one succeeds (200), competitor receives 409.

# Feature Specification: Claim Decision Engine

## 1. Feature Overview
The **Claim Decision Engine** enables authorized personnel to adjudicate claims that have completed field investigation and back-office review.

Key operational characteristics:
1. **Source State:** Claims must currently be in status **`UNDER_REVIEW`**.
2. **Terminal Decisions:** Claims can transition to **`APPROVED`** or **`REJECTED`**.
3. **Authorized Roles (Ratified):** Both **`CLAIMS_OFFICER`** and **`ADMIN`** hold adjudication authority.
4. **Financial Adjudication (`lossAssessment`):** When approving a claim (`APPROVED`), financial loss assessment parameters (`estimatedPartsCost`, `laborCost`, `deductibleApplied`, `deductibleOverrideReason`) are mandatory. For `REJECTED`, `lossAssessment` is strictly forbidden. Both return 400 `VALIDATION_ERROR`.
5. **Concurrency Safety:** Simultaneous conflicting decisions (e.g. concurrent approval vs rejection) are resolved atomically: exactly one succeeds; competing requests fail with `409 Conflict`.

---

## 2. Technical Architecture & Implementation

### Endpoint Definition & Middleware
Defined in [src/modules/claims/claim.routes.js](../../src/modules/claims/claim.routes.js):
```javascript
router.post(
  '/:claimId/decision',
  authorizeRole(['CLAIMS_OFFICER', 'ADMIN']),
  validateObjectId('claimId'),
  validate(decisionSchema),
  claimController.decideClaim
);
```

### Pre-Read and Error Discrimination Helper
In the `APPROVED` branch, a scoped pre-read queries the claim within the tenant organization before performing financial calculations (`coverageSnapshot`, `policyId`). Error handling is unified in `handleClaimNotFoundOrStateError`:
```javascript
const handleClaimNotFoundOrStateError = async (claimId, organizationId) => {
  const existing = await claimRepository.findByIdAndOrganization(claimId, organizationId);
  if (!existing) {
    throw new AppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
  }
  throw new AppError('Claim is not in UNDER_REVIEW status', 409, 'INVALID_STATUS_TRANSITION');
};
```
- In the `REJECTED` branch: Zero pre-read is performed; the atomic update executes immediately.
- In the `APPROVED` branch: The pre-read uses `handleClaimNotFoundOrStateError` if the claim does not exist or status is not `UNDER_REVIEW`. The atomic filter on `UNDER_REVIEW` remains the final concurrent defense.

### Atomic Repository Query
Implemented in [src/modules/claims/claim.repository.js](../../src/modules/claims/claim.repository.js):
```javascript
const makeDecision = async (claimId, organizationId, decision, decisionNotes, timelineEvent, lossAssessmentDoc = null) => {
  const updateDoc = {
    $set: { status: decision, decisionNotes },
    $push: { timeline: timelineEvent },
  };

  if (lossAssessmentDoc) {
    updateDoc.$set.lossAssessment = lossAssessmentDoc;
  }

  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'UNDER_REVIEW' },
    updateDoc,
    { new: true }
  ).lean();
};
```

---

## 3. API Contract & Endpoints

### POST `/api/v1/claims/:claimId/decision`
* **Authorized Roles:** `CLAIMS_OFFICER`, `ADMIN`.
* **Authentication:** Required (JWT).
* **URL Parameters:** `claimId` (24-character hexadecimal ObjectId).
* **Request Body (Approval with Loss Assessment):**
  ```json
  {
    "decision": "APPROVED",
    "notes": "Police report and damage photographs match coverage requirements.",
    "lossAssessment": {
      "estimatedPartsCost": 4500.50,
      "laborCost": 1200.00,
      "deductibleApplied": 500.00,
      "deductibleOverrideReason": "Waived 50% per promotional campaign"
    }
  }
  ```
* **Validation Rules:**
  * `decision`: Required enum: `'APPROVED'` or `'REJECTED'`.
  * `notes`: Optional string, trimmed.
  * `lossAssessment`:
    * Mandatory when `decision === 'APPROVED'` (triggers 400 `VALIDATION_ERROR` if omitted).
    * Forbidden when `decision === 'REJECTED'` (triggers 400 `VALIDATION_ERROR` if supplied).
    * Unknown keys strictly forbidden (`.unknown(false)` — triggers 400, e.g. client-sent `totalDamage` or `netApprovedPayout`).
    * `estimatedPartsCost`: Number, `.strict()`, min 0, max 1,000,000, max 2 decimals, required. Zero allowed.
    * `laborCost`: Number, `.strict()`, min 0, max 1,000,000, max 2 decimals, required. Zero allowed.
    * `deductibleApplied`: Number, `.strict()`, min 0, max 1,000,000, max 2 decimals, optional. Zero allowed.
    * `deductibleOverrideReason`: String, trimmed, max 1000 chars payload guard.
* **Business Evaluation Rules:**
  * `totalDamage = estimatedPartsCost + laborCost`.
  * If `totalDamage <= 0`, throws 400 `VALIDATION_ERROR` with `"totalDamage must be greater than zero"`.
  * If `totalDamage <= deductibleApplied`, throws 422 `DAMAGE_BELOW_DEDUCTIBLE` with `"Total damage must be greater than the applied deductible"`.
  * Policy deductible is retrieved from `claim.coverageSnapshot.deductibleAmount` (falling back to live policy lookup for legacy claims created before snapshot existed).
  * `overridden = appliedCents !== policyDeductibleCents`:
    * If overridden: trimmed reason must be between 10 and 300 characters, else 422 `OVERRIDE_REASON_REQUIRED` (`"Deductible override reason is required and must be between 10 and 300 characters when deductible is overridden"`).
    * If not overridden: supplying a non-empty reason throws 422 `OVERRIDE_REASON_NOT_ALLOWED` (`"Deductible override reason is not allowed when deductible matches policy deductible"`).
    * `deductibleOverridden` boolean is persisted in `lossAssessment`.
    * Trimmed reason is stored only when overridden, otherwise `null`.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Decision recorded successfully",
    "data": {
      "id": "60d0fe4f5311236168a109cc",
      "claimNumber": "CLM-INS-0001",
      "status": "APPROVED",
      "decisionNotes": "Police report and damage photographs match coverage requirements.",
      "lossAssessment": {
        "estimatedPartsCost": 4500.50,
        "laborCost": 1200.00,
        "totalDamage": 5700.50,
        "policyDeductible": 1000.00,
        "deductibleApplied": 500.00,
        "deductibleOverridden": true,
        "deductibleOverrideReason": "Waived 50% per promotional campaign",
        "netApprovedPayout": 5200.50,
        "assessedAt": "2026-09-28T14:30:00.000Z",
        "assessedBy": {
          "id": "60d0fe4f5311236168a109bb",
          "name": "Sarah Officer",
          "employeeCode": "EMP-002"
        }
      }
    }
  }
  ```
  * `400 Bad Request`: `VALIDATION_ERROR` (missing decision, missing lossAssessment on APPROVED, lossAssessment present on REJECTED, unknown keys, invalid decimal places, or totalDamage <= 0).
  * `401 Unauthorized`: Unauthenticated.
  * `403 Forbidden`: Authenticated user is a `FIELD_ADJUSTER`.
  * `404 Not Found`: `CLAIM_NOT_FOUND` (claim does not exist or belongs to another tenant).
  * `409 Conflict`: `INVALID_STATUS_TRANSITION` (claim is not in `UNDER_REVIEW`).
  * `422 Unprocessable Entity`: `DAMAGE_BELOW_DEDUCTIBLE` (when `totalDamage <= deductibleApplied`).
  * `422 Unprocessable Entity`: `OVERRIDE_REASON_REQUIRED` (when `deductibleApplied !== policyDeductible` without valid 10-300 char reason).
  * `422 Unprocessable Entity`: `OVERRIDE_REASON_NOT_ALLOWED` (when `deductibleApplied === policyDeductible` and a non-empty reason is supplied).

---

## 4. Audit Trail Logging

The decision appends a definitive audit entry to `claim.timeline`:
```javascript
{
  action: decision === 'APPROVED' ? 'Claim Approved' : 'Claim Rejected',
  performedBy: authUser.userId,
  role: authUser.role, // 'CLAIMS_OFFICER' or 'ADMIN'
  timestamp: new Date(),
  notes: overridden ? `${notes ? notes + ' ' : ''}[DEDUCTIBLE OVERRIDE] policy deductible ${policyDeductible}, applied ${applied}. Reason: ${reason}` : notes
}
```

---

## 5. Automated Testing Suite

Tested in:
* [tests/claim.decisionStage4.test.js](../../tests/claim.decisionStage4.test.js)
* [tests/claim.decision.test.js](../../tests/claim.decision.test.js)
* [tests/claim.lossAssessment.test.js](../../tests/claim.lossAssessment.test.js)
* Happy path: `APPROVED` by `CLAIMS_OFFICER`.
* Happy path: `REJECTED` by `CLAIMS_OFFICER`.
* Happy path: Decision by `ADMIN`.
* Optionality of notes field.
* RBAC: `FIELD_ADJUSTER` returns 403.
* Tenant isolation: Cross-tenant claim returns 404.
* Status invariants: Rejecting decisions on `NEW`, `ASSIGNED`, `SUBMITTED`, or already `APPROVED` claims with 409.
* Race condition test: Two simultaneous requests (`Promise.all`) on same claim — exactly one succeeds (200), competitor receives 409.

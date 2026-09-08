# Feature Specification: Inspection Submission & Review Initiation

## 1. Feature Overview
Once a Field Adjuster has gathered all required field evidence, they submit the final report. This locks further on-site editing and transitions the claim to back-office processing.

This feature encompasses two sequential lifecycle transitions:
1. **Inspection Submission:** `ASSIGNED` → `SUBMITTED` (executed by assigned `FIELD_ADJUSTER`).
2. **Review Initiation:** `SUBMITTED` → `UNDER_REVIEW` (executed by any `CLAIMS_OFFICER` within the organization).

---

## 2. Business Invariants & Three Mandatory Pillars

### Rule BR-SUBMIT-2 (Three Pillars Validation)
Before transitioning from `ASSIGNED` to `SUBMITTED`, the backend verifies that all three core pillars of the inspection report have been completed:
1. **Pillar 1 — Vehicle Verified:** `claim.vehicle.vehicleId` must not be null.
2. **Pillar 2 — Accident Recorded:** `claim.accident.accidentType` must not be null.
3. **Pillar 3 — Location Captured:** `claim.location.latitude` and `claim.location.longitude` must not be null. (Note: `0` is a mathematically valid coordinate and is not treated as null).

If any pillar is missing, the submission is rejected with **`422 Unprocessable Entity`** (`INSPECTION_INCOMPLETE`).

---

## 3. Technical Architecture & Endpoints

### 3.1 POST `/api/v1/claims/:claimId/inspection/submit`
* **Authorized Roles:** `FIELD_ADJUSTER` only (assigned adjuster only).
* **Validation & Execution Sequence:**
  1. Verifies caller is assigned to the claim and belongs to the tenant.
  2. Asserts status is `ASSIGNED` (409 if not).
  3. Verifies the Three Mandatory Pillars (422 if incomplete).
  4. Executes atomic update:
     ```javascript
     Claim.findOneAndUpdate(
       { _id: claimId, organizationId, status: 'ASSIGNED', assignedTo },
       { $set: { status: 'SUBMITTED' }, $push: { timeline: timelineEvent } },
       { new: true }
     );
     ```
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Inspection submitted successfully",
    "data": {
      "status": "SUBMITTED"
    }
  }
  ```

---

### 3.2 POST `/api/v1/claims/:claimId/review/start`
* **Authorized Roles:** `CLAIMS_OFFICER` only.
* **Validation & Execution Sequence:**
  1. Enforces tenant scope (`organizationId`).
  2. Asserts status is currently `SUBMITTED`.
  3. Executes atomic status transition:
     ```javascript
     Claim.findOneAndUpdate(
       { _id: claimId, organizationId, status: 'SUBMITTED' },
       { $set: { status: 'UNDER_REVIEW' }, $push: { timeline: timelineEvent } },
       { new: true }
     );
     ```
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Review started successfully",
    "data": {
      "status": "UNDER_REVIEW"
    }
  }
  ```

---

## 4. Multi-Tenancy & Concurrency Invariants

1. **Adjuster Isolation on Submit:** Only the assigned adjuster can submit. Attempting to submit a claim assigned to another adjuster or from another tenant returns `404 Not Found`.
2. **Atomic Review Lock:** If two claims officers attempt to open and start a review simultaneously, exactly one succeeds (200 OK) while the other receives `409 INVALID_STATUS_TRANSITION`.
3. **Audit Trail Logging:**
   * Submission appends: `{ action: 'Inspection Submitted', performedBy: adjusterId, role: 'FIELD_ADJUSTER' }`.
   * Review start appends: `{ action: 'Review Started', performedBy: officerId, role: 'CLAIMS_OFFICER' }`.

---

## 5. Automated Testing Suite

Tested in:
* [tests/claim.inspection.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/claim.inspection.test.js) (Submission tests & 3-pillar validation)
* [tests/claim.lifecycle.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/claim.lifecycle.test.js) (Review start transition tests)

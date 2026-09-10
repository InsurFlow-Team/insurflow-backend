# Feature Specification: Status Machine Expansion (IN_PROGRESS & Correction Loop)

## 1. Overview
Sprint 2 expands the claim lifecycle by introducing two intermediate operational states:
1. **`IN_PROGRESS`**: Bridges `ASSIGNED` and `SUBMITTED`. Once assigned, a field adjuster must explicitly start or resume inspection before any mobile drafts (`vehicle`, `accident`, `location`) or final submission can be performed.
2. **`CORRECTION_REQUIRED`**: Introduces an iterative back-office correction loop. A Claims Officer reviewing a submitted claim under review can send it back for adjuster correction with mandatory notes. The adjuster resumes inspection (`IN_PROGRESS`), updates the required data, and resubmits (`SUBMITTED`) for re-review (`UNDER_REVIEW`).

The complete 9-status lifecycle is:
`NEW → ASSIGNED → IN_PROGRESS → SUBMITTED → UNDER_REVIEW → APPROVED / REJECTED → CLOSED`, plus the correction loop `UNDER_REVIEW → CORRECTION_REQUIRED → IN_PROGRESS → SUBMITTED → UNDER_REVIEW`.

---

## 2. Technical Architecture & Component Structure

### Architecture & Layer Roles
- **Model ([src/modules/claims/claim.model.js:L49-L55](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.model.js#L49-L55)):**
  The `status` enum contains: `['NEW', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'APPROVED', 'REJECTED', 'CLOSED']`.
  `Claim.ACTIVE_ADJUSTER_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'CORRECTION_REQUIRED']` provides the single source of truth for active adjuster capacity.
- **Timeline Audit Sub-Schema ([src/modules/claims/claim.model.js:L6-L35](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.model.js#L6-L35)):**
  Added `previousStatus`, `newStatus`, and `notes` to every timeline sub-document.
- **Repository ([src/modules/claims/claim.repository.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.repository.js)):**
  Atomic `findOneAndUpdate` mutations enforcing tenant `organizationId`, status preconditions, and audit entries.
- **Service ([src/modules/claims/claim.service.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.service.js)):**
  Handles ownership discrimination (404 vs 403), status check discrimination (404 vs 409 `INVALID_STATUS_TRANSITION`), dynamic timeline labeling, and audit field propagation.
- **Validation ([src/modules/claims/claim.validation.js:L117-L124](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.validation.js#L117-L124)):**
  Enforces required non-empty string `notes` on correction requests.
- **Routes ([src/modules/claims/claim.routes.js:L56-L95](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.routes.js#L56-L95)):**
  Mounts `POST /:claimId/inspection/start` and `POST /:claimId/review/request-correction` with RBAC and parameter validation.

---

## 3. API Contract & Endpoints

### 3.1 POST `/api/v1/claims/:claimId/inspection/start`
Starts or resumes a field inspection.

* **Authorized Roles:** `FIELD_ADJUSTER` (assigned adjuster only; cross-adjuster or cross-tenant returns `404 CLAIM_NOT_FOUND`).
* **Preconditions:** Claim must be in status `ASSIGNED` or `CORRECTION_REQUIRED`. Any other status returns `409 INVALID_STATUS_TRANSITION`.
* **Request Body:** None.
* **Timeline Event Generated:**
  - If previous status was `ASSIGNED`: `action: 'Inspection Started'`.
  - If previous status was `CORRECTION_REQUIRED`: `action: 'Inspection Resumed'`.
  - `previousStatus`: `'ASSIGNED'` or `'CORRECTION_REQUIRED'`.
  - `newStatus`: `'IN_PROGRESS'`.
  - `notes`: `null`.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Inspection started successfully",
    "data": {
      "status": "IN_PROGRESS"
    }
  }
  ```

---

### 3.2 POST `/api/v1/claims/:claimId/review/request-correction`
Requests changes on an inspection currently under review.

* **Authorized Roles:** `CLAIMS_OFFICER` (any claims officer in the same organization).
* **Preconditions:** Claim must be in status `UNDER_REVIEW`. Any other status returns `409 INVALID_STATUS_TRANSITION`.
* **Request Body:**
  ```json
  {
    "notes": "Damage photo for rear bumper is unclear; please re-photograph and update description."
  }
  ```
* **Validation Rules:** `notes` is required, trimmed string. Missing or empty string returns `400 VALIDATION_ERROR`.
* **Timeline Event Generated:**
  - `action`: `'Correction Requested'`.
  - `previousStatus`: `'UNDER_REVIEW'`.
  - `newStatus`: `'CORRECTION_REQUIRED'`.
  - `notes`: String passed in request body.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Correction requested successfully",
    "data": {
      "status": "CORRECTION_REQUIRED"
    }
  }
  ```

---

## 4. Audit Trail & Timeline Schema

Every status mutation appends a timeline entry tracking:
- `action`: Human-readable event description.
- `previousStatus`: Status prior to transition (e.g. `'UNDER_REVIEW'`).
- `newStatus`: Resulting status (e.g. `'CORRECTION_REQUIRED'`).
- `notes`: Contextual note or reason (or `null` if none).
- `performedBy`: User ID of the actor.
- `role`: Role of the actor at execution time.
- `timestamp`: UTC execution timestamp.

Non-status events (`Vehicle Confirmed`, `Accident Details Recorded`, `Location Captured`, `Claim Created`) retain `previousStatus: null`, `newStatus: null`, `notes: null`.

---

## 5. Testing & Verification
Implemented and validated in [tests/claim.statusMachine.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/claim.statusMachine.test.js):
- End-to-end traversal across all 9 statuses with correction loop.
- Prohibited status transitions returning `409 INVALID_STATUS_TRANSITION`.
- Dynamic timeline labeling (`Inspection Started` vs `Inspection Resumed`).
- Input validation rejection (`400 VALIDATION_ERROR`) on missing correction notes.
- RBAC (`403 Forbidden`) and stealth cross-tenant isolation (`404 Not Found`).
- Workload capacity integration in [tests/user.adjuster.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/user.adjuster.test.js).

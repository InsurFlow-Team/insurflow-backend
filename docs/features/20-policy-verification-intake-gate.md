# Feature Specification: Policy Verification / Intake Gate & Coverage Snapshot

## 1. Feature Overview
The **Policy Verification / Intake Gate** introduces a mandatory eligibility check before any claim can be created in InsurFlow. When a policyholder calls to report an accident, the **`CLAIMS_OFFICER`** or **`ADMIN`** first verifies that:

1. The caller holds a valid insurance policy with the company.
2. The policy is currently **ACTIVE** (not expired or cancelled).
3. The policy was active on the date the incident occurred.
4. The vehicle involved matches the policy record.
5. **Coverage Snapshot & Eligibility Hint:** Returns the policy's coverage structure (`policyType`, `coveredPerils`, `deductibleAmount`) and provides an immediate intake hint (`eligibilityHint`) if an `incidentType` is supplied.

Only after successful verification does the system allow the officer to proceed with claim creation (`POST /claims`).

> **Domain Modeling Clarification (Own-Damage Scope):**
> - **`coveredPerils`** exclusively represents **physical own-damage perils to the insured vehicle** (`COLLISION`, `THEFT`, `FIRE`, `NATURAL_DISASTER`).
> - **`COMPREHENSIVE`**: Covers own-damage to the insured vehicle for perils specified in `coveredPerils` (must be non-empty), subject to `deductibleAmount`.
> - **`THIRD_PARTY`**: Covers third-party liability only. Excludes own-damage to the insured vehicle (`coveredPerils` is strictly `[]`, deductible is `0`). Badge/hint text: **"الضرر الذاتي غير مشمول"** (*Own-damage is not covered*). Third-party liability is separate from compulsory insurance; compulsory insurance is a distinct product not modeled here.
> - **`eligibilityHint`**:
>   - `ELIGIBLE_FOR_REVIEW`: When `incidentType` is included in `coveredPerils`.
>   - `NOT_COVERED_BY_POLICY_TYPE`: When `incidentType` is not in `coveredPerils` (e.g. own-damage claim under a `THIRD_PARTY` policy).
>   - `COVERAGE_UNKNOWN`: Legacy policy missing `policyType` / `deductibleAmount`.
>   - `null`: No `incidentType` was provided in the request or policy is not active.

---

## 2. Technical Architecture & Data Flow

```
[Claims Officer / Admin — Web Dashboard]
   │
   ▼ POST /api/v1/policies/verify
[authenticate] → [adjusterLocationMiddleware] → [authorizeRole(['CLAIMS_OFFICER', 'ADMIN'])]
   │
   ▼
[validate(verifyPolicySchema)] (validates policyNumber/plateNumber, incidentDate, optional incidentType)
   │
   ▼
[policyController.verifyPolicy]
   │
   ▼
[policyService.verifyPolicy]
   ├── 1. Query Policy: policyRepository.findByPolicyNumberAndOrganization(policyNumber, orgId)
   │      └── Not found → 404 POLICY_NOT_FOUND
   ├── 2. Status Check:
   │      ├── CANCELLED → 422 POLICY_CANCELLED
   │      └── EXPIRED → 422 POLICY_EXPIRED
   ├── 3. Date Check (if incidentDate provided):
   │      ├── incidentDate in future → 400 INVALID_INCIDENT_DATE
   │      └── Outside [startDate, expiryDate] → 422 POLICY_NOT_ACTIVE_ON_DATE
   ├── 4. Vehicle Lookup: vehicleRepository.findByPolicyAndOrganization(policyId, orgId)
   │      └── Populates customerId for customer data
   ├── 5. Plate Cross-Match (if plateNumber provided):
   │      └── Mismatch → 422 VEHICLE_MISMATCH
   ├── 6. Coverage Snapshot & Eligibility Hint Evaluation:
   │      ├── Reference Date = incidentDate ? new Date(incidentDate) : now
   │      └── If policy ACTIVE & valid on reference date and incidentType provided:
   │            ├── policyType missing → COVERAGE_UNKNOWN
   │            ├── incidentType in coveredPerils → ELIGIBLE_FOR_REVIEW
   │            └── incidentType not in coveredPerils → NOT_COVERED_BY_POLICY_TYPE
   └── 7. Return { isEligible: true, eligibilityHint, policy, vehicle, customer }
```

### Components Involved
* **Route:** [src/modules/policies/policy.routes.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/policies/policy.routes.js)
* **Controller:** [src/modules/policies/policy.controller.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/policies/policy.controller.js)
* **Service:** [src/modules/policies/policy.service.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/policies/policy.service.js)
* **Model:** [src/modules/policies/policy.model.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/policies/policy.model.js)
* **Validation:** [src/modules/policies/policy.validation.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/policies/policy.validation.js)
* **Repositories:**
  * `policyRepository`: [src/modules/policies/policy.repository.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/policies/policy.repository.js)
  * `vehicleRepository`: [src/modules/vehicles/vehicle.repository.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/vehicles/vehicle.repository.js)
* **Migration Script:** [src/scripts/migrateLegacyPolicies.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/scripts/migrateLegacyPolicies.js)

---

## 3. API Contract & Endpoints

### POST `/api/v1/policies/verify`
* **Authorized Roles:** `CLAIMS_OFFICER`, `ADMIN`.
* **Authentication:** Required (JWT).
* **Request Body:**
  ```json
  {
    "policyNumber": "POL-1000",
    "plateNumber": "ABC-1234",
    "incidentDate": "2026-09-21",
    "incidentType": "COLLISION"
  }
  ```
* **Fields:**
  * `policyNumber` (optional if `plateNumber` provided): The insurance policy number to verify.
  * `plateNumber` (optional if `policyNumber` provided): Vehicle plate number for direct lookup or cross-matching.
  * `incidentDate` (optional): Date of the incident in `YYYY-MM-DD` format (cannot be in the future).
  * `incidentType` (optional): Peril type to check against own-damage coverage. Allowed values: `COLLISION`, `THEFT`, `FIRE`, `NATURAL_DISASTER`.

* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Policy verified successfully",
    "data": {
      "isEligible": true,
      "eligibilityHint": "ELIGIBLE_FOR_REVIEW",
      "policy": {
        "id": "60d0fe4f5311236168a109d1",
        "policyNumber": "POL-1000",
        "status": "ACTIVE",
        "startDate": "2025-01-01",
        "expiryDate": "2026-12-31",
        "policyType": "COMPREHENSIVE",
        "coveredPerils": ["COLLISION", "THEFT", "FIRE", "NATURAL_DISASTER"],
        "deductibleAmount": 500
      },
      "coverage": {
        "policyType": "COMPREHENSIVE",
        "effectiveFrom": "2025-01-01",
        "effectiveTo": "2026-12-31",
        "deductible": 500,
        "incidents": [
          { "code": "COLLISION", "covered": true },
          { "code": "THEFT", "covered": true },
          { "code": "FIRE", "covered": true },
          { "code": "NATURAL_DISASTER", "covered": true }
        ]
      },
      "vehicle": {
        "id": "60d0fe4f5311236168a109d0",
        "plateNumber": "ABC-1234",
        "make": "Toyota",
        "model": "Camry",
        "year": 2022,
        "color": "White"
      },
      "customer": {
        "id": "60d0fe4f5311236168a109d2",
        "fullName": "Ahmad Ali",
        "phone": "+962791234567"
      }
    }
  }
  ```

* **Error Responses:**
  * `400 Bad Request`:
    * Neither `policyNumber` nor `plateNumber` provided (`VALIDATION_ERROR`).
    * Invalid `incidentDate` format (`VALIDATION_ERROR`).
    * `INVALID_INCIDENT_DATE` — `incidentDate` is in the future.
    * Invalid `incidentType` value not in enum (`VALIDATION_ERROR`).
  * `403 Forbidden`: Authenticated user is not `CLAIMS_OFFICER` or `ADMIN`.
  * `404 Not Found`:
    * `POLICY_NOT_FOUND` — Policy does not exist in the caller's organization (includes cross-tenant stealth rejection), or vehicle has no linked policy.
    * `VEHICLE_NOT_FOUND` — Vehicle with the given `plateNumber` does not exist in the organization.
  * `422 Unprocessable Entity`:
    * `POLICY_EXPIRED` — Policy status is `EXPIRED` or calendar `expiryDate` has passed.
    * `POLICY_CANCELLED` — Policy status is `CANCELLED`.
    * `POLICY_NOT_ACTIVE_ON_DATE` — The incident date falls outside the policy's coverage period `[startDate, expiryDate]`.
    * `VEHICLE_MISMATCH` — The provided plate number does not match the vehicle registered with the policy, or policy has no vehicle record linked to match.
    * `AMBIGUOUS_VEHICLE_SELECTION` — Policy has multiple linked vehicles and `plateNumber` was not specified.

---

## 4. Business Invariants & Multi-Tenancy

1. **Rule BR-POL-VERIFY-1 (Intake Gate):** No claim should be created without first verifying that the policyholder and vehicle belong to the company and the policy is active.
2. **Rule BR-POL-VERIFY-2 (Eligibility vs Coverage Snapshot):** Successful verification confirms the caller is insured and active (`isEligible: true`). When `incidentType` is supplied, `eligibilityHint` provides an advisory intake hint (`ELIGIBLE_FOR_REVIEW` or `NOT_COVERED_BY_POLICY_TYPE`).
3. **Rule BR-POL-VERIFY-3 (Role Restriction):** Only `CLAIMS_OFFICER` and `ADMIN` can perform policy verification.
4. **Rule BR-POL-VERIFY-4 (Strict Tenancy):** Policies and vehicles are queried exclusively within the caller's `organizationId`. Resources belonging to another tenant return `404 Not Found` (stealth rejection per BR-TENANT-3).
5. **Rule BR-POL-VERIFY-5 (Dual Input Support & Plate Normalization):** The gate supports verification by `policyNumber`, `plateNumber`, or both. Plate number comparison is case-insensitive and whitespace-trimmed.
6. **Rule BR-POL-VERIFY-6 (Temporal Validity):** Rejects future incident dates (`incidentDate > today`) and enforces that elapsed `expiryDate` marks a policy as expired even if DB status string is not yet updated.
7. **Rule BR-POL-VERIFY-7 (Own-Damage Scope):** `coveredPerils` defines own-damage coverage for the insured vehicle. A `THIRD_PARTY` policy has empty perils and indicates that own-damage is not covered ("الضرر الذاتي غير مشمول").

---

## 5. Frontend Integration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Policy Verification Screen                              │
│ Officer enters policyNumber OR plateNumber (+ date, peril)      │
│ Frontend calls: POST /api/v1/policies/verify                    │
│                                                                 │
│ ❌ Error → Show rejection reason, BLOCK intake                  │
│ ✅ Success → Auto-fill customer/vehicle/coverage fields         │
│           → Display Eligibility Hint badge:                     │
│             * ELIGIBLE_FOR_REVIEW (Green badge)                 │
│             * NOT_COVERED_BY_POLICY_TYPE (Warning badge:        │
│               "الضرر الذاتي غير مشمول")                         │
│             * COVERAGE_UNKNOWN (Advisory badge)                 │
│           → Enable "Continue to Claim" button                   │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Claim Intake Form                                       │
│ Officer enters incident details                                 │
│ Frontend calls: POST /api/v1/claims                             │
│ Claim created with status: NEW                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Test Data for Frontend Development

| Scenario | `policyNumber` | `plateNumber` | `incidentType` | Expected Result |
|---|---|---|---|---|
| Active COMPREHENSIVE (covered) | `POL-1000` | `ABC-1234` | `COLLISION` | 200 OK — `isEligible: true`, `eligibilityHint: 'ELIGIBLE_FOR_REVIEW'` |
| Active THIRD_PARTY (own-damage) | `POL-4000` | `TPL-4000` | `COLLISION` | 200 OK — `isEligible: true`, `eligibilityHint: 'NOT_COVERED_BY_POLICY_TYPE'` |
| Active policy without incidentType | `POL-1000` | — | — | 200 OK — `isEligible: true`, `eligibilityHint: null` |
| Expired policy (reject) | `POL-2000` | — | — | 422 `POLICY_EXPIRED` |
| Cancelled policy (reject) | `POL-3000` | — | — | 422 `POLICY_CANCELLED` |
| Future incident date | `POL-1000` | — | — | 400 `INVALID_INCIDENT_DATE` |
| Invalid peril | `POL-1000` | — | `FLOOD` | 400 `VALIDATION_ERROR` |
| Non-existent policy | `POL-9999` | — | — | 404 `POLICY_NOT_FOUND` |
| Wrong plate on policy | `POL-1000` | `WRONG-123` | — | 422 `VEHICLE_MISMATCH` |

---

## 7. Automated Testing Suite

Tested in [tests/policy.verification.test.js](../../tests/policy.verification.test.js) (48 tests):
* Successful verification with active policy (CLAIMS_OFFICER and ADMIN) returning coverage snapshot (`policyType`, `coveredPerils`, `deductibleAmount`) and dedicated `coverage` object.
* GAP-02 Coverage Visibility & Incident Applicability:
  * COMPREHENSIVE policy with verified `incidentDate` returns full `coverage` object with `effectiveFrom`, `effectiveTo`, `deductible`, and all canonical perils mapped with `covered: true`.
  * Covered incidentType (`COLLISION`) confirms `covered: true` in `coverage.incidents` and `ELIGIBLE_FOR_REVIEW`.
  * Uncovered incidentType on partial policy confirms `covered: false` in `coverage.incidents` and `NOT_COVERED_BY_POLICY_TYPE`.
  * Incident date outside policy period is rejected with 422 `POLICY_NOT_ACTIVE_ON_DATE` and exposes no false coverage.
  * Legacy policy missing coverage data safely returns `coverage: null` without fabricating data.
  * Absence of currency and coverage limits verified (no fabricated financial metadata).
  * THIRD_PARTY policy returns `coverage` with `deductible: 0` and all incidents un-covered.
  * 100% backward compatibility of response envelope and legacy fields.
* Coverage Snapshot & Hint:
  * COMPREHENSIVE with matching peril returns `ELIGIBLE_FOR_REVIEW`.
  * THIRD_PARTY with own-damage peril returns `NOT_COVERED_BY_POLICY_TYPE`.
  * Request without `incidentType` returns `eligibilityHint: null`.
  * Date range check with `incidentDate` and `incidentType` evaluates hint on reference date.
  * Direct insert legacy policy returns `COVERAGE_UNKNOWN` and null coverage fields.
* Schema & Validation:
  * Rejects `COMPREHENSIVE` with empty `coveredPerils` array.
  * Rejects `THIRD_PARTY` with non-empty `coveredPerils`.
  * Rejects invalid peril value (e.g. `FLOOD`) in `coveredPerils` element enum.
  * Rejects invalid `incidentType` with 400 `VALIDATION_ERROR`.
* Migration Script:
  * Dry-run mode (`--apply` omitted) produces zero updates and keeps legacy documents unmodified.
  * Apply mode persists `THIRD_PARTY`, `coveredPerils: []`, `deductibleAmount: 0`.
  * Script idempotency: second run finds zero records to update.
* Status & Mismatch rejections (expired, cancelled, date mismatch, plate mismatch, multi-vehicle ambiguity).
* Multi-tenancy and RBAC isolation tests.

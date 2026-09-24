# Feature Specification: Policy Verification / Intake Gate

## 1. Feature Overview
The **Policy Verification / Intake Gate** introduces a mandatory eligibility check before any claim can be created in InsurFlow. When a policyholder calls to report an accident, the **`CLAIMS_OFFICER`** or **`ADMIN`** first verifies that:

1. The caller holds a valid insurance policy with the company.
2. The policy is currently **ACTIVE** (not expired or cancelled).
3. The policy was active on the date the incident occurred.
4. The vehicle involved matches the policy record.

Only after successful verification does the system allow the officer to proceed with claim creation (`POST /claims`).

> **Important Distinction:** This feature performs **Policy/Eligibility Verification** (is the caller insured?), **not** coverage determination (is this specific incident type covered?). Coverage determination may follow after incident details are captured.

---

## 2. Technical Architecture & Data Flow

```
[Claims Officer / Admin — Web Dashboard]
   │
   ▼ POST /api/v1/policies/verify
[authenticate] → [adjusterLocationMiddleware] → [authorizeRole(['CLAIMS_OFFICER', 'ADMIN'])]
   │
   ▼
[validate(verifyPolicySchema)]
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
   │      └── Outside [startDate, expiryDate] → 422 POLICY_NOT_ACTIVE_ON_DATE
   ├── 4. Vehicle Lookup: vehicleRepository.findByPolicyAndOrganization(policyId, orgId)
   │      └── Populates customerId for customer data
   ├── 5. Plate Cross-Match (if plateNumber provided):
   │      └── Mismatch → 422 VEHICLE_MISMATCH
   └── 6. Return { isEligible: true, policy, vehicle, customer }
```

### Components Involved
* **Route:** [src/modules/policies/policy.routes.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/policies/policy.routes.js)
* **Controller:** [src/modules/policies/policy.controller.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/policies/policy.controller.js)
* **Service:** [src/modules/policies/policy.service.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/policies/policy.service.js)
* **Validation:** [src/modules/policies/policy.validation.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/policies/policy.validation.js)
* **Repositories:**
  * `policyRepository`: [src/modules/policies/policy.repository.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/policies/policy.repository.js)
  * `vehicleRepository`: [src/modules/vehicles/vehicle.repository.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/vehicles/vehicle.repository.js)

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
    "incidentDate": "2026-09-21"
  }
  ```
* **Fields:**
  * `policyNumber` (optional if `plateNumber` provided): The insurance policy number to verify.
  * `plateNumber` (optional if `policyNumber` provided): Vehicle plate number for direct lookup or cross-matching.
  * `incidentDate` (optional): Date of the incident in `YYYY-MM-DD` format to check the policy was active on that date (cannot be in the future).

* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Policy verified successfully",
    "data": {
      "isEligible": true,
      "policy": {
        "id": "60d0fe4f5311236168a109d1",
        "policyNumber": "POL-1000",
        "status": "ACTIVE",
        "startDate": "2025-01-01",
        "expiryDate": "2026-12-31"
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
  * `403 Forbidden`: Authenticated user is not `CLAIMS_OFFICER` or `ADMIN`.
  * `404 Not Found`:
    * `POLICY_NOT_FOUND` — Policy does not exist in the caller's organization (includes cross-tenant stealth rejection), or vehicle has no linked policy.
    * `VEHICLE_NOT_FOUND` — Vehicle with the given `plateNumber` does not exist in the organization.
  * `422 Unprocessable Entity`:
    * `POLICY_EXPIRED` — Policy status is `EXPIRED` or calendar `expiryDate` has passed.
    * `POLICY_CANCELLED` — Policy status is `CANCELLED`.
    * `POLICY_NOT_ACTIVE_ON_DATE` — The incident date falls outside the policy's coverage period `[startDate, expiryDate]`.
    * `VEHICLE_MISMATCH` — The provided plate number does not match the vehicle registered with the policy, or policy has no vehicle record linked to match.

---

## 4. Business Invariants & Multi-Tenancy

1. **Rule BR-POL-VERIFY-1 (Intake Gate):** No claim should be created without first verifying that the policyholder and vehicle belong to the company and the policy is active.
2. **Rule BR-POL-VERIFY-2 (Eligibility, Not Coverage):** Successful verification confirms the caller is insured; it does **not** determine whether the specific incident type is covered under the policy terms.
3. **Rule BR-POL-VERIFY-3 (Role Restriction):** Only `CLAIMS_OFFICER` and `ADMIN` can perform policy verification (same roles that create claims).
4. **Rule BR-POL-VERIFY-4 (Strict Tenancy):** Policies and vehicles are queried exclusively within the caller's `organizationId`. Resources belonging to another tenant return `404 Not Found` (stealth rejection per BR-TENANT-3).
5. **Rule BR-POL-VERIFY-5 (Dual Input Support & Plate Normalization):** The gate supports verification by `policyNumber`, `plateNumber`, or both. Plate number comparison is case-insensitive and whitespace-trimmed.
6. **Rule BR-POL-VERIFY-6 (Temporal Validity):** Rejects future incident dates (`incidentDate > today`) and enforces that elapsed `expiryDate` marks a policy as expired even if DB status string is not yet updated.

---

## 5. Frontend Integration Flow

```
┌─────────────────────────────────────────────────────┐
│ Step 1: Policy Verification Screen                  │
│ Officer enters policyNumber OR plateNumber (+ date) │
│ Frontend calls: POST /api/v1/policies/verify        │
│                                                     │
│ ❌ Error → Show rejection reason, BLOCK intake      │
│ ✅ Success → Auto-fill customer/vehicle fields      │
│           → Enable "Continue to Claim" button       │
└───────────────────────────┬─────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: Claim Intake Form (existing)                │
│ Officer enters incident details                     │
│ Frontend calls: POST /api/v1/claims                 │
│ Claim created with status: NEW                      │
└─────────────────────────────────────────────────────┘
```

---

## 6. Test Data for Frontend Development

| Scenario | `policyNumber` | `plateNumber` | Expected Result |
|---|---|---|---|
| Active policy by policyNumber | `POL-1000` | — | 200 OK — eligible |
| Active policy by plateNumber | — | `ABC-1234` | 200 OK — eligible |
| Dual match (success) | `POL-1000` | `ABC-1234` | 200 OK — eligible |
| Expired policy (reject) | `POL-2000` | — | 422 `POLICY_EXPIRED` |
| Cancelled policy (reject) | `POL-3000` | — | 422 `POLICY_CANCELLED` |
| Future incident date | `POL-1000` | — (date: 2099-01-01) | 400 `INVALID_INCIDENT_DATE` |
| Non-existent policy | `POL-9999` | — | 404 `POLICY_NOT_FOUND` |
| Wrong plate on policy | `POL-1000` | `WRONG-123` | 422 `VEHICLE_MISMATCH` |

---

## 7. Automated Testing Suite

Tested in [tests/policy.verification.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/policy.verification.test.js) (22 tests):
* Successful verification with active policy (CLAIMS_OFFICER and ADMIN).
* Successful verification with incidentDate within policy period.
* Successful verification with case-insensitive plate match.
* Successful verification using `plateNumber` only.
* Rejection of expired policy (422 `POLICY_EXPIRED`).
* Rejection of cancelled policy (422 `POLICY_CANCELLED`).
* Rejection of policy when calendar expiryDate has elapsed (422 `POLICY_EXPIRED`).
* Rejection when incidentDate is in the future (400 `INVALID_INCIDENT_DATE`).
* Rejection when incidentDate outside policy period (422 `POLICY_NOT_ACTIVE_ON_DATE`).
* Rejection when plate number does not match (422 `VEHICLE_MISMATCH`).
* Rejection when policy has no linked vehicle to match plate (422 `VEHICLE_MISMATCH`).
* Rejection when policy has multiple vehicles and plateNumber is omitted (422 `AMBIGUOUS_VEHICLE_SELECTION`).
* Successful verification when policy has multiple vehicles and valid plateNumber is specified.
* Non-existent policy (404 `POLICY_NOT_FOUND`).
* Non-existent vehicle by plate (404 `VEHICLE_NOT_FOUND`).
* Vehicle without linked policy (404 `POLICY_NOT_FOUND`).
* Cross-tenant stealth rejection (404).
* RBAC enforcement (403 for `FIELD_ADJUSTER`).
* Unauthenticated request rejection (401).
* Missing both policyNumber and plateNumber validation (400 `VALIDATION_ERROR`).
* Invalid incidentDate format validation (400 `VALIDATION_ERROR`).

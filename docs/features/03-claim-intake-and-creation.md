# Feature Specification: Claim Intake & Creation

## 1. Feature Overview
The **Claim Intake & Creation** module provides the front-door entry point for all insurance claim records in InsurFlow. 

When a policyholder calls to report a motor accident or damage:
1. A **`CLAIMS_OFFICER`** or **`ADMIN`** takes intake notes and submits initial incident details through the Web Dashboard.
2. The Backend validates inputs, attaches tenant identity, generates the sequential claim number, and sets the initial state to **`NEW`**.
3. An immutable audit timeline event (`'Claim Created'`) is logged.

---

## 2. Architecture & Design Patterns

### Creation Sequence
```
[Claims Officer / Admin]
   │
   ▼ POST /api/v1/claims
[role.middleware(['CLAIMS_OFFICER', 'ADMIN'])] ──▶ 403 Forbidden for Adjusters
   │
   ▼
[validate(createClaimSchema)] ──▶ 400 Bad Request on invalid fields
   │
   ▼
[claimController.createClaim]
   │
   ▼
[claimService.createClaim]
   ├── 1. Attaches authUser.organizationId & authUser.userId
   ├── 2. Sets status = 'NEW'
   ├── 3. Appends timeline event: { action: 'Claim Created', performedBy, role, timestamp }
   └── 4. Calls claimRepository.create(claimData)
            │
            ▼
        [Claim.pre('save')] ──▶ Allocates CLM-<ORG>-0001 (Atomic Counter)
```

### Components Involved
* **Route:** [src/modules/claims/claim.routes.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.routes.js)
* **Controller:** [src/modules/claims/claim.controller.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.controller.js)
* **Service:** [src/modules/claims/claim.service.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.service.js)
* **Repository:** [src/modules/claims/claim.repository.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.repository.js)
* **Model:** [src/modules/claims/claim.model.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.model.js)
* **Validation:** [src/modules/claims/claim.validation.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.validation.js)

---

## 3. API Contract & Endpoints

### POST `/api/v1/claims`
* **Authorized Roles:** `CLAIMS_OFFICER`, `ADMIN`.
* **Authentication:** Required (JWT).
* **Request Body:**
  ```json
  {
    "policyId": "6a91ab09c9ff1dc54fabf160",
    "plateNumber": "ABC-1234",
    "incidentType": "COLLISION",
    "incidentLocation": "Al-Irsal St, Ramallah",
    "incidentDate": "2026-09-08",
    "latitude": 31.9050,
    "longitude": 35.2040
  }
  ```
* **Validation Rules:**
  * `policyId`: Valid MongoDB ObjectId string, required.
  * `plateNumber`: String, optional. If provided, must match the vehicle registered on the policy.
  * `incidentType`: Required enum: `['COLLISION', 'REAR_END_COLLISION', 'SIDE_IMPACT', 'PARKING_DAMAGE', 'OTHER']`.
  * `incidentLocation`: String, required, trimmed.
  * `incidentDate`: String `YYYY-MM-DD`, optional. Must fall within the policy period and not in the future.
  * `latitude`: Number (-90 to 90), optional GPS coordinate.
  * `longitude`: Number (-180 to 180), optional GPS coordinate.
* **Intake Business Gates:**
  * Validates policy existence and status (`ACTIVE`).
  * Cross-verifies vehicle/plate against policy vehicle.
  * If policy has multiple vehicles registered and `plateNumber` is omitted, request is rejected with 422 `AMBIGUOUS_VEHICLE_SELECTION`.
  * Auto-populates customer name, customer phone, vehicle plate number, and `policyId` reference onto the new Claim record.
* **Success Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "Claim created successfully",
    "data": {
      "id": "60d0fe4f5311236168a109cc",
      "claimNumber": "CLM-INS-0001",
      "status": "NEW",
      "createdAt": "2026-09-08T10:00:00.000Z"
    }
  }
  ```

---

## 4. Multi-Tenancy & Business Invariants

1. **Rule BR-CLAIM-1 (Role Restriction):** Restricted strictly to `CLAIMS_OFFICER` and `ADMIN`. Field Adjusters inspect; they do not intake claims.
2. **Rule BR-CLAIM-2 (Initial State):** Unconditionally set to `'NEW'`. The client cannot specify or override `status`.
3. **Rule BR-CLAIM-3 (Tenant Ownership):** `organizationId` is derived exclusively from `req.user.organizationId`.
4. **Rule BR-CLAIM-4 (Audit Initiation):** Initializes `timeline` with:
   ```javascript
   {
     action: 'Claim Created',
     performedBy: authUser.userId,
     role: authUser.role, // 'CLAIMS_OFFICER' or 'ADMIN'
     timestamp: new Date()
   }
   ```

---

## 5. Automated Testing Suite

Tested in:
* [tests/claim.lifecycle.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/claim.lifecycle.test.js)
* [tests/claim.numbering.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/claim.numbering.test.js)
* [tests/claim.statusMachine.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/claim.statusMachine.test.js)

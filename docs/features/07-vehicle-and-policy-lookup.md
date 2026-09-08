# Feature Specification: Vehicle & Policy Lookup

## 1. Feature Overview
During on-site field inspections, a **`FIELD_ADJUSTER`** inspects the vehicle involved in the incident and searches the insurer's underwriting registry by vehicle plate number.

This feature enables:
1. Retrieval of vehicle details (VIN, make, model, year).
2. Resolution of the active or expired insurance policy.
3. Policyholder / customer identification.
4. License plate normalization (trimming whitespace, uppercase conversion).
5. Transparent policy status warning (`POLICY_EXPIRED`) while permitting field inspection to proceed.

---

## 2. Technical Architecture & Data Flow

```
[Field Adjuster Mobile App]
   │
   ▼ GET /api/v1/vehicles/lookup?plateNumber=DXB-1234
[role.middleware(['FIELD_ADJUSTER'])] ──▶ 403 Forbidden for Officers/Admins
   │
   ▼
[validate(lookupVehicleSchema, 'query')]
   │
   ▼
[vehicleController.lookupVehicle]
   │
   ▼
[vehicleService.lookupVehicle]
   ├── 1. Normalize: plateNumber.trim().toUpperCase()
   ├── 2. Query Vehicle: vehicleRepository.findByPlateAndOrganization(normalizedPlate, orgId)
   │      └── Throws 404 VEHICLE_NOT_FOUND if absent
   ├── 3. Query Policy: policyRepository.findByIdAndOrganization(vehicle.policyId, orgId)
   ├── 4. Query Customer: customerRepository.findByIdAndOrganization(vehicle.customerId, orgId)
   └── 5. Evaluate policy expiry:
          └── If policy.status === 'EXPIRED', attach warning object
```

### Components Involved
* **Route:** [src/modules/vehicles/vehicle.routes.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/vehicles/vehicle.routes.js)
* **Controller:** [src/modules/vehicles/vehicle.controller.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/vehicles/vehicle.controller.js)
* **Service:** [src/modules/vehicles/vehicle.service.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/vehicles/vehicle.service.js)
* **Repositories:** 
  * `vehicleRepository`: [src/modules/vehicles/vehicle.repository.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/vehicles/vehicle.repository.js)
  * `policyRepository`: [src/modules/policies/policy.repository.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/policies/policy.repository.js)
  * `customerRepository`: [src/modules/customers/customer.repository.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/customers/customer.repository.js)

---

## 3. API Contract & Endpoints

### GET `/api/v1/vehicles/lookup`
* **Authorized Roles:** `FIELD_ADJUSTER` only.
* **Authentication:** Required (JWT).
* **Query Parameters:**
  * `plateNumber`: Required string (e.g. `?plateNumber=DXB-1234`).
* **Success Response (200 OK — Active Policy):**
  ```json
  {
    "success": true,
    "message": "Vehicle details retrieved successfully",
    "data": {
      "vehicle": {
        "id": "60d0fe4f5311236168a109d0",
        "plateNumber": "DXB-1234",
        "vin": "1HGCR2F83HA123456",
        "make": "Toyota",
        "model": "Camry",
        "year": 2022
      },
      "policy": {
        "id": "60d0fe4f5311236168a109d1",
        "policyNumber": "POL-2026-0001",
        "coverageType": "COMPREHENSIVE",
        "status": "ACTIVE",
        "startDate": "2026-01-01T00:00:00.000Z",
        "endDate": "2026-12-31T23:59:59.000Z"
      },
      "customer": {
        "id": "60d0fe4f5311236168a109d2",
        "name": "Mohammed Ali",
        "phone": "+971501112233",
        "email": "m.ali@example.com"
      }
    }
  }
  ```
* **Success Response (200 OK — Expired Policy):**
  When `policy.status === 'EXPIRED'`, HTTP status remains 200, but a warning is included in the payload:
  ```json
  {
    "success": true,
    "message": "Vehicle details retrieved successfully",
    "data": {
      "vehicle": { ... },
      "policy": { ... },
      "customer": { ... },
      "warning": {
        "code": "POLICY_EXPIRED",
        "message": "The policy associated with this vehicle has expired"
      }
    }
  }
  ```
* **Error Responses:**
  * `400 Bad Request`: Missing `plateNumber` or unknown query parameters.
  * `403 Forbidden`: Authenticated user is not a `FIELD_ADJUSTER`.
  * `404 Not Found`: `VEHICLE_NOT_FOUND`.

---

## 4. Business Invariants & Multi-Tenancy

1. **Adjuster Exclusive:** Only `FIELD_ADJUSTER` can search vehicles in the field.
2. **Expired Policy Policy (Rule BR-VEH-3):** Inspection is permitted to continue even if the policy is expired so the adjuster can document the physical scene; the underwriting department is notified via the warning flag.
3. **Strict Tenancy:** Vehicles, policies, and customers must match the caller's `organizationId`. A vehicle with plate `DXB-1234` in Tenant B will return 404 when looked up by an adjuster in Tenant A.

---

## 5. Automated Testing Suite

Tested in [tests/vehicle.lookup.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/vehicle.lookup.test.js) (8 tests):
* Correct retrieval of vehicle, policy, and customer data.
* License plate case-insensitivity and trimming.
* Warning object attached when policy is expired.
* Role-based access rejection (403 for `CLAIMS_OFFICER` and `ADMIN`).
* Tenant boundary isolation (404 for cross-tenant plate).

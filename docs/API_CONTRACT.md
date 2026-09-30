# InsurFlow API Contract

## 1. Purpose
This document defines the API contract between the InsurFlow Backend, Web Dashboard, and Flutter Mobile Application. It serves as the shared agreement across the full operational scope (Sprint 1 & Sprint 2), reflecting the complete business workflow.

## 2. API Conventions
- **Base URL:** `/api/v1/`
- **Response Format:**
  - Success:
    ```json
    {
      "success": true,
      "message": "Optional message",
      "data": {} 
    }
    ```
  - Error:
    ```json
    {
      "success": false,
      "message": "General error description",
      "errors": [
        {
          "code": "ERROR_CODE",
          "details": "Specific error details"
        }
      ] 
    }
    ```
    *(Aligned with the existing `src/utils/apiResponse.js` convention)*
  - **Production Internal Error Masking (HTTP 500 / SEC-03):** In production environments, unexpected 500 errors always return a safe generic message (`"Internal Server Error"`) with error code `"INTERNAL_ERROR"`, strictly preventing leakage of internal exception messages, stack traces, database details, or filesystem paths to clients. Diagnostic details are preserved in server-side logs.

### 2.1 Request Headers for Location Tracking (Feature 18)
Mobile client requests performed by `FIELD_ADJUSTER` users passively transmit the adjuster's current GPS position via standard HTTP request headers:
- `X-Latitude` (or alias `X-Adjuster-Latitude`): Current latitude as decimal number (`-90.0` to `90.0`).
- `X-Longitude` (or alias `X-Adjuster-Longitude`): Current longitude as decimal number (`-180.0` to `180.0`).
These headers are processed asynchronously by a lightweight middleware mounted after authentication. They update the adjuster's stored location without interrupting, delaying, or rejecting the primary request.

## 3. Authentication
The API uses JWT-based authentication. The context containing user identity, role, and organization is securely extracted by the Backend from the access token.

## 4. Roles & Authorization
- **ADMIN:** Administrative user management, Oversight of all organization claims, Verify Policy Eligibility, Create Claim, Make Claim decision, Final claim closure, Download Final Claim Report.
- **CLAIMS_OFFICER:** Verify Policy Eligibility, Create Claim, List organization Claims, View Claim Details, View available Field Adjusters, Assign Field Adjuster, Start Claim Review, Request Correction, Make Claim decision, Download Final Claim Report.
- **FIELD_ADJUSTER:** View Claims assigned to them, View assigned Claim Details, Accept Assignment, Decline Assignment, Start / Resume inspection, Perform inspection drafts, Submit completed inspection.

*(No additional permissions are invented outside of these scopes).*

## 5. Multi-Tenancy
- InsurFlow is a multi-tenant platform serving multiple organizations.
- Every authenticated user belongs to an Organization.
- Every Claim belongs to an Organization.
- **Rule:** The client must NOT send `organizationId` as a trusted value in requests.
- **Rule:** The Backend obtains `organizationId` from the authenticated user context (`req.user.organizationId`).
- Organization isolation must apply to all Claim-related operations (reading, writing, and transitioning).

## 6. Claim Lifecycle
Valid status enum: `NEW`, `PENDING_ACCEPTANCE`, `ASSIGNED`, `IN_PROGRESS`, `SUBMITTED`, `UNDER_REVIEW`, `CORRECTION_REQUIRED`, `APPROVED`, `REJECTED`, `CLOSED`.

Valid status transitions (enforced by the Backend):
- `Create Claim` → `NEW`
- `Assign Adjuster` (`NEW` → `PENDING_ACCEPTANCE`)
- `Accept Assignment` (`PENDING_ACCEPTANCE` → `ASSIGNED`)
- `Decline Assignment` (`PENDING_ACCEPTANCE` → `NEW`)
- `Start / Resume Inspection` (`ASSIGNED` or `CORRECTION_REQUIRED` → `IN_PROGRESS`)
- `Submit Inspection` (`IN_PROGRESS` → `SUBMITTED`)
- `Start Review` (`SUBMITTED` → `UNDER_REVIEW`)
- `Request Correction` (`UNDER_REVIEW` → `CORRECTION_REQUIRED`)
- `Make Decision` (`UNDER_REVIEW` → `APPROVED` | `REJECTED`)
- `Admin Close` (`APPROVED` → `CLOSED`)

## 7. Authentication APIs

### `POST /auth/login`
- **Purpose:** Authenticate a user.
- **Authorized Roles:** Any valid user.
- **Authentication:** None.
- **Request Body:**
  ```json
  {
    "organizationCode": "INS-A",
    "employeeCode": "FA-001",
    "password": "****"
  }
  ```
- **Validation Rules:** All fields are required.
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Login successful",
    "data": {
      "accessToken": "jwt-token-string",
      "user": {
        "id": "user-uuid",
        "name": "Ahmed Ali",
        "employeeCode": "FA-001",
        "role": "FIELD_ADJUSTER",
        "organizationId": "org-uuid",
        "organizationName": "InsurCo"
      }
    }
  }
  ```
- **Error Responses:** 
  - `400 Bad Request`: Validation errors.
  - `401 Unauthorized`: Invalid credentials, Invalid organization, Inactive user.
  - `429 Too Many Requests`: Too many failed login attempts (exceeded rate limit). Returns `TOO_MANY_REQUESTS`.

## 7.5 Policy Verification API (Feature 20)

### `POST /policies/verify`
- **Purpose:** Claims Officer or Admin verifies policy validity, active status, calendar date coverage, vehicle linkage, and retrieves a coverage snapshot prior to claim creation.
- **Authorized Roles:** `CLAIMS_OFFICER`, `ADMIN` (Adjuster receives 403 Forbidden).
- **Authentication:** Required (JWT).
- **Request Body:**
  ```json
  {
    "policyNumber": "POL-1000",
    "plateNumber": "ABC-1234",
    "incidentDate": "2026-06-15",
    "incidentType": "COLLISION"
  }
  ```
  *(At least one of `policyNumber` or `plateNumber` is required. `incidentDate` and `incidentType` are optional).*
- **Perils & Policy Scope:**
  - `coveredPerils`: Represents physical own-damage perils to the insured vehicle only (`COLLISION`, `THEFT`, `FIRE`, `NATURAL_DISASTER`).
  - `policyType`: `COMPREHENSIVE` (covers own-damage for listed perils) or `THIRD_PARTY` (covers third-party liability only; own-damage is excluded with empty perils and zero deductible).
  - Third-party liability is separate from compulsory insurance (compulsory is not modeled).
  - Hint text for third-party own damage: **"الضرر الذاتي غير مشمول"** (*Own-damage not covered*).
- **Error Codes:**
  - `400 VALIDATION_ERROR`: Missing both `policyNumber` and `plateNumber`, invalid `incidentDate` format (`YYYY-MM-DD`), or invalid `incidentType`.
  - `400 INVALID_INCIDENT_DATE`: `incidentDate` is in the future.
  - `403 FORBIDDEN`: Called by `FIELD_ADJUSTER`.
  - `404 POLICY_NOT_FOUND`: Policy not found within tenant.
  - `404 VEHICLE_NOT_FOUND`: Vehicle not found by plate within tenant.
  - `422 POLICY_CANCELLED`: Policy is cancelled.
  - `422 POLICY_EXPIRED`: Policy is expired or calendar expiry has elapsed.
  - `422 POLICY_NOT_ACTIVE_ON_DATE`: `incidentDate` outside policy period.
  - `422 VEHICLE_MISMATCH`: Specified plate number does not match policy vehicle.
  - `422 AMBIGUOUS_VEHICLE_SELECTION`: Policy has multiple vehicles registered and caller omitted `plateNumber`.
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Policy verified successfully",
    "data": {
      "isEligible": true,
      "eligibilityHint": "ELIGIBLE_FOR_REVIEW",
      "policy": {
        "id": "60d0fe4f5311236168a109ca",
        "policyNumber": "POL-1000",
        "status": "ACTIVE",
        "startDate": "2025-01-01",
        "expiryDate": "2026-12-31",
        "policyType": "COMPREHENSIVE",
        "coveredPerils": ["COLLISION", "THEFT", "FIRE", "NATURAL_DISASTER"],
        "deductibleAmount": 500
      },
      "vehicle": {
        "id": "60d0fe4f5311236168a109cb",
        "plateNumber": "ABC-1234",
        "make": "Toyota",
        "model": "Camry",
        "year": 2022,
        "color": "White"
      },
      "customer": {
        "id": "60d0fe4f5311236168a109cc",
        "fullName": "Ahmad Ali",
        "phone": "+962791234567"
      }
    }
  }
  ```
- **Eligibility Hint Values:**
  - `ELIGIBLE_FOR_REVIEW`: When `incidentType` is in `coveredPerils`.
  - `NOT_COVERED_BY_POLICY_TYPE`: When `incidentType` is not in `coveredPerils` (badge: "الضرر الذاتي غير مشمول").
  - `COVERAGE_UNKNOWN`: For legacy policies missing `policyType`.
  - `null`: When `incidentType` is not provided.

## 8. Claims APIs

### `POST /claims`
- **Purpose:** Claims Officer or Admin creates an initial Claim.
- **Authorized Roles:** `CLAIMS_OFFICER`, `ADMIN`
- **Authentication:** Required (JWT).
- **Request Body:**
  ```json
  {
    "policyId": "651a2b3c4d5e6f7a8b9c0d1e",
    "plateNumber": "ABC-1234",
    "incidentDate": "2026-06-15",
    "incidentType": "COLLISION",
    "incidentLocation": "Main St, Riyadh",
    "latitude": 31.9050,
    "longitude": 35.2040
  }
  ```
- **Fields:**
  - `policyId` (String, required): Valid MongoDB ObjectId of an active policy verified via `POST /policies/verify`.
  - `plateNumber` (String, optional): License plate number. If the policy has more than one registered vehicle, this field is mandatory; otherwise, intake is rejected with 422 `AMBIGUOUS_VEHICLE_SELECTION`. If provided, must match a vehicle registered on the policy.
  - `incidentDate` (String, optional): `YYYY-MM-DD`. Cannot be in the future and must fall within policy `[startDate, expiryDate]`.
  - `incidentType` (String, required): One of `COLLISION`, `REAR_END_COLLISION`, `SIDE_IMPACT`, `PARKING_DAMAGE`, `OTHER`.
  - `incidentLocation` (String, required): Incident location address/description.
  - `latitude` (Number, optional): GPS coordinate (-90 to 90).
  - `longitude` (Number, optional): GPS coordinate (-180 to 180).
- **Incident Coordinates (Feature 18):** `latitude` and `longitude` are optional numeric coordinates. When provided, they are stored in a dedicated `claim.incidentCoordinates: { latitude, longitude, capturedAt }` subdocument (separate from incident address string `claim.incidentLocation` and inspection GPS `claim.location`). If omitted, `incidentCoordinates` is stored as `null` and `incidentLocation` text is preserved as given.
- **Business Rules:** The Backend automatically determines `organizationId`, `createdBy`, `createdAt`, `status` (`NEW`), and resolves `customer` (`name`, `phone`) and `vehicle` (`plateNumber`) from the policy vehicle record. The client must not attempt to control these values.
- **Error Codes:**
  - `400 VALIDATION_ERROR`: Missing `policyId`, missing `incidentType`, missing `incidentLocation`, or invalid format.
  - `404 POLICY_NOT_FOUND`: Policy not found in the authenticated user's organization.
  - `422 POLICY_CANCELLED`: Policy is cancelled.
  - `422 POLICY_EXPIRED`: Policy has expired.
  - `422 POLICY_NOT_ACTIVE_ON_DATE`: Policy was not active on `incidentDate`.
  - `422 NO_VEHICLE_ON_POLICY`: No vehicle registered under the policy.
  - `422 VEHICLE_MISMATCH`: Specified plate number does not match any vehicle registered under the policy.
  - `422 AMBIGUOUS_VEHICLE_SELECTION`: Policy has multiple vehicles registered and caller omitted `plateNumber`.
- **Success Response (201):**
  ```json
  {
    "success": true,
    "message": "Claim created successfully",
    "data": {
      "id": "claim-uuid",
      "claimNumber": "CLM-0001",
      "status": "NEW",
      "createdAt": "2026-08-26T15:00:00Z"
    }
  }
  ```
- **Status Transition:** → `NEW`

### `GET /claims`
- **Purpose:** Retrieve Claims visible to the authenticated user.
- **Authorized Roles:** `CLAIMS_OFFICER`, `FIELD_ADJUSTER`, `ADMIN`
- **Authentication:** Required (JWT).
- **Request Parameters:**
  - `status`: Optional filter (`NEW`, `PENDING_ACCEPTANCE`, `ASSIGNED`, `IN_PROGRESS`, `SUBMITTED`, `UNDER_REVIEW`, `CORRECTION_REQUIRED`, `APPROVED`, `REJECTED`, `CLOSED`). Returns 400 `VALIDATION_ERROR` for invalid status values.
  - `adjusterId`: Optional MongoDB ObjectId string to filter claims assigned to a specific Field Adjuster.
  - `assignedTo`: Alias for `adjusterId`.
  - `page`: Optional integer $\ge 1$ (default: `1`).
  - `limit`: Optional integer between $1$ and $100$ (default: `50`).
- **Pagination Headers (Response):**
  - `X-Total-Count`: Total number of matching claims in organization.
  - `X-Page`: Current page number.
  - `X-Limit`: Items per page.
  - `X-Total-Pages`: Total page count.
- **Filtering Behavior:**
  - `CLAIMS_OFFICER`: Returns organization-wide Claims (optionally filtered by `status` and/or `adjusterId`).
  - `FIELD_ADJUSTER`: Returns only Claims assigned to the authenticated user.
  - `ADMIN`: Returns Claims according to administrative permissions (optionally filtered by `status` and/or `adjusterId`).
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Claims retrieved successfully",
    "data": [
      {
        "id": "claim-uuid",
        "claimNumber": "CLM-DEMO-0001",
        "status": "ASSIGNED",
        "customerName": "John Doe",
        "initialPlateNumber": "ABC-1234",
        "createdAt": "2026-08-26T15:00:00Z",
        "incidentCoordinates": {
          "latitude": 31.9050,
          "longitude": 35.2040,
          "capturedAt": "2026-08-26T14:30:00.000Z"
        },
        "assignedTo": {
          "id": "6a91ab09c9ff1dc54fabf15c",
          "name": "Ahmed Ali"
        },
        "fieldAdjuster": {
          "id": "6a91ab09c9ff1dc54fabf15c",
          "name": "Ahmed Ali"
        }
      }
    ]
  }
  ```

### `GET /claims/:claimId`
- **Purpose:** Retrieve comprehensive Claim details (Single Source of Truth for claim detail pages).
- **Authorized Roles:** `CLAIMS_OFFICER`, `FIELD_ADJUSTER`, `ADMIN`
- **Authentication:** Required (JWT).
- **Business Rules:** Scope applies based on organization isolation and assignment rules. `FIELD_ADJUSTER` can only view claims assigned to them.
- **Success Response (200):** *(Fields like vehicle make/model, accident, evidence will be null or empty until populated during the inspection)*
  ```json
  {
    "success": true,
    "message": "Claim retrieved successfully",
    "data": {
      "id": "claim-uuid",
      "claimNumber": "CLM-DEMO-0001",
      "status": "ASSIGNED",
      "trackingToken": "d4e2a6b8c0f1e3d5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3",
      "incidentDate": "2026-08-25",
      "incidentType": "COLLISION",
      "incidentLocation": "Al-Irsal St, Ramallah",
      "incidentCoordinates": {
        "latitude": 31.9050,
        "longitude": 35.2040,
        "capturedAt": "2026-08-26T15:00:00.000Z"
      },
      "createdAt": "2026-08-26T15:00:00.000Z",
      "updatedAt": "2026-08-26T15:10:00.000Z",

      "customer": {
        "name": "John Doe",
        "phone": "0591234567"
      },

      "vehicle": {
        "plateNumber": "ABC-1234",
        "make": "Toyota",
        "model": "Camry",
        "year": 2024,
        "color": "White"
      },

      "policy": {
        "id": "policy-uuid",
        "policyNumber": "POL-INS-001",
        "status": "ACTIVE",
        "startDate": "2026-01-01T00:00:00.000Z",
        "expiryDate": "2027-12-31T00:00:00.000Z"
      },

      "assignment": {
        "assignedTo": {
          "id": "adjuster-uuid",
          "name": "Ahmed Ali",
          "employeeCode": "FA-001"
        },
        "assignedBy": {
          "id": "officer-uuid",
          "name": "Sara Khan",
          "employeeCode": "CO-001"
        },
        "assignedAt": "2026-08-26T15:10:00.000Z",
        "priority": "HIGH",
        "assignmentNotes": "Urgent case"
      },

      "accident": {
        "accidentType": "COLLISION",
        "accidentDate": "2026-08-25",
        "accidentTime": "14:30",
        "description": "Front collision at intersection",
        "damageDescription": "Front bumper and hood damage"
      },

      "location": {
        "latitude": 31.9050,
        "longitude": 35.2040,
        "address": "Main St, Ramallah",
        "capturedAt": "2026-08-26T16:00:00.000Z"
      },

      "evidence": [
        {
          "imageType": "VEHICLE_FRONT",
          "url": "https://res.cloudinary.com/...",
          "uploadedBy": {
            "id": "adjuster-uuid",
            "name": "Ahmed Ali",
            "employeeCode": "FA-001"
          },
          "uploadedAt": "2026-08-26T16:05:00.000Z"
        }
      ],

      "signature": {
        "url": "https://res.cloudinary.com/...",
        "capturedBy": "adjuster-uuid",
        "capturedAt": "2026-08-26T16:30:00.000Z"
      },

      "decisionNotes": null,
      "closedBy": null,
      "closedAt": null,
      "closingNotes": null,

      "timeline": [
        {
          "action": "Claim Created",
          "previousStatus": null,
          "newStatus": null,
          "notes": null,
          "performedBy": {
            "id": "officer-uuid",
            "name": "Sara Khan",
            "employeeCode": "CO-001",
            "role": "CLAIMS_OFFICER"
          },
          "role": "CLAIMS_OFFICER",
          "timestamp": "2026-08-26T15:00:00.000Z"
        }
      ],

      "createdBy": {
        "id": "officer-uuid",
        "name": "Sara Khan",
        "employeeCode": "CO-001"
      },

      "coverageSnapshot": {
        "policyType": "COMPREHENSIVE",
        "coveredPerils": ["COLLISION", "THEFT"],
        "deductibleAmount": 500,
        "capturedAt": "2026-08-26T15:00:00.000Z"
      },

      "lossAssessment": {
        "estimatedPartsCost": 1200.0,
        "laborCost": 800.0,
        "totalDamage": 2000.0,
        "policyDeductible": 500.0,
        "deductibleApplied": 500.0,
        "deductibleOverrideReason": null,
        "netApprovedPayout": 1500.0,
        "currency": "ILS",
        "assessedAt": "2026-08-26T17:00:00.000Z",
        "assessedBy": {
          "id": "officer-uuid",
          "name": "Sara Khan",
          "employeeCode": "CO-001"
        }
      }
    }
  }
  ```
- **Response Field Notes:**
  - `coverageSnapshot` is captured server-side at claim intake from verified policy (`null` for legacy claims).
  - `lossAssessment` is populated when claim is adjudicated (`APPROVED`), containing financial damage figures and net approved payout (`null` if unapproved or legacy).
  - `vehicle.make`, `vehicle.model`, `vehicle.year`, `vehicle.color` are `null` until the Field Adjuster confirms a vehicle during inspection.
  - `policy` is populated from the top-level `policyId` reference set at claim creation.
  - `assignment.assignedTo`, `assignment.assignedBy` are `null` for unassigned (NEW) claims.
  - `accident`, `location` are `null` until populated during inspection.
  - `evidence` is `[]` until photos are uploaded during inspection.
  - `signature` is `null` until captured during inspection.
  - All user references are resolved to `{ id, name, employeeCode }` objects.

### `GET /claims/stats`
- **Purpose:** Retrieve aggregated KPI statistics and workload metrics for the dashboard.
- **Authorized Roles:** `ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`
- **Authentication:** Required (JWT).
- **Request Parameters (Query):**
  - `from`: Optional ISO 8601 string or `YYYY-MM-DD` date. Expanded to `00:00:00.000Z`. Rejects if in the future.
  - `to`: Optional ISO 8601 string or `YYYY-MM-DD` date. Expanded to `23:59:59.999Z`. Silently capped to current server time if in the future.
- **Validation Rules & Error Messages (400 Bad Request):**
  - `from` date cannot be in the future (`from date cannot be in the future`).
  - `from` date must be before or equal to `to` date when `to` is explicitly supplied (`from date must be before or equal to to date`).
  - Resolved date range cannot exceed 5 years (`date range cannot exceed 5 years`).
  - Invalid ISO format triggers Joi date parsing error.
  - Unknown/unrecognized query parameters rejected (`VALIDATION_ERROR`).
- **Response Shapes by Role:**
  - **`ADMIN` / `CLAIMS_OFFICER` (Organization Scope):**
    ```json
    {
      "success": true,
      "message": "Claim statistics retrieved successfully",
      "data": {
        "scope": "ORGANIZATION",
        "totalClaims": 13,
        "byStatus": {
          "NEW": 2,
          "PENDING_ACCEPTANCE": 0,
          "ASSIGNED": 3,
          "IN_PROGRESS": 2,
          "SUBMITTED": 1,
          "UNDER_REVIEW": 1,
          "CORRECTION_REQUIRED": 1,
          "APPROVED": 1,
          "REJECTED": 1,
          "CLOSED": 1
        },
        "pendingActionCount": 4,
        "actionableBreakdown": {
          "unassigned": 2,
          "pendingAcceptance": 0,
          "readyForReview": 2
        },
        "adjustersWorkload": {
          "totalActive": 3,
          "available": 3,
          "nearCapacity": 1,
          "atCapacity": 1
        }
      }
    }
    ```
    *Non-Mutually Exclusive Note:* In `adjustersWorkload`, `available` ($\le 3$ active tasks) and `atCapacity` ($\ge 3$ active tasks) overlap. An adjuster with exactly 3 active claims is counted in both metrics.
  - **`FIELD_ADJUSTER` (Assigned Scope):**
    ```json
    {
      "success": true,
      "message": "Claim statistics retrieved successfully",
      "data": {
        "scope": "ASSIGNED",
        "totalClaims": 6,
        "byStatus": {
          "NEW": 0,
          "PENDING_ACCEPTANCE": 0,
          "ASSIGNED": 2,
          "IN_PROGRESS": 1,
          "SUBMITTED": 1,
          "UNDER_REVIEW": 0,
          "CORRECTION_REQUIRED": 1,
          "APPROVED": 1,
          "REJECTED": 0,
          "CLOSED": 0
        },
        "pendingActionCount": 4,
        "actionableBreakdown": {
          "toStart": 2,
          "inProgress": 1,
          "needsCorrection": 1
        },
        "capacity": {
          "active": 4,
          "max": 3
        }
      }
    }
    ```
- **Status Codes:**
  - `200 OK`: Statistics retrieved successfully.
  - `400 Bad Request`: Query parameter validation error (`VALIDATION_ERROR`).
  - `401 Unauthorized`: Missing or invalid JWT token.
  - `403 Forbidden`: Authenticated user role is not authorized.
  - `500 Internal Server Error`: Generic internal server error (`INTERNAL_ERROR`).

## 9. Field Adjuster APIs

### `GET /users/adjusters`
- **Purpose:** Allow Claims Officer to retrieve Field Adjusters for map-based or list-based dispatch.
- **Authorized Roles:** `CLAIMS_OFFICER`
- **Authentication:** Required (JWT).
- **Request Parameters (Query):**
  - `status`: Optional filter (`available` | `all`, default: `all`).
  - `claimId`: Optional claim ObjectId. Uses claim's `incidentCoordinates` as proximity reference point.
  - `latitude`: Optional decimal number (-90..90) specifying direct reference latitude.
  - `longitude`: Optional decimal number (-180..180) specifying direct reference longitude.
- **Business Rules:**
  - The Backend calculates availability via a single `$lookup` aggregation. `AVAILABLE` if User status = `ACTIVE` AND the Field Adjuster has 3 or fewer active inspection tasks (`activeTasksCount <= 3`) across `ASSIGNED`, `IN_PROGRESS`, `CORRECTION_REQUIRED`. If `activeTasksCount > 3`, status is `UNAVAILABLE`.
  - When reference coordinates are supplied (via `claimId` or direct `latitude`/`longitude`), the Backend computes geodesic Haversine distance in kilometers (`distanceKm`, rounded to 2 decimals) from each adjuster's last-known location.
  - Adjusters are sorted ascending by `distanceKm`. Adjusters without reported location are placed at the end with `distanceKm: null`.
- **Success Response (200):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "adjuster-id",
        "name": "Ahmed Ali",
        "employeeCode": "FA-001",
        "role": "FIELD_ADJUSTER",
        "status": "ACTIVE",
        "availability": "AVAILABLE",
        "activeTasksCount": 1,
        "capacityLimit": 3,
        "location": {
          "latitude": 31.9038,
          "longitude": 35.2034,
          "updatedAt": "2026-09-14T07:25:00.000Z"
        },
        "distanceKm": 0.15
      }
    ]
  }
  ```

### `POST /claims/:claimId/assign`
- **Purpose:** Assign a Field Adjuster to a Claim (Two-Step Workflow Step 1).
- **Authorized Roles:** `CLAIMS_OFFICER`, `ADMIN`
- **Authentication:** Required (JWT).
- **Request Body:**
  ```json
  {
    "adjusterId": "651a1f8b7f1d2c001f8d4e92",
    "priority": "HIGH",
    "notes": "Please inspect ASAP",
    "overrideCapacity": false
  }
  ```
- **Business Rules:**
  - The Backend records `assignedTo`, `assignedBy`, `assignedAt`, `priority`, `assignmentNotes`.
  - Claim transitions to `PENDING_ACCEPTANCE`.
  - Fired notification of type `PENDING_ACCEPTANCE` to target adjuster.
  - Claims in `PENDING_ACCEPTANCE` do NOT count towards active adjuster capacity.
  - **Advisory Capacity Rule (Feature 18):** If the target adjuster has $> 3$ active assigned tasks (`ASSIGNED`, `IN_PROGRESS`, `CORRECTION_REQUIRED`) and `overrideCapacity` is absent or `false`, the request is rejected with `409 ADJUSTER_UNAVAILABLE`.
  - When `overrideCapacity: true` is sent, the assignment proceeds even if over capacity, and the audit timeline note is prefixed with:
    `"[CAPACITY OVERRIDE] Assigned while adjuster had <N> active tasks (max: 3)"`.
- **Validation rules (Rejects if):** Malformed MongoDB ObjectId format for `adjusterId` (must be 24-character hexadecimal, returns 400 `VALIDATION_ERROR`), Claim doesn't exist, Claim belongs to another org, User is not a Field Adjuster, Adjuster is inactive, Adjuster is over capacity without `overrideCapacity: true`, Claim is not in `NEW` status, Unauthorized user.
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Assignment pending acceptance",
    "data": {
      "id": "claim-uuid",
      "claimNumber": "CLM-DEMO-0001",
      "status": "PENDING_ACCEPTANCE",
      "assignedTo": "651a1f8b7f1d2c001f8d4e92",
      "priority": "HIGH"
    }
  }
  ```
- **Status Transition:** `NEW` → `PENDING_ACCEPTANCE`

### `POST /claims/:claimId/accept-assignment`
- **Purpose:** Field Adjuster accepts the pending claim assignment (Two-Step Workflow Step 2a).
- **Authorized Roles:** `FIELD_ADJUSTER` (strictly the assigned adjuster).
- **Authentication:** Required (JWT).
- **Request Body:** `{}` (empty object)
- **Preconditions:** Claim must be in `PENDING_ACCEPTANCE` status and assigned to calling adjuster. Returns 409 `INVALID_STATUS_TRANSITION` if status is not `PENDING_ACCEPTANCE`. Returns 404 if claim is not assigned to calling adjuster or belongs to another tenant.
- **Audit Timeline Event:**
  - `action`: `'Assignment Accepted'`
  - `previousStatus`: `'PENDING_ACCEPTANCE'`
  - `newStatus`: `'ASSIGNED'`
  - `notes`: `"[ASSIGNMENT ACCEPTED] by <employeeCode>"`
- **Push Notification:** Triggers push notification of type `ASSIGNED` to the assigned adjuster.
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Assignment accepted",
    "data": {
      "id": "claim-uuid",
      "claimNumber": "CLM-DEMO-0001",
      "status": "ASSIGNED",
      "assignedTo": "651a1f8b7f1d2c001f8d4e92"
    }
  }
  ```
- **Status Transition:** `PENDING_ACCEPTANCE` → `ASSIGNED`

### `POST /claims/:claimId/decline-assignment`
- **Purpose:** Field Adjuster declines a pending claim assignment, returning it to unassigned pool for re-dispatch (Two-Step Workflow Step 2b).
- **Authorized Roles:** `FIELD_ADJUSTER` (strictly the assigned adjuster).
- **Authentication:** Required (JWT).
- **Stealth-Tenancy & Authorization Rules:**
  - If called by `CLAIMS_OFFICER` or `ADMIN`: `403 Forbidden` (`Forbidden: Insufficient permissions`).
  - If called by an adjuster not assigned to the claim: `404 Not Found` (`Claim not found`).
  - If claim belongs to another organization: `404 Not Found` (`Claim not found`).
  - If claim is not in `PENDING_ACCEPTANCE` status (e.g. `ASSIGNED`, `IN_PROGRESS` or `NEW`): `409 Conflict` (`INVALID_STATUS_TRANSITION`).
- **Request Body:**
  ```json
  {
    "reason": "Vehicle mechanical breakdown on route"
  }
  ```
- **Validation Rules (400 Bad Request):**
  - `reason`: Required non-empty string after trimming, max 300 characters.
  - Missing/empty: `400 VALIDATION_ERROR` with details `"Reason is required"`.
  - Exceeds 300 chars: `400 VALIDATION_ERROR` with details `"Reason cannot exceed 300 characters"`.
- **State Mutations (Atomic):**
  - `status`: `PENDING_ACCEPTANCE` → `NEW`
  - `assignedTo`: `null`
  - `assignedBy`: `null`
  * `assignedAt`: `null`
  * `assignmentNotes`: `null`
- **Timeline Audit Event:**
  - `action`: `'Assignment Declined'`
  - `previousStatus`: `'PENDING_ACCEPTANCE'`
  - `newStatus`: `'NEW'`
  - `performedBy`: `req.user.userId`
  - `role`: `'FIELD_ADJUSTER'`
  - `notes`: `"[ASSIGNMENT DECLINED] by <employeeCode> — <reason>"`
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Assignment declined successfully",
    "data": {
      "id": "claim-uuid",
      "claimNumber": "CLM-DEMO-0001",
      "status": "NEW",
      "assignedTo": null,
      "assignedBy": null,
      "assignedAt": null,
      "assignmentNotes": null
    }
  }
  ```
- **Status Transition:** `PENDING_ACCEPTANCE` → `NEW`

## 10. Vehicle & Policy APIs

### `GET /vehicles/lookup`
- **Purpose:** Provide Mock Vehicle, Customer, and Policy information for Sprint 1.
- **Authorized Roles:** `FIELD_ADJUSTER`
- **Authentication:** Required (JWT).
- **Request Parameters:** `?plateNumber=ABC-1234`
- **Business Rules:** Mock Data is strictly accessed via the Backend (no direct client-to-insurance DB connections). 
- **Warning Condition:** If the retrieved policy is EXPIRED, it does not prevent the workflow, but should return a clear indication for the client.
- **Success Response (200):**
  ```json
  {
    "success": true,
    "data": {
      "vehicle": { "id": "v-uuid", "plateNumber": "ABC-1234", "make": "Toyota", "model": "Corolla", "year": 2022, "color": "White" },
      "customer": { "id": "c-uuid", "fullName": "John Doe", "phone": "0591234567" },
      "policy": { "id": "p-uuid", "policyNumber": "POL-102938", "status": "ACTIVE", "startDate": "2023-01-01", "expiryDate": "2024-01-01" }
    }
  }
  ```

### `POST /policies/verify`
- **Purpose:** Claims Officer or Admin verifies policy eligibility before creating a new claim (Intake Gate).
- **Authorized Roles:** `CLAIMS_OFFICER`, `ADMIN`
- **Authentication:** Required (JWT).
- **Request Body:**
  ```json
  {
    "policyNumber": "POL-1000",
    "plateNumber": "ABC-1234",
    "incidentDate": "2026-09-21"
  }
  ```
- **Validation Rules:**
  - `policyNumber` (string, optional if `plateNumber` provided, trimmed).
  - `plateNumber` (string, optional if `policyNumber` provided, trimmed).
  - At least one of `policyNumber` or `plateNumber` must be provided.
  - `incidentDate` (ISO 8601 string `YYYY-MM-DD`, optional, cannot be in the future).
- **Business Invariants:**
  - Enforces tenant isolation (policy and vehicle must belong to caller's `organizationId`).
  - Supports verification by `policyNumber`, `plateNumber`, or both.
  - Rejects policies that do not exist (404 `POLICY_NOT_FOUND`, cross-tenant stealth rejection).
  - Rejects vehicles that do not exist when querying by plate (404 `VEHICLE_NOT_FOUND`).
  - Rejects policies with status `CANCELLED` (422 `POLICY_CANCELLED`).
  - Rejects policies with status `EXPIRED` or past calendar expiryDate (422 `POLICY_EXPIRED`).
  - Validates `incidentDate` falls within `[startDate, expiryDate]` (422 `POLICY_NOT_ACTIVE_ON_DATE`).
  - Rejects `incidentDate` in the future (400 `INVALID_INCIDENT_DATE`).
  - Cross-matches `plateNumber` against the vehicle registered with the policy; rejects if plate mismatches or if policy has no vehicle record linked (422 `VEHICLE_MISMATCH`).
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Policy verified successfully",
    "data": {
      "isEligible": true,
      "policy": {
        "id": "policy-uuid",
        "policyNumber": "POL-1000",
        "status": "ACTIVE",
        "startDate": "2025-01-01T00:00:00.000Z",
        "expiryDate": "2026-12-31T23:59:59.999Z"
      },
      "vehicle": {
        "id": "vehicle-uuid",
        "plateNumber": "ABC-1234",
        "make": "Toyota",
        "model": "Camry",
        "year": 2022,
        "color": "White"
      },
      "customer": {
        "id": "customer-uuid",
        "fullName": "Ahmad Ali",
        "phone": "+962791234567"
      }
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`:
    - `VALIDATION_ERROR` (neither `policyNumber` nor `plateNumber` provided, or invalid date format).
    - `INVALID_INCIDENT_DATE` (incident date cannot be in the future).
  - `401 Unauthorized`: Missing or invalid JWT.
  - `403 Forbidden`: Authenticated user is not `CLAIMS_OFFICER` or `ADMIN`.
  - `404 Not Found`:
    - `POLICY_NOT_FOUND` (non-existent policy, vehicle has no linked policy, or cross-tenant stealth rejection).
    - `VEHICLE_NOT_FOUND` (vehicle not found with provided plate number).
  - `422 Unprocessable Entity`: `POLICY_EXPIRED`, `POLICY_CANCELLED`, `POLICY_NOT_ACTIVE_ON_DATE`, `VEHICLE_MISMATCH`.

## 11. Inspection APIs

### `POST /claims/:claimId/inspection/start`
- **Purpose:** Field Adjuster starts a new inspection or resumes an inspection after a correction request.
- **Authorized Roles:** `FIELD_ADJUSTER` (assigned adjuster only).
- **Authentication:** Required (JWT).
- **Preconditions:** Claim must be in status `ASSIGNED` or `CORRECTION_REQUIRED`. Attempting to start from any other status returns 409 `INVALID_STATUS_TRANSITION`.
- **Request Body:** None.
- **Timeline Event Generated:**
  - If previous status was `ASSIGNED`: `action: 'Inspection Started'`, `previousStatus: 'ASSIGNED'`, `newStatus: 'IN_PROGRESS'`.
  - If previous status was `CORRECTION_REQUIRED`: `action: 'Inspection Resumed'`, `previousStatus: 'CORRECTION_REQUIRED'`, `newStatus: 'IN_PROGRESS'`.
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Inspection started successfully",
    "data": {
      "status": "IN_PROGRESS"
    }
  }
  ```
- **Status Transition:** `ASSIGNED` | `CORRECTION_REQUIRED` → `IN_PROGRESS`

### `PUT /claims/:claimId/vehicle`
- **Purpose:** Field Adjuster associates the identified vehicle/policy/customer information with the Claim.
- **Authorized Roles:** `FIELD_ADJUSTER`
- **Authentication:** Required (JWT).
- **Request Body:**
  ```json
  {
    "vehicleId": "651a1f8b7f1d2c001f8d4e93",
    "policyId": "651a1f8b7f1d2c001f8d4e94",
    "customerId": "651a1f8b7f1d2c001f8d4e95",
    "plateNumber": "ABC-1234"
  }
  ```
- **Business Rules:** Verify claim belongs to the user's org, is assigned to the authenticated Field Adjuster, and is currently in `IN_PROGRESS` status. Rejects malformed `vehicleId`, `policyId`, or `customerId` with 400 `VALIDATION_ERROR` (must be valid 24-character hexadecimal MongoDB ObjectIds). No arbitrary changes to ownership allowed.

### `PUT /claims/:claimId/accident`
- **Purpose:** Update accident details on the Claim.
- **Authorized Roles:** `FIELD_ADJUSTER`
- **Authentication:** Required (JWT).
- **Request Body:**
  ```json
  {
    "accidentType": "REAR_END_COLLISION",
    "accidentDate": "2026-08-26",
    "accidentTime": "18:30",
    "description": "Rear ended at traffic light.",
    "damageDescription": "Bumper broken."
  }
  ```
- **Business Rules:** Claim must be in `IN_PROGRESS` status. Allowed types: `COLLISION`, `REAR_END_COLLISION`, `SIDE_IMPACT`, `PARKING_DAMAGE`, `OTHER`.

### `PUT /claims/:claimId/location`
- **Purpose:** Update the location associated with the Claim.
- **Authorized Roles:** `FIELD_ADJUSTER`
- **Authentication:** Required (JWT).
- **Request Body:**
  ```json
  {
    "latitude": 24.7136,
    "longitude": 46.6753,
    "address": "King Fahd Road, Riyadh",
    "capturedAt": "2026-08-26T18:45:00Z"
  }
  ```
- **Business Rules:** Claim must be in `IN_PROGRESS` status.

### `POST /claims/:claimId/evidence`
- **Purpose:** Field Adjuster uploads an inspection evidence photo (repeatable, additive).
- **Authorized Roles:** `FIELD_ADJUSTER` (assigned adjuster only).
- **Authentication:** Required (JWT).
- **Preconditions:** Claim must be in `IN_PROGRESS` status.
- **Content-Type:** `multipart/form-data`
- **Request Fields:**
  - `file`: Binary image file (JPEG, PNG, WEBP, max 10MB). Required.
  - `imageType`: String enum. Required. One of: `VEHICLE_FRONT`, `VEHICLE_REAR`, `VEHICLE_SIDE`, `DAMAGE_CLOSEUP`, `DRIVER_LICENSE`, `OTHER`.
- **Business Rules:** Files are stored in Cloudinary under `insurflow/${organizationId}/evidence`. Appends a new item to `claim.evidence` array and logs timeline event (`action: 'Evidence Uploaded'`, `notes: imageType`).
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Evidence uploaded successfully",
    "data": {
      "status": "IN_PROGRESS",
      "evidence": [
        {
          "imageType": "DAMAGE_CLOSEUP",
          "url": "https://res.cloudinary.com/...",
          "publicId": "insurflow/org-1/evidence/...",
          "uploadedBy": "60d0fe4f5311236168a109d0",
          "uploadedAt": "2026-09-11T08:00:00Z"
        }
      ]
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request` (`VALIDATION_ERROR`):
    ```json
    {
      "success": false,
      "message": "An image file is required",
      "errors": [
        {
          "code": "VALIDATION_ERROR",
          "details": "An image file is required"
        }
      ]
    }
    ```
    *(Also triggered for invalid `imageType`, files exceeding 10MB limit `"File size exceeds limit of 10MB"`, or unsupported MIME type `"Only JPEG, PNG, and WEBP images are allowed"`)*.
  - `401 Unauthorized` (`UNAUTHORIZED`):
    ```json
    {
      "success": false,
      "message": "Unauthorized access",
      "errors": [{ "code": "UNAUTHORIZED", "details": "Authentication token missing or invalid" }]
    }
    ```
  - `403 Forbidden` (`FORBIDDEN`):
    ```json
    {
      "success": false,
      "message": "Forbidden",
      "errors": [{ "code": "FORBIDDEN", "details": "Access restricted to FIELD_ADJUSTER" }]
    }
    ```
  - `404 Not Found` (`CLAIM_NOT_FOUND`):
    ```json
    {
      "success": false,
      "message": "Claim not found",
      "errors": [{ "code": "CLAIM_NOT_FOUND", "details": "Resource not found" }]
    }
    ```
    *(Returned when claim does not exist, belongs to another tenant, or is assigned to another adjuster)*.
  - `409 Conflict` (`INVALID_STATUS_TRANSITION`):
    ```json
    {
      "success": false,
      "message": "Claim is not in IN_PROGRESS status or not assigned to you",
      "errors": [{ "code": "INVALID_STATUS_TRANSITION", "details": "Claim is not in IN_PROGRESS status or not assigned to you" }]
    }
    ```

### `POST /claims/:claimId/signature`
- **Purpose:** Field Adjuster captures or re-captures the digital signature (singular, overwritable).
- **Authorized Roles:** `FIELD_ADJUSTER` (assigned adjuster only).
- **Authentication:** Required (JWT).
- **Preconditions:** Claim must be in `IN_PROGRESS` status.
- **Content-Type:** `multipart/form-data`
- **Request Fields:**
  - `file`: Binary image file (JPEG, PNG, WEBP, max 10MB). Required.
- **Business Rules:** File is stored in Cloudinary under `insurflow/${organizationId}/signatures`. Overwrites `claim.signature` object and logs timeline event (`action: 'Signature Captured'`).
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Signature captured successfully",
    "data": {
      "status": "IN_PROGRESS",
      "signature": {
        "url": "https://res.cloudinary.com/...",
        "publicId": "insurflow/org-1/signatures/...",
        "capturedBy": "60d0fe4f5311236168a109d0",
        "capturedAt": "2026-09-11T08:00:00Z"
      }
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request` (`VALIDATION_ERROR`):
    ```json
    {
      "success": false,
      "message": "An image file is required",
      "errors": [
        {
          "code": "VALIDATION_ERROR",
          "details": "An image file is required"
        }
      ]
    }
    ```
    *(Also triggered for files exceeding 10MB limit `"File size exceeds limit of 10MB"` or unsupported MIME type `"Only JPEG, PNG, and WEBP images are allowed"`)*.
  - `401 Unauthorized` (`UNAUTHORIZED`):
    ```json
    {
      "success": false,
      "message": "Unauthorized access",
      "errors": [{ "code": "UNAUTHORIZED", "details": "Authentication token missing or invalid" }]
    }
    ```
  - `403 Forbidden` (`FORBIDDEN`):
    ```json
    {
      "success": false,
      "message": "Forbidden",
      "errors": [{ "code": "FORBIDDEN", "details": "Access restricted to FIELD_ADJUSTER" }]
    }
    ```
  - `404 Not Found` (`CLAIM_NOT_FOUND`):
    ```json
    {
      "success": false,
      "message": "Claim not found",
      "errors": [{ "code": "CLAIM_NOT_FOUND", "details": "Resource not found" }]
    }
    ```
    *(Returned when claim does not exist, belongs to another tenant, or is assigned to another adjuster)*.
  - `409 Conflict` (`INVALID_STATUS_TRANSITION`):
    ```json
    {
      "success": false,
      "message": "Claim is not in IN_PROGRESS status or not assigned to you",
      "errors": [{ "code": "INVALID_STATUS_TRANSITION", "details": "Claim is not in IN_PROGRESS status or not assigned to you" }]
    }
    ```

### `POST /claims/:claimId/inspection/submit`
- **Purpose:** Submit the completed field inspection.
- **Authorized Roles:** `FIELD_ADJUSTER`
- **Authentication:** Required (JWT).
- **Business Rules:** Caller must be assigned adjuster and claim must be in `IN_PROGRESS` status. Backend validates all Five Mandatory Pillars:
  1. Vehicle (`claim.vehicle.vehicleId != null`)
  2. Accident (`claim.accident.accidentType != null`)
  3. Location (`claim.location.latitude != null && claim.location.longitude != null`)
  4. Evidence (`claim.evidence.length >= 1`)
  5. Signature (`claim.signature.url != null`)
  Returns 422 `INSPECTION_INCOMPLETE` if any pillar is missing.
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Inspection submitted successfully",
    "data": {
      "status": "SUBMITTED"
    }
  }
  ```
- **Status Transition:** `IN_PROGRESS` → `SUBMITTED`

## 12. Review & Decision APIs

### `POST /claims/:claimId/review/start`
- **Purpose:** Start the review of the submitted inspection.
- **Authorized Roles:** `CLAIMS_OFFICER`
- **Authentication:** Required (JWT).
- **Business Rules:** Verify authenticated user is Claims Officer, claim belongs to same organization, and claim is currently `SUBMITTED`.
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Review started",
    "data": {
      "status": "UNDER_REVIEW"
    }
  }
  ```
- **Status Transition:** `SUBMITTED` → `UNDER_REVIEW`

### `POST /claims/:claimId/review/request-correction`
- **Purpose:** Request changes on an inspection currently under review.
- **Authorized Roles:** `CLAIMS_OFFICER`
- **Authentication:** Required (JWT).
- **Preconditions:** Claim must be in `UNDER_REVIEW` status.
- **Request Body:**
  ```json
  {
    "notes": "Rear bumper damage description lacks detail. Please update narrative and re-verify plate."
  }
  ```
- **Validation Rules:** `notes` is required, non-empty trimmed string. Returns 400 `VALIDATION_ERROR` if empty.
- **Timeline Event Generated:**
  - `action`: `'Correction Requested'`
  - `previousStatus`: `'UNDER_REVIEW'`
  - `newStatus`: `'CORRECTION_REQUIRED'`
  - `notes`: Provided reason string
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Correction requested successfully",
    "data": {
      "status": "CORRECTION_REQUIRED"
    }
  }
  ```
- **Status Transition:** `UNDER_REVIEW` → `CORRECTION_REQUIRED`

### `POST /claims/:claimId/decision`
- **Purpose:** Make an adjudication decision on an `UNDER_REVIEW` claim. For `APPROVED` claims, calculates financial loss assessment, deductibles, and net payout.
- **Authorized Roles:** `CLAIMS_OFFICER`, `ADMIN`
- **Authentication:** Required (JWT).
- **Request Body (Approval with Loss Assessment):**
  ```json
  {
    "decision": "APPROVED",
    "notes": "Damage estimate confirmed by field inspection.",
    "lossAssessment": {
      "estimatedPartsCost": 1200.0,
      "laborCost": 800.0,
      "deductibleApplied": 500.0,
      "deductibleOverrideReason": null
    }
  }
  ```
- **Request Body (Rejection):**
  ```json
  {
    "decision": "REJECTED",
    "notes": "Incident details do not match physical evidence."
  }
  ```
- **Validation Rules:**
  - `decision`: Required, enum: `"APPROVED"`, `"REJECTED"`.
  - `notes`: Optional string.
  - `lossAssessment`:
    - **Forbidden** when `decision === "REJECTED"` (returns `400 VALIDATION_ERROR`).
    - **Optional** when `decision === "APPROVED"` under feature flag default (`REQUIRE_LOSS_ASSESSMENT=false`).
    - **Mandatory** when `decision === "APPROVED"` and `REQUIRE_LOSS_ASSESSMENT=true`.
    - Strict Numeric Types: Numeric fields (`estimatedPartsCost`, `laborCost`, `deductibleApplied`) must be JSON numbers, strictly rejecting string numbers like `"12.50"` (`400 VALIDATION_ERROR`).
    - Decimal Precision: Maximum 2 decimal places (e.g. `12.345` is rejected with `400 VALIDATION_ERROR`).
    - Bounds: Minimum `0`, Maximum `1,000,000`.
    - Disallowed Keys: Any unknown key (including `totalDamage`, `netApprovedPayout`, `policyDeductible`, `assessedBy`) is strictly rejected with `400 VALIDATION_ERROR`.
    - `deductibleOverrideReason`: Required string (length 5–300 after trim) if and only if `deductibleApplied` differs from `policyDeductible`. If equal, stored as `null`.
- **Financial Calculation & Business Rules:**
  - **Deductible Resolution Hierarchy:**
    1. Taken directly from `claim.coverageSnapshot.deductibleAmount` (0 extra database queries in standard flow).
    2. If `coverageSnapshot` is null (legacy claim), falls back to live policy query (`policy.deductibleAmount`).
    3. If live policy or deductible is missing/deleted, falls back safely to `0`.
  - **Damage Below Deductible Invariant:** If `totalDamage <= deductibleApplied`, the request is rejected with `422 DAMAGE_BELOW_DEDUCTIBLE`. The claim state remains in `UNDER_REVIEW`, no financial record is saved, and no audit timeline event is appended.
  - **Cents Arithmetic:** All computations are performed using integer cents (`Math.round(amount * 100)`) to eliminate binary floating point imprecision.
- **Success Response (200 - Approval with Loss Assessment):**
  ```json
  {
    "success": true,
    "message": "Decision recorded successfully",
    "data": {
      "id": "6aba6b317ba1dd7370dc525c",
      "claimNumber": "CLM-ALP-0001",
      "status": "APPROVED",
      "decisionNotes": "Damage estimate confirmed by field inspection.",
      "lossAssessment": {
        "estimatedPartsCost": 1200.0,
        "laborCost": 800.0,
        "totalDamage": 2000.0,
        "policyDeductible": 500.0,
        "deductibleApplied": 500.0,
        "deductibleOverrideReason": null,
        "netApprovedPayout": 1500.0,
        "currency": "ILS",
        "assessedAt": "2026-09-28T13:27:13.000Z",
        "assessedBy": "user-uuid"
      }
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: `VALIDATION_ERROR` (invalid decision enum, string numbers, > 2 decimals, negative amounts, > 1,000,000, unknown keys in lossAssessment, or `lossAssessment` present on `REJECTED`).
  - `404 Not Found`: `CLAIM_NOT_FOUND` (claim does not exist or belongs to another tenant organization).
  - `409 Conflict`: `INVALID_STATUS_TRANSITION` (claim is not in `UNDER_REVIEW` status, or concurrent decision race lost).
  - `422 Unprocessable Entity`:
    - `DAMAGE_BELOW_DEDUCTIBLE` (`totalDamage <= deductibleApplied`).
    - `OVERRIDE_REASON_REQUIRED` (`deductibleApplied !== policyDeductible` without valid `deductibleOverrideReason` of 5–300 chars).
- **Status Transition:** `UNDER_REVIEW` → `APPROVED` | `REJECTED`

## 13. Admin Closure API

### `POST /claims/:claimId/close`
- **Purpose:** Admin closes an approved Claim.
- **Authorized Roles:** `ADMIN`
- **Authentication:** Required (JWT).
- **Request Body:**
  ```json
  {
    "closingNotes": "Payout confirmed and case archived."
  }
  ```
- **Validation Rules:**
  - `closingNotes`: Optional string.
- **Business Rules:** Claim must belong to admin's organization and currently be in `APPROVED` status. Backend atomically records `closedBy`, `closedAt`, and `closingNotes`, and appends `'Claim Closed'` timeline event.
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Claim closed",
    "data": {
      "id": "claim-uuid",
      "claimNumber": "CLM-ORG-0001",
      "status": "CLOSED",
      "closedBy": "admin-uuid",
      "closedAt": "2026-09-08T00:00:00Z",
      "closingNotes": "Payout confirmed and case archived."
    }
  }
  ```
- **Status Transition:** `APPROVED` → `CLOSED`

## 14. Final Claim Report API

### `GET /claims/:claimId/report`
- **Purpose:** Download the publication-grade formatted PDF dossier for a finalized claim.
- **Authorized Roles:** `ADMIN`, `CLAIMS_OFFICER`
- **Authentication:** Required (JWT via `Authorization: Bearer <TOKEN>` or httpOnly cookie).
- **Path Parameters:**
  - `:claimId` (required): 24-character hexadecimal MongoDB ObjectId. Rejects malformed IDs with `400 VALIDATION_ERROR`.
- **Preconditions & Precedence:**
  - **404-before-409 Precedence:** Claim lookup is scoped strictly by caller's organization (`{ _id: claimId, organizationId: authUser.organizationId }`). If the claim does not exist or belongs to another organization, returns `404 CLAIM_NOT_FOUND` before validating lifecycle status.
  - **Terminal Status Invariant:** Claim must have reached a terminal decision status: `APPROVED`, `REJECTED`, or `CLOSED`. Any request on an in-flight status (`NEW`, `ASSIGNED`, `IN_PROGRESS`, `SUBMITTED`, `UNDER_REVIEW`, `CORRECTION_REQUIRED`) returns `409 INVALID_STATUS_TRANSITION`.
- **Success Response (200 OK):**
  - **Content Type:** `application/pdf` (binary buffer, starting with `%PDF` magic bytes).
  - **Headers:**
    - `Content-Type: application/pdf`
    - `Content-Disposition: attachment; filename="<claimNumber>-report.pdf"`
  - *Note: On success, the response body contains the raw PDF byte stream, not the standard JSON envelope.*
- **Error Responses (Standard JSON Envelope):**
  - `400 Bad Request` (`VALIDATION_ERROR`):
    ```json
    {
      "success": false,
      "message": "Validation error",
      "errors": [{ "code": "VALIDATION_ERROR", "details": "\"claimId\" with value \"...\" fails to match the required pattern" }]
    }
    ```
  - `401 Unauthorized` (`UNAUTHORIZED`): Missing, invalid, or expired JWT.
  - `403 Forbidden` (`FORBIDDEN_RESOURCE`): Authenticated user lacks access (e.g. `FIELD_ADJUSTER`).
  - `404 Not Found` (`CLAIM_NOT_FOUND`): Claim not found within caller's organization.
  - `409 Conflict` (`INVALID_STATUS_TRANSITION`):
    ```json
    {
      "success": false,
      "message": "Report is only available for claims with a final decision (APPROVED, REJECTED, or CLOSED).",
      "errors": [
        {
          "code": "INVALID_STATUS_TRANSITION",
          "details": "Report is only available for claims with a final decision (APPROVED, REJECTED, or CLOSED)."
        }
      ]
    }
    ```
  - `500 Internal Server Error` (`INTERNAL_ERROR`): Internal generation error (safe generic masking in production).

## 15. User Administration APIs (`ADMIN` only)

### `POST /users`
- **Purpose:** Create a new user (Officer or Adjuster) within the admin's organization.
- **Authorized Roles:** `ADMIN`
- **Authentication:** Required (JWT).
- **Request Body:**
  ```json
  {
    "name": "Kareem Officer",
    "employeeCode": "CO-002",
    "password": "SecurePassword123!",
    "role": "CLAIMS_OFFICER"
  }
  ```
- **Validation Rules:**
  - `name`: Required string.
  - `employeeCode`: Required string (must be unique within the organization).
  - `password`: Minimum 8 characters.
  - `role`: Must be either `CLAIMS_OFFICER` or `FIELD_ADJUSTER` (cannot create another `ADMIN`).
- **Success Response (201):**
  ```json
  {
    "success": true,
    "message": "User created successfully",
    "data": {
      "id": "user-uuid",
      "name": "Kareem Officer",
      "employeeCode": "CO-002",
      "role": "CLAIMS_OFFICER",
      "status": "ACTIVE",
      "createdAt": "2026-09-07T12:00:00Z"
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Validation error or attempting to create `ADMIN` role.
  - `409 Conflict`: `EMPLOYEE_CODE_TAKEN` if code already exists in organization.

### `GET /users`
- **Purpose:** List all users belonging to the admin's organization.
- **Authorized Roles:** `ADMIN`
- **Authentication:** Required (JWT).
- **Request Parameters:**
  - `role`: Optional role filter (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`). Returns 400 `VALIDATION_ERROR` for invalid role values.
  - `page`: Optional integer $\ge 1$ (default: `1`).
  - `limit`: Optional integer between $1$ and $100$ (default: `50`).
- **Pagination Headers (Response):**
  - `X-Total-Count`: Total number of matching users in organization.
  - `X-Page`: Current page number.
  - `X-Limit`: Items per page.
  - `X-Total-Pages`: Total page count.
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Users retrieved successfully",
    "data": [
      {
        "_id": "user-uuid",
        "name": "Ahmed Adjuster",
        "employeeCode": "FA-001",
        "role": "FIELD_ADJUSTER",
        "status": "ACTIVE",
        "createdAt": "2026-09-07T12:00:00Z"
      }
    ]
  }
  ```

### `PATCH /users/:userId`
- **Purpose:** Update user details (`name` and/or `employeeCode`).
- **Authorized Roles:** `ADMIN`
- **Authentication:** Required (JWT).
- **Path Parameters:** `:userId` (valid 24-character hex ObjectId).
- **Request Body:**
  ```json
  {
    "name": "Updated Name",
    "employeeCode": "FA-003"
  }
  ```
- **Validation Rules:**
  - `name`: Optional string, trimmed, non-empty.
  - `employeeCode`: Optional string, trimmed, non-empty (must be unique within the organization).
  - At least one field must be provided. Empty body `{}` is rejected.
  - Unknown/disallowed fields (`role`, `password`, `status`, `organizationId`) return `400 VALIDATION_ERROR`.
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "User updated successfully",
    "data": {
      "id": "user-uuid",
      "name": "Updated Name",
      "employeeCode": "FA-003",
      "role": "FIELD_ADJUSTER",
      "status": "ACTIVE",
      "createdAt": "2026-09-07T12:00:00Z",
      "updatedAt": "2026-09-12T12:40:00Z"
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Invalid ID format, empty body, or invalid/disallowed fields.
  - `401 Unauthorized`: Missing or invalid authentication token.
  - `403 Forbidden`: Non-admin role attempting the update.
  - `404 Not Found`: User not found in this organization (tenant isolation).
  - `409 Conflict`: `EMPLOYEE_CODE_TAKEN` if the new employee code is already taken in this organization.

### `PATCH /users/:userId/status`
- **Purpose:** Activate or deactivate a user account.
- **Authorized Roles:** `ADMIN`
- **Authentication:** Required (JWT).
- **Path Parameters:** `:userId` (valid 24-character hex ObjectId).
- **Request Body:**
  ```json
  {
    "status": "INACTIVE"
  }
  ```
- **Validation Rules:** `status` must be either `ACTIVE` or `INACTIVE`.
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "User status updated successfully",
    "data": {
      "id": "user-uuid",
      "status": "INACTIVE"
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Invalid ID format or invalid status value.
  - `404 Not Found`: User not found in this organization.

### `PATCH /users/:userId/reset-password`
- **Purpose:** Administratively reset a user's password.
- **Authorized Roles:** `ADMIN`
- **Authentication:** Required (JWT).
- **Path Parameters:** `:userId` (valid 24-character hex ObjectId).
- **Request Body:**
  ```json
  {
    "newPassword": "BrandNewPassword123!"
  }
  ```
- **Validation Rules:** `newPassword` minimum 8 characters.
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "User password reset successfully",
    "data": {
      "id": "user-uuid",
      "message": "Password reset successfully"
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Invalid ID format or password too short.
  - `404 Not Found`: User not found in this organization.

### `PATCH /users/me/fcm-token`
- **Purpose:** Register or update Firebase Cloud Messaging (FCM) device push token for the authenticated user.
- **Authorized Roles:** All authenticated roles (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`).
- **Authentication:** Required (JWT).
- **Request Body:**
  ```json
  {
    "fcmToken": "c7x...-fcm-device-registration-token"
  }
  ```
- **Validation Rules:** `fcmToken` (string, required, non-empty, trimmed).
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Device token updated successfully",
    "data": {
      "id": "673f1a2b3c4d5e6f7a8b9c0d",
      "fcmToken": "c7x...-fcm-device-registration-token"
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Missing or empty `fcmToken`.
  - `401 Unauthorized`: Missing, invalid, or expired JWT.

### `GET /notifications`
- **Purpose:** Paginated list of notifications for the authenticated user, ordered newest first (`createdAt: -1`).
- **Authorized Roles:** All authenticated roles (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`).
- **Authentication:** Required (JWT).
- **Query Parameters:**
  - `page` (integer, optional, default: 1, min: 1)
  - `limit` (integer, optional, default: 50, min: 1, max: 100)
  - `unreadOnly` (boolean, optional, default: false). When `true`, returns only records where `readAt == null`.
- **Response Headers:** `X-Total-Count`, `X-Page`, `X-Limit`, `X-Total-Pages`.
- **Populated Fields:** `relatedClaimId` is populated with `claimNumber` at read time (`claimNumber` is never stored on the notification document).
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Notifications retrieved successfully",
    "data": [
      {
        "_id": "673f8a45b12c3d0012ef3456",
        "recipientId": "673f8a45b12c3d0012ef3401",
        "organizationId": "673f8a45b12c3d0012ef3400",
        "type": "NEW_CLAIM",
        "relatedClaimId": {
          "_id": "673f8a45b12c3d0012ef3410",
          "claimNumber": "CLM-ALPHA-0042"
        },
        "title": "New Claim Created",
        "body": "New claim CLM-ALPHA-0042 has been created.",
        "readAt": null,
        "createdAt": "2026-09-23T19:00:00.000Z"
      }
    ]
  }
  ```

### `GET /notifications/unread-count`
- **Purpose:** Fast unread notification badge counter for the authenticated user.
- **Authorized Roles:** All authenticated roles (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`).
- **Authentication:** Required (JWT).
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Unread count retrieved successfully",
    "data": {
      "count": 4
    }
  }
  ```

### `PATCH /notifications/:id/read`
- **Purpose:** Mark a notification as read (sets `readAt` to current timestamp).
- **Authorized Roles:** All authenticated roles (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`).
- **Authentication:** Required (JWT).
- **Parameters:** `:id` — 24-character hexadecimal MongoDB ObjectId.
- **Idempotency:** If already read, returns the existing document unmodified without altering `readAt`.
- **Stealth Tenancy:** Returns 404 `NOTIFICATION_NOT_FOUND` if the notification does not exist or belongs to another user/tenant.
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Notification marked as read",
    "data": {
      "_id": "673f8a45b12c3d0012ef3456",
      "recipientId": "673f8a45b12c3d0012ef3401",
      "organizationId": "673f8a45b12c3d0012ef3400",
      "type": "NEW_CLAIM",
      "relatedClaimId": {
        "_id": "673f8a45b12c3d0012ef3410",
        "claimNumber": "CLM-ALPHA-0042"
      },
      "title": "New Claim Created",
      "body": "New claim CLM-ALPHA-0042 has been created.",
      "readAt": "2026-09-23T19:15:30.123Z",
      "createdAt": "2026-09-23T19:00:00.000Z"
    }
  }
  ```

## 16. Request/Response Models
*Conceptual entities represented in the APIs. Not meant to map exactly 1:1 to database schema.*
- **User:** `id`, `name`, `employeeCode`, `role`, `organizationId`, `status`, `fcmToken`.
- **Notification:** `id`, `recipientId`, `organizationId`, `type`, `relatedClaimId`, `title`, `body`, `readAt`, `createdAt`.
- **Organization:** `id`, `name`, `code`.
- **Claim:** `id`, `claimNumber`, `status`, `organizationId`, `createdBy`, `assignedTo`, `assignedBy`, `assignedAt`, `closedBy`, `closedAt`, `customer`, `vehicle`, `policy`, `accident`, `location`, `evidence`, `signature`.
- **TimelineEvent:** `action`, `performedBy`, `role`, `timestamp`.

## 17. Error Contract
- Error responses align with the utility found in `src/utils/apiResponse.js`.
- Common HTTP Status Codes: `400`, `401`, `403`, `404`, `409`, `422`, `429`, `500`.
- Common Error Codes: `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `UNAUTHORIZED`, `FORBIDDEN`, `CLAIM_NOT_FOUND`, `ADJUSTER_NOT_FOUND`, `ADJUSTER_UNAVAILABLE`, `INVALID_STATUS_TRANSITION`, `CLAIM_NOT_ASSIGNED`, `POLICY_EXPIRED`, `POLICY_NOT_FOUND`, `POLICY_CANCELLED`, `POLICY_NOT_ACTIVE_ON_DATE`, `VEHICLE_NOT_FOUND`, `VEHICLE_MISMATCH`, `INVALID_INCIDENT_DATE`, `TOO_MANY_REQUESTS`.

## 18. Status Transitions
The backend is the sole authority enforcing these transitions:
- `NEW` → `ASSIGNED` (by Claims Officer)
- `ASSIGNED` → `SUBMITTED` (by Field Adjuster)
- `SUBMITTED` → `UNDER_REVIEW` (by Claims Officer)
- `UNDER_REVIEW` → `APPROVED` (by Claims Officer)
- `APPROVED` → `CLOSED` (by Admin)

## 19. Mobile/Web Responsibilities
- **WEB Dashboard:** Login, Create Claim, View Claims, View Adjusters, Assign Adjuster, Start Review, Make Decision, Admin Close, Download Final Claim Report.
- **MOBILE App:** Login, View assigned Claims, Open Claim, Perform inspection, Vehicle/Policy lookup, Accident data, Location, Evidence, Signature, Submit inspection.
- **BACKEND System:** Authentication, Authorization, Organization isolation, Business validation, Claim lifecycle, Assignment, Data persistence, Mock lookup, Status transitions, Audit events, PDF Report generation.

## 20. Mock Data Rules
- Mock insurance data is accessed **through Backend APIs** (`GET /vehicles/lookup`).
- Flutter never communicates directly with a future insurance-company database.
- Backend resolves and merges the data.

## 21. Open Decisions / Requires Team Decision // out of the sprint 1
- **Location Payload Definition (Resolved in Feature 18):** The system separates "Accident Location Address" (`claim.incidentLocation`), "Accident Incident Coordinates" (`claim.incidentCoordinates: { latitude, longitude, capturedAt }` captured at creation via optional `latitude`/`longitude` in `POST /claims`), and "Inspection Location" GPS captured by the field adjuster on-site during inspection via `PUT /claims/:claimId/location` into `claim.location`. They are strictly separate data structures with independent lifecycles.
- **Digital Signature Flow (Resolved in Feature 15):** The signature is uploaded as an image file to Cloudinary and persisted in `claim.signature`.
- **Evidence Formatting (Resolved in Feature 15):** Photo evidence is uploaded to Cloudinary, validated by `imageType` enum, and stored in `claim.evidence`.

## 22. Public Claim Tracking (Feature 23)

### `GET /api/v1/public/claims/track/:trackingToken`

**Authentication:** None — this is a public, unauthenticated endpoint.

**Purpose:** Allows insurance claimants to track the progress of their claim via a unique tracking URL without logging in.

**Token Format:** 64-character lowercase hexadecimal string (256-bit cryptographic random).

**Rate Limiting:** Subject to the global `apiLimiter` (300 req/15min per IP).

**Response Headers:** `Cache-Control: no-store`, `Pragma: no-cache`.

#### Success Response (200)

```json
{
  "success": true,
  "message": "Claim status retrieved successfully",
  "data": {
    "claimNumber": "CLM-ORG1-0001",
    "status": "IN_PROGRESS",
    "statusDescription": "Your claim is being inspected.",
    "customerName": "Ahmad",
    "incidentType": "COLLISION",
    "createdAt": "2026-09-20T10:30:00.000Z",
    "updatedAt": "2026-09-25T14:00:00.000Z",
    "timeline": [
      { "label": "Claim Received", "timestamp": "2026-09-20T10:30:00.000Z" },
      { "label": "Inspector Assigned", "timestamp": "2026-09-21T09:00:00.000Z" }
    ]
  }
}
```

#### Error Response (404 — any invalid/unknown/malformed token)

```json
{
  "success": false,
  "message": "Claim not found"
}
```

#### Customer-Friendly Status Mapping

| Internal | Public | Description |
|---|---|---|
| `NEW` | `RECEIVED` | Your claim has been received and is being processed. |
| `PENDING_ACCEPTANCE` | `RECEIVED` | Your claim has been received and is being processed. |
| `ASSIGNED` | `IN_PROGRESS` | An inspector has been assigned to your claim. |
| `IN_PROGRESS` | `IN_PROGRESS` | Your claim is being inspected. |
| `SUBMITTED` | `IN_REVIEW` | Your inspection is complete and under review. |
| `UNDER_REVIEW` | `IN_REVIEW` | Your inspection is complete and under review. |
| `CORRECTION_REQUIRED` | `IN_PROGRESS` | Additional information is being gathered. |
| `APPROVED` | `APPROVED` | Your claim has been approved. |
| `REJECTED` | `REJECTED` | Your claim has been declined. |
| `CLOSED` | `CLOSED` | Your claim has been finalized and closed. |

#### Tracking Token Lifecycle

- Generated automatically at claim creation (`POST /api/v1/claims`)
- Returned in the `createClaim` response as `trackingToken`
- Staff shares the tracking URL with the customer
- No expiration or revocation in current version

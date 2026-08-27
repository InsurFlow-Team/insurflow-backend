# InsurFlow API Contract

## 1. Purpose
This document defines the API contract between the InsurFlow Backend, Web Dashboard, and Flutter Mobile Application. It serves as the shared agreement for the Sprint 1 scope, reflecting the new business workflow.

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

## 3. Authentication
The API uses JWT-based authentication. The context containing user identity, role, and organization is securely extracted by the Backend from the access token.

## 4. Roles & Authorization
- **ADMIN:** Administrative operations, Final claim closure.
- **CLAIMS_OFFICER:** Create Claim, List organization Claims, View Claim Details, View available Field Adjusters, Assign Field Adjuster, Start Claim Review, Make Claim decision.
- **FIELD_ADJUSTER:** View Claims assigned to them, View assigned Claim Details, Perform inspection, Submit inspection.

*(No additional permissions are invented outside of these scopes).*

## 5. Multi-Tenancy
- InsurFlow is a multi-tenant platform serving multiple organizations.
- Every authenticated user belongs to an Organization.
- Every Claim belongs to an Organization.
- **Rule:** The client must NOT send `organizationId` as a trusted value in requests.
- **Rule:** The Backend obtains `organizationId` from the authenticated user context (`req.user.organizationId`).
- Organization isolation must apply to all Claim-related operations (reading, writing, and transitioning).

## 6. Claim Lifecycle
Valid status enum: `NEW`, `ASSIGNED`, `SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, `CLOSED`.

Valid status transitions (enforced by the Backend):
- `Create Claim` → `NEW`
- `Assign Adjuster` → `ASSIGNED`
- `Submit Inspection` → `SUBMITTED`
- `Start Review` → `UNDER_REVIEW`
- `Approve` → `APPROVED`
- `Admin Close` → `CLOSED`

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

## 8. Claims APIs

### `POST /claims`
- **Purpose:** Claims Officer creates an initial Claim.
- **Authorized Roles:** `CLAIMS_OFFICER`
- **Authentication:** Required (JWT).
- **Request Body:**
  ```json
  {
    "customerName": "John Doe",
    "customerPhone": "0591234567",
    "initialPlateNumber": "ABC-1234",
    "incidentType": "COLLISION",
    "incidentLocation": "Main St, Riyadh"
  }
  ```
- **Business Rules:** The Backend automatically determines `organizationId`, `createdBy`, `createdAt`, and `status`. The client must not attempt to control these values.
- **Success Response (201):**
  ```json
  {
    "success": true,
    "message": "Claim created successfully",
    "data": {
      "id": "claim-uuid",
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
- **Filtering Behavior:**
  - `CLAIMS_OFFICER`: Returns organization-wide Claims.
  - `FIELD_ADJUSTER`: Returns only Claims assigned to the authenticated user.
  - `ADMIN`: Returns Claims according to administrative permissions.
- **Success Response (200):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "claim-uuid",
        "status": "NEW",
        "customerName": "John Doe",
        "initialPlateNumber": "ABC-1234",
        "createdAt": "2026-08-26T15:00:00Z"
      }
    ]
  }
  ```

### `GET /claims/:claimId`
- **Purpose:** Retrieve detailed Claim information.
- **Authorized Roles:** `CLAIMS_OFFICER`, `FIELD_ADJUSTER`, `ADMIN`
- **Authentication:** Required (JWT).
- **Business Rules:** Scope applies based on organization isolation and assignment rules.
- **Success Response (200):** *(Note: Fields like vehicle, accident, evidence will be null or omitted until populated during the inspection)*
  ```json
  {
    "success": true,
    "data": {
      "id": "claim-uuid",
      "status": "ASSIGNED",
      "customer": { "name": "John Doe", "phone": "0591234567" },
      "vehicle": { "plateNumber": "ABC-1234" },
      "assignment": { 
        "assignedTo": "adjuster-id", 
        "assignedBy": "officer-id", 
        "assignedAt": "2026-08-26T15:10:00Z" 
      },
      "timeline": [
        { "action": "Claim Created", "performedBy": "officer-id", "role": "CLAIMS_OFFICER", "timestamp": "2026-08-26T15:00:00Z" }
      ],
      "createdAt": "2026-08-26T15:00:00Z"
    }
  }
  ```

## 9. Field Adjuster APIs

### `GET /users/adjusters`
- **Purpose:** Allow Claims Officer to retrieve Field Adjusters available for assignment.
- **Authorized Roles:** `CLAIMS_OFFICER`
- **Authentication:** Required (JWT).
- **Request Parameters:** `?status=available` (optional filter).
- **Business Rules:** The Backend calculates availability. AVAILABLE if User status = `ACTIVE` AND the Field Adjuster has no active inspection task in `ASSIGNED` or `IN_PROGRESS`. 
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
        "activeTasksCount": 0
      }
    ]
  }
  ```

### `POST /claims/:claimId/assign`
- **Purpose:** Assign a Field Adjuster to a Claim.
- **Authorized Roles:** `CLAIMS_OFFICER`
- **Authentication:** Required (JWT).
- **Request Body:**
  ```json
  {
    "adjusterId": "adjuster-uuid",
    "priority": "HIGH",
    "notes": "Please inspect ASAP"
  }
  ```
- **Business Rules:** The Backend records `assignedTo`, `assignedBy`, `assignedAt`.
- **Validation rules (Rejects if):** Claim doesn't exist, Claim belongs to another org, User is not a Field Adjuster, Adjuster is inactive/unavailable, Claim is not in `NEW` status, Unauthorized user.
- **Success Response (200):**
  ```json
  {
    "success": true,
    "message": "Adjuster assigned successfully",
    "data": { "status": "ASSIGNED" }
  }
  ```
- **Status Transition:** `NEW` → `ASSIGNED`

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

## 11. Inspection APIs

### `PUT /claims/:claimId/vehicle`
- **Purpose:** Field Adjuster associates the identified vehicle/policy/customer information with the Claim.
- **Authorized Roles:** `FIELD_ADJUSTER`
- **Authentication:** Required (JWT).
- **Request Body:**
  ```json
  {
    "vehicleId": "v-uuid",
    "policyId": "p-uuid",
    "customerId": "c-uuid",
    "plateNumber": "ABC-1234"
  }
  ```
- **Business Rules:** Verify claim belongs to the user's org, is assigned to the authenticated Field Adjuster, and is in a valid state. No arbitrary changes to ownership allowed.

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
- **Business Rules:** Allowed types: `COLLISION`, `REAR_END_COLLISION`, `SIDE_IMPACT`, `PARKING_DAMAGE`, `OTHER`.

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

### `POST /claims/:claimId/inspection/submit`
- **Purpose:** Submit the completed field inspection.
- **Authorized Roles:** `FIELD_ADJUSTER`
- **Authentication:** Required (JWT).
- **Business Rules:** Backend validates required inspection information (Vehicle, Policy, Accident, Location, Evidence, Signature). Returns validation error if incomplete. If valid, timeline event is created.
- **Success Response (200):**
  ```json
  { "success": true, "message": "Inspection submitted successfully", "data": { "status": "SUBMITTED" } }
  ```
- **Status Transition:** `ASSIGNED` → `SUBMITTED`

## 12. Review & Decision APIs

### `POST /claims/:claimId/review/start`
- **Purpose:** Start the review of the submitted inspection.
- **Authorized Roles:** `CLAIMS_OFFICER`
- **Authentication:** Required (JWT).
- **Business Rules:** Verify authenticated user is Claims Officer, claim belongs to same organization, and claim is currently `SUBMITTED`.
- **Success Response (200):**
  ```json
  { "success": true, "message": "Review started", "data": { "status": "UNDER_REVIEW" } }
  ```
- **Status Transition:** `SUBMITTED` → `UNDER_REVIEW`

### `POST /claims/:claimId/decision`
- **Purpose:** Make a decision on the Claim.
- **Authorized Roles:** `CLAIMS_OFFICER`
- **Authentication:** Required (JWT).
- **Request Body:**
  ```json
  {
    "decision": "APPROVED",
    "reviewNotes": "Looks good."
  }
  ```
- **Business Rules:** Claim must be `UNDER_REVIEW`. (Note: `REJECTED` is NOT implemented in Sprint 1 unless explicitly approved by the team).
- **Success Response (200):**
  ```json
  { "success": true, "message": "Claim approved", "data": { "status": "APPROVED" } }
  ```
- **Status Transition:** `UNDER_REVIEW` → `APPROVED`

## 13. Admin Closure API

### `POST /claims/:claimId/close`
- **Purpose:** Admin closes the Claim.
- **Authorized Roles:** `ADMIN`
- **Authentication:** Required (JWT).
- **Request Body:**
  ```json
  {
    "closingNotes": "Finalized and archived."
  }
  ```
- **Business Rules:** Claim must be `APPROVED`. Backend records `closedBy` and `closedAt`.
- **Success Response (200):**
  ```json
  { "success": true, "message": "Claim closed", "data": { "status": "CLOSED" } }
  ```
- **Status Transition:** `APPROVED` → `CLOSED`

## 14. Request/Response Models
*Conceptual entities represented in the APIs. Not meant to map exactly 1:1 to database schema.*
- **User:** `id`, `name`, `employeeCode`, `role`, `organizationId`, `status`.
- **Organization:** `id`, `name`, `code`.
- **Claim:** `id`, `claimNumber`, `status`, `organizationId`, `createdBy`, `assignedTo`, `assignedBy`, `assignedAt`, `closedBy`, `closedAt`, `customer`, `vehicle`, `policy`, `accident`, `location`, `evidence`, `signature`.
- **TimelineEvent:** `action`, `performedBy`, `role`, `timestamp`.

## 15. Error Contract
- Error responses align with the utility found in `src/utils/apiResponse.js`.
- Common HTTP Status Codes: `400`, `401`, `403`, `404`, `409`, `422`, `500`.
- Common Error Codes: `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `UNAUTHORIZED`, `FORBIDDEN`, `CLAIM_NOT_FOUND`, `ADJUSTER_NOT_FOUND`, `ADJUSTER_UNAVAILABLE`, `INVALID_STATUS_TRANSITION`, `CLAIM_NOT_ASSIGNED`, `POLICY_EXPIRED`.

## 16. Status Transitions
The backend is the sole authority enforcing these transitions:
- `NEW` → `ASSIGNED` (by Claims Officer)
- `ASSIGNED` → `SUBMITTED` (by Field Adjuster)
- `SUBMITTED` → `UNDER_REVIEW` (by Claims Officer)
- `UNDER_REVIEW` → `APPROVED` (by Claims Officer)
- `APPROVED` → `CLOSED` (by Admin)

## 17. Mobile/Web Responsibilities
- **WEB Dashboard:** Login, Create Claim, View Claims, View Adjusters, Assign Adjuster, Start Review, Make Decision, Admin Close.
- **MOBILE App:** Login, View assigned Claims, Open Claim, Perform inspection, Vehicle/Policy lookup, Accident data, Location, Evidence, Signature, Submit inspection.
- **BACKEND System:** Authentication, Authorization, Organization isolation, Business validation, Claim lifecycle, Assignment, Data persistence, Mock lookup, Status transitions, Audit events.

## 18. Mock Data Rules
- Mock insurance data is accessed **through Backend APIs** (`GET /vehicles/lookup`).
- Flutter never communicates directly with a future insurance-company database.
- Backend resolves and merges the data.

## 19. Open Decisions / Requires Team Decision // out of the sprint 1
- **Location Payload Definition:** The system supports "Accident Location" and "Inspection Location". The current `PUT /claims/:claimId/location` contract assumes a single location object. The team needs to decide if these will be separate nested objects or separate endpoints.
- **Digital Signature Flow:** How the signature is uploaded/persisted (e.g., base64 vs. file upload) is not strictly defined in this document yet.
- **Evidence Formatting:** The exact validation rules for required evidence files.

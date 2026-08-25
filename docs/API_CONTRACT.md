# InsurFlow API Contract - Sprint 1

This document defines the official API contract for the InsurFlow backend for Sprint 1.

**Base URL:** `/api/v1`

## Core Architectural Principles

### 1. Multi-Tenancy & Authorization
- Every business Claim belongs to exactly one Organization.
- Every authenticated user belongs to an Organization.
- The Organization (`organizationId`), User (`userId`), and Role (`role`) are determined securely from the authenticated backend context (JWT token).
- **Security Rule:** Clients must NEVER send `organizationId`, `createdBy`, or `role` in any requests. The backend ignores or rejects these if provided.
- Claims queries must always be strictly scoped to the authenticated user's Organization.

### 2. Local Drafts
- **Local Drafts are a Mobile responsibility.**
- Drafts do NOT exist in the Backend in Sprint 1. They are stored locally on the device.
- There are NO endpoints like `POST /drafts`, `GET /drafts`, or `PATCH /drafts`. The backend only receives a claim when it is fully submitted.

### 3. API Response Convention
All endpoints follow a consistent JSON response structure to ensure simple consumption by Flutter and React clients.

#### Success Response
```json
{
  "success": true,
  "message": "Optional success message",
  "data": { ... }
}
```

#### Error Response
```json
{
  "success": false,
  "message": "Error description",
  "errors": [ ... ] 
}
```
*(The `errors` array is optional and can contain detailed validation rule violations).*

### 4. Standard HTTP Error Codes
- `400 Bad Request`: Validation errors or malformed payload.
- `401 Unauthorized`: Missing or invalid authentication token.
- `403 Forbidden`: Authenticated, but insufficient role permissions.
- `404 Not Found`: The requested resource does not exist.
- `409 Conflict`: Resource state conflict (e.g., trying to start review on a claim not in SUBMITTED state).
- `422 Validation Error`: Business validation rules failed.
- `500 Internal Server Error`: Unexpected backend error.

## Endpoint Authorization Matrix

| Endpoint | Authentication Required | Allowed Roles | Organization Isolation |
|----------|-------------------------|---------------|------------------------|
| `POST /auth/login` | No | Any valid user | N/A |
| `GET /vehicle-policy/lookup` | Yes | `FIELD_ADJUSTER` | N/A (Mock Data Lookup) |
| `POST /claims` | Yes | `FIELD_ADJUSTER` | Auto-associated with User's Org |
| `GET /claims` | Yes | `CLAIMS_OFFICER` | Scoped to User's Org |
| `GET /claims/:claimId` | Yes | `CLAIMS_OFFICER` | Scoped to User's Org |
| `PATCH /claims/:claimId/status`| Yes | `CLAIMS_OFFICER` | Scoped to User's Org |

*(Note: The ADMIN role exists conceptually but has no specific endpoints in Sprint 1).*

---

## 1. Authentication

### `POST /api/v1/auth/login`
Authenticates a user and returns a JWT access token along with context data.

#### Request Body (application/json)
- `organizationCode` (String, Required)
- `employeeCode` (String, Required)
- `password` (String, Required)

```json
{
  "organizationCode": "INS-A",
  "employeeCode": "FA-001",
  "password": "********"
}
```

#### Successful Response (200 OK)
```json
{
  "success": true,
  "data": {
    "accessToken": "jwt-token",
    "user": {
      "id": "101",
      "name": "Ahmed Ali",
      "employeeCode": "FA-001",
      "role": "FIELD_ADJUSTER",
      "organizationId": "ORG-01",
      "organizationName": "Insurance Company A"
    }
  }
}
```

---

## 2. Vehicle & Policy Lookup

### `GET /api/v1/vehicle-policy/lookup`
Retrieves mock Vehicle, Customer, and Policy information based on a plate number.

#### Query Parameters
- `plateNumber` (String, Required): The plate number to look up.

#### Successful Response (200 OK)
```json
{
  "success": true,
  "data": {
    "vehicle": {
      "plateNumber": "ABC-1234",
      "make": "Toyota",
      "model": "Camry",
      "year": 2022,
      "color": "White"
    },
    "customer": {
      "name": "John Doe",
      "phone": "+1234567890"
    },
    "policy": {
      "policyNumber": "POL-987654321",
      "status": "ACTIVE",
      "startDate": "2023-01-01",
      "expiryDate": "2024-01-01"
    }
  }
}
```
*Note on Policy Status:* Allowed statuses are `ACTIVE` and `EXPIRED`. An `EXPIRED` policy does NOT prevent claim creation in Sprint 1, but the frontend should display a warning.

---

## 3. Claim Submission

### `POST /api/v1/claims`
Submits a finalized claim from the Field Adjuster's mobile application.

#### Request Body (application/json)
All top-level keys (`vehicle`, `customer`, `policy`, `accident`, `location`) are required.

```json
{
  "vehicle": {
    "plateNumber": "ABC-1234",
    "make": "Toyota",
    "model": "Camry",
    "year": 2022,
    "color": "White"
  },
  "customer": {
    "name": "John Doe",
    "phone": "+1234567890"
  },
  "policy": {
    "policyNumber": "POL-987654321",
    "status": "ACTIVE",
    "startDate": "2023-01-01",
    "expiryDate": "2024-01-01"
  },
  "accident": {
    "type": "COLLISION", 
    "date": "2023-10-25",
    "time": "14:30",
    "description": "Rear ended at a stop light"
  },
  "location": {
    "accidentLocation": {
      "street": "Main St",
      "area": "Downtown",
      "latitude": 34.0522,
      "longitude": -118.2437
    },
    "inspectionLocation": {
      "street": "Main St",
      "area": "Downtown",
      "latitude": 34.0522,
      "longitude": -118.2437
    }
  }
}
```

*Accident Type Enum:* `COLLISION`, `REAR_END_COLLISION`, `SIDE_IMPACT`, `PARKING_DAMAGE`, `OTHER`

#### Successful Response (201 Created)
```json
{
  "success": true,
  "message": "Claim submitted successfully",
  "data": {
    "claimNumber": "CLM-0001",
    "status": "SUBMITTED"
  }
}
```

---

## 4. Claims List

### `GET /api/v1/claims`
Retrieves a list of claims scoped automatically to the authenticated Claims Officer's Organization.

#### Successful Response (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "claimNumber": "CLM-0001",
      "vehiclePlateNumber": "ABC-1234",
      "status": "SUBMITTED",
      "updatedAt": "2023-10-25T15:00:00Z"
    }
  ]
}
```

---

## 5. Claim Details

### `GET /api/v1/claims/:claimId`
Retrieves full details of a specific claim. Backend verifies the claim belongs to the user's organization.

#### Successful Response (200 OK)
```json
{
  "success": true,
  "data": {
    "claimNumber": "CLM-0001",
    "status": "SUBMITTED",
    "vehicle": {
      "plateNumber": "ABC-1234",
      "make": "Toyota",
      "model": "Camry",
      "year": 2022,
      "color": "White"
    },
    "customer": {
      "name": "John Doe",
      "phone": "+1234567890"
    },
    "policy": {
      "policyNumber": "POL-987654321",
      "status": "ACTIVE",
      "startDate": "2023-01-01",
      "expiryDate": "2024-01-01"
    },
    "accident": {
      "type": "COLLISION",
      "date": "2023-10-25",
      "time": "14:30",
      "description": "Rear ended at a stop light"
    },
    "location": {
      "accidentLocation": {
        "street": "Main St",
        "area": "Downtown",
        "latitude": 34.0522,
        "longitude": -118.2437
      },
      "inspectionLocation": {
        "street": "Main St",
        "area": "Downtown",
        "latitude": 34.0522,
        "longitude": -118.2437
      }
    },
    "createdBy": {
      "id": "101",
      "name": "Ahmed Ali",
      "employeeCode": "FA-001"
    },
    "timeline": [
      {
        "action": "Claim Submitted",
        "user": {
          "id": "101",
          "name": "Ahmed Ali"
        },
        "timestamp": "2023-10-25T15:00:00Z"
      }
    ],
    "createdAt": "2023-10-25T15:00:00Z",
    "updatedAt": "2023-10-25T15:00:00Z"
  }
}
```

#### Timeline Event Types (Sprint 1 Supported Actions)
- `Claim Created`
- `Vehicle Identified`
- `Policy Retrieved`
- `Accident Information Added`
- `Location Captured`
- `Claim Submitted`
- `Review Started`

---

## 6. Start Review

### `PATCH /api/v1/claims/:claimId/status`
Transitions a claim from `SUBMITTED` to `UNDER_REVIEW`. 
- **Rule 1:** User must have the `CLAIMS_OFFICER` role.
- **Rule 2:** Claim must currently be `SUBMITTED`.

#### Request Body (application/json)
```json
{
  "status": "UNDER_REVIEW"
}
```

#### Successful Response (200 OK)
```json
{
  "success": true,
  "message": "Claim status updated to UNDER_REVIEW",
  "data": {
    "claimNumber": "CLM-0001",
    "status": "UNDER_REVIEW",
    "updatedAt": "2023-10-25T16:00:00Z"
  }
}
```

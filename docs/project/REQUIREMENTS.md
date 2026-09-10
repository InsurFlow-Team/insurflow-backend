# InsurFlow — Functional Requirements Specification

## 1. Role-Based Permission Matrix: "Who Can Do What?"

| Functional Capability | `ADMIN` | `CLAIMS_OFFICER` | `FIELD_ADJUSTER` | Public / Unauthenticated |
|---|:---:|:---:|:---:|:---:|
| **User Login** (`POST /auth/login`) | ✅ | ✅ | ✅ | ✅ |
| **Change Own Password** (`PUT /auth/change-password`) | ✅ | ✅ | ✅ | ❌ |
| **Create Claim** (`POST /claims`) | ❌ | ✅ | ❌ | ❌ |
| **List Organization Claims** (`GET /claims`) | ✅ | ✅ | ❌ *(Assigned only)* | ❌ |
| **List Assigned Claims** (`GET /claims`) | ❌ | ❌ | ✅ | ❌ |
| **View Claim Details** (`GET /claims/:claimId`) | ✅ | ✅ | ✅ *(Assigned only)* | ❌ |
| **List Adjusters & Availability** (`GET /users/adjusters`) | ✅ | ✅ | ❌ | ❌ |
| **Assign Claim to Adjuster** (`POST /claims/:claimId/assign`)| ❌ | ✅ | ❌ | ❌ |
| **Start / Resume Inspection** (`POST /claims/:id/inspection/start`) | ❌ | ❌ | ✅ *(Assigned only)* | ❌ |
| **Lookup Vehicle & Policy** (`GET /vehicles/lookup`) | ❌ | ❌ | ✅ | ❌ |
| **Update Vehicle Info on Claim** (`PUT /claims/:claimId/vehicle`) | ❌ | ❌ | ✅ *(Assigned only)* | ❌ |
| **Update Accident Details** (`PUT /claims/:claimId/accident`) | ❌ | ❌ | ✅ *(Assigned only)* | ❌ |
| **Capture GPS Location** (`PUT /claims/:claimId/location`) | ❌ | ❌ | ✅ *(Assigned only)* | ❌ |
| **Submit Inspection** (`POST /claims/:claimId/inspection/submit`) | ❌ | ❌ | ✅ *(Assigned only)* | ❌ |
| **Start Claim Review** (`POST /claims/:claimId/review/start`)| ❌ | ✅ | ❌ | ❌ |
| **Request Correction** (`POST /claims/:id/review/request-correction`)| ❌ | ✅ | ❌ | ❌ |
| **Claim Decision (Approve/Reject)** (`POST /claims/:id/decision`) | ✅ | ✅ | ❌ | ❌ |
| **Close Claim** (`POST /claims/:claimId/close`) | ✅ | ❌ | ❌ | ❌ |
| **Create New User** (`POST /users`) | ✅ | ❌ | ❌ | ❌ |
| **List Organization Users** (`GET /users`) | ✅ | ❌ | ❌ | ❌ |
| **Update User Status (Active/Inactive)** (`PATCH /users/:id/status`) | ✅ | ❌ | ❌ | ❌ |
| **Reset User Password** (`PATCH /users/:id/reset-password`) | ✅ | ❌ | ❌ | ❌ |

---

## 2. Module Functional Requirements

### 2.1 Authentication & Session
- **FR-AUTH-1 (Tenant-Scoped Login):** The system must accept `organizationCode`, `employeeCode`, and `password`. The system must verify that the organization exists, locate the user within that organization, ensure the user is `ACTIVE`, and verify the bcrypt password hash. Protected against brute-force via `loginLimiter`.
- **FR-AUTH-2 (JWT Generation):** Upon successful authentication, the system must return an access token containing `userId`, `role`, and `organizationId`, valid for 8 hours.
- **FR-AUTH-3 (Cookie Issuance):** The server must also set an `httpOnly` cookie (`token`) with appropriate security flags (`secure: true` in production, `sameSite`).
- **FR-AUTH-4 (Self Password Change):** An authenticated user must be able to change their password by providing `currentPassword` and `newPassword` (minimum 8 characters). The new password cannot match the current password.

---

### 2.2 Claim Intake & Creation
- **FR-CLAIM-1 (Officer Intake):** Only users with role `CLAIMS_OFFICER` can create an initial claim.
- **FR-CLAIM-2 (Mandatory Intake Data):** The client must provide:
  - `customerName` (String, required, trimmed)
  - `customerPhone` (String, required, trimmed)
  - `initialPlateNumber` (String, required, trimmed)
  - `incidentType` (Enum: `COLLISION`, `REAR_END_COLLISION`, `SIDE_IMPACT`, `PARKING_DAMAGE`, `OTHER`)
  - `incidentLocation` (String, required, trimmed)
- **FR-CLAIM-3 (Automated Server Context):** The server must automatically assign:
  - `organizationId` from authenticated token
  - `createdBy` from authenticated token
  - `status = 'NEW'`
  - `claimNumber` (`CLM-<ORG_CODE>-NNNN` generated atomically per tenant)
  - Initial timeline audit entry: `"Claim Created"`

---

### 2.3 Field Adjuster Workload & Assignment
- **FR-ASSIGN-1 (Adjuster Availability Query):** A Claims Officer can query adjusters within their organization. The system computes availability via MongoDB aggregation based on:
  - User `status === 'ACTIVE'`
  - User has $\le 3$ active claims across statuses `['ASSIGNED', 'IN_PROGRESS', 'CORRECTION_REQUIRED']` (`activeTasksCount <= 3`)
  - Optional query parameter `?status=available` filters only available adjusters.
- **FR-ASSIGN-2 (Claim Assignment):** A Claims Officer can assign a claim in `NEW` status to an available field adjuster.
  - The request accepts `adjusterId`, optional `priority` (`LOW`, `MEDIUM`, `HIGH`, default `MEDIUM`), and optional `notes`.
  - The system must verify the claim exists, belongs to the officer's organization, and is currently in `NEW` status.
  - The system must verify the target adjuster exists in the same organization, has role `FIELD_ADJUSTER`, is `ACTIVE`, and has $\le 3$ active assigned claims.
  - Transitions claim status to `ASSIGNED`.
  - Appends timeline event: `"Claim Assigned"`.

---

### 2.4 Vehicle & Policy Lookup
- **FR-LOOKUP-1 (Plate Query):** A Field Adjuster can query vehicle data by license plate (`GET /vehicles/lookup?plateNumber=...`).
- **FR-LOOKUP-2 (Normalization):** The query must normalize plate text (trim whitespace and convert to uppercase).
- **FR-LOOKUP-3 (Cross-Entity Resolution):** The response must resolve and return:
  - Vehicle details (ID, plate, make, model, year, color)
  - Linked Customer details (ID, full name, phone)
  - Linked Policy details (ID, policy number, status, start date, expiry date)
- **FR-LOOKUP-4 (Expired Policy Warning):** If the resolved policy has `status === 'EXPIRED'`, the response must still return the data but include a warning object (`code: 'POLICY_EXPIRED'`) informing the adjuster to flag the claim.

---

### 2.5 Field Inspection Workflow (Start & Incremental Drafting)
- **FR-INSPECT-0 (Inspection Initiation):** `POST /claims/:claimId/inspection/start`
  - Callable only by the assigned `FIELD_ADJUSTER`.
  - Allowed when claim status is `ASSIGNED` (appends `"Inspection Started"`) or `CORRECTION_REQUIRED` (appends `"Inspection Resumed"`).
  - Transitions claim status to `IN_PROGRESS`.
- **FR-INSPECT-1 (Ownership Precondition):** All draft update endpoints (`/vehicle`, `/accident`, `/location`) require:
  - Authenticated user has role `FIELD_ADJUSTER`.
  - Claim belongs to user's organization.
  - Claim is explicitly assigned to the authenticated adjuster (`assignedTo === req.user.userId`).
  - Claim is currently in `IN_PROGRESS` status.
- **FR-INSPECT-2 (Vehicle Linkage):** `PUT /claims/:claimId/vehicle` accepts `vehicleId`, `policyId`, `customerId`, `plateNumber`. All referenced IDs must exist and belong to the same organization. Appends timeline event: `"Vehicle Confirmed"`.
- **FR-INSPECT-3 (Accident Recording):** `PUT /claims/:claimId/accident` accepts:
  - `accidentType` (Enum: `COLLISION`, `REAR_END_COLLISION`, `SIDE_IMPACT`, `PARKING_DAMAGE`, `OTHER`)
  - `accidentDate` (Format: `YYYY-MM-DD`)
  - `accidentTime` (Format: `HH:mm`)
  - `description` (String, required)
  - `damageDescription` (String, required)
  Appends timeline event: `"Accident Details Recorded"`.
- **FR-INSPECT-4 (Location Capture):** `PUT /claims/:claimId/location` accepts:
  - `latitude` (Number between -90 and 90)
  - `longitude` (Number between -180 and 180)
  - `address` (String, required)
  - `capturedAt` (ISO 8601 Date string, required)
  Appends timeline event: `"Location Captured"`.

---

### 2.6 Inspection Submission
- **FR-SUBMIT-1 (Completeness Validation):** `POST /claims/:claimId/inspection/submit` must verify that:
  - Caller is assigned `FIELD_ADJUSTER` and claim is in `IN_PROGRESS` status.
  - Vehicle data is populated (`vehicle.vehicleId` not null).
  - Accident data is populated (`accident.accidentType` not null).
  - Location is populated (`latitude` and `longitude` are numbers; note: coordinates of `0` are valid).
  - If any section is missing, reject with HTTP 422 (`INSPECTION_INCOMPLETE`) listing missing components.
- **FR-SUBMIT-2 (Submission State Transition):** Transitions status from `IN_PROGRESS` to `SUBMITTED`.
- **FR-SUBMIT-3 (Timeline Entry):** Appends timeline event: `"Inspection Submitted"`.

---

### 2.7 Claim Review & Correction Loop
- **FR-REVIEW-1 (Role & Tenant):** Only a `CLAIMS_OFFICER` belonging to the claim's organization can initiate review.
- **FR-REVIEW-2 (Precondition):** The claim must currently be in `SUBMITTED` status.
- **FR-REVIEW-3 (State Transition):** Atomically transitions claim status from `SUBMITTED` to `UNDER_REVIEW`. Appends timeline event: `"Review Started"`.
- **FR-REVIEW-4 (Correction Request):** A `CLAIMS_OFFICER` can send an `UNDER_REVIEW` claim back for correction (`POST /claims/:claimId/review/request-correction`):
  - Request body requires non-empty `notes`.
  - Transitions claim status from `UNDER_REVIEW` to `CORRECTION_REQUIRED`.
  - Appends timeline event: `"Correction Requested"` with notes.

---

### 2.8 Claim Decision Engine
- **FR-DECIDE-1 (Adjudication Authority):** Users with role `CLAIMS_OFFICER` or `ADMIN` can record a formal decision (`POST /claims/:claimId/decision`).
- **FR-DECIDE-2 (Precondition & Target):** Claim must be in `UNDER_REVIEW` status.
- **FR-DECIDE-3 (Decision Body):** Accepts `decision` (`APPROVED` or `REJECTED`) and optional `notes`.
- **FR-DECIDE-4 (State Transition):** Atomically transitions status to `APPROVED` or `REJECTED`, stores `decisionNotes`, and appends `"Claim Approved"` or `"Claim Rejected"` to the timeline.

---

### 2.9 Final Administrative Closure
- **FR-CLOSE-1 (Admin Authority):** Only users with role `ADMIN` can close a claim (`POST /claims/:claimId/close`).
- **FR-CLOSE-2 (Precondition & Target):** Claim must currently be in `APPROVED` status.
- **FR-CLOSE-3 (State Transition):** Atomically transitions status to `CLOSED`, records `closedBy`, `closedAt`, and optional `closingNotes`. Appends timeline event: `"Claim Closed"`.

---

### 2.10 User Administration (Admin Governance)
- **FR-USER-1 (Admin User Provisioning):** `ADMIN` can create new users with roles `CLAIMS_OFFICER` or `FIELD_ADJUSTER` (cannot self-replicate another `ADMIN` via API).
- **FR-USER-2 (Employee Code Uniqueness):** Employee codes are strictly unique within an organization, but the same code may exist in a different organization.
- **FR-USER-3 (User Deactivation):** `ADMIN` can toggle a user status between `ACTIVE` and `INACTIVE`. Inactive users cannot log in.
- **FR-USER-4 (Administrative Password Reset):** `ADMIN` can reset passwords for staff in their organization without knowing the previous password.


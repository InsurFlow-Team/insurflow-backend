# InsurFlow — Authoritative Business Rules & Domain Invariants

> **CRITICAL NOTICE FOR ALL AI AGENTS & DEVELOPERS:**  
> This document contains the definitive, non-negotiable business rules for InsurFlow. These rules reflect resolved product decisions agreed upon by engineering leadership and product stakeholders. **Do NOT deviate from or question these rules without explicit authorization from the project lead.**

---

## 1. The Core Claim Lifecycle Workflow (10-Status State Machine)

The complete end-to-end business flow across Web Dashboard and Mobile App is defined as follows:

```
┌────────────────────────────────────────────────────────┐
│           0. PRE-INTAKE POLICY VERIFICATION GATE       │
│  Claims Officer or Admin verifies policy eligibility:  │
│  POST /api/v1/policies/verify                          │
│  Checks existence, ACTIVE status, date & plate match   │
│  ❌ Not found/invalid ──▶ Block claim creation         │
│  ✅ Verified ──────────▶ Auto-fill & Proceed to Intake │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   1. INTAKE & CREATION                 │
│  Claims Officer or Admin logs in to Web Dashboard      │
│  Creates Claim with customer & incident details        │
│  Status: [ NEW ]                                       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│              2. DISPATCH (TWO-STEP STEP 1)             │
│  Claims Officer or Admin views available Adjusters     │
│  Dispatches claim to active Adjuster (workload <= 3)   │
│  Status transitions: [ NEW ] ──▶ [ PENDING_ACCEPTANCE ]│
└───────────────────────────┬────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌───────────────────────────┐ ┌───────────────────────────┐
│   2a. ADJUSTER DECLINES   │ │    2b. ADJUSTER ACCEPTS   │
│  Adjuster declines on app │ │  Adjuster accepts on app  │
│  [PENDING_ACCEPTANCE]     │ │  [PENDING_ACCEPTANCE]     │
│             │             │ │             │             │
│             ▼             │ │             ▼             │
│          [ NEW ]          │ │        [ ASSIGNED ]       │
│  (returns to queue)       │ └─────────────┬─────────────┘
└───────────────────────────┘               │
                                            ▼
┌────────────────────────────────────────────────────────┐
│                   3. INSPECTION INITIATION             │
│  Field Adjuster logs in to Mobile App & opens claim    │
│  Initiates inspection: POST /inspection/start          │
│  Status transitions: [ ASSIGNED ] ──▶ [ IN_PROGRESS ]  │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   4. ON-SITE DRAFTING (IN_PROGRESS)    │
│  Field Adjuster gathers evidence and saves drafts:     │
│    • Vehicle & Policy lookup & confirmation            │
│    • Accident details & damage description             │
│    • Real-time GPS location & address                  │
│    • Categorized evidence photos (Cloudinary)          │
│    • Inspection digital signature sign-off             │
│  Status remains: [ IN_PROGRESS ]                       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   5. INSPECTION SUBMISSION             │
│  Field Adjuster validates 5 pillars and submits        │
│  Status transitions: [ IN_PROGRESS ] ──▶ [ SUBMITTED ] │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   6. BACK-OFFICE CLAIM REVIEW          │
│  Submitted claim appears on Web Dashboard              │
│  Claims Officer opens claim and starts review          │
│  Status transitions: [ SUBMITTED ] ──▶ [ UNDER_REVIEW ]│
└─────────────┬────────────────────────────┬─────────────┘
              │                            │
      [Needs Correction]            [Ready for Decision]
              │                            │
              ▼                            ▼
┌──────────────────────────────┐  ┌───────────────────────────────────┐
│     7. CORRECTION LOOP       │  │        8. ADJUDICATION DECISION   │
│ Claims Officer sends back:   │  │ Officer or Admin adjudicates:     │
│ POST /review/request-corr    │  │ POST /decision                    │
│ [ UNDER_REVIEW ]             │  │ Status: [ APPROVED ] | [ REJECTED]│
│      ▼                       │  └─────────────────┬─────────────────┘
│ [ CORRECTION_REQUIRED ]      │                    │
│      ▼ (Adjuster restarts)   │                    │ If Approved
│ [ IN_PROGRESS ] ──▶ [SUBMIT] │                    ▼
└──────────────────────────────┘  ┌───────────────────────────────────┐
                                  │        9. ADMIN FINAL CLOSURE     │
                                  │ Admin closes and archives case:   │
                                  │ POST /close                       │
                                  │ Status: [ CLOSED ]                │
                                  └───────────────────────────────────┘
```

---

## 2. Invariant Rules by Domain

### 2.1 Multi-Tenancy & Data Isolation
- **Rule BR-TENANT-1 (Identity Derivation):** `organizationId` is **never** accepted from incoming request bodies, headers, or query parameters. It is cryptographically derived solely from the validated JWT token (`req.user.organizationId`).
- **Rule BR-TENANT-2 (Strict Isolation Boundary):** An authenticated user belonging to Organization A must never be able to read, modify, assign, or infer the existence of any entity (Claim, Vehicle, Customer, Policy, User) belonging to Organization B.
- **Rule BR-TENANT-3 (Stealth Cross-Tenant Rejection):** Any request referencing a resource from another organization must respond with `HTTP 404 Not Found` (rather than 403), ensuring cross-tenant resource existence is never leaked.
- **Rule BR-TENANT-4 (Atomic Tenant Mutation):** All database updates and transitions must enforce `organizationId` directly in the database write filter query (`{ _id: id, organizationId: authUser.organizationId }`) to guarantee multi-tenancy enforcement at the database level.

---

### 2.2 Policy Verification & Pre-Intake Gate (Feature 20)
- **Rule BR-POL-VERIFY-1 (Intake Gate Invariant):** Before creating a new claim, the Claims Officer or Admin must verify that the policyholder and vehicle belong to the organization and that the policy was valid and active at the time of the incident (`POST /api/v1/policies/verify`).
- **Rule BR-POL-VERIFY-2 (Eligibility vs. Coverage Boundary):** Policy verification certifies policyholder and vehicle eligibility (contract validity). It does **not** adjudicate coverage type or damage liability; coverage determination occurs during post-inspection adjudication (`POST /decision`).
- **Rule BR-POL-VERIFY-3 (Authorized Roles):** Policy verification is restricted strictly to users with role **`CLAIMS_OFFICER`** or **`ADMIN`** (same roles authorized to create claims). Field Adjusters receive `403 Forbidden`.
- **Rule BR-POL-VERIFY-4 (Strict Multi-Tenancy & Stealth 404):** Policies are queried strictly by `{ policyNumber, organizationId }` where `organizationId` is derived exclusively from JWT. Inquiries into policies belonging to another organization return `404 Not Found` (`POLICY_NOT_FOUND`) per BR-TENANT-3.
- **Rule BR-POL-VERIFY-5 (Cross-Validation Rules & Dual Input):**
  - Accepts `policyNumber`, `plateNumber`, or both. At least one must be provided.
  - If queried by `policyNumber`: policy must exist in the caller's organization (`404 POLICY_NOT_FOUND`).
  - If queried by `plateNumber` alone: vehicle must exist in the organization (`404 VEHICLE_NOT_FOUND`) and have a linked policy (`404 POLICY_NOT_FOUND`).
  - Policy status must not be `CANCELLED` (`422 POLICY_CANCELLED`).
  - Policy status must not be `EXPIRED` and current date must not exceed `expiryDate` (`422 POLICY_EXPIRED`).
  - If `incidentDate` is provided:
    - Must not be in the future (`400 INVALID_INCIDENT_DATE`).
    - Must fall within `[startDate, expiryDate]` (`422 POLICY_NOT_ACTIVE_ON_DATE`).
  - If `plateNumber` is provided alongside `policyNumber`, the plate is case-insensitively verified against the policy's registered vehicle; mismatch or lack of linked vehicle record returns `422 VEHICLE_MISMATCH`.
  - If `plateNumber` is omitted and the policy has more than one registered vehicle, verification is rejected with `422 AMBIGUOUS_VEHICLE_SELECTION` requiring the caller to specify `plateNumber`.

---

### 2.3 Claim Creation
- **Rule BR-CLAIM-1 (Creator Role):** Claim creation is restricted strictly to users with role **`CLAIMS_OFFICER`** or **`ADMIN`**. Field Adjusters do **not** create claims in the backend; they inspect claims dispatched to them.
- **Rule BR-CLAIM-2 (Initial Status):** Every newly created claim is unconditionally assigned status **`NEW`**.
- **Rule BR-CLAIM-3 (Audit Log Initiation):** Every new claim initializes an immutable timeline array with an initial event: `action: 'Claim Created'`, recording the creator's user ID, role, and current timestamp.
- **Rule BR-CLAIM-4 (Tenant-Scoped Claim Number):** Every claim receives a unique, sequential human-readable identifier formatted as `CLM-<ORG_CODE>-NNNN` via an atomic tenant-scoped Counter model.
- **Rule BR-CLAIM-5 (Ambiguous Vehicle Selection Protection):** When creating a claim (`POST /api/v1/claims`), if the resolved policy has more than one registered vehicle and the request does not provide `plateNumber`, claim creation is rejected with `HTTP 422 Unprocessable Entity` (`AMBIGUOUS_VEHICLE_SELECTION`). The caller must explicitly supply `plateNumber` to prevent silent attachment of an arbitrary vehicle.

---

### 2.3 Field Adjuster Assignment
- **Rule BR-ASSIGN-1 (Assigner Role):** Users with role **`CLAIMS_OFFICER`** or **`ADMIN`** can assign claims.
- **Rule BR-ASSIGN-2 (State Invariant):** Claims can **only** be assigned if they are currently in status **`NEW`**. Attempting to assign an already `ASSIGNED`, `IN_PROGRESS`, or subsequent state claim must fail with `HTTP 409 Conflict`.
- **Rule BR-ASSIGN-3 (Adjuster Qualification):** The target assignee must:
  1. Belong to the same organization as the claim.
  2. Possess role **`FIELD_ADJUSTER`**.
  3. Have user status **`ACTIVE`**.
- **Rule BR-ASSIGN-4 (Workload Capacity & Advisory Override):** An adjuster is eligible for assignment (`AVAILABLE`) if and only if they have **3 or fewer active inspection tasks** (`activeTasksCount <= 3`) across active statuses: `['ASSIGNED', 'IN_PROGRESS', 'CORRECTION_REQUIRED']`.
  - If `activeTasksCount > 3`, assignment is rejected with `HTTP 409 Conflict` (`ADJUSTER_UNAVAILABLE`), **unless** the Claims Officer or Admin provides `"overrideCapacity": true` in the request body.
  - When overridden, the assignment succeeds and the audit timeline note is prefixed with:
    `"[CAPACITY OVERRIDE] Assigned while adjuster had <N> active tasks (max: 3)"`.
  - The backend is the single source of truth for capacity enforcement.
- **Rule BR-ASSIGN-5 (Two-Step Dispatch - Step 1):** The database update must atomically verify `status: 'NEW'` and set `status: 'PENDING_ACCEPTANCE'`, `assignedTo`, `assignedBy`, `assignedAt`, `priority`, and append a timeline event. Claims in `PENDING_ACCEPTANCE` do **not** count towards the adjuster's active workload capacity.
- **Rule BR-ASSIGN-6 (Adjuster Assignment Acceptance - Step 2a):** The assigned `FIELD_ADJUSTER` explicitly accepts the dispatched claim via `POST /api/v1/claims/:claimId/accept-assignment`.
  - Precondition: Claim must currently be in `PENDING_ACCEPTANCE` status. Any other status returns `HTTP 409 Conflict` (`INVALID_STATUS_TRANSITION`).
  - Authorization & Stealth Tenancy: Only the specific `FIELD_ADJUSTER` assigned to the claim may accept. Non-assigned or cross-tenant adjusters receive `HTTP 404 Not Found`.
  - Atomic State Update: Transitions `status: 'ASSIGNED'`, adds timeline event with `action: 'Assignment Accepted'`, `previousStatus: 'PENDING_ACCEPTANCE'`, `newStatus: 'ASSIGNED'`, `notes: '[ASSIGNMENT ACCEPTED] by <employeeCode>'`.
  - Inspection Invariant: Field inspection cannot be started until acceptance is confirmed (`POST /inspection/start` returns 409 if status is `PENDING_ACCEPTANCE`).
- **Rule BR-ASSIGN-7 (Adjuster Assignment Decline & Re-dispatch - Step 2b):** An assigned `FIELD_ADJUSTER` may decline a dispatched claim via `POST /api/v1/claims/:claimId/decline-assignment` with a mandatory reason (1–300 chars).
  - Precondition: Claim must currently be in `PENDING_ACCEPTANCE` status. Any other status returns `HTTP 409 Conflict` (`INVALID_STATUS_TRANSITION`).
  - Authorization & Stealth Tenancy: Only the specific `FIELD_ADJUSTER` assigned to the claim may decline. Other roles receive `HTTP 403 Forbidden`. Non-assigned adjusters receive `HTTP 404 Not Found`.
  - Atomic State Reset: Atomically resets `status: 'NEW'`, `assignedTo: null`, `assignedBy: null`, `assignedAt: null`, `assignmentNotes: null`.
  - Timeline Audit Trail: Records an event with `action: 'Assignment Declined'`, `previousStatus: 'PENDING_ACCEPTANCE'`, `newStatus: 'NEW'`, `notes: '[ASSIGNMENT DECLINED] by <employeeCode> — <reason>'`.
  - Re-dispatch: Claim immediately returns to the unassigned queue (`NEW`) for fresh map-based proximity dispatch by Claims Officers.
- **Rule BR-LOCATION-1 (Passive Location Ingestion via HTTP Headers):** Mobile client requests performed by `FIELD_ADJUSTER` users passively transmit the adjuster's current GPS position via `X-Latitude` and `X-Longitude` request headers. A cross-cutting middleware validates coordinate boundaries (`-90..90`, `-180..180`) and asynchronously updates stored location. It operates in a non-blocking `try/catch` wrapper that logs server warnings on failure and never interrupts, delays, or rejects the primary request.
- **Rule BR-DISPATCH-PROXIMITY (Server-Side Haversine Proximity Sorting):** When querying adjusters via `GET /api/v1/users/adjusters` with reference coordinates (from `claimId`'s `incidentCoordinates` or direct query params), the server computes geodesic distances via the Haversine formula (km, rounded to 2 decimals) and sorts adjusters ascending. Adjusters with no reported location are placed at the end with `distanceKm: null`.

---

### 2.4 Vehicle & Policy Verification
- **Rule BR-VEH-1 (Adjuster Search Only):** Vehicle and policy lookups (`GET /vehicles/lookup`) are restricted strictly to **`FIELD_ADJUSTER`** users during mobile field operations.
- **Rule BR-VEH-2 (License Plate Normalization):** All search inputs are trimmed and transformed to uppercase before querying.
- **Rule BR-VEH-3 (Expired Policy Policy):** If a vehicle's associated policy is `EXPIRED`:
  - The lookup must **succeed** (returning vehicle, customer, and policy data).
  - The response must include a warning object (`code: 'POLICY_EXPIRED'`).
  - **The field inspection is permitted to proceed**, but the adjuster and officer are warned so the claim can be flagged for underwriting review.

---

### 2.5 Field Inspection Initiation & Mobile Drafting
- **Rule BR-INSPECT-START (Inspection Initiation):** Before making draft updates, the assigned `FIELD_ADJUSTER` must invoke `POST /claims/:claimId/inspection/start`.
  - Allowed from `ASSIGNED` (appends `"Inspection Started"`) or `CORRECTION_REQUIRED` (appends `"Inspection Resumed"`).
  - Transitions claim status to **`IN_PROGRESS`**.
- **Rule BR-INSPECT-1 (Assigned Adjuster Exclusive):** Inspection draft modifications (`PUT /vehicle`, `PUT /accident`, `PUT /location`) can **only** be executed by the specific `FIELD_ADJUSTER` to whom the claim is assigned.
- **Rule BR-INSPECT-2 (State Invariant):** Inspection draft modifications can only occur while the claim is in status **`IN_PROGRESS`**.
- **Rule BR-INSPECT-3 (Drafting Freedom):** An adjuster may update vehicle, accident, or location data in any order and multiple times prior to final submission.
- **Rule BR-INSPECT-EVIDENCE (Photo Evidence Capture & Additive Persistence):** The adjuster uploads scene photographs to Cloudinary via `POST /api/v1/claims/:claimId/evidence`.
  - **Additive Persistence (`$push`):** On-site accident inspection requires comprehensive visual documentation from multiple angles (`VEHICLE_FRONT`, `VEHICLE_REAR`, `VEHICLE_SIDE`, `DAMAGE_CLOSEUP`, `DRIVER_LICENSE`, `OTHER`). Each photo upload appends a new item to the `claim.evidence` array with `$push`, preserving all visual records.
  - Max file size 10MB; accepted MIME types: JPEG, PNG, WEBP.
  - Stored in tenant-isolated folder: `insurflow/${organizationId}/evidence`.
- **Rule BR-INSPECT-SIG (Digital Signature Sign-Off & Overwritable Persistence):** The adjuster captures the inspection sign-off via `POST /api/v1/claims/:claimId/signature`.
  - **Overwritable Persistence (`$set`):** The inspection holds exactly one active signature sign-off. If a signature needs to be re-drawn (e.g., due to touchscreen inaccuracies or customer revision), subsequent uploads cleanly overwrite the `claim.signature` object with `$set`, preventing orphan records and ensuring legal clarity.
  - Max file size 10MB; accepted MIME types: JPEG, PNG, WEBP.
  - Stored in tenant-isolated folder: `insurflow/${organizationId}/signatures`.

---

### 2.6 Inspection Submission
- **Rule BR-SUBMIT-1 (Submission Authority):** Only the assigned `FIELD_ADJUSTER` can submit the inspection.
- **Rule BR-SUBMIT-2 (Five Mandatory Pillars of Inspection):** Submission is **rejected** with `HTTP 422 Unprocessable Entity` (`INSPECTION_INCOMPLETE`) unless all five mandatory pillars are present:
  1. **Vehicle:** `claim.vehicle.vehicleId` must not be null.
  2. **Accident:** `claim.accident.accidentType` must not be null.
  3. **Location:** `claim.location.latitude` and `claim.location.longitude` must not be null. *(Note: Coordinate `0` is a valid mathematical value and must not be treated as null).*
  4. **Evidence (at least 1 photo):** `claim.evidence` must contain at least one photo (`claim.evidence.length >= 1`).
  5. **Signature:** `claim.signature.url` must not be null.
- **Rule BR-SUBMIT-3 (Submission State Transition):** A valid submission atomically transitions status from **`IN_PROGRESS`** to **`SUBMITTED`** and records an `"Inspection Submitted"` timeline entry.

---

### 2.7 Claim Review, Correction Loop & Adjudication
- **Rule BR-REV-1 (Reviewer Role):** Only users with role **`CLAIMS_OFFICER`** can start a review (`POST /claims/:claimId/review/start`).
- **Rule BR-REV-2 (Review Precondition):** The claim must currently be in status **`SUBMITTED`**. Transitions status to **`UNDER_REVIEW`**.
- **Rule BR-REV-CORRECT (Correction Request):** If the submitted inspection lacks clarity or requires amendments:
  - `CLAIMS_OFFICER` calls `POST /claims/:claimId/review/request-correction` with mandatory non-empty `notes`.
  - Claim must be in status **`UNDER_REVIEW`**.
  - Transitions status to **`CORRECTION_REQUIRED`** and appends `"Correction Requested"` with reason notes to the timeline.
- **Rule BR-DECISION (Claim Decision):** When review is satisfactory:
  - Either **`CLAIMS_OFFICER`** or **`ADMIN`** calls `POST /claims/:claimId/decision`.
  - Claim must be in status **`UNDER_REVIEW`**.
  - Accepts `decision` (`APPROVED` or `REJECTED`) and optional `notes`.
  - Transitions status to **`APPROVED`** or **`REJECTED`**.

---

### 2.8 Final Administrative Closure
- **Rule BR-CLOSE (Admin Sign-Off):** 
  - Restricted exclusively to **`ADMIN`** (`POST /claims/:claimId/close`).
  - Source state invariant: Claim must be currently in status **`APPROVED`**.
  - Atomically captures `closedBy`, `closedAt`, optional `closingNotes`, and transitions status to **`CLOSED`**.

---

### 2.9 Final Claim Report Generation
- **Rule BR-REPORT-ROLES (Authorized Report Roles):** Generation of the final claim report (`GET /api/v1/claims/:claimId/report`) is restricted strictly to users with role **`ADMIN`** and **`CLAIMS_OFFICER`**. Field Adjusters (`FIELD_ADJUSTER`) are rejected unconditionally with `HTTP 403 Forbidden` (`FORBIDDEN_RESOURCE`).
- **Rule BR-REPORT-STATUS (Terminal Decision Status Precondition):** A claim report can **only** be generated after a claim has reached a final decision status: **`APPROVED`**, **`REJECTED`**, or **`CLOSED`**. Requests on any in-flight or non-terminal status (`NEW`, `ASSIGNED`, `IN_PROGRESS`, `SUBMITTED`, `UNDER_REVIEW`, `CORRECTION_REQUIRED`) are blocked with `HTTP 409 Conflict` (`INVALID_STATUS_TRANSITION`) with detail: `"Report is only available for claims with a final decision (APPROVED, REJECTED, or CLOSED)."`.
- **Rule BR-REPORT-PRECEDENCE (404-Before-409 Existence Precedence):** Tenant-scoped existence verification strictly precedes status validation. If a claim does not exist or belongs to another tenant, the system responds with `HTTP 404 Not Found` (`CLAIM_NOT_FOUND`), preventing information leakage regarding the status of out-of-scope resources.
- **Rule BR-REPORT-DELIVERY (Buffer-Then-Send & Asset Resilience):** Embedded images (evidence photos and signature) are transformed via Cloudinary (`w_800,c_limit,q_auto:good,f_jpg`) and gracefully degrade into visual placeholder blocks upon network failure. The PDF is assembled completely in memory as a `Buffer` before setting HTTP 200 headers, guaranteeing that unexpected generation errors preserve the standard JSON error envelope.

---

## 3. Summary Decision Matrix

| Question | Authoritative Answer |
|---|---|
| Who creates claims? | **`CLAIMS_OFFICER` and `ADMIN`** |
| Can Field Adjusters create claims? | **No** |
| Who assigns claims? | **`CLAIMS_OFFICER` only** |
| How many active claims can an adjuster handle? | **Up to 3 active claims (`activeTasksCount <= 3`)** |
| What statuses count as active for an adjuster? | **`ASSIGNED`, `IN_PROGRESS`, `CORRECTION_REQUIRED`** |
| When can draft updates occur? | **Only when claim is in `IN_PROGRESS` status** |
| How does a claim enter `IN_PROGRESS`? | **Adjuster calls `POST /claims/:id/inspection/start`** |
| What happens if a policy is expired? | **Inspection proceeds, but API returns `POLICY_EXPIRED` warning** |
| When can an inspection be submitted? | **Only when vehicle, accident, GPS location, evidence photo(s), and digital signature are all completed** |
| Can an adjuster upload multiple evidence photos? | **Yes, additive array up to 10MB per file** |
| Can an adjuster re-capture or update their signature? | **Yes, subsequent signature uploads overwrite the previous one** |
| Who initiates review? | **Any `CLAIMS_OFFICER` in the same organization** |
| Who can request corrections? | **`CLAIMS_OFFICER` on claims in `UNDER_REVIEW`** |
| Who can approve or reject claims? | **`CLAIMS_OFFICER` and `ADMIN` on claims in `UNDER_REVIEW`** |
| Who closes claims? | **`ADMIN` only on claims in `APPROVED` status** |
| Who can download the final claim report? | **`ADMIN` and `CLAIMS_OFFICER` only** |
| When can the final claim report be generated? | **Only after a final decision: `APPROVED`, `REJECTED`, or `CLOSED`** |
| Can Field Adjusters download the claim report? | **No (`HTTP 403 Forbidden`)** |
| Does a push notification failure fail the claim action? | **Never (`Notification` document is saved; push errors are caught and logged only)** |
| Who can register a device FCM token? | **Any authenticated user for their own account (`PATCH /users/me/fcm-token`)** |

---

### 2.10 Push Notifications & Device Token Management
- **Rule BR-NOTIF-1 (Zero Push-Failure Propagation):** A push delivery failure (e.g. expired FCM token, Firebase network downtime, or invalid payload) must **never** cause the calling business action to fail or throw an exception. The parent domain operation (such as assigning a claim, requesting corrections, approving, or rejecting) must proceed and succeed regardless of push outcome.
- **Rule BR-NOTIF-2 (Persistence Precedence):** The `Notification` record is always created and saved in MongoDB first, before any push delivery attempt is made.
- **Rule BR-NOTIF-3 (Silent Skip on Missing Token):** If the recipient user has no registered `fcmToken` (or is not found in the database), push delivery is skipped silently without throwing an error.
- **Rule BR-NOTIF-4 (Device Token Ownership & Multi-Tenancy):** An authenticated user of any role (`FIELD_ADJUSTER`, `CLAIMS_OFFICER`, `ADMIN`) may register or update their own FCM device token via `PATCH /api/v1/users/me/fcm-token`. The operation strictly updates the caller's own User document (`req.user.userId`) within their authenticated tenant (`req.user.organizationId`). Users cannot view or overwrite device tokens belonging to other users.

### 2.11 Dashboard Notification Center & Fan-Out Rules (Feature 21)
- **Rule BR-NOTIF-5 (Read-State Timestamp & Idempotency):** The notification read state is represented by `readAt` (type `Date`, default `null`). An unread notification has `readAt === null`. Marking a notification as read sets `readAt` to current timestamp. Marking an already-read notification as read is strictly idempotent: the existing document is returned and `readAt` is preserved unmodified.
- **Rule BR-NOTIF-6 (Stealth Tenancy on Notification Access):** All notification queries and mutations are strictly filtered by `{ recipientId: req.user.userId, organizationId: req.user.organizationId }`. Attempting to mark or view a notification that belongs to another user or another tenant returns HTTP 404 `NOTIFICATION_NOT_FOUND` to protect privacy and tenant isolation.
- **Rule BR-NOTIF-7 (Loop-Per-Recipient Fan-Out):** Organization-wide notifications (`NEW_CLAIM`, `INSPECTION_COMPLETED`, `ASSIGNMENT_DECLINED`) generate one separate `Notification` document per active recipient (`CLAIMS_OFFICER` and `ADMIN` with `status: 'ACTIVE'`). Organizations with zero active officers/admins produce zero notification documents without throwing or interrupting caller operations.
- **Rule BR-NOTIF-8 (Intake Creator Exclusion):** When a claim is created (`NEW_CLAIM`), all active officers and admins receive a notification, strictly excluding the creator (`authUser.userId`).
- **Rule BR-NOTIF-9 (Read-Time Claim Number Resolution):** `claimNumber` is never statically duplicated or stored in `Notification` documents; it is populated from `relatedClaimId` dynamically at read time.
- **Rule BR-NOTIF-10 (Zero Lifecycle-Failure Propagation):** Any failure during notification creation or push dispatch is caught and logged to `console.error`; it must never fail or roll back the primary claim lifecycle action (`createClaim`, `declineAssignment`, `submitInspection`).



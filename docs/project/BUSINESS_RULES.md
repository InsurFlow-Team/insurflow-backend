# InsurFlow — Authoritative Business Rules & Domain Invariants

> **CRITICAL NOTICE FOR ALL AI AGENTS & DEVELOPERS:**  
> This document contains the definitive, non-negotiable business rules for InsurFlow. These rules reflect resolved product decisions agreed upon by engineering leadership and product stakeholders. **Do NOT deviate from or question these rules without explicit authorization from the project lead.**

---

## 1. The Core Claim Lifecycle Workflow (9-Status State Machine)

The complete end-to-end business flow across Web Dashboard and Mobile App is defined as follows:

```
┌────────────────────────────────────────────────────────┐
│                   1. INTAKE & CREATION                 │
│  Claims Officer logs in to Web Dashboard               │
│  Creates Claim with customer & incident details        │
│  Status: [ NEW ]                                       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   2. DISPATCH & ASSIGNMENT             │
│  Claims Officer views available Field Adjusters        │
│  Assigns claim to active Adjuster (workload <= 3)      │
│  Status transitions: [ NEW ] ──▶ [ ASSIGNED ]          │
└───────────────────────────┬────────────────────────────┘
                            │
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
│  Status remains: [ IN_PROGRESS ]                       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   5. INSPECTION SUBMISSION             │
│  Field Adjuster validates 3 pillars and submits        │
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

### 2.2 Claim Creation
- **Rule BR-CLAIM-1 (Creator Role):** Claim creation is restricted strictly to users with role **`CLAIMS_OFFICER`**. Field Adjusters do **not** create claims in the backend; they inspect claims dispatched to them.
- **Rule BR-CLAIM-2 (Initial Status):** Every newly created claim is unconditionally assigned status **`NEW`**.
- **Rule BR-CLAIM-3 (Audit Log Initiation):** Every new claim initializes an immutable timeline array with an initial event: `action: 'Claim Created'`, recording the creator's user ID, role, and current timestamp.
- **Rule BR-CLAIM-4 (Tenant-Scoped Claim Number):** Every claim receives a unique, sequential human-readable identifier formatted as `CLM-<ORG_CODE>-NNNN` via an atomic tenant-scoped Counter model.

---

### 2.3 Field Adjuster Assignment
- **Rule BR-ASSIGN-1 (Assigner Role):** Only users with role **`CLAIMS_OFFICER`** can assign claims.
- **Rule BR-ASSIGN-2 (State Invariant):** Claims can **only** be assigned if they are currently in status **`NEW`**. Attempting to assign an already `ASSIGNED`, `IN_PROGRESS`, or subsequent state claim must fail with `HTTP 409 Conflict`.
- **Rule BR-ASSIGN-3 (Adjuster Qualification):** The target assignee must:
  1. Belong to the same organization as the claim.
  2. Possess role **`FIELD_ADJUSTER`**.
  3. Have user status **`ACTIVE`**.
- **Rule BR-ASSIGN-4 (Workload Capacity Invariant):** An adjuster is eligible for assignment (`AVAILABLE`) if and only if they have **3 or fewer active inspection tasks** (`activeTasksCount <= 3`) across active statuses: `['ASSIGNED', 'IN_PROGRESS', 'CORRECTION_REQUIRED']`. If `activeTasksCount > 3`, assignment is blocked with `HTTP 409 Conflict` (`ADJUSTER_UNAVAILABLE`).
- **Rule BR-ASSIGN-5 (Atomic Assignment):** The database update must atomically verify `status: 'NEW'` and set `status: 'ASSIGNED'`, `assignedTo`, `assignedBy`, `assignedAt`, `priority`, and append a timeline event.

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

---

### 2.6 Inspection Submission
- **Rule BR-SUBMIT-1 (Submission Authority):** Only the assigned `FIELD_ADJUSTER` can submit the inspection.
- **Rule BR-SUBMIT-2 (Three Mandatory Pillars of Inspection):** Submission is **rejected** with `HTTP 422 Unprocessable Entity` (`INSPECTION_INCOMPLETE`) unless all three sections are present:
  1. **Vehicle Verified:** `claim.vehicle.vehicleId` must not be null.
  2. **Accident Recorded:** `claim.accident.accidentType` must not be null.
  3. **Location Captured:** `claim.location.latitude` and `claim.location.longitude` must not be null. *(Note: Coordinate `0` is a valid mathematical value and must not be treated as null).*
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

## 3. Summary Decision Matrix

| Question | Authoritative Answer |
|---|---|
| Who creates claims? | **`CLAIMS_OFFICER` only** |
| Can Field Adjusters create claims? | **No** |
| Who assigns claims? | **`CLAIMS_OFFICER` only** |
| How many active claims can an adjuster handle? | **Up to 3 active claims (`activeTasksCount <= 3`)** |
| What statuses count as active for an adjuster? | **`ASSIGNED`, `IN_PROGRESS`, `CORRECTION_REQUIRED`** |
| When can draft updates occur? | **Only when claim is in `IN_PROGRESS` status** |
| How does a claim enter `IN_PROGRESS`? | **Adjuster calls `POST /claims/:id/inspection/start`** |
| What happens if a policy is expired? | **Inspection proceeds, but API returns `POLICY_EXPIRED` warning** |
| When can an inspection be submitted? | **Only when vehicle, accident, and GPS location are all filled** |
| Who initiates review? | **Any `CLAIMS_OFFICER` in the same organization** |
| Who can request corrections? | **`CLAIMS_OFFICER` on claims in `UNDER_REVIEW`** |
| Who can approve or reject claims? | **`CLAIMS_OFFICER` and `ADMIN` on claims in `UNDER_REVIEW`** |
| Who closes claims? | **`ADMIN` only on claims in `APPROVED` status** |


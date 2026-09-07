# InsurFlow — Authoritative Business Rules & Domain Invariants

> **CRITICAL NOTICE FOR ALL AI AGENTS & DEVELOPERS:**  
> This document contains the definitive, non-negotiable business rules for InsurFlow. These rules reflect resolved product decisions agreed upon by engineering leadership and product stakeholders. **Do NOT deviate from or question these rules without explicit authorization from the project lead.**

---

## 1. The Core Sprint 1 Lifecycle Workflow (Permanently Decided)

The end-to-end business flow for Sprint 1 is locked as follows:

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
│  Assigns claim to an active, unburdened Adjuster       │
│  Status transitions: [ NEW ] ──▶ [ ASSIGNED ]          │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   3. ON-SITE FIELD INSPECTION          │
│  Field Adjuster logs in to Mobile App                  │
│  Views assigned claim and drives to inspection site    │
│  Looks up Vehicle & Policy via license plate           │
│  Saves inspection components incrementally (Drafts):   │
│    • Vehicle & Policy confirmation                     │
│    • Accident details & damage description             │
│    • Real-time GPS location & address                  │
│  Status remains: [ ASSIGNED ]                          │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   4. INSPECTION SUBMISSION             │
│  Field Adjuster validates and submits report           │
│  Status transitions: [ ASSIGNED ] ──▶ [ SUBMITTED ]    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   5. BACK-OFFICE CLAIM REVIEW          │
│  Submitted claim appears on Web Dashboard              │
│  Claims Officer opens claim and starts review          │
│  Status transitions: [ SUBMITTED ] ──▶ [ UNDER_REVIEW ]│
└────────────────────────────────────────────────────────┘
```

> **Explicit Decision on Terminal States:**  
> Claims in `UNDER_REVIEW` remain in that state for the duration of Sprint 1. The transitions to `APPROVED`, `REJECTED`, and `CLOSED` belong to **Sprint 2**.

---

## 2. Invariant Rules by Domain

### 2.1 Multi-Tenancy & Data Isolation
- **Rule BR-TENANT-1 (Identity Derivation):** `organizationId` is **never** accepted from incoming request bodies, headers, or query parameters. It is cryptographically derived solely from the validated JWT token (`req.user.organizationId`).
- **Rule BR-TENANT-2 (Strict Isolation Boundary):** An authenticated user belonging to Organization A must never be able to read, modify, assign, or infer the existence of any entity (Claim, Vehicle, Customer, Policy, User) belonging to Organization B.
- **Rule BR-TENANT-3 (Stealth Cross-Tenant Rejection):** Any request referencing a resource from another organization must respond with `HTTP 404 Not Found` (rather than 403), ensuring cross-tenant resource existence is never leaked.
- **Rule BR-TENANT-4 (Atomic Tenant Mutation):** All database updates and transitions must enforce `organizationId` directly in the database write filter query (`{ _id: id, organizationId: authUser.organizationId }`) to guarantee that multi-tenancy is enforced at the database level.

---

### 2.2 Claim Creation
- **Rule BR-CLAIM-1 (Creator Role):** Claim creation is restricted strictly to users with role **`CLAIMS_OFFICER`**. Field Adjusters do **not** create claims in the backend; they inspect claims dispatched to them.
- **Rule BR-CLAIM-2 (Initial Status):** Every newly created claim is unconditionally assigned status **`NEW`**.
- **Rule BR-CLAIM-3 (Audit Log Initiation):** Every new claim must initialize an immutable timeline array with an initial event: `action: 'Claim Created'`, recording the creator's user ID, role, and current timestamp.
- **Rule BR-CLAIM-4 (Sequential Claim Identifier):** Every claim receives a unique, sequential human-readable identifier (e.g., `CLM-0001`).

---

### 2.3 Field Adjuster Assignment
- **Rule BR-ASSIGN-1 (Assigner Role):** Only users with role **`CLAIMS_OFFICER`** can assign claims.
- **Rule BR-ASSIGN-2 (State Invariant):** Claims can **only** be assigned if they are currently in status **`NEW`**. Attempting to assign an already `ASSIGNED`, `SUBMITTED`, or `UNDER_REVIEW` claim must fail with `HTTP 409 Conflict`.
- **Rule BR-ASSIGN-3 (Adjuster Qualification):** The target assignee must:
  1. Belong to the same organization as the claim.
  2. Possess role **`FIELD_ADJUSTER`**.
  3. Have user status **`ACTIVE`**.
- **Rule BR-ASSIGN-4 (Workload Capacity Invariant):** For Sprint 1, an adjuster is eligible for assignment **only if they currently have 0 active claims in status `ASSIGNED`**. If an adjuster has an active task, assignment must fail with `HTTP 409 Conflict` (`ADJUSTER_UNAVAILABLE`).
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

### 2.5 Inspection Updates & Partial Saves (Mobile Drafts)
- **Rule BR-INSPECT-1 (Assigned Adjuster Exclusive):** Inspection modifications (`PUT /vehicle`, `PUT /accident`, `PUT /location`) can **only** be executed by the specific `FIELD_ADJUSTER` to whom the claim is assigned. Other adjusters (even within the same organization) cannot modify the claim.
- **Rule BR-INSPECT-2 (State Invariant):** Inspection modifications can only occur while the claim is in status **`ASSIGNED`**. Once submitted, modifications are locked.
- **Rule BR-INSPECT-3 (Drafting Freedom):** An adjuster may update vehicle, accident, or location data in any order and multiple times prior to final submission.

---

### 2.6 Inspection Submission
- **Rule BR-SUBMIT-1 (Submission Authority):** Only the assigned `FIELD_ADJUSTER` can submit the inspection.
- **Rule BR-SUBMIT-2 (Three Mandatory Pillars of Inspection):** Submission is **rejected** with `HTTP 422 Unprocessable Entity` (`INSPECTION_INCOMPLETE`) unless all three sections are present:
  1. **Vehicle Verified:** `claim.vehicle.vehicleId` must not be null.
  2. **Accident Recorded:** `claim.accident.accidentType` must not be null.
  3. **Location Captured:** `claim.location.latitude` and `claim.location.longitude` must not be null. *(Note: Coordinate `0` is a valid mathematical value and must not be treated as null).*
- **Rule BR-SUBMIT-3 (Submission State Transition):** A valid submission transitions status from **`ASSIGNED`** to **`SUBMITTED`** and records an `"Inspection Submitted"` timeline entry.

---

### 2.7 Claim Review Initiation
- **Rule BR-REV-1 (Reviewer Role):** Only users with role **`CLAIMS_OFFICER`** can start a review.
- **Rule BR-REV-2 (Organization Invariant):** Any claims officer within the organization may start the review (assignment is to the claims department, not exclusively the original creator).
- **Rule BR-REV-3 (State Invariant):** The claim must currently be in status **`SUBMITTED`**. If the claim is in any other status, the action must fail with `HTTP 409 Conflict`.
- **Rule BR-REV-4 (Review Transition):** Atomically transitions claim status from **`SUBMITTED`** to **`UNDER_REVIEW`** and appends `"Review Started"` to the timeline.

---

## 3. Summary Decision Matrix

| Question | Authoritative Answer |
|---|---|
| Who creates claims? | **`CLAIMS_OFFICER` only** |
| Can Field Adjusters create claims? | **No** |
| Who assigns claims? | **`CLAIMS_OFFICER` only** |
| Can an adjuster have multiple assigned claims in Sprint 1? | **No (maximum 1 active claim)** |
| Who executes inspections? | **Assigned `FIELD_ADJUSTER` only** |
| What happens if a policy is expired? | **Inspection proceeds, but API returns `POLICY_EXPIRED` warning** |
| When can an inspection be submitted? | **Only when vehicle, accident, and GPS location are all filled** |
| Who initiates review? | **Any `CLAIMS_OFFICER` in the same organization** |
| Are `APPROVED`, `REJECTED`, `CLOSED` in Sprint 1? | **No (Sprint 2 roadmap)** |

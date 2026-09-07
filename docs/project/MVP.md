# InsurFlow — MVP & Sprint Scope Definition

## 1. Executive Philosophy: Sprint 1 ≠ Full Insurance System
A common anti-pattern in insurance software development is attempting to build the entire underwriting, settlement, and fraud-detection suite in the first sprint.

**InsurFlow Sprint 1 is strictly focused on the core operational intake and field inspection pipeline.**

> **Authoritative Decision Reaffirmed by Independent Audit:**  
> The endpoints `POST /claims/:claimId/decision` (which approves or rejects a claim) and `POST /claims/:claimId/close` (which archives/closes a claim), along with the final terminal statuses **`APPROVED`**, **`REJECTED`**, and **`CLOSED`**, are **explicitly OUT OF SCOPE for Sprint 1**.  
>  
> Sprint 1 concludes when a claim is submitted from the field and placed **`UNDER_REVIEW`** by the back-office Claims Officer.

---

## 2. Sprint 1 Scope (Current Phase)

Sprint 1 delivers the foundational end-to-end operational loop between the Claims Officer (Web Dashboard) and the Field Adjuster (Flutter Mobile App):

```
┌───────────────────────────────┐
│     Claims Officer (Web)      │
│  1. Create Claim (NEW)        │
│  2. Assign Adjuster (ASSIGNED)│
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│     Field Adjuster (Mobile)   │
│  3. View Assigned Claim       │
│  4. Vehicle & Policy Lookup   │
│  5. Record Vehicle Info       │
│  6. Record Accident Details   │
│  7. Capture GPS Location      │
│  8. Submit (SUBMITTED)        │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│     Claims Officer (Web)      │
│  9. Open Claim on Dashboard   │
│ 10. Start Review (UNDER_REVIEW)│
└───────────────────────────────┘
```

### Sprint 1 Implemented Endpoints:
1. `POST /api/v1/auth/login` — Login using `organizationCode`, `employeeCode`, `password`
2. `PUT /api/v1/auth/change-password` — Change password for authenticated users
3. `POST /api/v1/claims` — Intake & claim creation (`CLAIMS_OFFICER` only)
4. `GET /api/v1/claims` — List claims (scoped to organization; adjusters see only assigned claims)
5. `GET /api/v1/claims/:claimId` — Detailed claim view with timeline audit trail
6. `GET /api/v1/users/adjusters?status=available` — Filter available field adjusters
7. `POST /api/v1/claims/:claimId/assign` — Assign claim to field adjuster (`CLAIMS_OFFICER` only)
8. `GET /api/v1/vehicles/lookup?plateNumber=...` — Query vehicle, policy, customer data (`FIELD_ADJUSTER` only)
9. `PUT /api/v1/claims/:claimId/vehicle` — Associate verified vehicle & policy to claim
10. `PUT /api/v1/claims/:claimId/accident` — Record accident type, date, time, damage description
11. `PUT /api/v1/claims/:claimId/location` — Capture GPS coordinates, timestamp, address
12. `POST /api/v1/claims/:claimId/inspection/submit` — Validate inspection completeness and submit
13. `POST /api/v1/claims/:claimId/review/start` — Transition claim to `UNDER_REVIEW` (`CLAIMS_OFFICER` only)
14. User Administration APIs (`POST /users`, `GET /users`, `PATCH /users/:id/status`, `PATCH /users/:id/reset-password`) for `ADMIN`.

---

## 3. Sprint 2 Scope (Future Roadmap)

Sprint 2 builds on the validated inspection pipeline to complete claim adjudication and media handling:
- **Decision Engine:** `POST /api/v1/claims/:claimId/decision` transitioning `UNDER_REVIEW` → `APPROVED` or `REJECTED`.
- **Administrative Closure:** `POST /api/v1/claims/:claimId/close` transitioning `APPROVED` → `CLOSED`.
- **Media & Evidence Storage:** Cloud storage (e.g., AWS S3 / Google Cloud Storage) integration for high-resolution vehicle damage photos and inspection evidence.
- **Digital Signatures:** Secure persistence of customer and adjuster signatures collected in the field.
- **Tenant-Scoped Counter Sequence:** Migration of global claim numbers (`CLM-xxxx`) to organization-scoped sequences (`CLM-<ORG>-xxxx`).
- **Real-Time Push Notifications:** WebSockets or Firebase Cloud Messaging (FCM) alerting adjusters to new dispatches and officers to completed submissions.
- **Aggregation Optimizations:** Replacing in-memory adjuster workload loops with MongoDB aggregation pipelines.
- **Pagination & Query Limits:** Cursor-based or offset-based pagination on claim listings.

---

## 4. In Scope vs. Out of Scope Matrix

| Capability | In Scope (Sprint 1) | Out of Scope (Sprint 1) | Target Sprint |
|---|:---:|:---:|:---:|
| Tenant-Scoped JWT Authentication | ✅ | | Sprint 1 |
| RBAC (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`) | ✅ | | Sprint 1 |
| Claim Creation by Claims Officer | ✅ | | Sprint 1 |
| Field Adjuster Dispatch & Availability Check | ✅ | | Sprint 1 |
| Vehicle & Policy Plate Lookup (Mock DB) | ✅ | | Sprint 1 |
| Partial / Incremental Inspection Updates (Drafting) | ✅ | | Sprint 1 |
| Inspection Completeness Validation | ✅ | | Sprint 1 |
| Atomic State Transition to `SUBMITTED` | ✅ | | Sprint 1 |
| Review Initiation to `UNDER_REVIEW` | ✅ | | Sprint 1 |
| Audit Timeline Tracking Per Mutation | ✅ | | Sprint 1 |
| Claim Decision (`APPROVED` / `REJECTED`) | | ❌ | Sprint 2 |
| Admin Claim Closure (`CLOSED`) | | ❌ | Sprint 2 |
| File / Photo Binary Upload to Cloud Object Storage | | ❌ | Sprint 2 |
| Server-side OCR Plate Recognition Engine | | ❌ | Sprint 2 |
| Multi-vehicle / Third-Party Counter-Claims | | ❌ | Sprint 3+ |
| Payout / Workshop Estimation Integrations | | ❌ | Sprint 3+ |

---

## 5. MoSCoW Prioritization (Sprint 1)

### Must Have
- Cryptographic tenant isolation across all endpoints.
- Role-based route authorization.
- Atomic state transitions preventing TOCTOU races (`NEW` → `ASSIGNED` → `SUBMITTED` → `UNDER_REVIEW`).
- Plate lookup resolving vehicle, customer, and policy with expired policy warnings.
- Completeness validation before inspection submission.

### Should Have
- ObjectId syntax validation on URL parameters (`:claimId`, `:userId`).
- Fail-fast environment variable validation at application startup.
- Normalized error response payloads for client predictability.

### Could Have
- Org-scoped claim numbering (acceptable as global counter for MVP).
- Login rate limiting (mitigated by org code + employee code requirement for MVP).

### Won't Have (in Sprint 1)
- Approval, rejection, or closure APIs.
- Cloud binary uploads or streaming.
- Payment gateway integrations.

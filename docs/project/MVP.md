# InsurFlow — MVP & Sprint Scope Definition

## 1. Executive Summary: Core Backend Complete

InsurFlow's backend has completed both **Sprint 1 (Intake, Dispatch & Field Inspection)** and **Sprint 2 (Adjudication Engine, Admin Governance, 9-Status State Machine, Performance & Security Hardening)**.

The backend delivers the full operational lifecycle:
`NEW → ASSIGNED → IN_PROGRESS → SUBMITTED → UNDER_REVIEW → APPROVED / REJECTED → CLOSED`, along with the iterative back-office correction loop (`UNDER_REVIEW → CORRECTION_REQUIRED → IN_PROGRESS → SUBMITTED`).

---

## 2. Core Implemented Scope (Sprint 1 & Sprint 2 Completed)

```
┌────────────────────────────────────────────────────────┐
│               Claims Officer / Admin (Web)             │
│  1. Create Claim (NEW)                                 │
│  2. Dispatch to Adjuster (ASSIGNED)                    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                Field Adjuster (Mobile)                 │
│  3. Start Inspection (IN_PROGRESS)                     │
│  4. Lookup Vehicle & Policy via plate                  │
│  5. Incremental drafts: Vehicle, Accident, GPS Location│
│  6. Validate 3 pillars & Submit (SUBMITTED)            │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│               Claims Officer / Admin (Web)             │
│  7. Open Claim & Start Review (UNDER_REVIEW)           │
│  8. Iterative Correction Loop if needed:               │
│     Request Correction (CORRECTION_REQUIRED)           │
│  9. Adjudicate: Approve or Reject (APPROVED/REJECTED)  │
│ 10. Admin Case Archival & Sign-Off (CLOSED)            │
└────────────────────────────────────────────────────────┘
```

### Complete Implemented Backend Endpoints:
1. `POST /api/v1/auth/login` — Tenant-scoped login (`organizationCode`, `employeeCode`, `password`)
2. `PUT /api/v1/auth/change-password` — Self-service password change
3. `POST /api/v1/claims` — Intake & claim creation (`CLAIMS_OFFICER` only)
4. `GET /api/v1/claims` — List claims (with pagination headers & role filtering)
5. `GET /api/v1/claims/:claimId` — Detailed claim view with timeline audit trail
6. `GET /api/v1/users/adjusters?status=available` — Filter available field adjusters ($\le 3$ active tasks)
7. `POST /api/v1/claims/:claimId/assign` — Assign claim to field adjuster (`CLAIMS_OFFICER` only)
8. `POST /api/v1/claims/:claimId/inspection/start` — Start/resume inspection (`FIELD_ADJUSTER` only)
9. `GET /api/v1/vehicles/lookup?plateNumber=...` — Query vehicle, policy, customer data (`FIELD_ADJUSTER` only)
10. `PUT /api/v1/claims/:claimId/vehicle` — Associate verified vehicle & policy to claim
11. `PUT /api/v1/claims/:claimId/accident` — Record accident type, date, time, damage description
12. `PUT /api/v1/claims/:claimId/location` — Capture GPS coordinates, timestamp, address
13. `POST /api/v1/claims/:claimId/inspection/submit` — Validate 3 pillars and submit report
14. `POST /api/v1/claims/:claimId/review/start` — Transition claim to `UNDER_REVIEW`
15. `POST /api/v1/claims/:claimId/review/request-correction` — Send claim back with notes (`CORRECTION_REQUIRED`)
16. `POST /api/v1/claims/:claimId/decision` — Approve or Reject claim (`CLAIMS_OFFICER`, `ADMIN`)
17. `POST /api/v1/claims/:claimId/close` — Final closure and archival (`ADMIN` only)
18. `POST /api/v1/users` — Admin create staff user
19. `GET /api/v1/users` — Admin list organization users with pagination
20. `PATCH /api/v1/users/:id/status` — Admin toggle user status (`ACTIVE` / `INACTIVE`)
21. `PATCH /api/v1/users/:id/reset-password` — Admin password reset
22. `GET /health` — Health check endpoint

---

## 3. Future Roadmap (Sprint 3+)

- **Media & Evidence Storage:** Cloud object storage (e.g., AWS S3 / Cloudinary) integration for damage photos and document uploads.
- **Digital Signatures:** Secure cryptographic persistence of customer and adjuster signatures collected in the field.
- **Real-Time Push Notifications:** WebSockets or Firebase Cloud Messaging (FCM) alerting adjusters to new dispatches and officers to completed submissions.
- **Multi-Vehicle / Third-Party Counter-Claims:** Support for multi-party accident claims.
- **Workshop Estimation & Automated Payouts:** Integration with repair shop estimation software and banking gateways.

---

## 4. Capability Delivery Matrix

| Capability | Status | Delivered In |
|---|:---:|:---:|
| Tenant-Scoped JWT Authentication & Password Change | ✅ Complete | Sprint 1 |
| RBAC (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`) | ✅ Complete | Sprint 1 |
| Claim Creation by Claims Officer | ✅ Complete | Sprint 1 |
| Field Adjuster Dispatch & Availability Check ($\le 3$ active tasks) | ✅ Complete | Sprint 1 / Sprint 2 |
| Vehicle & Policy Plate Lookup (Mock DB) | ✅ Complete | Sprint 1 |
| Partial / Incremental Inspection Updates (`IN_PROGRESS`) | ✅ Complete | Sprint 1 / Sprint 2 |
| Inspection Completeness Validation (3 Pillars) | ✅ Complete | Sprint 1 |
| Atomic State Transition to `SUBMITTED` | ✅ Complete | Sprint 1 / Sprint 2 |
| Review Initiation to `UNDER_REVIEW` | ✅ Complete | Sprint 1 |
| Audit Timeline Tracking Per Mutation with Previous/New Status | ✅ Complete | Sprint 1 / Sprint 2 |
| Tenant-Scoped Sequential Numbering (`CLM-<ORG>-NNNN`) | ✅ Complete | Sprint 2 |
| Claim Decision Engine (`APPROVED` / `REJECTED`) | ✅ Complete | Sprint 2 |
| Admin Claim Closure (`CLOSED`) | ✅ Complete | Sprint 2 |
| Status Machine Expansion (`IN_PROGRESS` + Correction Loop) | ✅ Complete | Sprint 2 |
| Single-Query Aggregation for Adjuster Workload ($Lookup) | ✅ Complete | Sprint 2 |
| Header-Based Pagination (`X-Total-Count`, etc.) | ✅ Complete | Sprint 2 |
| Multi-Tier Rate Limiting (`loginLimiter` + `apiLimiter`) | ✅ Complete | Sprint 2 |
| Cloud Object Storage for High-Resolution Photos | ⏳ Planned | Sprint 3+ |
| Digital Signatures on Mobile | ⏳ Planned | Sprint 3+ |
| Real-Time Web / Push Notifications | ⏳ Planned | Sprint 3+ |


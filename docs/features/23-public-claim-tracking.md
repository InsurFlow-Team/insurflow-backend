# Feature 23 — Public Claim Tracking

> **Status:** Implemented & Verified  
> **Sprint:** Post-Sprint 2  
> **Test Suite:** `tests/claim.publicTracking.test.js` (33 tests)

---

## 1. Overview

Provides a **public, read-only claim tracking experience** for insurance claimants (customers). Each claim automatically receives a unique, cryptographically random tracking token at creation time. The customer can open the tracking URL without logging in and see the high-level progress of their claim.

**Key Design Principles:**
- No customer account or login required.
- Minimal data exposure — only intentionally public fields.
- Opaque 256-bit random tracking tokens prevent enumeration.
- Dedicated public DTO — never shares code with internal claim response.
- Rate-limited via existing `apiLimiter`.

---

## 2. Endpoint

### `GET /api/v1/public/claims/track/:trackingToken`

| Property | Value |
|---|---|
| **Authentication** | None (public) |
| **Authorization** | Token is the sole authorization |
| **Rate Limiting** | Yes — existing `apiLimiter` (300 req/15min per IP) |
| **Cache-Control** | `no-store` (prevents browser/CDN caching) |

### Request

| Parameter | Location | Format | Required |
|---|---|---|---|
| `trackingToken` | URL path | 64-character lowercase hex string | Yes |

### Success Response (200 OK)

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
      {
        "label": "Claim Received",
        "timestamp": "2026-09-20T10:30:00.000Z"
      },
      {
        "label": "Inspector Assigned",
        "timestamp": "2026-09-21T09:00:00.000Z"
      }
    ]
  }
}
```

### Error Response (404 — invalid/unknown/malformed token)

```json
{
  "success": false,
  "message": "Claim not found"
}
```

> **Security:** Always returns the same generic 404 for malformed tokens, unknown tokens, and non-existent tokens. No information leakage about claim existence.

---

## 3. Customer-Friendly Status Mapping

| Internal Status | Public Status | Customer Description |
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

---

## 4. Public Timeline Events

Only the following internal timeline actions are exposed as customer-visible milestones:

| Internal Action | Public Label |
|---|---|
| `Claim Created` | Claim Received |
| `[ASSIGNMENT ACCEPTED]...` / `Assignment Accepted` | Inspector Assigned |
| `Inspection Started` / `Inspection Resumed` | Inspection Started |
| `Inspection Submitted` | Inspection Submitted |
| `Review Started` | Review Started |
| `Claim Approved` / `Decision: APPROVED` | Claim Approved |
| `Claim Rejected` / `Decision: REJECTED` | Claim Declined |
| `Claim Closed` | Claim Closed |

All other timeline events (assignment, decline, correction requests, location updates, evidence uploads, vehicle updates) are **internal-only** and excluded from the public response.

---

## 5. Tracking Token

- **Format:** 64-character lowercase hexadecimal string (32 random bytes)
- **Entropy:** 256 bits — not bruteforceable
- **Generation:** Automatic at claim creation time (`crypto.randomBytes(32).toString('hex')`)
- **Storage:** Plaintext field on Claim document with single-field unique sparse index
- **Returned in:** `POST /api/v1/claims` response (new `trackingToken` field)
- **Expiration:** None (MVP)
- **Revocation:** Not supported (MVP)

---

## 6. Security Controls

| Concern | Mitigation |
|---|---|
| Enumeration | 256-bit random tokens (2^256 search space) |
| Information leakage | Identical 404 for malformed, unknown, and non-existent tokens (mitigates response-shape/status enumeration) |
| PII exposure | Dedicated public DTO — no IDs, phone, evidence, financials, notes, coordinates |
| Cross-tenant access | Token uniquely identifies one claim; no tenant filtering needed |
| Caching of sensitive data | `Cache-Control: no-store`, `Pragma: no-cache` headers applied unconditionally |
| Rate limiting | Existing `apiLimiter` (300 req/15min per IP) |
| Token format validation | 64-char lowercase hex regex check before DB query |

---

## 7. Data Exposure — Fields Intentionally Public

| Field | Source |
|---|---|
| `claimNumber` | `claim.claimNumber` |
| `status` | Mapped from `claim.status` via `PUBLIC_STATUS_MAP` |
| `statusDescription` | Human-readable description from `PUBLIC_STATUS_MAP` |
| `customerName` | `claim.customer.name` |
| `incidentType` | `claim.incidentType` |
| `createdAt` | `claim.createdAt` |
| `updatedAt` | `claim.updatedAt` |
| `timeline[]` | Filtered from `claim.timeline` via `PUBLIC_TIMELINE_MAP` |

---

## 8. Data Intentionally Excluded

- Internal MongoDB `_id`
- `organizationId`
- `trackingToken` (not echoed back)
- `createdBy`, `assignedTo`, `assignedBy` (user references)
- `customer.phone`
- `vehicle`, `policyId`, `coverageSnapshot`
- `evidence[]`, `signature`
- `location`, `incidentLocation`, `incidentCoordinates`
- `decisionNotes`, `closingNotes`, `assignmentNotes`
- `lossAssessment`
- Timeline `performedBy`, `role`, `notes`, `previousStatus`, `newStatus`

---

## 9. Files Changed

| File | Change |
|---|---|
| `src/modules/claims/claim.model.js` | Added `trackingToken` field + single-field unique sparse index |
| `src/modules/claims/claim.repository.js` | Added `findByTrackingToken()` method |
| `src/modules/claims/claim.service.js` | Added `crypto` import, token generation in `createClaim`, `PUBLIC_STATUS_MAP`, `PUBLIC_TIMELINE_MAP`, `getPublicClaimStatus()` |
| `src/modules/claims/claim.public.controller.js` | **New** — Public controller with token format validation |
| `src/modules/claims/claim.public.routes.js` | **New** — Public route (no auth middleware) |
| `src/app.js` | Mounted public routes at `/api/v1/public` |
| `tests/claim.publicTracking.test.js` | **New** — 33 integration tests |

---

## 10. Test Coverage (33 Tests)

- **Functional:** Valid token, unknown token, malformed tokens (3 variants), cache headers, createClaim integration
- **Status Mapping:** All 10 internal statuses verified against expected public mapping
- **Security:** No leakage of `_id`, `organizationId`, user refs, evidence, signature, notes, financials, phone, token, policy/vehicle/location
- **Timeline:** Customer-visible filtering, empty timeline, no internal fields in events
- **Cross-Organization:** Org1/Org2 isolation via separate tokens
- **Regression:** Authenticated endpoints still require auth, still work with valid auth
- **Tracking Token Retrieval:** Authenticated `GET /claims/:claimId` returns trackingToken, while list `GET /claims` strictly excludes it
- **Rate Limiting:** Public endpoint respects existing rate limiter

# Feature Specification: Final Claim Report (PDF Dossier)

## 1. Feature Overview
The Final Claim Report generation engine provides a publication-grade, downloadable PDF dossier endpoint (`GET /api/v1/claims/:claimId/report`) designed for legal record-keeping, insurance underwriting archives, and customer settlement summaries.

To ensure compliance, multi-tenancy isolation, and operational reliability:
1. **Multi-Tenancy Isolation:** The claim and all related domain entities are strictly resolved using the caller's authenticated `organizationId` from JWT claims. Non-existent or cross-tenant claims return stealth `404 Not Found`.
2. **Authorized Roles (RBAC):** Access is restricted exclusively to **`ADMIN`** and **`CLAIMS_OFFICER`**. Field adjusters (`FIELD_ADJUSTER`) are rejected with `HTTP 403 Forbidden` (`FORBIDDEN_RESOURCE`), even if assigned to the claim.
3. **Terminal Decision Precondition & Precedence:** Reports can only be generated once a claim has reached a final decision status: **`APPROVED`**, **`REJECTED`**, or **`CLOSED`**. Requests on in-flight or unadjudicated claims return `HTTP 409 Conflict` (`INVALID_STATUS_TRANSITION`). The 404 existence check strictly precedes the 409 status check to prevent status leakage.
4. **Full Domain Hydration:** In addition to populated claim fields (`createdBy`, `assignedTo`, `closedBy`, etc.), the report engine hydrates vehicle details (`Vehicle`), active coverage policies (`Policy`), and company metadata (`Organization`).
5. **Resilient Asset Pipeline:** Embedded evidence photos and signatures undergo Cloudinary on-the-fly transformations and graceful degradation via fallback placeholder blocks if remote assets fail to load.
6. **Buffer-Then-Send Delivery:** The document is built into an in-memory `Buffer` prior to transmission, preserving standard JSON error envelopes should any unexpected error occur.
7. **Law 10 Compliance Note (`pdfmake`):** `pdfmake` (v0.3.x) is explicitly authorized as a lightweight, pure-JavaScript PDF generation engine that avoids the heavy operational and memory footprint of headless Chromium (Puppeteer) while providing declarative layout definitions.

---

## 2. Endpoint Specification

### `GET /api/v1/claims/:claimId/report`
- **Purpose:** Generate and download the comprehensive, formatted PDF report for a finalized claim.
- **Authentication:** Required (JWT via `Authorization: Bearer <TOKEN>` header or httpOnly cookie).
- **Authorized Roles:** `ADMIN`, `CLAIMS_OFFICER`.
- **Path Parameters:**
  - `:claimId` (required): 24-character hexadecimal MongoDB ObjectId. Rejects invalid formats with `400 VALIDATION_ERROR`.

### Preconditions & Precedence
1. **Authentication & Role Verification:** Caller must present a valid JWT with role `ADMIN` or `CLAIMS_OFFICER`. Otherwise `401 UNAUTHORIZED` or `403 FORBIDDEN_RESOURCE`.
2. **Tenant-Scoped Lookup (404-before-409 Precedence):** Claim is queried with `{ _id: claimId, organizationId: authUser.organizationId }`. If not found, returns `404 CLAIM_NOT_FOUND` immediately.
3. **Lifecycle Status Verification (Terminal State Invariant):** Claim `status` must be one of `['APPROVED', 'REJECTED', 'CLOSED']`. If the claim is in `NEW`, `ASSIGNED`, `IN_PROGRESS`, `SUBMITTED`, `UNDER_REVIEW`, or `CORRECTION_REQUIRED`, returns `409 INVALID_STATUS_TRANSITION` with exact detail:
   ```
   Report is only available for claims with a final decision (APPROVED, REJECTED, or CLOSED).
   ```

### Response Delivery Model
- **HTTP Status:** `200 OK`
- **Response Type:** Binary stream (`Buffer`)
- **Response Headers:**
  ```http
  Content-Type: application/pdf
  Content-Disposition: attachment; filename="<claimNumber>-report.pdf"
  ```
- **Error Response Shape:** Under any error condition (400, 401, 403, 404, 409, 500), the response remains the project's standard JSON envelope:
  ```json
  {
    "success": false,
    "message": "Error description",
    "errors": [
      {
        "code": "ERROR_CODE",
        "details": "Error details"
      }
    ]
  }
  ```

---

## 3. Hydration Scope & Data Assembly

The report aggregates data across 4 distinct models and populated user references:

```
                      ┌──────────────────────┐
                      │     Organization     │
                      │  (name, code)        │
                      └──────────┬───────────┘
                                 │
                                 ▼
┌─────────────────┐   ┌──────────────────────┐   ┌──────────────────┐
│     Vehicle     ├──▶│        Claim         │◀──┤      Policy      │
│ (make, model,   │   │  (claimNumber, dates,│   │  (policyNumber,  │
│  year, color)   │   │   status, accident)  │   │   dates, status) │
└─────────────────┘   └──────────┬───────────┘   └──────────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          ▼                      ▼                      ▼
  Evidence Photos         Digital Signature      Audit Timeline
  (Cloudinary URLs)       (Cloudinary URL)       (all state events)
```

1. **Claim Document (`claimRepository.findForReport`):**
   - Populates user metadata (`name`, `employeeCode`, `role`) on:
     - `createdBy`
     - `assignedTo`
     - `assignedBy`
     - `closedBy`
     - `signature.capturedBy`
     - `evidence.uploadedBy`
     - `timeline.performedBy`
2. **Vehicle (`vehicleRepository.findByIdAndOrganization`):**
   - Fetched via `claim.vehicle.vehicleId` with tenant scoping.
   - Supplies `make`, `model`, `year`, `color`, and confirmed `plateNumber`.
3. **Policy (`policyRepository.findByIdAndOrganization`):**
   - Fetched via `claim.vehicle.policyId` with tenant scoping.
   - Supplies `policyNumber`, `status`, `startDate`, and `expiryDate`.
4. **Organization (`Organization.findById(organizationId)`):**
   - Supplies company header name and organization code.
5. **Decider & Closer Resolution:**
   - **Decider:** Extracted from the latest `Claim Approved` / `Claim Rejected` timeline event or populated decider fields.
   - **Closer:** If `status === 'CLOSED'`, resolved from `claim.closedBy` or the `Claim Closed` timeline event.

---

## 4. Remote Image Pipeline & Fault Tolerance

The PDF document embeds high-resolution visual evidence collected during field inspections (accident photos and digital signature).

### Dynamic Cloudinary Transformation
To optimize PDF generation latency, memory consumption, and document file size, remote Cloudinary URLs are automatically rewritten on-the-fly before retrieval:
```javascript
// URL Rewrite Rule
fetchUrl = rawUrl.replace('/upload/', '/upload/w_800,c_limit,q_auto:good,f_jpg/');
```
- Limits image width to a maximum of 800px while maintaining original aspect ratio (`w_800,c_limit`).
- Automatically compresses with good visual quality balance (`q_auto:good`).
- Enforces JPEG format output (`f_jpg`).

### Graceful Degradation (Placeholder Bounding Box)
Remote network calls are wrapped in per-image `try/catch` blocks with a 10-second timeout (`AbortSignal.timeout(10000)`):
- If an image fails to fetch (e.g., HTTP 404, HTTP 500, network timeout, DNS resolution failure), the error is logged as a server-side warning.
- The image is replaced by a stylized placeholder table block in the document definition:
  ```
  +---------------------------------------------------------------+
  | [Image unavailable: <Label> — Failed to retrieve remote asset] |
  +---------------------------------------------------------------+
  ```
- **Invariant:** Remote asset fetch failures **never** crash PDF generation or cause the endpoint to return an HTTP 500.

---

## 5. Document Structure & Layout Specification

The document definition is structured with the following layout hierarchy:

1. **Header & Metadata:**
   - Organization name and code (left-aligned, bold primary navy `#1e3a8a`).
   - Document title (`FINAL CLAIM REPORT`).
   - Claim Number (`CLM-<ORG>-NNNN`), status badge (color-coded: Green `#16a34a` for `APPROVED`, Red `#dc2626` for `REJECTED`, Slate `#475569` for `CLOSED`), and UTC generation timestamp.
   - Solid divider rule (`#1e3a8a`).
2. **Section 1: Customer Information:**
   - Customer name, phone number, incident location.
3. **Section 2: Vehicle & Policy Details (Hydrated):**
   - 4-column key-value grid: Plate Number, Policy Number, Make / Model, Policy Status, Year / Color, Coverage Date Window.
4. **Section 3: Accident Details:**
   - Accident Type, Date & Time, Description, Damage Description.
5. **Section 4: Location & GPS Coordinates:**
   - Text address, latitude & longitude coordinates, capture timestamp.
6. **Section 5: Evidence Photos:**
   - 2-column grid displaying photo type label, uploader name, upload timestamp, and embedded photo (or placeholder).
7. **Section 6: Digital Signature:**
   - Embedded signature image, signer role, capturer name, and sign-off timestamp.
8. **Section 7: Decision Outcome:**
   - Final decision (`APPROVED` / `REJECTED`), Decider name and employee code, decision timestamp, decision notes.
9. **Section 8: Claim Closure (Conditional):**
   - Included only when `status === 'CLOSED'`. Closed by name and employee code, closure timestamp, closing notes.
10. **Section 9 / 8: Timeline Audit Trail:**
    - Full chronologically ordered table with header: Timestamp, Action, Performer, State Transition, Notes. Alternating row shading (`#ffffff` / `#f8fafc`).
11. **Page Footer:**
    - Dynamic page numbering on every page: `InsurFlow Confidential • Page X of Y` (`#9ca3af`, 7.5pt).

---

## 6. Test Suite Coverage (`tests/claim.report.test.js`)

All 9 test cases execute against in-memory MongoDB with mocked network assets:

| # | Test Case Description | Verified Invariants | Status |
|---|---|---|:---:|
| 1 | `200 for ADMIN on an APPROVED claim` | Verifies `Content-Type: application/pdf`, `Content-Disposition` containing filename with claimNumber, and `%PDF` magic bytes. | ✅ Pass |
| 2 | `200 for CLAIMS_OFFICER on a REJECTED claim` | Verifies officer authorization on rejected claims with proper headers and valid PDF bytes. | ✅ Pass |
| 3 | `200 for CLAIMS_OFFICER on a CLOSED claim` | Verifies rendering of conditional closure block (Section 8) without breaking generation. | ✅ Pass |
| 4 | `403 for FIELD_ADJUSTER` | Verifies field adjusters cannot download reports even on their own assigned claims. | ✅ Pass |
| 5 | `404 when claim does not exist` | Verifies `CLAIM_NOT_FOUND` error envelope for non-existent claim ID. | ✅ Pass |
| 6 | `404 on cross-tenant access` | Verifies multi-tenancy isolation: requesting another org's claim returns stealth 404. | ✅ Pass |
| 7 | `409 INVALID_STATUS_TRANSITION on non-terminal status` | Verifies 409 rejection across `IN_PROGRESS`, `SUBMITTED`, and `UNDER_REVIEW` with exact error message. | ✅ Pass |
| 8 | `Graceful degradation on HTTP 500 image fetch` | Verifies 200 and valid PDF returned when remote image fetch fails with HTTP 500. | ✅ Pass |
| 9 | `Graceful degradation on network timeout` | Verifies 200 and valid PDF returned when remote image fetch rejects with network timeout. | ✅ Pass |

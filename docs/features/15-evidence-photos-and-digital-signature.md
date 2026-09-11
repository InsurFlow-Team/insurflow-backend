# Feature Specification: Evidence Photos & Digital Signature (Cloudinary)

## 1. Feature Overview
During on-site accident assessment, a **`FIELD_ADJUSTER`** collects visual proof and customer/adjuster confirmation while the claim is in the **`IN_PROGRESS`** inspection state. This feature adds the final two operational inspection components:
1. **Photo Evidence Capture:** Repeatable, categorized image uploads stored in Cloudinary under tenant-isolated folders. Multiple photos can be uploaded incrementally and additively.
2. **Digital Signature Sign-Off:** A singular digital signature capturing the sign-off for the inspection, stored in Cloudinary. Subsequent uploads cleanly overwrite previous signatures to handle retries without orphan records.

Both components are mandatory pillars verified before an inspection can be submitted (`POST /claims/:claimId/inspection/submit`).

For lifecycle transitions and prerequisites, refer to the authoritative [Status Machine Expansion Specification](./14-status-machine-expansion.md).

---

## 2. Technical Architecture & Component Structure

### 2.1 File Upload & Cloud Storage Infrastructure
- **Multer Memory Storage ([src/middlewares/upload.middleware.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/middlewares/upload.middleware.js)):**
  - Configured with `multer.memoryStorage()` to buffer files in memory as `Buffer` objects, avoiding temporary disk writes on serverless or ephemeral container hosts.
  - File size limit enforced at **10MB** (`limits: { fileSize: 10 * 1024 * 1024 }`). Oversized files emit `LIMIT_FILE_SIZE`, mapped by [src/middlewares/errorHandler.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/middlewares/errorHandler.js) to `400 VALIDATION_ERROR`.
  - File MIME whitelist: strictly `image/jpeg`, `image/png`, and `image/webp`. Disallowed types return `400 VALIDATION_ERROR` via `AppError`.
- **Cloudinary Streaming Uploader ([src/utils/uploadToCloudinary.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/utils/uploadToCloudinary.js)):**
  - Streams raw file buffers directly to Cloudinary using `cloudinary.uploader.upload_stream(...)`.
  - Tenant-scoped storage pathing:
    - Evidence: `insurflow/${authUser.organizationId}/evidence`
    - Signature: `insurflow/${authUser.organizationId}/signatures`
  - Encapsulated in an isolated utility function to allow complete mocking during unit and integration testing without invoking the real Cloudinary API.

### 2.2 Data Model ([src/modules/claims/claim.model.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.model.js))
```javascript
evidence: {
  type: [
    {
      imageType: {
        type: String,
        enum: ['VEHICLE_FRONT', 'VEHICLE_REAR', 'VEHICLE_SIDE', 'DAMAGE_CLOSEUP', 'DRIVER_LICENSE', 'OTHER'],
        required: true,
      },
      url: { type: String, required: true },
      publicId: { type: String, required: true },
      uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      uploadedAt: { type: Date, default: Date.now },
    },
  ],
  default: [],
},
signature: {
  url: { type: String, default: null },
  publicId: { type: String, default: null },
  capturedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  capturedAt: { type: Date, default: null },
},
```

### 2.3 Atomic Repository Layer ([src/modules/claims/claim.repository.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.repository.js))
Write operations strictly enforce tenant boundaries, assigned ownership, and the `IN_PROGRESS` status invariant in a single atomic MongoDB query:
```javascript
// Additive Evidence Upload ($push)
Claim.findOneAndUpdate(
  { _id: claimId, organizationId, status: 'IN_PROGRESS', assignedTo },
  { $push: { evidence: evidenceItem, timeline: timelineEvent } },
  { returnDocument: 'after' }
).lean();

// Singular Overwritable Signature ($set)
Claim.findOneAndUpdate(
  { _id: claimId, organizationId, status: 'IN_PROGRESS', assignedTo },
  { $set: { signature: signatureData }, $push: { timeline: timelineEvent } },
  { returnDocument: 'after' }
).lean();
```

---

## 3. API Contract & Endpoints

### 3.1 POST `/api/v1/claims/:claimId/evidence`
Uploads a single categorized inspection photo.

* **Authorized Roles:** `FIELD_ADJUSTER` (assigned adjuster only).
* **Preconditions:** Claim must be in status `IN_PROGRESS`.
* **Content-Type:** `multipart/form-data`
* **Form Fields:**
  * `file`: Binary image file (JPEG, PNG, WEBP, $\le$ 10MB). Required.
  * `imageType`: String enum. Required. One of:
    * `VEHICLE_FRONT`
    * `VEHICLE_REAR`
    * `VEHICLE_SIDE`
    * `DAMAGE_CLOSEUP`
    * `DRIVER_LICENSE`
    * `OTHER`
* **Middleware Chain Order:** `upload.single('file')` precedes `validate(uploadEvidenceSchema)` so `req.body` text fields are populated prior to Joi validation.
* **Timeline Event:**
  * `action`: `'Evidence Uploaded'`
  * `previousStatus`: `null`
  * `newStatus`: `null`
  * `notes`: `imageType` value
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Evidence uploaded successfully",
    "data": {
      "status": "IN_PROGRESS",
      "evidence": [
        {
          "imageType": "VEHICLE_FRONT",
          "url": "https://res.cloudinary.com/...",
          "publicId": "...",
          "uploadedBy": "60d0fe4f5311236168a109d0",
          "uploadedAt": "2026-09-11T08:00:00.000Z"
        }
      ]
    }
  }
  ```

---

### 3.2 POST `/api/v1/claims/:claimId/signature`
Uploads or re-captures the digital signature.

* **Authorized Roles:** `FIELD_ADJUSTER` (assigned adjuster only).
* **Preconditions:** Claim must be in status `IN_PROGRESS`.
* **Content-Type:** `multipart/form-data`
* **Form Fields:**
  * `file`: Binary image file (JPEG, PNG, WEBP, $\le$ 10MB). Required.
* **Timeline Event:**
  * `action`: `'Signature Captured'`
  * `previousStatus`: `null`
  * `newStatus`: `null`
  * `notes`: `null`
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Signature captured successfully",
    "data": {
      "status": "IN_PROGRESS",
      "signature": {
        "url": "https://res.cloudinary.com/...",
        "publicId": "...",
        "capturedBy": "60d0fe4f5311236168a109d0",
        "capturedAt": "2026-09-11T08:00:00.000Z"
      }
    }
  }
  ```

---

## 4. Five Mandatory Pillars of Inspection Submission

The submission endpoint (`POST /claims/:claimId/inspection/submit`) enforces five mandatory inspection pillars:
1. **Vehicle Verified:** `claim.vehicle.vehicleId != null`
2. **Accident Recorded:** `claim.accident.accidentType != null`
3. **Location Captured:** `claim.location.latitude != null && claim.location.longitude != null`
4. **Evidence Uploaded:** `claim.evidence.length >= 1`
5. **Signature Captured:** `claim.signature.url != null`

If any pillar is missing, submission is rejected with **`422 Unprocessable Entity`** (`INSPECTION_INCOMPLETE`), detailing all missing requirements (e.g. `"Inspection incomplete. Missing: evidence, signature"`).

---

## 5. Security, Multi-Tenancy & Error Handling

* **Stealth Multi-Tenancy:** Calls by an adjuster to a claim belonging to another tenant or assigned to a different adjuster return `404 Not Found` (`CLAIM_NOT_FOUND`).
* **Status Invariant (409):** Upload attempts on claims not currently in `IN_PROGRESS` (e.g. `ASSIGNED`, `SUBMITTED`, `UNDER_REVIEW`) return `409 Conflict` (`INVALID_STATUS_TRANSITION`).
* **File Validation (400):**
  * Missing file: `400 VALIDATION_ERROR` (`An image file is required`).
  * Oversized file ($>10$MB): `400 VALIDATION_ERROR` (`File size exceeds limit of 10MB`).
  * Invalid MIME type: `400 VALIDATION_ERROR` (`Only JPEG, PNG, and WEBP images are allowed`).
  * Invalid `imageType`: `400 VALIDATION_ERROR`.
* **RBAC (403):** Access by non-`FIELD_ADJUSTER` roles (e.g. `CLAIMS_OFFICER`, `ADMIN`) returns `403 Forbidden`.

---

## 6. Automated Testing Suite

Tested and verified in [tests/claim.evidence.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/claim.evidence.test.js) (11 tests):
* Evidence upload happy path with timeline event recording (200).
* Additive persistence across multiple evidence photo uploads.
* Rejection on missing file (400).
* Rejection on invalid `imageType` enum (400).
* Rejection on file size exceeding 10MB (400).
* Rejection on disallowed file MIME types (400).
* Signature capture happy path and singular object format (200).
* Signature overwrite without duplication (200).
* Invariant enforcement on `ASSIGNED` claims (409).
* Stealth 404 rejection on cross-adjuster and cross-tenant access.
* 5-pillar completeness verification during `inspection/submit` (422 when evidence/signature missing, 200 when complete).

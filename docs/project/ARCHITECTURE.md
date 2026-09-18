# InsurFlow — Backend Architecture Reference

## 1. Architectural Philosophy & Architectural Verdict
The InsurFlow backend follows a **Modular Layered Architecture** built on Node.js, Express.js, and MongoDB/Mongoose. 

> **Architectural Verdict (Validated by Independent Audit):**  
> The existing architecture is **clean, well-structured, and fundamentally sound**. It provides clear separation of concerns, robust multi-tenancy enforcement, and standard enterprise design patterns. **No architectural redesign or migration to another framework is required.**

---

## 2. Technology Stack

| Layer / Concern | Technology | Version | Purpose |
|---|---|---|---|
| **Runtime** | Node.js | v20+ LTS | Asynchronous, non-blocking runtime environment |
| **Framework** | Express.js | 5.2.x | Minimalist REST HTTP server and routing pipeline |
| **Database** | MongoDB | v6.0+ | Document database optimized for semi-structured claim records |
| **ODM** | Mongoose | 9.9.x | Schema modeling, casting, validation, and index management |
| **Language** | JavaScript | ES2022 / CommonJS | Core implementation language |
| **Authentication** | `jsonwebtoken` | 9.0.x | Stateless HS256 JWT generation and verification |
| **Password Hashing** | `bcrypt` | 6.0.x | Salted password hashing (10 rounds) |
| **Request Validation** | `joi` | 18.2.x | Schema-driven request body, query, and parameter validation |
| **Security Headers** | `helmet` | 8.3.x | HTTP security header hardening |
| **CORS** | `cors` | 2.8.x | Cross-Origin Resource Sharing control |
| **Logging** | `morgan` | 1.11.x | HTTP request logging (dev / combined) |
| **File Uploads** | `multer` | 2.3.x | In-memory multipart/form-data buffer processing |
| **Cloud Media Storage** | `cloudinary` | 2.11.x | Cloud asset storage, CDN delivery, tenant-isolated paths |
| **Test Suite** | Jest + Supertest | 29.7.x / 6.3.x | Integration and unit testing with `mongodb-memory-server` |

---

## 3. Modular Layered Pattern

Code is organized by business domain modules under `src/modules/`. Each module adheres to a strict 5-layer separation of concerns:

```
                  ┌─────────────────────────────────────┐
                  │          Incoming Request           │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 1. ROUTE LAYER (*.routes.js)                                           │
│    • Route path and HTTP verb definitions                              │
│    • Middleware composition: authenticate -> authorizeRole -> validate│
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 2. CONTROLLER LAYER (*.controller.js)                                  │
│    • Unpacks req.body, req.params, req.query, and req.user             │
│    • Delegates to Service layer                                        │
│    • Returns standard API responses (successResponse / errorResponse)  │
│    • Wrapped with asyncWrapper (no manual try/catch boilerplate)       │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 3. SERVICE LAYER (*.service.js)                                        │
│    • Pure domain and business logic                                    │
│    • State machine validation & invariant enforcement                  │
│    • Inter-repository orchestration                                    │
│    • Throws AppError with HTTP status and domain error codes           │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 4. REPOSITORY LAYER (*.repository.js)                                  │
│    • Direct Mongoose query execution                                   │
│    • Mandatory tenant filtering: { organizationId, ... }               │
│    • Atomic mutations with condition filters (findOneAndUpdate)        │
│    • Returns plain JavaScript objects via .lean() where appropriate    │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 5. MODEL LAYER (*.model.js)                                            │
│    • Mongoose schema definitions, field types, constraints             │
│    • Compound tenant-scoped unique indexes                             │
│    • Pre-save hooks (e.g., password hashing, claimNumber generation)   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Module Directory Structure

```
src/
├── app.js                   # Express application setup & middleware assembly
├── server.js                # HTTP listener & process lifecycle management
├── config/
│   ├── env.js               # Centralized configuration & fail-fast startup checks
│   ├── database.js          # Mongoose connection management
│   └── cloudinary.js        # Cloudinary SDK client configuration
├── middlewares/
│   ├── auth.middleware.js   # JWT verification & req.user attachment
│   ├── role.middleware.js   # RBAC permission checks
│   ├── validate.middleware.js# Joi boundary schema validator
│   ├── upload.middleware.js # Multer in-memory upload handler (10MB, JPEG/PNG/WEBP)
│   ├── adjusterLocation.middleware.js # Header-based GPS location capture for Field Adjusters
│   ├── rateLimiter.middleware.js # Multi-tier rate limiting (loginLimiter & apiLimiter)
│   ├── errorHandler.js      # Global centralized error response handler
│   └── notFound.js          # 404 handler for undefined endpoints
├── utils/
│   ├── apiResponse.js       # Standardized response envelopes
│   ├── appError.js          # Custom operational error class
│   ├── asyncWrapper.js      # Promise rejection forwarding to next()
│   ├── counter.model.js     # Atomic sequence counter model
│   ├── geo.utils.js         # Pure-JS Haversine distance calculator (km)
│   └── uploadToCloudinary.js# Cloudinary upload_stream buffer helper
└── modules/
    ├── auth/                # Login, JWT, password change
    ├── claims/              # Claims, inspections, evidence, signature, lifecycle
    ├── users/               # Users, adjusters, admin management
    ├── organizations/       # Tenant organization records
    ├── vehicles/            # Vehicle registry & plate lookup
    ├── policies/            # Insurance policy records
    └── customers/           # Policyholder contact entities
```

---

## 5. Cross-Cutting Architectural Concerns

### 5.1 Authentication Architecture
- **Stateless JWT:** Access tokens are signed using `HS256` with an 8-hour expiration.
- **Payload Contents:**
  ```json
  {
    "userId": "66d8...",
    "role": "FIELD_ADJUSTER",
    "organizationId": "66d7..."
  }
  ```
- **Dual Token Extraction:** `auth.middleware.js` inspects:
  1. `Authorization: Bearer <token>` header (preferred for mobile & API clients).
  2. `token` httpOnly cookie (supported for web dashboard sessions).
- **Algorithm Confusion Prevention:** `jwt.verify` strictly specifies `algorithms: ['HS256']`.
- **Password Security:** Passwords stored using `bcrypt` (10 rounds). Schema enforces `select: false` so hashes are never returned in queries unless explicitly requested via `.select('+password')`.

### 5.2 Authorization (RBAC) Architecture
- Handled by `authorizeRole([...allowedRoles])` middleware factory.
- Evaluates `req.user.role` extracted from the authenticated JWT token.
- Returns `403 Forbidden` if the user's role is not within the authorized array.
- Available System Roles:
  - `ADMIN`
  - `CLAIMS_OFFICER`
  - `FIELD_ADJUSTER`

### 5.3 Multi-Tenancy Architecture
- **The Core Tenant Boundary Rule:**  
  *Clients are NEVER allowed to provide `organizationId` in request bodies or query parameters to select or mutate tenant data.*
- The backend unconditionally extracts `organizationId` from `req.user.organizationId`.
- **Repository Isolation:** Every read and write query must include `organizationId` in its filter:
  ```javascript
  // Read
  Claim.findOne({ _id: claimId, organizationId });

  // Atomic Write
  Claim.findOneAndUpdate({ _id: claimId, organizationId, status: 'NEW' }, ...);
  ```
- **Index-Level Guarantee:** Data models maintain compound unique indexes combining `organizationId` with natural keys:
  - Claim: `{ organizationId: 1, claimNumber: 1 }` (unique)
  - User: `{ organizationId: 1, employeeCode: 1 }` (unique)
  - Vehicle: `{ organizationId: 1, plateNumber: 1 }` (unique)
  - Policy: `{ organizationId: 1, policyNumber: 1 }` (unique)
  - Notification: `{ organizationId: 1, recipientId: 1, createdAt: -1 }`

### 5.4 Database & Concurrency Design
- **Atomic Operations Over Read-Modify-Write:** Status transitions and state mutations use Mongoose `findOneAndUpdate` with state preconditions in the filter query.
  - For example, dispatching an adjuster queries `{ _id: claimId, organizationId, status: 'NEW' }` and transitions to `status: 'PENDING_ACCEPTANCE'`. If two officers attempt simultaneous assignment, exactly one succeeds and the other receives `null`, which the service converts to an HTTP 409 Conflict.
  - Acceptance (`POST /claims/:claimId/accept-assignment`) atomically verifies `{ _id: claimId, organizationId, status: 'PENDING_ACCEPTANCE', assignedTo: adjusterId }` and transitions to `status: 'ASSIGNED'`.
  - Similarly, declining an assignment (`POST /claims/:claimId/decline-assignment`) queries `{ _id: claimId, organizationId, status: 'PENDING_ACCEPTANCE', assignedTo: adjusterId }` and atomically resets the claim back to `status: 'NEW'` while nulling assignment fields (`assignedTo`, `assignedBy`, `assignedAt`, `assignmentNotes`) and appending an `[ASSIGNMENT DECLINED]` timeline event.
- **Audit Timeline:** Claims embed an array of timeline subdocuments (`timeline: [...]`), atomically appended using `$push` on every lifecycle event.

### 5.5 Unified API Response Envelope
Every endpoint in the system complies with the unified structure provided by `src/utils/apiResponse.js`:

**Success Response (HTTP 200 / 201):**
```json
{
  "success": true,
  "message": "Human-readable confirmation message",
  "data": { ... }
}
```

**Error Response (HTTP 4xx / 5xx):**
```json
{
  "success": false,
  "message": "Summary of the error",
  "errors": [
    {
      "code": "SPECIFIC_ERROR_CODE",
      "details": "Actionable detail or field-level description"
    }
  ]
}
```

### 5.6 File Upload & Cloud Storage Architecture
- **In-Memory Buffering (`multer.memoryStorage()`):** Handled by `upload.middleware.js` configured with `multer.memoryStorage()` to buffer incoming files directly in memory as `Buffer` objects, avoiding temporary disk writes on serverless or ephemeral container hosts (bounded by a strict 10MB per file limit).
- **Direct-to-Cloud Streaming (`upload_stream`):** File buffers are streamed directly to Cloudinary using `cloudinary.uploader.upload_stream` inside `src/utils/uploadToCloudinary.js`.
- **Tenant-Scoped Folder Structure:** All assets are strictly partitioned by tenant ID within Cloudinary:
  - Evidence photos: `insurflow/${organizationId}/evidence`
  - Digital signatures: `insurflow/${organizationId}/signatures`
- **Layered Placement:** `uploadToCloudinary.js` sits in `src/utils/` as an isolated domain utility. It is **called exclusively from the Service layer (`claim.service.js`) and never directly from the Controller layer**, preserving strict 5-layer architectural separation and allowing complete mocking in tests without invoking external Cloudinary APIs.
- **Validation Guardrails:** Restricts uploads to `image/jpeg`, `image/png`, and `image/webp`. Multer size errors (`LIMIT_FILE_SIZE`) are caught and normalized by `errorHandler.js` into standard `400 VALIDATION_ERROR` responses.

### 5.7 Request Validation Architecture & Express 5 Query Property Shadowing
- **Schema-Driven Boundaries:** All external inputs entering the system are validated at the Route layer using Joi schemas via `src/middlewares/validate.middleware.js`.
- **The Express 5 `req.query` Prototype Getter Bug (Sprint 1 Architectural Debt):**
  - *Root Cause:* In Express 5.x, `req.query` is implemented as an inherited getter on `IncomingMessage.prototype` without a setter (`{ get: [Function: query], set: undefined }`).
  - *Impact:* Standard assignment `req[property] = value` executed when `property === 'query'` failed silently in non-strict mode. As a result, Joi type transformations (such as string to integer/number, string to Date object, string trimming) and default values (such as `page: 1`, `limit: 50`) were silently discarded, leaving `req.query` with raw strings or `undefined`.
  - *Masking in Legacy Endpoints:* This architectural issue was previously masked in Sprint 1/2 endpoints (`GET /api/v1/users`, `GET /api/v1/claims`) because service layers implemented defensive manual fallback destructuring (`const { page = 1, limit = 50 } = pagination;`) and JavaScript arithmetic coercion (`(page - 1) * limit`).
  - *Resolution:* `validate.middleware.js` explicitly checks `if (property === 'query')` and invokes:
    ```javascript
    Object.defineProperty(req, 'query', {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    ```
    This defines an own, writable property on the `req` instance, properly shadowing the prototype getter and guaranteeing that Joi-transformed data types, trimmed values, and injected defaults propagate seamlessly to Controllers and Services.

### 5.8 Location Tracking & Map Dispatch Architecture (Feature 18)
- **Passive HTTP Header Ingestion (`adjusterLocation.middleware.js`):**
  - Instead of dedicated polling endpoints or stateful WebSockets, the mobile client sends `X-Latitude` and `X-Longitude` request headers on every request made by a `FIELD_ADJUSTER`.
  - The middleware runs immediately after `authenticate`, verifies role and coordinate limits (`-90..90`, `-180..180`), and updates `user.location` asynchronously.
  - Wrapped completely in a non-blocking `try/catch` with server warnings; never calls `next(err)` and never delays or rejects primary route execution.
- **Incident Coordinates vs Incident Location Address:**
  - `claim.incidentCoordinates: { latitude, longitude, capturedAt }` is captured optionally at claim creation (`POST /claims`) and kept immutable.
  - The accident location text string `claim.incidentLocation` (required address description) is preserved completely without modification.
  - Both are strictly separated from on-site inspection GPS (`claim.location: { latitude, longitude, address, capturedAt }`) updated during inspection (`PUT /claims/:id/location`).
- **Server-Side Haversine Geodesic Computation (`geo.utils.js`):**
  - Great-circle distance in kilometers calculated via pure JavaScript spherical trigonometry without external dependencies.
  - `GET /api/v1/users/adjusters` resolves incident coordinates (from `claimId` or direct params), calculates `distanceKm`, and sorts ascending (null locations last).
- **Advisory Capacity & Explicit Override:**
  - Enforced server-side in `claim.service.js` (`assignClaim`): blocks with `409 ADJUSTER_UNAVAILABLE` when `activeTasksCount > 3`, unless `overrideCapacity: true` is explicitly passed.
  - Overridden assignments prefix the audit timeline with `[CAPACITY OVERRIDE] Assigned while adjuster had <N> active tasks (max: 3)`.

### 5.9 Push Notification & Device Token Architecture (Feature 19)
- **Firebase Admin SDK Initialization (`src/config/firebase.js`):**
  - Uses the official `firebase-admin` SDK initialized via service account credentials loaded from a local JSON file (path configurable via `FIREBASE_SERVICE_ACCOUNT_PATH`).
  - Unconditionally verifies file existence on disk (`fs.existsSync`) and immediately throws if missing, with no environment-conditional fallback or silent suppression.
- **Cross-Module Push Sender (`src/services/push.service.js`):**
  - Encapsulates `admin.messaging().send(...)`.
  - Normalizes FCM data payloads to ensure all values are strings (required by FCM protocol).
  - No retries or unprompted resilience layers; errors bubble up to caller or service-level handlers.
- **Notification Persistence Model (`src/modules/notifications/notification.model.js`):**
  - Mongoose schema tracking `recipientId`, `organizationId`, `type` (`PENDING_ACCEPTANCE`, `ASSIGNED`, `CORRECTION_REQUIRED`, `APPROVED`, `REJECTED`), `relatedClaimId`, `title`, `body`, `read`, and `createdAt`.
  - Compound index `{ organizationId: 1, recipientId: 1, createdAt: -1 }` for efficient tenant-scoped user notification listing.
- **Push & Business Logic Decoupling (`src/modules/notifications/notification.service.js`):**
  - `createAndSendNotification` always creates the `Notification` database document first.
  - Queries recipient `User` for `fcmToken` using `.select('fcmToken').lean()`.
  - If token exists, calls `sendPush(...)` inside an isolated `try/catch`.
  - Any push failure is logged to `console.error` and suppressed — it never propagates or fails the calling business flow (e.g. claim assignment, approval, or correction request).
- **Device Token Self-Registration (`PATCH /api/v1/users/me/fcm-token`):**
  - Resides within the `users` module.
  - Mounted before `/:userId` parameter routes to prevent routing conflicts.
  - Accessible to all authenticated users regardless of role, updating exclusively the calling user's document (`req.user.userId`) scoped to their authenticated `organizationId`.


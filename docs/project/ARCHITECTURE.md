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
│   └── database.js          # Mongoose connection management
├── middlewares/
│   ├── auth.middleware.js   # JWT verification & req.user attachment
│   ├── role.middleware.js   # RBAC permission checks
│   ├── validate.middleware.js# Joi boundary schema validator
│   ├── rateLimiter.middleware.js # Multi-tier rate limiting (loginLimiter & apiLimiter)
│   ├── errorHandler.js      # Global centralized error response handler
│   └── notFound.js          # 404 handler for undefined endpoints
├── utils/
│   ├── apiResponse.js       # Standardized response envelopes
│   ├── appError.js          # Custom operational error class
│   ├── asyncWrapper.js      # Promise rejection forwarding to next()
│   └── counter.model.js     # Atomic sequence counter model
└── modules/
    ├── auth/                # Login, JWT, password change
    ├── claims/              # Claims, inspections, lifecycle transitions
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

### 5.4 Database & Concurrency Design
- **Atomic Operations Over Read-Modify-Write:** Status transitions and state mutations use Mongoose `findOneAndUpdate` with state preconditions in the filter query.
  - For example, assigning an adjuster queries `{ _id: claimId, organizationId, status: 'NEW' }`. If two officers attempt simultaneous assignment, exactly one succeeds and the other receives `null`, which the service converts to an HTTP 409 Conflict.
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

# Feature Specification: Authentication & Session Management

## 1. Feature Overview
InsurFlow is an Enterprise B2B SaaS Motor Insurance Claims Management backend. Because multiple insurance companies (tenants) share the same infrastructure, authentication must strictly enforce tenant context from the moment credentials are submitted.

The **Authentication & Session Management** feature handles:
1. Multi-tenant login via Organization Code, Employee Code, and Password.
2. Secure credential verification using `bcrypt` password hashing.
3. Cryptographically signed JWT tokens embedding user identity, role, and organization context.
4. Token delivery through both HTTP-only cookies and Authorization headers.
5. In-flight password updates with current password validation and reuse prevention.
6. Brute-force protection via dedicated login rate limiting (`loginLimiter`).

---

## 2. Architecture & Design Patterns

### Architecture Flow
```
[Client] 
   │
   ▼ (POST /api/v1/auth/login)
[rateLimiter (loginLimiter)] ──▶ (429 if >5 failed attempts / 15 min)
   │
   ▼
[validate(loginSchema)] ──▶ (400 if validation fails)
   │
   ▼
[authController.login]
   │
   ▼
[authService.login]
   ├── 1. Find Organization by code (uppercase)
   ├── 2. Find User by organizationId + employeeCode (select +password)
   ├── 3. Verify user.status === 'ACTIVE'
   ├── 4. Compare password via bcrypt.compare()
   ├── 5. Generate JWT token with { userId, role, organizationId }
   └── 6. Set cookie & return user payload
```

### Components Involved
* **Route:** [src/modules/auth/auth.routes.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/auth/auth.routes.js)
* **Controller:** [src/modules/auth/auth.controller.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/auth/auth.controller.js)
* **Service:** [src/modules/auth/auth.service.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/auth/auth.service.js)
* **Repository:** [src/modules/users/user.repository.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/users/user.repository.js)
* **Models:** [src/modules/users/user.model.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/users/user.model.js), [src/modules/organizations/organization.model.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/organizations/organization.model.js)
* **Middlewares:** [src/middlewares/auth.middleware.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/middlewares/auth.middleware.js), [src/middlewares/rateLimiter.middleware.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/middlewares/rateLimiter.middleware.js)

---

## 3. API Contract & Endpoints

### 3.1 POST `/api/v1/auth/login`
Authenticates a user and issues a JWT session token.

* **Authentication:** None (Public).
* **Rate Limiting:** `loginLimiter` (5 failed attempts per 15 min per IP).
* **Request Headers:** `Content-Type: application/json`
* **Request Body:**
  ```json
  {
    "organizationCode": "INS",
    "employeeCode": "CO-001",
    "password": "Password123!"
  }
  ```
* **Validation Rules:**
  * `organizationCode`: String, required, trimmed.
  * `employeeCode`: String, required, trimmed.
  * `password`: String, required.
* **Success Response (200 OK):**
  * Sets HTTP-only cookie: `token=<jwt>; HttpOnly; Secure; SameSite=Strict`
  * Response Body:
    ```json
    {
      "success": true,
      "message": "Login successful",
      "data": {
        "user": {
          "id": "60d0fe4f5311236168a109ca",
          "name": "Sarah Connor",
          "employeeCode": "CO-001",
          "role": "CLAIMS_OFFICER",
          "organizationId": "60d0fe4f5311236168a109c9"
        },
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
      }
    }
    ```
* **Error Responses:**
  * `400 Bad Request`: `VALIDATION_ERROR` (missing fields or malformed payload).
  * `401 Unauthorized`: `INVALID_CREDENTIALS` (invalid organization code, employee code, wrong password, or inactive account).
  * `429 Too Many Requests`: `TOO_MANY_REQUESTS` (exceeded 5 failed login attempts within 15 minutes).

---

### 3.2 PUT `/api/v1/auth/change-password`
Allows an authenticated user to change their own password.

* **Authentication:** Required (Bearer JWT or cookie).
* **Authorized Roles:** `ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`.
* **Request Body:**
  ```json
  {
    "currentPassword": "Password123!",
    "newPassword": "NewSecurePassword456!"
  }
  ```
* **Validation Rules:**
  * `currentPassword`: String, required.
  * `newPassword`: String, min 8 chars, must contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.
* **Business Invariants:**
  * `newPassword` cannot be identical to `currentPassword` (returns 400 `VALIDATION_ERROR`).
  * `currentPassword` must match hash stored in database (returns 401 `INVALID_CREDENTIALS`).
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Password changed successfully"
  }
  ```

---

## 4. Security & Multi-Tenancy Invariants

1. **Strict Tenant Context Derivation:**
   * During login, `organizationId` is resolved via `Organization.findOne({ code: organizationCode.toUpperCase() })`.
   * The User is queried via `User.findOne({ organizationId: org._id, employeeCode })`.
   * Two different organizations can have identical employee codes (e.g. `FA-001` in Org A and `FA-001` in Org B) without collision.
2. **Timing Attack & Enumeration Resistance:**
   * Invalid organization code, non-existent employee code, wrong password, or inactive account all return the identical message: `"Invalid credentials"` with code `INVALID_CREDENTIALS`.
3. **Password Security:**
   * Passwords are never stored in plaintext.
   * `bcrypt.hash(password, salt)` with cost factor 10 is executed via Mongoose `pre('save')` hook.
   * Password field has `select: false` on `userSchema` to prevent accidental inclusion in user queries.
4. **JWT Security:**
   * Signed using HMAC-SHA256 (`HS256`).
   * Token payload: `{ userId, role, organizationId }`.
   * Expiration configurable via `JWT_EXPIRES_IN` (default: `8h`).

---

## 5. Database Schema & Indexes

### User Schema (`users` collection)
```javascript
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  employeeCode: { type: String, required: true, trim: true },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['ADMIN', 'CLAIMS_OFFICER', 'FIELD_ADJUSTER'], required: true },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
}, { timestamps: true });

// Compound Unique Index: Prevents duplicate employee codes within the same organization
userSchema.index({ organizationId: 1, employeeCode: 1 }, { unique: true });
```

---

## 6. Automated Testing Suite

Tested in:
* [tests/auth.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/auth.test.js) (15 tests)
* [tests/auth.changePassword.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/auth.changePassword.test.js) (7 tests)
* [tests/rateLimiting.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/rateLimiting.test.js) (5 tests)

Key scenarios verified:
* Successful login returns 200, JWT token, and user profile.
* Invalid password returns 401.
* Inactive user account returns 401.
* Cross-tenant employee code collision isolation.
* Rate limiter trips on 6th failed attempt.
* Successful login does not consume rate limit quota.
* Changing password updates bcrypt hash and rejects old password on subsequent login.

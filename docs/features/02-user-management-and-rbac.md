# Feature Specification: User Management & RBAC

## 1. Feature Overview
The **User Management & Role-Based Access Control (RBAC)** module empowers Organization Administrators (`ADMIN`) to onboard personnel, query organization rosters with pagination, deactivate staff, and reset user passwords securely.

InsurFlow enforces a three-role model:
1. **`ADMIN`**: Manages users, resets credentials, changes status, makes claim decisions, and executes final claim closures.
2. **`CLAIMS_OFFICER`**: Creates claims, dispatches claims to adjusters, initiates claim reviews, and makes adjudication decisions (`APPROVED` / `REJECTED`).
3. **`FIELD_ADJUSTER`**: Inspects assigned claims on-site, performs vehicle lookups, updates inspection components (vehicle, accident, location), and submits inspection reports.

---

## 2. Architecture & Design Patterns

### Architecture Flow
```
[Admin Client]
   │
   ▼
[auth.middleware] ──▶ Extracts req.user { userId, role: 'ADMIN', organizationId }
   │
   ▼
[role.middleware(['ADMIN'])] ──▶ 403 Forbidden if role !== 'ADMIN'
   │
   ▼
[validate(schema)] ──▶ Validates inputs / query parameters
   │
   ▼
[user.controller]
   │
   ▼
[user.service] ──▶ Applies multi-tenant logic and invariants
   │
   ▼
[user.repository] ──▶ Scopes all Mongoose operations by req.user.organizationId
```

### Components Involved
* **Route:** [src/modules/users/user.routes.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/users/user.routes.js)
* **Controller:** [src/modules/users/user.controller.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/users/user.controller.js)
* **Service:** [src/modules/users/user.service.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/users/user.service.js)
* **Repository:** [src/modules/users/user.repository.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/users/user.repository.js)
* **Validation:** [src/modules/users/user.validation.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/users/user.validation.js)

---

## 3. API Contract & Endpoints

### 3.1 POST `/api/v1/users`
Creates a new staff member under the authenticated administrator's organization.

* **Authorized Roles:** `ADMIN` only.
* **Request Body:**
  ```json
  {
    "name": "David Adjuster",
    "employeeCode": "FA-002",
    "password": "InitialPassword123!",
    "role": "FIELD_ADJUSTER"
  }
  ```
* **Validation & Business Invariants:**
  * `name`: String, required, trimmed.
  * `employeeCode`: String, required, trimmed.
  * `password`: String, min 8 chars with uppercase, lowercase, number, special char.
  * `role`: Must be either `'CLAIMS_OFFICER'` or `'FIELD_ADJUSTER'`. Creating another `'ADMIN'` via this endpoint is strictly prohibited (returns 400 `VALIDATION_ERROR`).
  * `employeeCode` must be unique within the tenant (returns 409 `EMPLOYEE_CODE_TAKEN`).
* **Success Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "User created successfully",
    "data": {
      "id": "60d0fe4f5311236168a109cb",
      "name": "David Adjuster",
      "employeeCode": "FA-002",
      "role": "FIELD_ADJUSTER",
      "status": "ACTIVE"
    }
  }
  ```

---

### 3.2 GET `/api/v1/users`
Lists users belonging to the administrator's organization with pagination and optional role filtering.

* **Authorized Roles:** `ADMIN` only.
* **Query Parameters:**
  * `role`: Optional string enum (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`).
  * `page`: Integer $\ge 1$ (default: `1`).
  * `limit`: Integer $1 \le \text{limit} \le 100$ (default: `50`).
* **Response Headers:**
  * `X-Total-Count`: Total number of matching users in the tenant.
  * `X-Page`: Current page number.
  * `X-Limit`: Items per page.
  * `X-Total-Pages`: Total page count.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Users retrieved successfully",
    "data": [
      {
        "_id": "60d0fe4f5311236168a109cb",
        "name": "David Adjuster",
        "employeeCode": "FA-002",
        "role": "FIELD_ADJUSTER",
        "status": "ACTIVE",
        "createdAt": "2026-09-01T10:00:00.000Z"
      }
    ]
  }
  ```

---

### 3.3 PATCH `/api/v1/users/:userId`
Updates user profile attributes (`name` and/or `employeeCode`).

* **Authorized Roles:** `ADMIN` only.
* **Request Body:**
  ```json
  {
    "name": "الاسم الجديد",
    "employeeCode": "FA-003"
  }
  ```
* **Validation & Business Invariants:**
  * `name`: Optional string, trimmed, non-empty.
  * `employeeCode`: Optional string, trimmed, non-empty (must be unique within the tenant).
  * At least one field required (`.min(1)`).
  * Unknown/disallowed fields (`role`, `password`, `status`, `organizationId`) are strictly rejected (`400 VALIDATION_ERROR`).
  * If `employeeCode` is already in use by another user in the organization, returns `409 EMPLOYEE_CODE_TAKEN`.
  * If the target user does not exist or belongs to another organization, returns `404 USER_NOT_FOUND`.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "User updated successfully",
    "data": {
      "id": "60d0fe4f5311236168a109cb",
      "name": "الاسم الجديد",
      "employeeCode": "FA-003",
      "role": "FIELD_ADJUSTER",
      "status": "ACTIVE",
      "createdAt": "2026-09-01T10:00:00.000Z",
      "updatedAt": "2026-09-12T12:40:00.000Z"
    }
  }
  ```

---

### 3.4 PATCH `/api/v1/users/:userId/status`
Activates or deactivates an employee account.

* **Authorized Roles:** `ADMIN` only.
* **Request Body:**
  ```json
  {
    "status": "INACTIVE"
  }
  ```
* **Business Invariants:**
  * `status`: Must be `'ACTIVE'` or `'INACTIVE'`.
  * If a target user belongs to another organization, returns `404 USER_NOT_FOUND` (stealth multi-tenant protection).
  * Deactivated users cannot authenticate or execute API actions.

---

### 3.5 PATCH `/api/v1/users/:userId/reset-password`
Administrative password override for an employee.

* **Authorized Roles:** `ADMIN` only.
* **Request Body:**
  ```json
  {
    "newPassword": "TemporaryPassword456!"
  }
  ```
* **Business Invariants:**
  * Updates the password hash using `bcrypt` (triggers pre-save hook).
  * Cross-tenant attempts return `404 USER_NOT_FOUND`.

---

## 4. Multi-Tenancy & Security Rules

1. **Tenant Isolation:**
   All repository operations require `organizationId`:
   ```javascript
   User.findOne({ _id: userId, organizationId });
   User.findOneAndUpdate({ _id: userId, organizationId }, ...);
   ```
2. **Employee Code Uniqueness:**
   Enforced per tenant via compound index `{ organizationId: 1, employeeCode: 1 }`.

---

## 5. Automated Testing Suite

Tested in:
* [tests/user.management.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/user.management.test.js) (30 tests)
* [tests/pagination.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/pagination.test.js) (User listing pagination tests)

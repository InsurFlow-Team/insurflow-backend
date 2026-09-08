# Feature Specification: Pagination & Query Limits (Listing APIs)

## 1. Feature Overview
To guarantee predictable database query latency and prevent uncontrolled memory consumption as data scales, all collection listing endpoints in InsurFlow enforce pagination and upper-bound query limits.

### Ratified Business Standards
* **Default Page:** `1` (1-indexed).
* **Default Limit:** `50` items per page.
* **Maximum Limit:** `100` items per page (strictly enforced; requests $> 100$ return `400 VALIDATION_ERROR`).
* **Transport Strategy:** Pagination metadata is returned via standard **HTTP response headers**.
* **Payload Compatibility:** The JSON response body preserves the bare array structure `data: []` (does not wrap in `{ items: [] }`).

---

## 2. Technical Architecture & Implementation

### Endpoints Covered
1. `GET /api/v1/claims` ([src/modules/claims/claim.controller.js:L29-L39](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.controller.js#L29-L39))
2. `GET /api/v1/users` ([src/modules/users/user.controller.js:L22-L32](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/users/user.controller.js#L22-L32))

### Response Headers
* `X-Total-Count`: Total number of matching documents in the tenant scope.
* `X-Page`: Current page number.
* `X-Limit`: Items per page limit applied.
* `X-Total-Pages`: Total page count (`Math.ceil(totalCount / limit)`).

### CORS Exposure
To allow browser-based single-page applications (SPAs) to read these custom headers, they are exposed in the CORS configuration in [src/app.js:L24-L32](file:///c:/Users/HP/Desktop/INSURFLOW/src/app.js#L24-L32):
```javascript
app.use(cors({
  origin: config.corsOrigin,
  optionsSuccessStatus: 200,
  credentials: true,
  exposedHeaders: [
    'X-Total-Count',
    'X-Page',
    'X-Limit',
    'X-Total-Pages',
    'RateLimit-Limit',
    'RateLimit-Remaining',
    'RateLimit-Reset',
  ],
}));
```

---

## 3. Query & Repository Mechanics

### Tenant-Scoped Query Isolation
To prevent cross-tenant count pollution, the exact same `query` filter object is passed to both `countDocuments(query)` and `find(query)` inside a parallel `Promise.all`:

```javascript
// Claim Repository Example:
const findByOrganization = async (organizationId, status, pagination = {}) => {
  const { page = 1, limit = 50 } = pagination;
  const skip = (page - 1) * limit;
  const query = { organizationId, ...(status && { status }) };

  const [totalCount, claims] = await Promise.all([
    Claim.countDocuments(query),
    Claim.find(query)
      .select('claimNumber status customer.name vehicle.plateNumber incidentType createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return { totalCount, claims };
};
```

### Role-Based Filter Handling on Claims
* **`CLAIMS_OFFICER` & `ADMIN`:** Queries organization-wide claims (`{ organizationId, ... }`).
* **`FIELD_ADJUSTER`:** Queries only claims assigned to the caller (`{ organizationId, assignedTo: userId, ... }`). Both `X-Total-Count` and returned items reflect the adjuster's assigned subset.

---

## 4. API Contract & Validation Rules

### Query Schema
```javascript
const listClaimsQuerySchema = Joi.object({
  status: Joi.string()
    .valid('NEW', 'ASSIGNED', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED')
    .optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
});
```

* Request: `GET /api/v1/claims?page=2&limit=20&status=ASSIGNED`
* Success Response (200 OK):
  * **Headers:**
    ```http
    X-Total-Count: 85
    X-Page: 2
    X-Limit: 20
    X-Total-Pages: 5
    ```
  * **Body:**
    ```json
    {
      "success": true,
      "message": "Claims retrieved successfully",
      "data": [ ... 20 claims ... ]
    }
    ```

---

## 5. Automated Testing Suite

Tested in [tests/pagination.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/pagination.test.js) (10 tests):
* Default header emission on `GET /claims` and `GET /users` (`limit: 50`).
* Chunked pagination across multiple pages with no item overlap.
* Combining status filter with page and limit.
* Adjuster total count scoping (ensuring adjuster total count only reflects assigned claims).
* Validation error rejection (400 on `page=0`, `page=-5`, `limit=0`, `limit=150`).

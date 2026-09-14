# Feature Specification: Map-Based Adjuster Dispatch & Location Tracking (Feature 18)

## 1. Feature Overview
The **Map-Based Adjuster Dispatch & Location Tracking** capability enables Claims Officers to visualize Field Adjusters' real-time proximities and workload capacities on a dashboard map, calculating Haversine geodesic distances server-side from an incident location, and dispatching claims with an optional capacity override.

### Key Architectural & Operational Decisions:
1. **Advisory Capacity & Explicit Override:**
   - Default capacity is **3 active tasks** (`MAX_ACTIVE_CLAIMS_PER_ADJUSTER = 3`).
   - If target adjuster has `activeTasksCount > 3`, `POST /api/v1/claims/:claimId/assign` returns `409 ADJUSTER_UNAVAILABLE` unless `overrideCapacity: true` is included in the request body.
   - When overridden, the assignment proceeds atomically, and the timeline note is prefixed with:
     `"[CAPACITY OVERRIDE] Assigned while adjuster had <N> active tasks (max: 3)"`.
   - The backend is the single source of truth for capacity enforcement.
2. **HTTP Header-Based Location Capture:**
   - Field Adjuster coordinates arrive via `X-Latitude` and `X-Longitude` HTTP request headers on any incoming authenticated request from the mobile app.
   - Handled by `adjusterLocation.middleware.js` mounted after `authenticate`.
   - Runs exclusively when `req.user.role === 'FIELD_ADJUSTER'`.
   - Validates latitude (-90 to 90) and longitude (-180 to 180).
   - Async update is wrapped in `try/catch`: never delays or fails the primary request; malformed or missing headers log a server warning and continue.
3. **Incident Coordinates vs. Incident Location Address vs. Inspection Location:**
   - Free-text accident location address is preserved in the required String field: `claim.incidentLocation` (e.g. `"Al-Irsal St, Ramallah"`).
   - Creation-time incident coordinates are stored in a dedicated field: `claim.incidentCoordinates: { latitude, longitude, capturedAt }`.
   - Omitted or coordinate-free claim creation leaves `claim.incidentLocation` untouched and sets `claim.incidentCoordinates: null`.
   - The existing `claim.location` field (used by `PUT /claims/:claimId/location` during on-site inspection in `IN_PROGRESS` status) is untouched.
   - Resolves Section 21 Open Item ("Location Payload Definition") in `docs/API_CONTRACT.md`.
4. **Server-Side Haversine Geodesic Distance Engine:**
   - Pure JavaScript implementation in `src/utils/geo.utils.js` (zero external dependencies).
   - Computes great-circle distance in kilometers rounded to 2 decimal places.
5. **Proximity-Aware Adjuster Dispatch Endpoint:**
   - `GET /api/v1/users/adjusters` accepts optional query params: `claimId`, or `latitude` and `longitude`.
   - Resolves incident coordinates from `claimId` (tenant-scoped, 404 if not found).
   - Returns each adjuster with `location: { latitude, longitude, updatedAt }` and `distanceKm`.
   - Sorts ascending by `distanceKm`, with adjusters without reported location placed last (`distanceKm: null`).
   - Reuses existing `availability: 'AVAILABLE' | 'UNAVAILABLE'` from Feature 05 without adding duplicate capacity status fields.

---

## 2. Architecture & Data Flow

### Adjuster Location Ingestion (Cross-Cutting Middleware)
```
[Mobile App (Field Adjuster)]
   │
   ▼ Request with Headers: `X-Latitude: 31.9038`, `X-Longitude: 35.2034`
[auth.middleware.authenticate]
   │
   ▼
[adjusterLocation.middleware]
   ├── Checks req.user.role === 'FIELD_ADJUSTER'
   ├── Validates -90 <= lat <= 90 && -180 <= lon <= 180
   ├── Updates User.findByIdAndUpdate(userId, { location: { latitude, longitude, updatedAt: now } })
   └── try/catch: Logs warning on failure, NEVER throws to next(err)
   │
   ▼
[Actual Route Handler (e.g. GET /claims, PUT /claims/:id/accident, etc.)]
```

### Proximity & Dispatch Query Flow
```
[Claims Officer (Web Dashboard)]
   │
   ▼ GET /api/v1/users/adjusters?claimId=:claimId
[user.routes -> validate(getAdjustersQuerySchema)]
   │
   ▼
[user.service.getAdjusters]
   ├── 1. If claimId: fetch claim in tenant -> extract claim.incidentCoordinates
   │      └── Throws 404 CLAIM_NOT_FOUND if claim doesn't exist in tenant
   ├── 2. Fetch adjusters with workload: userRepository.findAdjustersWithWorkload(orgId)
   │      └── Projects location { latitude, longitude, updatedAt } & activeTasksCount
   ├── 3. Calculate distanceKm for each adjuster using calculateHaversineDistance()
   └── 4. Sort adjusters: ascending distanceKm (nulls last)
```

---

## 3. API Contracts

### A. HTTP Request Headers (Location Transport)
* **Headers:**
  * `X-Latitude`: Number between `-90.0` and `90.0`.
  * `X-Longitude`: Number between `-180.0` and `180.0`.
* **Behavior:** Processed automatically on any authenticated request where `req.user.role === 'FIELD_ADJUSTER'`.

### B. POST `/api/v1/claims` (Claim Intake with Incident GPS)
* **Request Body Extensions:**
  ```json
  {
    "customerName": "John Doe",
    "customerPhone": "0599123456",
    "initialPlateNumber": "77-888-99",
    "incidentType": "COLLISION",
    "incidentLocation": "Al-Irsal St, Ramallah",
    "latitude": 31.9050,
    "longitude": 35.2040
  }
  ```
* **Response:** Returns claim object with `incidentLocation: "Al-Irsal St, Ramallah"` and `incidentCoordinates: { latitude: 31.9050, longitude: 35.2040, capturedAt: "2026-09-14T07:27:55.000Z" }`.
* **Note:** `latitude` and `longitude` are optional. If omitted, `incidentLocation` text is preserved as given, and `incidentCoordinates` is stored as `null`.

### C. GET `/api/v1/users/adjusters` (Proximity Query)
* **Query Parameters:**
  * `claimId` (optional, string, 24-char hex): Resolves reference coordinates from target claim's `incidentCoordinates`.
  * `latitude` (optional, number, -90..90): Direct reference latitude.
  * `longitude` (optional, number, -180..180): Direct reference longitude.
  * `status` (optional, enum: `'available' | 'all'`, default: `'all'`).
* **Response Body (`200 OK`):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "60d0fe4f5311236168a109ca",
        "name": "Ahmad Adjuster",
        "email": "ahmad@insurance.com",
        "role": "FIELD_ADJUSTER",
        "status": "ACTIVE",
        "activeTasksCount": 1,
        "maxCapacity": 3,
        "availability": "AVAILABLE",
        "location": {
          "latitude": 31.9038,
          "longitude": 35.2034,
          "updatedAt": "2026-09-14T07:25:00.000Z"
        },
        "distanceKm": 0.15
      },
      {
        "id": "60d0fe4f5311236168a109cb",
        "name": "Khaled Adjuster",
        "email": "khaled@insurance.com",
        "role": "FIELD_ADJUSTER",
        "status": "ACTIVE",
        "activeTasksCount": 4,
        "maxCapacity": 3,
        "availability": "UNAVAILABLE",
        "location": {
          "latitude": 31.9200,
          "longitude": 35.2200,
          "updatedAt": "2026-09-14T07:15:00.000Z"
        },
        "distanceKm": 2.34
      },
      {
        "id": "60d0fe4f5311236168a109cc",
        "name": "Omar Adjuster",
        "email": "omar@insurance.com",
        "role": "FIELD_ADJUSTER",
        "status": "ACTIVE",
        "activeTasksCount": 0,
        "maxCapacity": 3,
        "availability": "AVAILABLE",
        "location": {
          "latitude": null,
          "longitude": null,
          "updatedAt": null
        },
        "distanceKm": null
      }
    ]
  }
  ```

### D. POST `/api/v1/claims/:claimId/assign` (Capacity Override)
* **Request Body:**
  ```json
  {
    "adjusterId": "60d0fe4f5311236168a109cb",
    "priority": "HIGH",
    "notes": "Urgent VIP inspection required",
    "overrideCapacity": true
  }
  ```
* **Responses:**
  * `200 OK`: Assignment successful. If `overrideCapacity: true` and active tasks > 3, timeline note is prepended: `"[CAPACITY OVERRIDE] Assigned while adjuster had <N> active tasks (max: 3)"`.
  * `409 Conflict`: Target adjuster has > 3 active tasks and `overrideCapacity` was omitted or `false`:
    ```json
    {
      "success": false,
      "message": "Adjuster has reached maximum capacity of 3 active claims",
      "errors": [
        {
          "code": "ADJUSTER_UNAVAILABLE",
          "details": "Adjuster has reached maximum capacity of 3 active claims"
        }
      ]
    }
    ```

---

## 4. Business Rules Enforced
* **BR-ASSIGN-4 (Capacity Rule & Advisory Override):** Adjuster maximum workload is 3 active claims (`ASSIGNED` + `IN_PROGRESS`). Assignment when `activeTasksCount > 3` is rejected with `409 ADJUSTER_UNAVAILABLE` unless `overrideCapacity: true`.
* **BR-LOCATION-1 (Passive Location Ingestion):** Adjuster locations are updated seamlessly via HTTP headers without dedicated polling or connection overhead.
* **BR-DISPATCH-PROXIMITY (Geodesic Proximity Sorting):** Distance is computed using the Haversine formula and sorted ascending. Adjusters without reported location appear last.
* **Tenant Isolation:** Coordinates, adjusters, and incident references never cross tenant boundaries.

# Feature Specification: Field Inspection Workflow (Mobile Draft Updates)

## 1. Feature Overview
During on-site accident assessment, a **`FIELD_ADJUSTER`** gathers physical evidence under unstable mobile connectivity conditions. The backend supports incremental, partial draft updates across three separate inspection sections:
1. **Vehicle & Policy Confirmation:** Links verified vehicle, policy, and customer IDs to the claim.
2. **Accident Details:** Records accident type, date, time, narrative description, and visible damage.
3. **GPS Location & Timestamp:** Captures physical coordinates (latitude/longitude), address, and device capture timestamp.

Drafting allows the adjuster to update these sections repeatedly and in any order before final submission.

---

## 2. Technical Architecture & Component Structure

### State & Ownership Invariants
All three update endpoints enforce strict write guards:
1. **Status Invariant:** The claim must be in status **`ASSIGNED`**.
2. **Assignee Invariant:** The caller's `userId` must match `claim.assignedTo`.
3. **Tenant Invariant:** The claim must match `req.user.organizationId`.

Executed via atomic `findOneAndUpdate` queries in [src/modules/claims/claim.repository.js:L78-L100](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.repository.js#L78-L100):
```javascript
Claim.findOneAndUpdate(
  { _id: claimId, organizationId, status: 'ASSIGNED', assignedTo },
  { $set: { ...sectionData }, $push: { timeline: timelineEvent } },
  { new: true }
);
```

---

## 3. API Contract & Endpoints

### 3.1 PUT `/api/v1/claims/:claimId/vehicle`
* **Authorized Roles:** `FIELD_ADJUSTER` only (assigned adjuster only).
* **Request Body:**
  ```json
  {
    "vehicleId": "60d0fe4f5311236168a109d0",
    "policyId": "60d0fe4f5311236168a109d1",
    "customerId": "60d0fe4f5311236168a109d2",
    "plateNumber": "DXB-1234"
  }
  ```
* **Validation Rules:** All four fields are required; IDs must match 24-char ObjectId format.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Vehicle updated successfully",
    "data": { "vehicle": { ... } }
  }
  ```

---

### 3.2 PUT `/api/v1/claims/:claimId/accident`
* **Authorized Roles:** `FIELD_ADJUSTER` only (assigned adjuster only).
* **Request Body:**
  ```json
  {
    "accidentType": "REAR_END_COLLISION",
    "accidentDate": "2026-09-08",
    "accidentTime": "14:30",
    "description": "Vehicle rear-ended at a red light by a third party.",
    "damageDescription": "Cracked rear bumper and shattered tail light."
  }
  ```
* **Validation Rules:**
  * `accidentType`: Enum `['COLLISION', 'REAR_END_COLLISION', 'SIDE_IMPACT', 'PARKING_DAMAGE', 'OTHER']`.
  * `accidentDate`: Regex `^\d{4}-\d{2}-\d{2}$`.
  * `accidentTime`: Regex `^\d{2}:\d{2}$`.
  * `description` & `damageDescription`: Non-empty strings.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Accident updated successfully",
    "data": { "accident": { ... } }
  }
  ```

---

### 3.3 PUT `/api/v1/claims/:claimId/location`
* **Authorized Roles:** `FIELD_ADJUSTER` only (assigned adjuster only).
* **Request Body:**
  ```json
  {
    "latitude": 25.1972,
    "longitude": 55.2744,
    "address": "Financial Center Rd, Downtown Dubai",
    "capturedAt": "2026-09-08T10:35:00.000Z"
  }
  ```
* **Validation Rules:**
  * `latitude`: Number between `-90` and `90`.
  * `longitude`: Number between `-180` and `180`.
  * `address`: String, required.
  * `capturedAt`: ISO 8601 Date string, required.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Location updated successfully",
    "data": { "location": { ... } }
  }
  ```

---

## 4. Multi-Tenancy & Error Handling

* **Stealth Multi-Tenancy:** If an adjuster attempts to modify a claim belonging to another tenant or assigned to another adjuster in the same tenant, the backend responds with `404 Not Found` (`CLAIM_NOT_FOUND`), preventing existence enumeration.
* **Status Invariant Check:** If the claim exists and belongs to the adjuster but is not in status `ASSIGNED` (e.g. already submitted), responds with `409 Conflict` (`INVALID_STATUS_TRANSITION`).

---

## 5. Automated Testing Suite

Tested in [tests/claim.inspection.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/claim.inspection.test.js) (14 tests):
* Incremental partial updates for vehicle, accident, and location.
* Blocking non-assigned adjusters (404).
* Blocking non-field-adjuster roles (403).
* Rejection of invalid dates, times, and coordinates (400).
* Locking modifications after inspection submission (409).

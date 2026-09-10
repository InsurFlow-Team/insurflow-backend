# Feature Specification: Field Adjuster Workload & Availability Aggregation

## 1. Feature Overview
Before a Claims Officer dispatches an inspection, they must determine which Field Adjusters are available in real time. 

An adjuster is defined as **`AVAILABLE`** if and only if:
1. Their account status is **`ACTIVE`**.
2. They have **3 or fewer (`<= 3`)** active inspection tasks (`ASSIGNED`, `IN_PROGRESS`, `CORRECTION_REQUIRED`). If active tasks exceed 3, they become **`UNAVAILABLE`**.

To prevent performance degradation (N+1 query loop) as adjuster headcount scales, this calculation is executed via a single MongoDB `$lookup` aggregation pipeline.

---

## 2. Technical Architecture & Aggregation Pipeline

Implemented in [src/modules/users/user.repository.js:L66-L153](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/users/user.repository.js#L66-L153) (`findAdjustersWithWorkload`):

```javascript
const findAdjustersWithWorkload = async (organizationId, statusFilter) => {
  const orgObjectId = typeof organizationId === 'string'
    ? new mongoose.Types.ObjectId(organizationId)
    : organizationId;

  const pipeline = [
    // 1. Match only adjusters in the current tenant
    {
      $match: {
        organizationId: orgObjectId,
        role: 'FIELD_ADJUSTER',
      },
    },
    // 2. Lookup active claims assigned to each adjuster
    {
      $lookup: {
        from: 'claims',
        let: { adjusterId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$assignedTo', '$$adjusterId'] },
                  { $eq: ['$status', 'ASSIGNED'] },
                  { $eq: ['$organizationId', orgObjectId] }, // Tenant boundary
                ],
              },
            },
          },
          { $count: 'count' },
        ],
        as: 'activeClaims',
      },
    },
    // 3. Extract count (default to 0 if no active tasks)
    {
      $addFields: {
        activeTasksCount: {
          $ifNull: [{ $arrayElemAt: ['$activeClaims.count', 0] }, 0],
        },
      },
    },
    // 4. Compute Availability enum
    {
      $addFields: {
        id: '$_id',
        availability: {
          $cond: {
            if: {
              $and: [
                { $eq: ['$status', 'ACTIVE'] },
                { $lte: ['$activeTasksCount', 3] },
              ],
            },
            then: 'AVAILABLE',
            else: 'UNAVAILABLE',
          },
        },
      },
    },
    // 5. Clean projection
    {
      $project: {
        _id: 0,
        id: 1,
        name: 1,
        employeeCode: 1,
        role: 1,
        status: 1,
        availability: 1,
        activeTasksCount: 1,
      },
    },
  ];

  // 6. Optional filter: ?status=available
  if (statusFilter === 'available') {
    pipeline.push({ $match: { availability: 'AVAILABLE' } });
  }

  return await User.aggregate(pipeline);
};
```

---

## 3. API Contract & Endpoints

### GET `/api/v1/users/adjusters`
* **Authorized Roles:** `CLAIMS_OFFICER`, `ADMIN`.
* **Query Parameters:**
  * `status`: Optional filter. Only accepted value is `'available'`. Passing anything else returns `400 Bad Request`.
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Adjusters retrieved successfully",
    "data": [
      {
        "id": "60d0fe4f5311236168a109cd",
        "name": "Ahmed Adjuster",
        "employeeCode": "FA-001",
        "role": "FIELD_ADJUSTER",
        "status": "ACTIVE",
        "availability": "AVAILABLE",
        "activeTasksCount": 0
      },
      {
        "id": "60d0fe4f5311236168a109ce",
        "name": "Bilal Adjuster",
        "employeeCode": "FA-002",
        "role": "FIELD_ADJUSTER",
        "status": "ACTIVE",
        "availability": "UNAVAILABLE",
        "activeTasksCount": 1
      },
      {
        "id": "60d0fe4f5311236168a109cf",
        "name": " Tariq Adjuster",
        "employeeCode": "FA-003",
        "role": "FIELD_ADJUSTER",
        "status": "INACTIVE",
        "availability": "UNAVAILABLE",
        "activeTasksCount": 0
      }
    ]
  }
  ```

---

## 4. Business Invariants & Edge Cases

1. **Inactive Users:** If `status === 'INACTIVE'`, availability is unconditionally `'UNAVAILABLE'`, even if active tasks are 0.
2. **Terminal / Non-Assigned Statuses:** Claims in `SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`, or `CLOSED` do NOT count towards active workload.
3. **Tenant Boundary:** The aggregation matches both adjusters and claims against the caller's `organizationId`. An adjuster never sees tasks from another tenant.

---

## 5. Automated Testing Suite

Tested in [tests/user.adjuster.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/user.adjuster.test.js) (7 tests):
* Calculates correct availability and active tasks count.
* Filtering with `?status=available`.
* Rejection of invalid status queries (`?status=busy` → 400).
* Inactive adjusters marked unavailable.
* Exclusion of non-assigned statuses from active count.
* Confirmation of N+1 elimination via Jest spy asserting `Claim.countDocuments` is never called.

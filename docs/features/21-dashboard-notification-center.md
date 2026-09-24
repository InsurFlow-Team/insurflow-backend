# Feature 21 — Dashboard Notification Center

## 1. Overview
The **Dashboard Notification Center** provides an in-app notification center for InsurFlow staff (`ADMIN`, `CLAIMS_OFFICER`, and `FIELD_ADJUSTER`). It exposes paginated notifications with real-time claim reference resolution, unread counter badges, idempotent read status tracking, and fan-out notifications on critical claim lifecycle state transitions.

---

## 2. Design Principles & Tenancy
1. **Stealth Multi-Tenancy:**
   - Every notification is strictly bound to `recipientId` (`req.user.userId`) and `organizationId` (`req.user.organizationId`).
   - If a user attempts to read or mark a notification belonging to another user or another organization, the system returns HTTP 404 `NOTIFICATION_NOT_FOUND`.
2. **Read Timestamp Tracking (`readAt`):**
   - Converted from legacy boolean `read` to `readAt` (type `Date`, default `null`).
   - `readAt === null` indicates an unread notification.
   - Once marked as read, `readAt` stores the exact ISO timestamp and is never overwritten on subsequent mark-as-read calls (idempotent).
3. **Read-Time Claim Number Resolution:**
   - `claimNumber` is never redundantly copied or stored in the `Notification` document.
   - The query populates `relatedClaimId` (`Claim` model) selecting `claimNumber` at read time, guaranteeing absolute consistency even if claim numbering schemes evolve.
4. **Loop-Per-Recipient Fan-Out:**
   - Organization-wide notifications (`NEW_CLAIM`, `INSPECTION_COMPLETED`, `ASSIGNMENT_DECLINED`) create separate `Notification` documents per recipient (`CLAIMS_OFFICER` and `ADMIN` with `status: 'ACTIVE'`).
   - Organizations with zero active officers/admins produce zero notification documents without throwing or interrupting the transaction.
5. **Zero-Failure Isolation Guarantee:**
   - Notification dispatch failures (e.g. database network transient or Firebase push errors) are logged to `console.error` and **never** block or fail the caller's primary transaction or state transition.

---

## 3. Data Model

### `Notification` Schema (`src/modules/notifications/notification.model.js`)

| Field | Type | Attributes | Description |
|---|---|---|---|
| `recipientId` | `ObjectId` | Required, ref: `'User'` | Recipient staff user ID |
| `organizationId` | `ObjectId` | Required, ref: `'Organization'` | Tenant organization ID |
| `type` | `String` | Required, enum | Type of notification (see below) |
| `relatedClaimId` | `ObjectId` | Required, ref: `'Claim'` | Associated claim document ID |
| `title` | `String` | Required, trimmed | Notification title |
| `body` | `String` | Required, trimmed | Notification body message |
| `readAt` | `Date` | Default: `null` | Timestamp when read, or `null` if unread |
| `createdAt` | `Date` | Default: `Date.now` | Creation timestamp |

### Supported Notification Types
```typescript
type NotificationType =
  | 'ASSIGNED'               // Adjuster accepted assignment (notifies assignedBy officer)
  | 'PENDING_ACCEPTANCE'     // Claim assigned to adjuster (notifies adjuster)
  | 'CORRECTION_REQUIRED'    // Officer requested inspection correction (notifies adjuster)
  | 'APPROVED'               // Officer/Admin approved claim (notifies adjuster)
  | 'REJECTED'               // Officer/Admin rejected claim (notifies adjuster)
  | 'ASSIGNMENT_DECLINED'    // Adjuster declined assignment (notifies active officers & admins)
  | 'INSPECTION_COMPLETED'   // Adjuster submitted inspection report (notifies active officers & admins)
  | 'NEW_CLAIM';             // Claim intake created (notifies active officers & admins, excluding creator)
```

### Database Indexes
- Compound Index: `{ organizationId: 1, recipientId: 1, createdAt: -1 }` (supports reverse-chronological list queries).
- Compound Index: `{ organizationId: 1, recipientId: 1, readAt: 1 }` (supports unread queries and badge counters).

---

## 4. API Endpoints

### 4.1 List Notifications
- **Method:** `GET`
- **Path:** `/api/v1/notifications`
- **Access:** Authenticated (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`)
- **Headers:** `Authorization: Bearer <JWT>`

#### Query Parameters
| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `page` | Integer | No | `1` | Page number ($\ge 1$) |
| `limit` | Integer | No | `50` | Items per page ($1 \le limit \le 100$) |
| `unreadOnly` | Boolean | No | `false` | When `true`, filters records where `readAt == null` |

#### Response Headers
- `X-Total-Count`: Total number of matching notifications
- `X-Page`: Current page number
- `X-Limit`: Page size limit
- `X-Total-Pages`: Total number of available pages

#### Success Response (HTTP 200)
```json
{
  "success": true,
  "message": "Notifications retrieved successfully",
  "data": [
    {
      "_id": "673f8a45b12c3d0012ef3456",
      "recipientId": "673f8a45b12c3d0012ef3401",
      "organizationId": "673f8a45b12c3d0012ef3400",
      "type": "NEW_CLAIM",
      "relatedClaimId": {
        "_id": "673f8a45b12c3d0012ef3410",
        "claimNumber": "CLM-ALPHA-0042"
      },
      "title": "New Claim Created",
      "body": "New claim CLM-ALPHA-0042 has been created.",
      "readAt": null,
      "createdAt": "2026-09-23T19:00:00.000Z"
    }
  ]
}
```

---

### 4.2 Get Unread Notification Count
- **Method:** `GET`
- **Path:** `/api/v1/notifications/unread-count`
- **Access:** Authenticated (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`)
- **Headers:** `Authorization: Bearer <JWT>`

#### Success Response (HTTP 200)
```json
{
  "success": true,
  "message": "Unread count retrieved successfully",
  "data": {
    "count": 4
  }
}
```

---

### 4.3 Mark Notification as Read
- **Method:** `PATCH`
- **Path:** `/api/v1/notifications/:id/read`
- **Access:** Authenticated (`ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`)
- **Headers:** `Authorization: Bearer <JWT>`
- **Parameters:** `:id` — 24-character hexadecimal MongoDB ObjectId

#### Success Response (HTTP 200)
```json
{
  "success": true,
  "message": "Notification marked as read",
  "data": {
    "_id": "673f8a45b12c3d0012ef3456",
    "recipientId": "673f8a45b12c3d0012ef3401",
    "organizationId": "673f8a45b12c3d0012ef3400",
    "type": "NEW_CLAIM",
    "relatedClaimId": {
      "_id": "673f8a45b12c3d0012ef3410",
      "claimNumber": "CLM-ALPHA-0042"
    },
    "title": "New Claim Created",
    "body": "New claim CLM-ALPHA-0042 has been created.",
    "readAt": "2026-09-23T19:15:30.123Z",
    "createdAt": "2026-09-23T19:00:00.000Z"
  }
}
```

#### Error Responses
- **404 Not Found (`NOTIFICATION_NOT_FOUND`):** Notification does not exist or does not belong to the calling user / organization.
- **400 Validation Error (`VALIDATION_ERROR`):** Invalid ObjectId format for `:id`.

---

## 5. Domain Notification Triggers

| Trigger | Originating Endpoint | State Transition | Recipients | Title / Body Pattern |
|---|---|---|---|---|
| `NEW_CLAIM` | `POST /api/v1/claims` | N/A (Intake creation) | All active `CLAIMS_OFFICER` & `ADMIN` in org (excluding creator) | `New Claim Created`<br/>`New claim {claimNumber} has been created.` |
| `ASSIGNMENT_DECLINED` | `POST /api/v1/claims/:id/decline-assignment` | `PENDING_ACCEPTANCE` $\to$ `NEW` | All active `CLAIMS_OFFICER` & `ADMIN` in org | `Assignment Declined`<br/>`{employeeCode} declined claim {claimNumber}. Reason: {reason}` |
| `INSPECTION_COMPLETED` | `POST /api/v1/claims/:id/inspection/submit` | `IN_PROGRESS` $\to$ `SUBMITTED` | All active `CLAIMS_OFFICER` & `ADMIN` in org | `Inspection Completed`<br/>`Inspection completed for claim {claimNumber}.` |
| `PENDING_ACCEPTANCE` | `POST /api/v1/claims/:id/assign` | `NEW` $\to$ `PENDING_ACCEPTANCE` | Target Field Adjuster | `New Assignment Pending`<br/>`You have a new claim assignment pending your acceptance: {claimNumber}.` |
| `ASSIGNED` | `POST /api/v1/claims/:id/accept-assignment` | `PENDING_ACCEPTANCE` $\to$ `ASSIGNED` | Assigned Claims Officer | `Assignment Accepted`<br/>`{employeeCode} accepted claim {claimNumber}.` |
| `CORRECTION_REQUIRED` | `POST /api/v1/claims/:id/review/request-correction` | `UNDER_REVIEW` $\to$ `CORRECTION_REQUIRED` | Assigned Field Adjuster | `Correction Requested`<br/>`Claim {claimNumber} needs correction. Reason: {notes}` |
| `APPROVED` | `POST /api/v1/claims/:id/decision` | `UNDER_REVIEW` $\to$ `APPROVED` | Assigned Field Adjuster | `Claim Approved`<br/>`Claim {claimNumber} has been approved.` |
| `REJECTED` | `POST /api/v1/claims/:id/decision` | `UNDER_REVIEW` $\to$ `REJECTED` | Assigned Field Adjuster | `Claim Rejected`<br/>`Claim {claimNumber} has been rejected.` |

---

## 6. Verification & Test Coverage
- `tests/notification.api.test.js`: End-to-end integration tests covering pagination, sorting, read status update, idempotency, stealth tenancy 404, unread count accuracy, loop-per-recipient dispatch, and trigger isolation.
- `tests/claim.notificationTriggers.test.js`: Trigger-specific tests for all 7 domain lifecycle notification triggers.
- `tests/notification.service.test.js`: Service-level unit tests for FCM push dispatch and error isolation.

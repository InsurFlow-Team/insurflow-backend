# Feature Specification: Push Notifications & Device Token Management (Feature 19)

> [!WARNING]
> **Implementation Status: PARTIAL / IN-PROGRESS (Increments 1 & 2 Only)**  
> This specification documents the foundational infrastructure and device-token registration delivered in Increments 1 and 2.  
> **Increment 3 (Domain Trigger Wiring) is NOT yet implemented.** At this stage, no notifications are triggered or dispatched by any business actions (claim assignment, correction requests, approvals, or rejections). End-to-end delivery will be activated once Increment 3 wires `createAndSendNotification` into the corresponding domain lifecycle hooks.

---

## 1. Feature Overview
The **Push Notifications** module enables InsurFlow to dispatch real-time mobile push notifications to field adjusters and staff members via Firebase Cloud Messaging (FCM), alongside persistent in-app notification records.

### Implementation Phasing:
- **Increment 1 (Closed):** Firebase Admin SDK initialization (`src/config/firebase.js`) and reusable push sender service (`src/services/push.service.js`).
- **Increment 2 (Closed):** Notification persistence model (`src/modules/notifications/notification.model.js`), unified notification service (`src/modules/notifications/notification.service.js`), `fcmToken` attribute on `User` model, and device token registration endpoint (`PATCH /api/v1/users/me/fcm-token`).
- **Increment 3 (Pending):** Wiring into the 4 core domain business lifecycle triggers (`ASSIGNED`, `CORRECTION_REQUIRED`, `APPROVED`, `REJECTED`).

---

## 2. Architectural Design & Decoupling

### Core Design Principles:
1. **Zero-Failure Propagation:** Push notification delivery failures must **never** fail the underlying business action (e.g. claim assignment or approval must succeed even if FCM delivery fails).
2. **Persistence First:** Notification records are always persisted to MongoDB first.
3. **Graceful Push Handling:**
   - If recipient has no `fcmToken` or is not found, push is skipped silently.
   - If `sendPush` throws an error, the error is caught, logged via `console.error`, and suppressed. The created `Notification` document is returned successfully.
4. **Tenant & Identity Isolation:**
   - `PATCH /api/v1/users/me/fcm-token` updates only the authenticated user's own document (`req.user.userId`), scoped by `organizationId`.
   - Notification records are strictly tenant-scoped via `organizationId`.

---

## 3. Data Models

### 3.1 Notification Model (`src/modules/notifications/notification.model.js`)
| Field | Type | Attributes | Description |
|---|---|---|---|
| `recipientId` | `ObjectId` | Required, ref: `'User'` | The user receiving the notification |
| `organizationId` | `ObjectId` | Required, ref: `'Organization'` | Tenant ID for multi-tenant isolation |
| `type` | `String` | Required, enum: `['ASSIGNED', 'CORRECTION_REQUIRED', 'APPROVED', 'REJECTED']` | Category of notification |
| `relatedClaimId` | `ObjectId` | Required, ref: `'Claim'` | Associated claim ID |
| `title` | `String` | Required, trimmed | Notification title |
| `body` | `String` | Required, trimmed | Notification message text |
| `read` | `Boolean` | Default: `false` | Read status |
| `createdAt` | `Date` | Default: `Date.now` | Creation timestamp |

**Indexes:**
- Compound: `{ organizationId: 1, recipientId: 1, createdAt: -1 }`

### 3.2 User Model Addition (`src/modules/users/user.model.js`)
| Field | Type | Attributes | Description |
|---|---|---|---|
| `fcmToken` | `String` | Default: `null` | Current FCM registration token for push notifications |

---

## 4. API Endpoints

### 4.1 Register / Update Device Token
- **Method:** `PATCH`
- **Path:** `/api/v1/users/me/fcm-token`
- **Access:** Authenticated (Any role: `ADMIN`, `CLAIMS_OFFICER`, `FIELD_ADJUSTER`)
- **Headers:** `Authorization: Bearer <JWT>`

#### Request Body
```json
{
  "fcmToken": "c7x...-device-token-string"
}
```

#### Validation Rules
- `fcmToken`: String, required, non-empty, trimmed.

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "Device token updated successfully",
  "data": {
    "id": "673f1a2b3c4d5e6f7a8b9c0d",
    "fcmToken": "c7x...-device-token-string"
  }
}
```

#### Error Responses
- `400 Bad Request`: Missing or empty `fcmToken`.
- `401 Unauthorized`: Missing or invalid JWT.

---

## 5. Notification Service (`src/modules/notifications/notification.service.js`)

### `createAndSendNotification({ recipientId, organizationId, type, relatedClaimId, title, body })`
1. Creates `Notification` document in MongoDB.
2. Queries `User.findById(recipientId).select('fcmToken').lean()`.
3. If `recipient.fcmToken` is present, invokes `sendPush(token, title, body, { claimId: relatedClaimId, type })`.
4. Wraps push delivery in isolated `try/catch` to guarantee that push failures never propagate to the caller.
5. Returns the persisted `Notification` document.

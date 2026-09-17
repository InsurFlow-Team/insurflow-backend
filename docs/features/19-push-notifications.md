# Feature Specification: Push Notifications & Device Token Management (Feature 19)

## 1. Feature Overview
The **Push Notifications** module enables InsurFlow to dispatch real-time mobile push notifications to field adjusters and staff members via Firebase Cloud Messaging (FCM), alongside persistent in-app notification records.

### Implementation Phasing:
- **Increment 1 (Closed):** Firebase Admin SDK initialization (`src/config/firebase.js`) and reusable push sender service (`src/services/push.service.js`).
- **Increment 2 (Closed):** Notification persistence model (`src/modules/notifications/notification.model.js`), unified notification service (`src/modules/notifications/notification.service.js`), `fcmToken` attribute on `User` model, and device token registration endpoint (`PATCH /api/v1/users/me/fcm-token`).
- **Increment 3 (Closed):** Wiring into the 4 core domain business lifecycle triggers (`ASSIGNED`, `CORRECTION_REQUIRED`, `APPROVED`, `REJECTED`) with strict call-site error isolation.

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

---

## 6. Domain Business Triggers & Lifecycle Wiring

Increment 3 wires `createAndSendNotification` directly into the four core atomic claim state transitions in `src/modules/claims/claim.service.js`. Every notification call is executed immediately after the atomic state transition succeeds in MongoDB, reusing the updated claim document already returned by the repository (zero extra database queries).

### 6.1 Trigger Mappings

| # | Domain Transition | Function (`claim.service.js`) | Recipient (`recipientId`) | Notification Type | Title | Message Body |
|---|---|---|---|---|---|---|
| 1 | `NEW` → `ASSIGNED` | `assignClaim` | Assigned Adjuster (`updatedClaim.assignedTo`) | `ASSIGNED` | `New Claim Assigned` | `You've been assigned claim <claimNumber>.` |
| 2 | `UNDER_REVIEW` → `CORRECTION_REQUIRED` | `requestCorrection` | Assigned Adjuster (`updatedClaim.assignedTo`) | `CORRECTION_REQUIRED` | `Correction Requested` | `Claim <claimNumber> needs correction. Reason: <notes>` |
| 3 | `UNDER_REVIEW` → `APPROVED` | `decideClaim` (approve) | Assigned Adjuster (`updatedClaim.assignedTo`) | `APPROVED` | `Claim Approved` | `Claim <claimNumber> has been approved.` |
| 4 | `UNDER_REVIEW` → `REJECTED` | `decideClaim` (reject) | Assigned Adjuster (`updatedClaim.assignedTo`) | `REJECTED` | `Claim Rejected` | `Claim <claimNumber> has been rejected.` |

In all four triggers:
- `organizationId`: `updatedClaim.organizationId` (tenant isolation preserved).
- `relatedClaimId`: `updatedClaim._id` (claim identifier linked).

### 6.2 Strict Call-Site Error Isolation
At each of the four call sites in `src/modules/claims/claim.service.js`, the entire notification operation is wrapped in a dedicated `try/catch` block:
```javascript
try {
  await createAndSendNotification({ ... });
} catch (err) {
  console.error('Failed to send notification for <action>:', err);
}
```
**Non-Negotiable Guarantee:** Any failure during notification processing — including database write errors on the `Notification` collection or Firebase FCM push dispatch errors — is caught and logged to `console.error` only. Notification failures **never** propagate or cause the parent claim transition to fail. The business action always returns HTTP 200 to the caller.

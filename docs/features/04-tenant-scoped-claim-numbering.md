# Feature Specification: Tenant-Scoped Claim Numbering

## 1. Feature Overview
In a multi-tenant insurance system, claim identifiers must be:
1. **Tenant-Scoped:** Each organization has its own independent sequence starting at `0001`.
2. **Brand-Identified:** Numbers follow the format `CLM-<ORG_CODE>-0001` (e.g. `CLM-INS-0001`, `CLM-ABC-0001`).
3. **Atomic:** Concurrently submitted claims must never receive duplicate sequence numbers.
4. **Collision-Proof:** Database-level compound unique indexing prevents duplicates.

---

## 2. Technical Architecture & Implementation

### Sequence Generation Hook
Claim number generation is implemented as a Mongoose `pre('save')` middleware on the `Claim` schema in [src/modules/claims/claim.model.js:L198-L218](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.model.js#L198-L218):

```javascript
claimSchema.pre('save', async function () {
  // Guard: Only execute on new document creation when claimNumber is not yet set
  if (!this.isNew || this.claimNumber) return;

  // 1. Resolve organization code for prefix
  const org = await Organization.findById(this.organizationId).select('code').lean();
  if (!org) {
    throw new Error('Organization not found for claim number generation');
  }

  // 2. Atomically increment tenant-scoped counter
  const counter = await Counter.findOneAndUpdate(
    { _id: `claimNumber_${this.organizationId}` },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );

  // 3. Format: CLM-<ORG_CODE>-NNNN (zero-padded to 4 digits)
  this.claimNumber = `CLM-${org.code}-${String(counter.seq).padStart(4, '0')}`;
});
```

---

## 3. Database Schema & Indexing

### Counter Model (`counters` collection)
Defined in [src/utils/counter.model.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/utils/counter.model.js):
```javascript
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g. 'claimNumber_60d0fe4f5311236168a109c9'
  seq: { type: Number, default: 0 },
});
```

### Claim Unique Compound Index
Defined in [src/modules/claims/claim.model.js:L195](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/claims/claim.model.js#L195):
```javascript
claimSchema.index({ organizationId: 1, claimNumber: 1 }, { unique: true });
```
This compound index guarantees that even if two separate organizations share identical sequence numbers (`CLM-AAA-0001` and `CLM-BBB-0001`), no index conflict occurs, while guaranteeing strict uniqueness within each tenant.

---

## 4. Concurrency & Gap Behavior

1. **Atomic Allocation:** MongoDB's `findOneAndUpdate` with `$inc` locks and mutates the single tenant counter document atomically.
2. **Concurrent Creation:** 15 simultaneous creation attempts within Org A produce exactly `CLM-ALPHA-0001` through `CLM-ALPHA-0015` with zero collisions.
3. **Save/Update Immunity:** Existing claim modifications (`claimDoc.incidentLocation = '...'`, `await claimDoc.save()`) do not trigger the hook because `this.isNew` is false and `this.claimNumber` is already present.
4. **Gap Policy:** If sequence incrementation succeeds but claim persistence subsequently fails (e.g. database disconnect), a sequence gap is accepted. Gapless numbering is not required by insurance business rules.

---

## 5. Automated Testing Suite

Tested in [tests/claim.numbering.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/claim.numbering.test.js) (8 comprehensive tests):
* Correct prefix generation based on Org code.
* Independent sequence initiation at `0001` across multiple tenants.
* Sequential progression within a tenant.
* Save update guard (no counter consumption on updates).
* 15-request single-tenant concurrent race condition.
* 30-request dual-tenant simultaneous concurrent race condition.
* Verification of MongoDB compound unique index.

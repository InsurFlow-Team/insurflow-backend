const mongoose = require('mongoose');

const letterSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    claimId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Claim',
      required: true,
      index: true,
    },
    letterNumber: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['APPROVAL', 'REJECTION', 'REPAIR_AUTHORIZATION'],
      required: true,
    },
    supersedesLetterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Letter',
      default: null,
    },
    snapshot: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    issuedByRole: {
      type: String,
      required: true,
    },
    issuedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// ── Indexes ──────────────────────────────────────────────────────────
// Tenant-scoped unique letterNumber
letterSchema.index({ organizationId: 1, letterNumber: 1 }, { unique: true });

// Query letters per claim, newest first
letterSchema.index({ organizationId: 1, claimId: 1, issuedAt: -1 });

// C2: Prevent race condition when two requests attempt to supersede the same letter concurrently
letterSchema.index(
  { organizationId: 1, supersedesLetterId: 1 },
  {
    unique: true,
    partialFilterExpression: { supersedesLetterId: { $type: 'objectId' } },
  }
);

// ── Immutability Hooks (Rule R1) ────────────────────────────────────
// Document save hook: block updates to existing documents
letterSchema.pre('save', function () {
  if (!this.isNew) {
    throw new Error('Letter records are immutable and cannot be updated');
  }
});

// Document delete hook: block deletion of document instances
letterSchema.pre('deleteOne', { document: true, query: false }, function () {
  throw new Error('Letter records are immutable and cannot be deleted');
});

// Query-level mutation hooks: block all update and delete queries
const blockedOperations = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
];

blockedOperations.forEach((op) => {
  letterSchema.pre(op, function () {
    throw new Error(`Letter records are immutable: operation "${op}" is prohibited`);
  });
});

const Letter = mongoose.model('Letter', letterSchema);

module.exports = Letter;

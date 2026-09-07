const mongoose = require('mongoose');
const Counter = require('../../utils/counter.model');
const Organization = require('../organizations/organization.model');

// ─── Timeline Sub-document Schema ────────────────────────────────────────────
const timelineEventSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: String,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

// ─── Claim Schema ─────────────────────────────────────────────────────────────
const claimSchema = new mongoose.Schema(
  {
    // ── Identity & Tenancy ──────────────────────────────────────────
    claimNumber: {
      type: String,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // ── Status & Lifecycle ──────────────────────────────────────────
    status: {
      type: String,
      enum: ['NEW', 'ASSIGNED', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED'],
      default: 'NEW',
      required: true,
    },

    // ── Customer Info (captured at claim creation) ──────────────────
    customer: {
      name: {
        type: String,
        required: true,
        trim: true,
      },
      phone: {
        type: String,
        required: true,
        trim: true,
      },
    },

    // ── Incident Info ───────────────────────────────────────────────
    incidentType: {
      type: String,
      enum: ['COLLISION', 'REAR_END_COLLISION', 'SIDE_IMPACT', 'PARKING_DAMAGE', 'OTHER'],
      required: true,
    },
    incidentLocation: {
      type: String,
      required: true,
      trim: true,
    },

    // ── Vehicle (initial plate; full data added during inspection) ───
    vehicle: {
      plateNumber: {
        type: String,
        trim: true,
      },
      vehicleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vehicle',
        default: null,
      },
      policyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Policy',
        default: null,
      },
      customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        default: null,
      },
    },

    // ── Assignment (populated by Claims Officer) ────────────────────
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assignedAt: {
      type: Date,
      default: null,
    },
    priority: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      default: 'MEDIUM',
    },
    assignmentNotes: {
      type: String,
      default: null,
    },

    // ── Accident Details (populated during inspection) ───────────────
    accident: {
      accidentType: {
        type: String,
        enum: ['COLLISION', 'REAR_END_COLLISION', 'SIDE_IMPACT', 'PARKING_DAMAGE', 'OTHER'],
        default: null,
      },
      accidentDate: {
        type: String,
        default: null,
      },
      accidentTime: {
        type: String,
        default: null,
      },
      description: {
        type: String,
        default: null,
      },
      damageDescription: {
        type: String,
        default: null,
      },
    },

    // ── Location (populated during inspection) ───────────────────────
    // This is the accident location — GPS coordinates captured by the field adjuster via PUT /claims/:claimId/location. Sprint 1 uses this single location object; there is no separate inspectionLocation.
    location: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      address: { type: String, default: null },
      capturedAt: { type: Date, default: null },
    },

    // ── Admin Closure ────────────────────────────────────────────────
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    closingNotes: {
      type: String,
      default: null,
    },

    // ── Decision (populated by Claims Officer / Admin) ────────────────
    decisionNotes: {
      type: String,
      default: null,
    },

    // ── Audit Timeline ───────────────────────────────────────────────
    timeline: {
      type: [timelineEventSchema],
      default: [],
    },
  },
  { timestamps: true }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
claimSchema.index({ organizationId: 1, claimNumber: 1 }, { unique: true });


// ─── Tenant-Scoped Claim Number Generation ───────────────────────────────────
// Generates CLM-<ORG_CODE>-0001 format. Counter is isolated per organizationId.
// Guard: only runs on new document creation, never on updates.
claimSchema.pre('save', async function () {
  if (!this.isNew || this.claimNumber) return;

  // Resolve organization code for the claim number prefix
  const org = await Organization.findById(this.organizationId).select('code').lean();
  if (!org) {
    throw new Error('Organization not found for claim number generation');
  }

  // Atomic tenant-scoped counter increment
  const counter = await Counter.findOneAndUpdate(
    { _id: `claimNumber_${this.organizationId}` },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );

  this.claimNumber = `CLM-${org.code}-${String(counter.seq).padStart(4, '0')}`;
});

module.exports = mongoose.model('Claim', claimSchema);

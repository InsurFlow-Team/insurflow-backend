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
    previousStatus: {
      type: String,
      default: null,
    },
    newStatus: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: null,
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
    trackingToken: {
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

    // ── Verified Policy Reference (set at claim creation) ────────────
    policyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Policy',
      required: true,
    },

    // ── Coverage Snapshot (captured at intake, immutable) ───────────
    coverageSnapshot: {
      type: new mongoose.Schema(
        {
          policyType: {
            type: String,
            enum: ['COMPREHENSIVE', 'THIRD_PARTY'],
            default: null,
          },
          coveredPerils: {
            type: [
              {
                type: String,
                enum: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
              },
            ],
            default: [],
          },
          deductibleAmount: {
            type: Number,
            min: 0,
            default: null,
          },
          capturedAt: {
            type: Date,
            default: Date.now,
          },
        },
        { _id: false }
      ),
      default: null,
    },

    // ── Status & Lifecycle ──────────────────────────────────────────
    status: {
      type: String,
      enum: ['NEW', 'PENDING_ACCEPTANCE', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'APPROVED', 'REJECTED', 'CLOSED'],
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
    incidentDate: {
      type: String,
      default: null,
    },
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
    incidentCoordinates: {
      type: new mongoose.Schema(
        {
          latitude: { type: Number, min: -90, max: 90, default: null },
          longitude: { type: Number, min: -180, max: 180, default: null },
          capturedAt: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: null,
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

    // ── Evidence & Signature (populated during inspection) ───────────
    evidence: {
      type: [
        {
          imageType: {
            type: String,
            enum: ['VEHICLE_FRONT', 'VEHICLE_REAR', 'VEHICLE_SIDE', 'DAMAGE_CLOSEUP', 'DRIVER_LICENSE', 'OTHER'],
            required: true,
          },
          url: { type: String, required: true },
          publicId: { type: String, required: true },
          uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    signature: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
      capturedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
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

    // ── Loss Assessment (populated upon approval) ────────────────────
    lossAssessment: {
      type: new mongoose.Schema(
        {
          estimatedPartsCost: {
            type: Number,
            required: true,
            min: 0,
          },
          laborCost: {
            type: Number,
            required: true,
            min: 0,
          },
          totalDamage: {
            type: Number,
            required: true,
            min: 0,
          },
          policyDeductible: {
            type: Number,
            required: true,
            min: 0,
          },
          deductibleApplied: {
            type: Number,
            required: true,
            min: 0,
          },
          deductibleOverrideReason: {
            type: String,
            default: null,
          },
          netApprovedPayout: {
            type: Number,
            required: true,
            min: 0,
          },
          assessedAt: {
            type: Date,
            default: Date.now,
          },
          assessedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
          },
        },
        { _id: false }
      ),
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
claimSchema.index({ organizationId: 1, createdAt: -1, status: 1 });
claimSchema.index({ organizationId: 1, assignedTo: 1, createdAt: -1 });
claimSchema.index({ organizationId: 1, policyId: 1 });
claimSchema.index({ trackingToken: 1 }, { unique: true, sparse: true });


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

const Claim = mongoose.model('Claim', claimSchema);
Claim.ACTIVE_ADJUSTER_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'CORRECTION_REQUIRED'];
Claim.MAX_ACTIVE_CLAIMS_PER_ADJUSTER = 3;

module.exports = Claim;

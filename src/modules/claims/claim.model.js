const mongoose = require('mongoose');
const Counter = require('../../utils/counter.model');
const Organization = require('../organizations/organization.model');
const Policy = require('../policies/policy.model');

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

// ─── Estimate Sub-document Schemas ───────────────────────────────────────────
const estimateLineSchema = new mongoose.Schema(
  {
    lineType: {
      type: String,
      enum: ['PART', 'LABOR', 'PAINT', 'SURVEYOR_FEE', 'TOWING'],
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0.01,
      max: 999,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'unitPrice must be an integer (minor units)',
      },
    },
    partCondition: {
      type: String,
      enum: ['NEW_ORIGINAL', 'NEW_AFTERMARKET', 'USED'],
      default: null,
    },
    depreciationPercent: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    gross: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'gross must be an integer (minor units)',
      },
    },
    depreciation: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'depreciation must be an integer (minor units)',
      },
    },
    net: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'net must be an integer (minor units)',
      },
    },
  },
  { _id: false }
);

const estimateSchema = new mongoose.Schema(
  {
    version: {
      type: Number,
      required: true,
    },
    source: {
      type: String,
      enum: ['SURVEYOR', 'GARAGE'],
      required: true,
    },
    garageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Garage',
      default: null,
    },
    vatApplied: {
      type: Boolean,
      default: true,
    },
    vatRatePercent: {
      type: Number,
      required: true,
    },
    lines: {
      type: [estimateLineSchema],
      required: true,
    },
    totals: {
      partsNet: { type: Number, required: true, min: 0, validate: Number.isInteger },
      labor: { type: Number, required: true, min: 0, validate: Number.isInteger },
      paint: { type: Number, required: true, min: 0, validate: Number.isInteger },
      surveyorFee: { type: Number, required: true, min: 0, validate: Number.isInteger },
      towing: { type: Number, required: true, min: 0, validate: Number.isInteger },
      repairSubtotal: { type: Number, required: true, min: 0, validate: Number.isInteger },
      vat: { type: Number, required: true, min: 0, validate: Number.isInteger },
      repairTotal: { type: Number, required: true, min: 0, validate: Number.isInteger },
      expenses: { type: Number, required: true, min: 0, validate: Number.isInteger },
    },
    mapped: {
      estimatedPartsCost: { type: Number, required: true, min: 0, validate: Number.isInteger },
      laborCost: { type: Number, required: true, min: 0, validate: Number.isInteger },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdByRole: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

// ─── Repair Order Sub-document Schemas (PB-10) ───────────────────────────────
const repairOrderStatusHistorySchema = new mongoose.Schema(
  {
    from: {
      type: String,
      required: true,
    },
    to: {
      type: String,
      required: true,
    },
    notes: {
      type: String,
      default: null,
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
    at: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const repairOrderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
    },
    garageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Garage',
      required: true,
    },
    garage: {
      name: { type: String, required: true },
      city: { type: String, required: true },
      phone: { type: String, required: true },
    },
    authorizedAmount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'authorizedAmount must be an integer (minor units)',
      },
    },
    deductibleToCollect: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'deductibleToCollect must be an integer (minor units)',
      },
    },
    repairTotal: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'repairTotal must be an integer (minor units)',
      },
    },
    status: {
      type: String,
      enum: ['AUTHORIZED', 'IN_REPAIR', 'SUPPLEMENT_REQUESTED', 'READY', 'DELIVERED', 'CANCELLED'],
      default: 'AUTHORIZED',
      required: true,
    },
    statusHistory: {
      type: [repairOrderStatusHistorySchema],
      default: [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

// ─── Reserve Sub-document Schemas (PB-13) ────────────────────────────────────
const reserveHistorySchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: ['INDEMNITY', 'EXPENSE'],
      required: true,
    },
    previousAmount: {
      type: Number,
      default: null,
      validate: {
        validator: function (v) {
          return v === null || v === undefined || Number.isInteger(v);
        },
        message: 'previousAmount must be an integer (minor units) or null',
      },
    },
    newAmount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'newAmount must be an integer (minor units)',
      },
    },
    source: {
      type: String,
      enum: ['INITIAL', 'MANUAL', 'DECISION', 'STATUS_ZERO', 'PAYMENT', 'REVERSAL'],
      required: true,
    },
    reason: {
      type: String,
      default: null,
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
    at: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const reserveSchema = new mongoose.Schema(
  {
    indemnity: {
      type: Number,
      min: 0,
      default: null,
      validate: {
        validator: function (v) {
          return v === null || v === undefined || Number.isInteger(v);
        },
        message: 'indemnity must be an integer (minor units)',
      },
    },
    expense: {
      type: Number,
      min: 0,
      default: null,
      validate: {
        validator: function (v) {
          return v === null || v === undefined || Number.isInteger(v);
        },
        message: 'expense must be an integer (minor units)',
      },
    },
    history: {
      type: [reserveHistorySchema],
      default: [],
    },
  },
  { _id: false }
);

// ─── Discharge Sub-document Schemas (PB-15) ──────────────────────────────────
const dischargeSignedScanSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
    },
    publicId: {
      type: String,
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const dischargeSnapshotSchema = new mongoose.Schema(
  {
    letterhead: {
      organizationName: { type: String, default: '' },
      address: { type: String, default: '' },
      phone: { type: String, default: '' },
    },
    dischargeNumber: {
      type: String,
      required: true,
    },
    issueDate: {
      type: String,
      default: '',
    },
    claimNumber: {
      type: String,
      required: true,
    },
    plateNumber: {
      type: String,
      default: '',
    },
    incidentDate: {
      type: String,
      default: '',
    },
    claimantName: {
      type: String,
      required: true,
    },
    claimantIdNumber: {
      type: String,
      default: '',
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'amount must be an integer (minor units)',
      },
    },
    currency: {
      type: String,
      required: true,
    },
    organizationName: {
      type: String,
      default: '',
    },
  },
  { _id: false }
);

const dischargeSchema = new mongoose.Schema(
  {
    dischargeNumber: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'amount must be an integer (minor units)',
      },
    },
    status: {
      type: String,
      enum: ['DRAFT', 'SIGNED', 'SUPERSEDED'],
      default: 'DRAFT',
      required: true,
    },
    snapshot: {
      type: dischargeSnapshotSchema,
      required: true,
    },
    signedScan: {
      type: dischargeSignedScanSchema,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    signedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);


// ─── Payment Sub-document Schemas (PB-16) ──────────────────────────────────
const paymentSchema = new mongoose.Schema(
  {
    paymentNumber: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['PAYMENT', 'REVERSAL'],
      required: true,
    },
    category: {
      type: String,
      enum: ['INDEMNITY', 'EXPENSE'],
      required: true,
    },
    payeeType: {
      type: String,
      enum: [
        'INSURED',
        'GARAGE',
        'THIRD_PARTY',
        'LAWYER',
        'TOW_PROVIDER',
        'SURVEYOR',
        'HOSPITAL',
        'LIENHOLDER_BANK',
        'HEIR',
      ],
      required: true,
    },
    payeeName: {
      type: String,
      required: true,
      trim: true,
    },
    garageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Garage',
      default: null,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: 'amount must be an integer (minor units)',
      },
    },
    currency: {
      type: String,
      required: true,
    },
    method: {
      type: String,
      enum: ['BANK_TRANSFER', 'CHEQUE', 'CASH'],
      required: true,
    },
    reference: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },
    paidAt: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    reversesPaymentNumber: {
      type: String,
      default: null,
    },
    reason: {
      type: String,
      minlength: 10,
      maxlength: 300,
      default: null,
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    recordedAt: {
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
    incidentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Incident',
      default: null,
    },
    incidentNumber: {
      type: String,
      default: null,
    },
    claimantPartyId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    subjectRef: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    claimType: {
      type: String,
      enum: ['OWN_DAMAGE', 'THIRD_PARTY_PD'],
      default: 'OWN_DAMAGE',
    },
    moneyUnit: {
      type: String,
      enum: ['MINOR'],
      default: 'MINOR',
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
          policyKind: {
            type: String,
            enum: ['UNIFIED_COMPULSORY', 'COMPLEMENTARY'],
            default: null,
          },
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
            validate: {
              validator: function (v) {
                return v === null || v === undefined || Number.isInteger(v);
              },
              message: 'deductibleAmount must be an integer (minor units)',
            },
          },
          sumInsured: {
            type: Number,
            min: 0,
            default: null,
            validate: {
              validator: function (v) {
                return v === null || v === undefined || Number.isInteger(v);
              },
              message: 'sumInsured must be an integer (minor units)',
            },
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

    // ── Eligibility Advisory (captured at intake) ───────────────────
    eligibilityHint: {
      type: String,
      enum: Object.values(Policy.ELIGIBILITY_HINTS),
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
    // Test fixtures create claims through Claim.create without the field, and the API layer enforces presence in Stage 4
    incidentDate: {
      type: String,
      default: null,
    },
    incidentDescription: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },
    incidentType: {
      type: String,
      enum: ['COLLISION', 'REAR_END_COLLISION', 'SIDE_IMPACT', 'PARKING_DAMAGE', 'OTHER', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
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
        enum: ['COLLISION', 'REAR_END_COLLISION', 'SIDE_IMPACT', 'PARKING_DAMAGE', 'OTHER', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
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
            validate: {
              validator: Number.isInteger,
              message: 'estimatedPartsCost must be an integer (minor units)',
            },
          },
          laborCost: {
            type: Number,
            required: true,
            min: 0,
            validate: {
              validator: Number.isInteger,
              message: 'laborCost must be an integer (minor units)',
            },
          },
          totalDamage: {
            type: Number,
            required: true,
            min: 0,
            validate: {
              validator: Number.isInteger,
              message: 'totalDamage must be an integer (minor units)',
            },
          },
          policyDeductible: {
            type: Number,
            required: true,
            min: 0,
            validate: {
              validator: Number.isInteger,
              message: 'policyDeductible must be an integer (minor units)',
            },
          },
          deductibleApplied: {
            type: Number,
            required: true,
            min: 0,
            validate: {
              validator: Number.isInteger,
              message: 'deductibleApplied must be an integer (minor units)',
            },
          },
          deductibleOverridden: {
            type: Boolean,
            default: false,
          },
          deductibleOverrideReason: {
            type: String,
            default: null,
          },
          netApprovedPayout: {
            type: Number,
            required: true,
            min: 0,
            validate: {
              validator: Number.isInteger,
              message: 'netApprovedPayout must be an integer (minor units)',
            },
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

    // ── Estimates (PB-08) ─────────────────────────────────────────────
    estimatesCount: {
      type: Number,
      default: 0,
    },
    approvedEstimateVersion: {
      type: Number,
      default: null,
    },
    estimates: {
      type: [estimateSchema],
      default: [],
    },

    // ── Repair Orders (PB-10) ─────────────────────────────────────────
    repairOrders: {
      type: [repairOrderSchema],
      default: [],
    },

    // ── Outstanding Reserve (PB-13) ───────────────────────────────────
    reserve: {
      type: reserveSchema,
      default: () => ({
        indemnity: null,
        expense: null,
        history: [],
      }),
    },

    // ── Audit Timeline ───────────────────────────────────────────────
    timeline: {
      type: [timelineEventSchema],
      default: [],
    },
        discharges: {
      type: [dischargeSchema],
      default: [],
    },
    payments: {
      type: [paymentSchema],
      default: [],
    },
    paidTotals: {
      indemnity: {
        type: Number,
        default: 0,
        min: 0,
        validate: {
          validator: Number.isInteger,
          message: 'paidTotals.indemnity must be an integer (minor units)',
        },
      },
      expense: {
        type: Number,
        default: 0,
        min: 0,
        validate: {
          validator: Number.isInteger,
          message: 'paidTotals.expense must be an integer (minor units)',
        },
      },
    },
    reversedPaymentNumbers: {
      type: [String],
      default: [],
    },
    paymentReversedAfterClose: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
claimSchema.index({ organizationId: 1, claimNumber: 1 }, { unique: true });
claimSchema.index({ organizationId: 1, 'repairOrders.orderNumber': 1 });
claimSchema.index({ organizationId: 1, 'discharges.dischargeNumber': 1 });
claimSchema.index({ organizationId: 1, 'payments.paymentNumber': 1 });
claimSchema.index({ organizationId: 1, createdAt: -1, status: 1 });
claimSchema.index({ organizationId: 1, assignedTo: 1, createdAt: -1 });
claimSchema.index({ organizationId: 1, policyId: 1 });
claimSchema.index({ trackingToken: 1 }, { unique: true, sparse: true });
claimSchema.index({ organizationId: 1, incidentId: 1 });
claimSchema.index(
  { organizationId: 1, incidentId: 1, 'vehicle.vehicleId': 1 },
  {
    name: 'uniq_own_damage_vehicle_per_incident',
    unique: true,
    partialFilterExpression: {
      claimType: 'OWN_DAMAGE',
      incidentId: { $type: 'objectId' },
    },
  }
);


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
Claim.ACTIVE_REPAIR_ORDER_STATUSES = ['AUTHORIZED', 'IN_REPAIR', 'SUPPLEMENT_REQUESTED', 'READY'];

module.exports = Claim;

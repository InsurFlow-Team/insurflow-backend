const mongoose = require('mongoose');

const POLICY_KINDS = ['UNIFIED_COMPULSORY', 'COMPLEMENTARY'];
const POLICY_TYPES = ['COMPREHENSIVE', 'THIRD_PARTY'];
const COVERED_PERILS = ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'];
const ELIGIBILITY_HINTS = Object.freeze({
  ELIGIBLE_FOR_REVIEW: 'ELIGIBLE_FOR_REVIEW',
  NOT_COVERED_BY_POLICY_TYPE: 'NOT_COVERED_BY_POLICY_TYPE',
  COVERAGE_UNKNOWN: 'COVERAGE_UNKNOWN',
  INCIDENT_OUTSIDE_POLICY_PERIOD: 'INCIDENT_OUTSIDE_POLICY_PERIOD',
});

const policySchema = new mongoose.Schema(
  {
    policyNumber: {
      type: String,
      required: true,
    },
    policyKind: {
      type: String,
      enum: POLICY_KINDS,
      required: [true, 'policyKind is required'],
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'EXPIRED', 'CANCELLED'],
      required: true,
      default: 'ACTIVE',
    },
    startDate: {
      type: Date,
      required: true,
    },
    expiryDate: {
      type: Date,
      required: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    policyType: {
      type: String,
      enum: POLICY_TYPES,
      default: null,
      validate: {
        validator: function (v) {
          if (this.policyKind === 'COMPLEMENTARY') {
            return v === 'COMPREHENSIVE';
          }
          if (this.policyKind === 'UNIFIED_COMPULSORY') {
            return v === null || v === undefined;
          }
          return true;
        },
        message: 'policyType must be COMPREHENSIVE for COMPLEMENTARY and null for UNIFIED_COMPULSORY',
      },
    },
    coveredPerils: {
      type: [
        {
          type: String,
          enum: COVERED_PERILS,
        },
      ],
      validate: {
        validator: function (v) {
          if (this.policyKind === 'COMPLEMENTARY') {
            return Array.isArray(v) && v.length > 0;
          }
          if (this.policyKind === 'UNIFIED_COMPULSORY') {
            return !v || v.length === 0;
          }
          return true;
        },
        message: 'coveredPerils must be empty for THIRD_PARTY and non-empty for COMPREHENSIVE (non-empty for COMPLEMENTARY and empty for UNIFIED_COMPULSORY)',
      },
      default: [],
    },
    deductibleAmount: {
      type: Number,
      required: [true, 'deductibleAmount is required'],
      min: [0, 'deductibleAmount cannot be negative'],
    },
    sumInsured: {
      type: Number,
      min: [0, 'sumInsured cannot be negative'],
      default: null,
      validate: {
        validator: function (v) {
          if (this.policyKind === 'COMPLEMENTARY') {
            return typeof v === 'number' && v >= 0;
          }
          if (this.policyKind === 'UNIFIED_COMPULSORY') {
            return v === null || v === undefined;
          }
          return true;
        },
        message: 'sumInsured is required for COMPLEMENTARY and must be null for UNIFIED_COMPULSORY',
      },
    },
    propertyDamageLimit: {
      type: Number,
      min: [0, 'propertyDamageLimit cannot be negative'],
      default: null,
      validate: {
        validator: function (v) {
          if (this.policyKind === 'UNIFIED_COMPULSORY') {
            return typeof v === 'number' && v >= 0;
          }
          if (this.policyKind === 'COMPLEMENTARY') {
            return v === null || v === undefined;
          }
          return true;
        },
        message: 'propertyDamageLimit is required for UNIFIED_COMPULSORY and must be null for COMPLEMENTARY',
      },
    },
    vehicleUse: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: [20, 'vehicleUse cannot exceed 20 characters'],
      default: null,
    },
  },
  { timestamps: true }
);

policySchema.index({ organizationId: 1, policyNumber: 1 }, { unique: true });

const Policy = mongoose.model('Policy', policySchema);

Policy.POLICY_KINDS = POLICY_KINDS;
Policy.POLICY_TYPES = POLICY_TYPES;
Policy.COVERED_PERILS = COVERED_PERILS;
Policy.ELIGIBILITY_HINTS = ELIGIBILITY_HINTS;

module.exports = Policy;

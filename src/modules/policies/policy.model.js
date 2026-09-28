const mongoose = require('mongoose');

const POLICY_TYPES = ['COMPREHENSIVE', 'THIRD_PARTY'];
const COVERED_PERILS = ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'];
const ELIGIBILITY_HINTS = Object.freeze({
  ELIGIBLE_FOR_REVIEW: 'ELIGIBLE_FOR_REVIEW',
  NOT_COVERED_BY_POLICY_TYPE: 'NOT_COVERED_BY_POLICY_TYPE',
  COVERAGE_UNKNOWN: 'COVERAGE_UNKNOWN',
});

const policySchema = new mongoose.Schema(
  {
    policyNumber: {
      type: String,
      required: true,
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
    /**
     * Policy Type:
     * - COMPREHENSIVE: Covers own-damage to the insured vehicle (under perils listed in coveredPerils).
     * - THIRD_PARTY: Covers third-party liability only; excludes own-damage to the insured vehicle.
     * Note: Third-party liability is separate from compulsory insurance; compulsory is not modeled here.
     */
    policyType: {
      type: String,
      enum: POLICY_TYPES,
      required: [true, 'policyType is required'],
    },
    /**
     * Covered Perils for Own-Damage:
     * Represents perils that cover physical damage to the insured vehicle itself.
     * - For COMPREHENSIVE policies: Must be non-empty (at least one peril).
     * - For THIRD_PARTY policies: Must be strictly empty [] (no own-damage coverage).
     */
    coveredPerils: {
      type: [
        {
          type: String,
          enum: COVERED_PERILS,
        },
      ],
      validate: {
        validator: function (v) {
          if (this.policyType === 'THIRD_PARTY') {
            return !v || v.length === 0;
          }
          if (this.policyType === 'COMPREHENSIVE') {
            return Array.isArray(v) && v.length > 0;
          }
          return true;
        },
        message: 'coveredPerils must be empty for THIRD_PARTY and non-empty for COMPREHENSIVE',
      },
      default: [],
    },
    deductibleAmount: {
      type: Number,
      required: [true, 'deductibleAmount is required'],
      min: [0, 'deductibleAmount cannot be negative'],
    },
  },
  { timestamps: true }
);

policySchema.index({ organizationId: 1, policyNumber: 1 }, { unique: true });

const Policy = mongoose.model('Policy', policySchema);

Policy.POLICY_TYPES = POLICY_TYPES;
Policy.COVERED_PERILS = COVERED_PERILS;
Policy.ELIGIBILITY_HINTS = ELIGIBILITY_HINTS;

module.exports = Policy;


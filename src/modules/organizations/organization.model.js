const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
  },
  settings: {
    statusSlaHours: {
      NEW: {
        type: Number,
        min: 1,
        default: null,
        validate: {
          validator: (v) => v === null || Number.isInteger(v),
          message: 'statusSlaHours.NEW must be an integer',
        },
      },
      PENDING_ACCEPTANCE: {
        type: Number,
        min: 1,
        default: null,
        validate: {
          validator: (v) => v === null || Number.isInteger(v),
          message: 'statusSlaHours.PENDING_ACCEPTANCE must be an integer',
        },
      },
      ASSIGNED: {
        type: Number,
        min: 1,
        default: null,
        validate: {
          validator: (v) => v === null || Number.isInteger(v),
          message: 'statusSlaHours.ASSIGNED must be an integer',
        },
      },
      IN_PROGRESS: {
        type: Number,
        min: 1,
        default: null,
        validate: {
          validator: (v) => v === null || Number.isInteger(v),
          message: 'statusSlaHours.IN_PROGRESS must be an integer',
        },
      },
      SUBMITTED: {
        type: Number,
        min: 1,
        default: null,
        validate: {
          validator: (v) => v === null || Number.isInteger(v),
          message: 'statusSlaHours.SUBMITTED must be an integer',
        },
      },
      UNDER_REVIEW: {
        type: Number,
        min: 1,
        default: null,
        validate: {
          validator: (v) => v === null || Number.isInteger(v),
          message: 'statusSlaHours.UNDER_REVIEW must be an integer',
        },
      },
      CORRECTION_REQUIRED: {
        type: Number,
        min: 1,
        default: null,
        validate: {
          validator: (v) => v === null || Number.isInteger(v),
          message: 'statusSlaHours.CORRECTION_REQUIRED must be an integer',
        },
      },
      APPROVED: {
        type: Number,
        min: 1,
        default: null,
        validate: {
          validator: (v) => v === null || Number.isInteger(v),
          message: 'statusSlaHours.APPROVED must be an integer',
        },
      },
    },
    vatRatePercent: {
      type: Number,
      min: 0,
      max: 100,
      default: 16,
      validate: {
        validator: Number.isInteger,
        message: 'vatRatePercent must be an integer between 0 and 100',
      },
    },
    letterhead: {
      address: {
        type: String,
        maxlength: 200,
        default: null,
      },
      phone: {
        type: String,
        default: null,
      },
    },
    reserveDefaults: {
      OWN_DAMAGE: {
        indemnity: {
          type: Number,
          min: 0,
          default: 500000,
          validate: {
            validator: Number.isInteger,
            message: 'reserveDefaults.OWN_DAMAGE.indemnity must be an integer (minor units)',
          },
        },
        expense: {
          type: Number,
          min: 0,
          default: 50000,
          validate: {
            validator: Number.isInteger,
            message: 'reserveDefaults.OWN_DAMAGE.expense must be an integer (minor units)',
          },
        },
      },
      THIRD_PARTY_PD: {
        indemnity: {
          type: Number,
          min: 0,
          default: 500000,
          validate: {
            validator: Number.isInteger,
            message: 'reserveDefaults.THIRD_PARTY_PD.indemnity must be an integer (minor units)',
          },
        },
        expense: {
          type: Number,
          min: 0,
          default: 50000,
          validate: {
            validator: Number.isInteger,
            message: 'reserveDefaults.THIRD_PARTY_PD.expense must be an integer (minor units)',
          },
        },
      },
    },
  },
}, { timestamps: true });

module.exports = mongoose.model('Organization', organizationSchema);

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
  },
}, { timestamps: true });

module.exports = mongoose.model('Organization', organizationSchema);

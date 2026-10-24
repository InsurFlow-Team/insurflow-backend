const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema(
  {
    plateNumber: {
      type: String,
      required: true,
      trim: true,
    },
    make: {
      type: String,
    },
    model: {
      type: String,
    },
    year: {
      type: Number,
    },
    color: {
      type: String,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
    },
    compulsoryPolicyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Policy',
      default: null,
    },
    complementaryPolicyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Policy',
      default: null,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
  },
  { timestamps: true }
);

// Indexes
vehicleSchema.index({ organizationId: 1, plateNumber: 1 }, { unique: true });
vehicleSchema.index({ organizationId: 1, compulsoryPolicyId: 1 });
vehicleSchema.index({ organizationId: 1, complementaryPolicyId: 1 });

module.exports = mongoose.model('Vehicle', vehicleSchema);

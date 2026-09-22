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
    policyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Policy',
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
vehicleSchema.index({ organizationId: 1, policyId: 1 });

module.exports = mongoose.model('Vehicle', vehicleSchema);

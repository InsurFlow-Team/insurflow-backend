const mongoose = require('mongoose');

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
  },
  { timestamps: true }
);

policySchema.index({ organizationId: 1, policyNumber: 1 }, { unique: true });

module.exports = mongoose.model('Policy', policySchema);

const mongoose = require('mongoose');
const { GOVERNORATES } = require('../../utils/governorates');

const garageSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Garage name is required'],
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    normalizedName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    governorate: {
      type: String,
      enum: GOVERNORATES,
      required: [true, 'governorate is required'],
    },
    city: {
      type: String,
      required: [true, 'city is required'],
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    phone: {
      type: String,
      required: [true, 'phone is required'],
      trim: true,
    },
    laborRate: {
      type: Number,
      required: [true, 'laborRate is required'],
      min: [0, 'laborRate cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'laborRate must be an integer (minor units)',
      },
    },
    approved: {
      type: Boolean,
      default: true,
      required: true,
    },
  },
  { timestamps: true }
);

// Indexes
garageSchema.index({ organizationId: 1, normalizedName: 1 }, { unique: true });
garageSchema.index({ organizationId: 1, approved: 1, name: 1 });

module.exports = mongoose.model('Garage', garageSchema);

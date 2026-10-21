const mongoose = require('mongoose');
const Counter = require('../../utils/counter.model');
const Organization = require('../organizations/organization.model');

const incidentSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    incidentNumber: {
      type: String,
    },
    incidentDate: {
      type: String,
      required: true,
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
    incidentDescription: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
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
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

// Indexes
incidentSchema.index({ organizationId: 1, incidentNumber: 1 }, { unique: true });
incidentSchema.index({ organizationId: 1, createdAt: -1 });

// Atomic tenant-scoped incidentNumber generation: INC-<ORG_CODE>-0001
incidentSchema.pre('save', async function () {
  if (!this.isNew || this.incidentNumber) return;

  const org = await Organization.findById(this.organizationId).select('code').lean();
  if (!org) {
    throw new Error('Organization not found for incident number generation');
  }

  const counter = await Counter.findOneAndUpdate(
    { _id: `incidentNumber_${this.organizationId}` },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );

  this.incidentNumber = `INC-${org.code}-${String(counter.seq).padStart(4, '0')}`;
});

const Incident = mongoose.model('Incident', incidentSchema);

module.exports = Incident;

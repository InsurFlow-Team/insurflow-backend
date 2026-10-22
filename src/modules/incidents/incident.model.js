const mongoose = require('mongoose');
const Counter = require('../../utils/counter.model');
const Organization = require('../organizations/organization.model');

const incidentVehicleSchema = new mongoose.Schema(
  {
    vehicleRole: {
      type: String,
      enum: ['INSURED', 'THIRD_PARTY', 'OTHER'],
      required: true,
    },
    plateRegion: {
      type: String,
      enum: ['PALESTINIAN', 'ISRAELI', 'OTHER', 'UNKNOWN'],
      required: true,
    },
    plateNumber: {
      type: String,
      trim: true,
      maxlength: 20,
      default: null,
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      default: null,
    },
    make: {
      type: String,
      trim: true,
      maxlength: 50,
      default: null,
    },
    model: {
      type: String,
      trim: true,
      maxlength: 50,
      default: null,
    },
    year: {
      type: Number,
      default: null,
    },
    insurerName: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },
    vehicleUse: {
      type: String,
      trim: true,
      maxlength: 20,
      default: null,
    },
    lienholderBank: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },
  },
  { _id: true, timestamps: false }
);

const partySchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: [
        'INSURED_DRIVER',
        'OWNER',
        'THIRD_PARTY_DRIVER',
        'PASSENGER',
        'PEDESTRIAN',
        'WITNESS',
        'GUARDIAN',
        'HEIR',
        'POLICYHOLDER',
        'AUTHORIZED_REPRESENTATIVE',
        'LIENHOLDER',
      ],
      required: true,
    },
    partyType: {
      type: String,
      enum: ['PERSON', 'COMPANY'],
      required: true,
      default: 'PERSON',
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    idType: {
      type: String,
      enum: ['PALESTINIAN_ID', 'ISRAELI_ID', 'PASSPORT', 'COMPANY_REGISTRATION'],
      default: null,
    },
    idNumber: {
      type: String,
      trim: true,
      default: null,
    },
    phone: {
      type: String,
      default: null,
    },
    licenseClass: {
      type: String,
      trim: true,
      maxlength: 20,
      default: null,
    },
    licenseExpiry: {
      type: String,
      default: null,
    },
    vehicleRef: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  { _id: true, timestamps: false }
);

const damagedItemSchema = new mongoose.Schema(
  {
    itemType: {
      type: String,
      enum: ['BUILDING', 'OTHER'],
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
  },
  { _id: true, timestamps: false }
);

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
    incidentAt: {
      type: Date,
      default: null,
    },
    reportedAt: {
      type: Date,
      default: Date.now,
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
    governorate: {
      type: String,
      enum: [
        'JENIN',
        'TUBAS',
        'TULKARM',
        'NABLUS',
        'QALQILYA',
        'SALFIT',
        'RAMALLAH_AL_BIREH',
        'JERICHO',
        'JERUSALEM',
        'BETHLEHEM',
        'HEBRON',
        'NORTH_GAZA',
        'GAZA',
        'DEIR_AL_BALAH',
        'KHAN_YUNIS',
        'RAFAH',
      ],
      default: null,
    },
    reportSource: {
      type: String,
      enum: [
        'PALESTINIAN_POLICE_EKROKA',
        'PALESTINIAN_POLICE_PAPER',
        'ISRAELI_POLICE',
        'AGREED_STATEMENT',
        'NONE',
      ],
      default: null,
    },
    eKrokaReference: {
      type: String,
      trim: true,
      maxlength: 50,
      default: null,
    },
    policeReportNumber: {
      type: String,
      trim: true,
      maxlength: 50,
      default: null,
    },
    injuriesReported: {
      type: Boolean,
      default: null,
    },
    vehicles: {
      type: [incidentVehicleSchema],
      default: [],
    },
    parties: {
      type: [partySchema],
      default: [],
    },
    damagedItems: {
      type: [damagedItemSchema],
      default: [],
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

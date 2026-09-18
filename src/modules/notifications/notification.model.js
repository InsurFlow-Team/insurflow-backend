const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  type: {
    type: String,
    enum: ['ASSIGNED', 'PENDING_ACCEPTANCE', 'CORRECTION_REQUIRED', 'APPROVED', 'REJECTED'],
    required: true,
  },
  relatedClaimId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Claim',
    required: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  body: {
    type: String,
    required: true,
    trim: true,
  },
  read: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

notificationSchema.index({ organizationId: 1, recipientId: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);

const mongoose = require('mongoose');
const Claim = require('./claim.model');


const create = async (data) => {
  const claim = new Claim(data);
  return await claim.save();
};


const findByOrganization = async (organizationId, filter = {}, pagination = {}) => {
  const { page = 1, limit = 50 } = pagination;
  const skip = (page - 1) * limit;

  // Support both legacy string status and filter object: { status, adjusterId }
  const status = typeof filter === 'string' ? filter : filter?.status;
  const adjusterId = typeof filter === 'object' ? (filter?.adjusterId || filter?.assignedTo) : undefined;

  const query = {
    organizationId,
    ...(status && { status }),
    ...(adjusterId && { assignedTo: adjusterId }),
  };

  const [totalCount, claims] = await Promise.all([
    Claim.countDocuments(query),
    Claim.find(query)
      .select('claimNumber status customer.name vehicle.plateNumber incidentType createdAt assignedTo incidentCoordinates')
      .populate('assignedTo', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return { totalCount, claims };
};


const findByAssignee = async (organizationId, userId, status, pagination = {}) => {
  const { page = 1, limit = 50 } = pagination;
  const skip = (page - 1) * limit;
  const query = { organizationId, assignedTo: userId, ...(status && { status }) };

  const [totalCount, claims] = await Promise.all([
    Claim.countDocuments(query),
    Claim.find(query)
      .select('claimNumber status customer.name vehicle.plateNumber incidentType createdAt assignedTo incidentCoordinates')
      .populate('assignedTo', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return { totalCount, claims };
};



const findByIdAndOrganization = async (claimId, organizationId) => {
  return await Claim.findOne({ _id: claimId, organizationId })
    .populate('createdBy', 'name employeeCode role')
    .populate('assignedTo', 'name employeeCode role')
    .populate('assignedBy', 'name employeeCode role')
    .populate('policyId', 'policyNumber status startDate expiryDate')
    .populate('vehicle.vehicleId', 'plateNumber make model year color')
    .populate('vehicle.customerId', 'fullName phone')
    .populate('evidence.uploadedBy', 'name employeeCode')
    .populate('timeline.performedBy', 'name employeeCode role')
    .populate('lossAssessment.assessedBy', 'name employeeCode role')
    .lean();
};

const findByIncidentId = async (organizationId, incidentId) => {
  return await Claim.find({ organizationId, incidentId })
    .select('claimNumber claimType status vehicle.plateNumber vehicle.vehicleId createdAt')
    .sort({ createdAt: 1 })
    .lean();
};

const findForReport = async (claimId, organizationId) => {
  return await Claim.findOne({ _id: claimId, organizationId })
    .populate('createdBy', 'name employeeCode role')
    .populate('assignedTo', 'name employeeCode role')
    .populate('assignedBy', 'name employeeCode role')
    .populate('closedBy', 'name employeeCode role')
    .populate('signature.capturedBy', 'name employeeCode role')
    .populate('evidence.uploadedBy', 'name employeeCode role')
    .populate('timeline.performedBy', 'name employeeCode role')
    .populate('lossAssessment.assessedBy', 'name employeeCode role')
    .lean();
};


const countActiveClaimsByAssignee = async (userId) => {
  return await Claim.countDocuments({
    assignedTo: userId,
    status: { $in: Claim.ACTIVE_ADJUSTER_STATUSES || ['ASSIGNED', 'IN_PROGRESS', 'CORRECTION_REQUIRED'] },
  });
};

const assignClaim = async (claimId, organizationId, updateData) => {
  const { assignedTo, assignedBy, assignedAt, status, priority, assignmentNotes, timelineEvent } = updateData;
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'NEW' },
    {
      $set: { assignedTo, assignedBy, assignedAt, status, priority, assignmentNotes },
      $push: { timeline: timelineEvent },
    },
    { returnDocument: 'after' }
  ).lean();
};

const startInspection = async (claimId, organizationId, assignedTo, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    {
      _id: claimId,
      organizationId,
      assignedTo,
      status: { $in: ['ASSIGNED', 'CORRECTION_REQUIRED'] },
    },
    {
      $set: { status: 'IN_PROGRESS' },
      $push: { timeline: timelineEvent },
    },
    { returnDocument: 'after' }
  ).lean();
};

const updateVehicle = async (claimId, organizationId, assignedTo, policyId, vehicleData, timelineEvent) => {
  if (!policyId) {
    throw new Error('updateVehicle requires the claim policyId');
  }
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'IN_PROGRESS', assignedTo, policyId },
    { $set: { vehicle: vehicleData }, $push: { timeline: timelineEvent } },
    { returnDocument: 'after' }
  ).lean();
};

const updateAccident = async (claimId, organizationId, assignedTo, accidentData, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'IN_PROGRESS', assignedTo },
    { $set: { accident: accidentData }, $push: { timeline: timelineEvent } },
    { returnDocument: 'after' }
  ).lean();
};

const updateLocation = async (claimId, organizationId, assignedTo, locationData, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'IN_PROGRESS', assignedTo },
    { $set: { location: locationData }, $push: { timeline: timelineEvent } },
    { returnDocument: 'after' }
  ).lean();
};

const addEvidence = async (claimId, organizationId, assignedTo, evidenceItem, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'IN_PROGRESS', assignedTo },
    { $push: { evidence: evidenceItem, timeline: timelineEvent } },
    { returnDocument: 'after' }
  ).lean();
};

const setSignature = async (claimId, organizationId, assignedTo, signatureData, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'IN_PROGRESS', assignedTo },
    { $set: { signature: signatureData }, $push: { timeline: timelineEvent } },
    { returnDocument: 'after' }
  ).lean();
};

const submitInspection = async (claimId, organizationId, assignedTo, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'IN_PROGRESS', assignedTo },
    { $set: { status: 'SUBMITTED' }, $push: { timeline: timelineEvent } },
    { returnDocument: 'after' }
  ).lean();
};

const startReview = async (claimId, organizationId, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'SUBMITTED' },
    { $set: { status: 'UNDER_REVIEW' }, $push: { timeline: timelineEvent } },
    { returnDocument: 'after' }
  ).lean();
};

const requestCorrection = async (claimId, organizationId, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'UNDER_REVIEW' },
    {
      $set: { status: 'CORRECTION_REQUIRED' },
      $push: { timeline: timelineEvent },
    },
    { returnDocument: 'after' }
  ).lean();
};

const makeDecision = async (claimId, organizationId, decision, decisionNotes, timelineEvent, lossAssessmentDoc = null) => {
  const updateFields = {
    status: decision,
    decisionNotes,
  };
  if (lossAssessmentDoc) {
    updateFields.lossAssessment = lossAssessmentDoc;
  }
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'UNDER_REVIEW' },
    {
      $set: updateFields,
      $push: { timeline: timelineEvent },
    },
    { returnDocument: 'after' }
  ).lean();
};

const closeClaim = async (claimId, organizationId, closedBy, closingNotes, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'APPROVED' },
    {
      $set: {
        status: 'CLOSED',
        closedBy,
        closedAt: timelineEvent.timestamp || new Date(),
        closingNotes,
      },
      $push: { timeline: timelineEvent },
    },
    { returnDocument: 'after' }
  ).lean();
};

/**
 * Aggregates claim status counts scoped by tenant (organizationId), optional assignee, and optional date range on createdAt.
 * @param {Object} options
 * @param {string|mongoose.Types.ObjectId} options.organizationId
 * @param {string|mongoose.Types.ObjectId} [options.assignedTo]
 * @param {Date} [options.fromDate]
 * @param {Date} [options.toDate]
 * @returns {Promise<Array<{ _id: string, count: number }>>}
 */
const getClaimStats = async ({ organizationId, assignedTo, fromDate, toDate }) => {
  const orgObjectId =
    typeof organizationId === 'string'
      ? new mongoose.Types.ObjectId(organizationId)
      : organizationId;

  const match = {
    organizationId: orgObjectId,
  };

  if (assignedTo) {
    match.assignedTo =
      typeof assignedTo === 'string'
        ? new mongoose.Types.ObjectId(assignedTo)
        : assignedTo;
  }

  if (fromDate || toDate) {
    match.createdAt = {
      ...(fromDate && { $gte: fromDate instanceof Date ? fromDate : new Date(fromDate) }),
      ...(toDate && { $lte: toDate instanceof Date ? toDate : new Date(toDate) }),
    };
  }


  const pipeline = [
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ];

  return await Claim.aggregate(pipeline);
};

const acceptAssignment = async (claimId, organizationId, assignedTo, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    {
      _id: claimId,
      organizationId,
      status: 'PENDING_ACCEPTANCE',
      assignedTo,
    },
    {
      $set: { status: 'ASSIGNED' },
      $push: { timeline: timelineEvent },
    },
    { returnDocument: 'after' }
  ).lean();
};

const declineAssignment = async (claimId, organizationId, assignedTo, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    {
      _id: claimId,
      organizationId,
      status: 'PENDING_ACCEPTANCE',
      assignedTo,
    },
    {
      $set: {
        status: 'NEW',
        assignedTo: null,
        assignedBy: null,
        assignedAt: null,
        assignmentNotes: null,
      },
      $push: { timeline: timelineEvent },
    },
    { returnDocument: 'after' }
  ).lean();
};

/**
 * Finds a claim by its public tracking token.
 * Populates vehicle details for public status display and selects only needed fields.
 */
const findByTrackingToken = async (trackingToken) => {
  return await Claim.findOne({ trackingToken })
    .select('claimNumber status vehicle timeline createdAt')
    .populate({
      path: 'vehicle.vehicleId',
      select: 'plateNumber make model year',
    })
    .lean();
};


const addEstimate = async (filter, updateDoc) => {
  return await Claim.findOneAndUpdate(
    filter,
    updateDoc,
    { returnDocument: 'after' }
  ).lean();
};

const approveEstimate = async (claimId, organizationId, version, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    {
      _id: claimId,
      organizationId,
      status: 'UNDER_REVIEW',
      'estimates.version': version,
    },
    {
      $set: { approvedEstimateVersion: version },
      $push: { timeline: timelineEvent },
    },
    { returnDocument: 'after' }
  ).lean();
};

const atomicCreateRepairOrder = async (filter, orderDoc, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    filter,
    {
      $push: {
        repairOrders: orderDoc,
        timeline: timelineEvent,
      },
    },
    { returnDocument: 'after' }
  ).lean();
};

const atomicUpdateRepairOrderStatus = async (filter, updateDoc) => {
  return await Claim.findOneAndUpdate(
    filter,
    updateDoc,
    { returnDocument: 'after' }
  ).lean();
};

module.exports = {
  create,
  findByOrganization,
  findByAssignee,
  findByIdAndOrganization,
  countActiveClaimsByAssignee,
  assignClaim,
  acceptAssignment,
  declineAssignment,
  startInspection,
  updateVehicle,
  updateAccident,
  updateLocation,
  addEvidence,
  setSignature,
  submitInspection,
  startReview,
  requestCorrection,
  makeDecision,
  closeClaim,
  getClaimStats,
  findForReport,
  findByTrackingToken,
  findByIncidentId,
  addEstimate,
  approveEstimate,
  atomicCreateRepairOrder,
  atomicUpdateRepairOrderStatus,
};

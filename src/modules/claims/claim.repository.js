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
      .select('claimNumber status customer.name vehicle.plateNumber incidentType createdAt assignedTo')
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
      .select('claimNumber status customer.name vehicle.plateNumber incidentType createdAt assignedTo')
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
    .populate('timeline.performedBy', 'name employeeCode role')
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

const updateVehicle = async (claimId, organizationId, assignedTo, vehicleData, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'IN_PROGRESS', assignedTo },
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

const makeDecision = async (claimId, organizationId, decision, decisionNotes, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'UNDER_REVIEW' },
    {
      $set: { status: decision, decisionNotes },
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

const declineAssignment = async (claimId, organizationId, assignedTo, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    {
      _id: claimId,
      organizationId,
      status: 'ASSIGNED',
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

module.exports = {
  create,
  findByOrganization,
  findByAssignee,
  findByIdAndOrganization,
  countActiveClaimsByAssignee,
  assignClaim,
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
};

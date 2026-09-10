const Claim = require('./claim.model');


const create = async (data) => {
  const claim = new Claim(data);
  return await claim.save();
};


const findByOrganization = async (organizationId, status, pagination = {}) => {
  const { page = 1, limit = 50 } = pagination;
  const skip = (page - 1) * limit;
  const query = { organizationId, ...(status && { status }) };

  const [totalCount, claims] = await Promise.all([
    Claim.countDocuments(query),
    Claim.find(query)
      .select('claimNumber status customer.name vehicle.plateNumber incidentType createdAt')
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
      .select('claimNumber status customer.name vehicle.plateNumber incidentType createdAt')
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

module.exports = {
  create,
  findByOrganization,
  findByAssignee,
  findByIdAndOrganization,
  countActiveClaimsByAssignee,
  assignClaim,
  startInspection,
  updateVehicle,
  updateAccident,
  updateLocation,
  submitInspection,
  startReview,
  requestCorrection,
  makeDecision,
  closeClaim,
};

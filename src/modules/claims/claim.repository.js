const Claim = require('./claim.model');


const create = async (data) => {
  const claim = new Claim(data);
  return await claim.save();
};


const findByOrganization = async (organizationId, status) => {
  const query = { organizationId, ...(status && { status }) };
  return await Claim.find(query)
    .select('claimNumber status customer.name vehicle.plateNumber incidentType createdAt')
    .sort({ createdAt: -1 })
    .lean();
};


const findByAssignee = async (organizationId, userId, status) => {
  const query = { organizationId, assignedTo: userId, ...(status && { status }) };
  return await Claim.find(query)
    .select('claimNumber status customer.name vehicle.plateNumber incidentType createdAt')
    .sort({ createdAt: -1 })
    .lean();
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
    status: 'ASSIGNED',
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
    { new: true }
  ).lean();
};

const updateVehicle = async (claimId, organizationId, assignedTo, vehicleData, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'ASSIGNED', assignedTo },
    { $set: { vehicle: vehicleData }, $push: { timeline: timelineEvent } },
    { new: true }
  ).lean();
};

const updateAccident = async (claimId, organizationId, assignedTo, accidentData, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'ASSIGNED', assignedTo },
    { $set: { accident: accidentData }, $push: { timeline: timelineEvent } },
    { new: true }
  ).lean();
};

const updateLocation = async (claimId, organizationId, assignedTo, locationData, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'ASSIGNED', assignedTo },
    { $set: { location: locationData }, $push: { timeline: timelineEvent } },
    { new: true }
  ).lean();
};

const submitInspection = async (claimId, organizationId, assignedTo, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'ASSIGNED', assignedTo },
    { $set: { status: 'SUBMITTED' }, $push: { timeline: timelineEvent } },
    { new: true }
  ).lean();
};

const startReview = async (claimId, organizationId, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'SUBMITTED' },
    { $set: { status: 'UNDER_REVIEW' }, $push: { timeline: timelineEvent } },
    { new: true }
  ).lean();
};

const makeDecision = async (claimId, organizationId, decision, decisionNotes, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'UNDER_REVIEW' },
    {
      $set: { status: decision, decisionNotes },
      $push: { timeline: timelineEvent },
    },
    { new: true }
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
    { new: true }
  ).lean();
};

module.exports = {
  create,
  findByOrganization,
  findByAssignee,
  findByIdAndOrganization,
  countActiveClaimsByAssignee,
  assignClaim,
  updateVehicle,
  updateAccident,
  updateLocation,
  submitInspection,
  startReview,
  makeDecision,
  closeClaim,
};

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

const assignClaim = async (claimId, updateData) => {
  const { assignedTo, assignedBy, assignedAt, status, priority, assignmentNotes, timelineEvent } = updateData;
  return await Claim.findByIdAndUpdate(
    claimId,
    {
      $set: { assignedTo, assignedBy, assignedAt, status, priority, assignmentNotes },
      $push: { timeline: timelineEvent },
    },
    { new: true }
  ).lean();
};

const updateVehicle = async (claimId, vehicleData, timelineEvent) => {
  return await Claim.findByIdAndUpdate(
    claimId,
    { $set: { vehicle: vehicleData }, $push: { timeline: timelineEvent } },
    { new: true }
  ).lean();
};

const updateAccident = async (claimId, accidentData, timelineEvent) => {
  return await Claim.findByIdAndUpdate(
    claimId,
    { $set: { accident: accidentData }, $push: { timeline: timelineEvent } },
    { new: true }
  ).lean();
};

const updateLocation = async (claimId, locationData, timelineEvent) => {
  return await Claim.findByIdAndUpdate(
    claimId,
    { $set: { location: locationData }, $push: { timeline: timelineEvent } },
    { new: true }
  ).lean();
};

const submitInspection = async (claimId, timelineEvent) => {
  return await Claim.findByIdAndUpdate(
    claimId,
    { $set: { status: 'SUBMITTED' }, $push: { timeline: timelineEvent } },
    { new: true }
  ).lean();
};

const startReview = async (claimId, timelineEvent) => {
  return await Claim.findByIdAndUpdate(
    claimId,
    { $set: { status: 'UNDER_REVIEW' }, $push: { timeline: timelineEvent } },
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
};

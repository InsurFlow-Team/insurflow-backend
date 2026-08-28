const Claim = require('./claim.model');

/**
 * Data Access Layer — all raw DB queries live here.
 * Services must NEVER call Mongoose directly; they go through this layer.
 */

/**
 * Create a new claim in the database.
 * @param {object} data - Claim document data.
 * @returns {Promise<Claim>}
 */
const create = async (data) => {
  const claim = new Claim(data);
  return await claim.save();
};

/**
 * Find all claims for a CLAIMS_OFFICER or ADMIN — scoped to their organization.
 * @param {string} organizationId
 * @returns {Promise<Claim[]>}
 */
const findByOrganization = async (organizationId, status) => {
  const query = { organizationId, ...(status && { status }) };
  return await Claim.find(query)
    .select('claimNumber status customer.name vehicle.plateNumber incidentType createdAt')
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Find all claims assigned to a specific FIELD_ADJUSTER.
 * Scoped to their organization + their userId.
 * @param {string} organizationId
 * @param {string} userId
 * @returns {Promise<Claim[]>}
 */
const findByAssignee = async (organizationId, userId, status) => {
  const query = { organizationId, assignedTo: userId, ...(status && { status }) };
  return await Claim.find(query)
    .select('claimNumber status customer.name vehicle.plateNumber incidentType createdAt')
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Find a single claim by ID — scoped to the organization.
 * Populates references for the detail view.
 * @param {string} claimId
 * @param {string} organizationId
 * @returns {Promise<Claim|null>}
 */
const findByIdAndOrganization = async (claimId, organizationId) => {
  return await Claim.findOne({ _id: claimId, organizationId })
    .populate('createdBy', 'name employeeCode role')
    .populate('assignedTo', 'name employeeCode role')
    .populate('assignedBy', 'name employeeCode role')
    .populate('timeline.performedBy', 'name employeeCode role')
    .lean();
};

/**
 * Count the number of active claims assigned to a specific user.
 * Active implies the claim is not CLOSED.
 * @param {string} userId
 * @returns {Promise<number>}
 */
const countActiveClaimsByAssignee = async (userId) => {
  return await Claim.countDocuments({
    assignedTo: userId,
    status: 'ASSIGNED',
  });
};
/**
 * Assign a claim to an adjuster.
 * Updates assignedTo, assignedBy, assignedAt, status, and timeline.
 * @param {string} claimId
 * @param {object} updateData - Object containing assignedTo, assignedBy, assignedAt, status, and timeline event.
 * @returns {Promise<Claim|null>}
 */
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

const Policy = require('./policy.model');

const findByIdAndOrganization = async (policyId, organizationId) => {
  return await Policy.findOne({ _id: policyId, organizationId }).lean();
};

const findByIdsAndOrganization = async (policyIds, organizationId) => {
  return await Policy.find({ _id: { $in: policyIds }, organizationId }).lean();
};

const findByPolicyNumberAndOrganization = async (policyNumber, organizationId) => {
  return await Policy.findOne({ policyNumber, organizationId }).lean();
};

module.exports = {
  findByIdAndOrganization,
  findByIdsAndOrganization,
  findByPolicyNumberAndOrganization,
};

const Policy = require('./policy.model');

const findByIdAndOrganization = async (policyId, organizationId) => {
  return await Policy.findOne({ _id: policyId, organizationId }).lean();
};

module.exports = { findByIdAndOrganization };

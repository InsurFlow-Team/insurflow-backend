const Customer = require('./customer.model');

const findByIdAndOrganization = async (customerId, organizationId) => {
  return await Customer.findOne({ _id: customerId, organizationId }).lean();
};

module.exports = { findByIdAndOrganization };

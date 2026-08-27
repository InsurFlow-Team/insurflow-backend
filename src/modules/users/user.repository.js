const User = require('./user.model');

/**
 * Find all FIELD_ADJUSTER users for a given organization.
 * @param {string} organizationId
 * @returns {Promise<User[]>}
 */
const findAdjustersByOrganization = async (organizationId) => {
  return await User.find({
    organizationId,
    role: 'FIELD_ADJUSTER',
  })
    .select('name employeeCode role status')
    .lean();
};

/**
 * Find a single user by ID, scoped to an organization.
 * @param {string} userId
 * @param {string} organizationId
 * @returns {Promise<User|null>}
 */
const findByIdAndOrganization = async (userId, organizationId) => {
  return await User.findOne({ _id: userId, organizationId }).lean();
};

module.exports = {
  findAdjustersByOrganization,
  findByIdAndOrganization,
};

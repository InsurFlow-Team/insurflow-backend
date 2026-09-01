const User = require('./user.model');


const findAdjustersByOrganization = async (organizationId) => {
  return await User.find({
    organizationId,
    role: 'FIELD_ADJUSTER',
  })
    .select('name employeeCode role status')
    .lean();
};

const findByIdAndOrganization = async (userId, organizationId) => {
  return await User.findOne({ _id: userId, organizationId }).lean();
};

module.exports = {
  findAdjustersByOrganization,
  findByIdAndOrganization,
};

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

const findByIdWithPassword = async (userId, organizationId) => {
  return await User.findOne({ _id: userId, organizationId }).select('+password');
};

const create = async (data) => {
  const user = new User(data);
  return await user.save();
};

const findAllByOrganization = async (organizationId, role) => {
  return await User.find({ organizationId, ...(role && { role }) })
    .select('name employeeCode role status createdAt')
    .lean();
};

const resetPassword = async (userId, organizationId, newPassword) => {
  const user = await User.findOne({ _id: userId, organizationId });
  if (!user) return null;
  user.password = newPassword;
  await user.save();
  return user;
};

const updateStatus = async (userId, organizationId, status) => {
  return await User.findOneAndUpdate(
    { _id: userId, organizationId },
    { $set: { status } },
    { new: true }
  ).lean();
};

module.exports = {
  findAdjustersByOrganization,
  findByIdAndOrganization,
  findByIdWithPassword,
  create,
  findAllByOrganization,
  resetPassword,
  updateStatus,
};

const Incident = require('./incident.model');

const create = async (data) => {
  const incident = new Incident(data);
  return await incident.save();
};

const deleteByIdAndOrganization = async (id, organizationId) => {
  return await Incident.findOneAndDelete({ _id: id, organizationId });
};

module.exports = {
  create,
  deleteByIdAndOrganization,
};

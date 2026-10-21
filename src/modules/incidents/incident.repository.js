const Incident = require('./incident.model');

const create = async (data) => {
  const incident = new Incident(data);
  return await incident.save();
};

const deleteByIdAndOrganization = async (id, organizationId) => {
  return await Incident.findOneAndDelete({ _id: id, organizationId });
};

const findByIdAndOrganization = async (id, organizationId) => {
  return await Incident.findOne({ _id: id, organizationId }).lean();
};

const findByOrganization = async (organizationId, filter = {}, pagination = {}) => {
  const { page = 1, limit = 50 } = pagination;
  const skip = (page - 1) * limit;
  const { incidentNumber, from, to } = filter;

  const query = {
    organizationId,
    ...(incidentNumber && { incidentNumber }),
  };

  if (from || to) {
    query.incidentDate = {
      ...(from && { $gte: from }),
      ...(to && { $lte: to }),
    };
  }

  const [totalCount, incidents] = await Promise.all([
    Incident.countDocuments(query),
    Incident.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return { totalCount, incidents };
};

const countByOrganization = async (organizationId, { fromDate, toDate } = {}) => {
  const query = { organizationId };
  if (fromDate || toDate) {
    query.createdAt = {
      ...(fromDate && { $gte: fromDate instanceof Date ? fromDate : new Date(fromDate) }),
      ...(toDate && { $lte: toDate instanceof Date ? toDate : new Date(toDate) }),
    };
  }
  return await Incident.countDocuments(query);
};

module.exports = {
  create,
  deleteByIdAndOrganization,
  findByIdAndOrganization,
  findByOrganization,
  countByOrganization,
};

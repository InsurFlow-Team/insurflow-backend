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

const pushVehicle = async (incidentId, organizationId, vehicleData) => {
  return await Incident.findOneAndUpdate(
    {
      _id: incidentId,
      organizationId,
      'vehicles.9': { $exists: false },
    },
    { $push: { vehicles: vehicleData } },
    { returnDocument: 'after' }
  ).lean();
};

const pushParty = async (incidentId, organizationId, partyData) => {
  const filter = {
    _id: incidentId,
    organizationId,
    'parties.29': { $exists: false },
  };
  if (partyData.vehicleRef) {
    filter['vehicles._id'] = partyData.vehicleRef;
  }
  return await Incident.findOneAndUpdate(
    filter,
    { $push: { parties: partyData } },
    { returnDocument: 'after' }
  ).lean();
};

const pushDamagedItem = async (incidentId, organizationId, itemData) => {
  return await Incident.findOneAndUpdate(
    {
      _id: incidentId,
      organizationId,
      'damagedItems.19': { $exists: false },
    },
    { $push: { damagedItems: itemData } },
    { returnDocument: 'after' }
  ).lean();
};

const fillReportFields = async (incidentId, organizationId, fields) => {
  const filter = {
    _id: incidentId,
    organizationId,
  };
  const setUpdates = {};

  if (fields.reportSource !== undefined) {
    filter.reportSource = { $in: [null, 'NONE'] };
    setUpdates.reportSource = fields.reportSource;
  }
  if (fields.eKrokaReference !== undefined) {
    filter.eKrokaReference = null;
    if (fields.reportSource === undefined) {
      filter.reportSource = 'PALESTINIAN_POLICE_EKROKA';
    }
    setUpdates.eKrokaReference = fields.eKrokaReference;
  }
  if (fields.policeReportNumber !== undefined) {
    filter.policeReportNumber = null;
    if (fields.reportSource === undefined) {
      filter.reportSource = { $in: ['PALESTINIAN_POLICE_PAPER', 'ISRAELI_POLICE'] };
    }
    setUpdates.policeReportNumber = fields.policeReportNumber;
  }
  if (fields.injuriesReported !== undefined) {
    filter.injuriesReported = { $in: [null, false] };
    setUpdates.injuriesReported = true;
  }
  if (fields.accidentArea !== undefined) {
    filter.accidentArea = { $in: [null, 'UNKNOWN'] };
    setUpdates.accidentArea = fields.accidentArea;
  }

  return await Incident.findOneAndUpdate(
    filter,
    { $set: setUpdates },
    { returnDocument: 'after' }
  ).lean();
};

module.exports = {
  create,
  deleteByIdAndOrganization,
  findByIdAndOrganization,
  findByOrganization,
  countByOrganization,
  pushVehicle,
  pushParty,
  pushDamagedItem,
  fillReportFields,
};

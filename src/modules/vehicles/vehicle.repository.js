const Vehicle = require('./vehicle.model');


const findByPlateAndOrganization = async (plateNumber, organizationId) => {
  return await Vehicle.findOne({ plateNumber, organizationId })
    .populate('customerId')
    .populate('compulsoryPolicyId').populate('complementaryPolicyId')
    .lean();
};


const create = async (data) => {
  const vehicle = new Vehicle(data);
  return await vehicle.save();
};

const findByIdAndOrganization = async (vehicleId, organizationId) => {
  return await Vehicle.findOne({ _id: vehicleId, organizationId }).lean();
};

const findByIdsAndOrganization = async (vehicleIds, organizationId) => {
  return await Vehicle.find({ _id: { $in: vehicleIds }, organizationId }).lean();
};

const findAllByPolicyAndOrganization = async (policyId, organizationId, policyKind) => {
  const filter = { organizationId };
  if (policyKind === 'COMPLEMENTARY') {
    filter.complementaryPolicyId = policyId;
  } else if (policyKind === 'UNIFIED_COMPULSORY') {
    filter.compulsoryPolicyId = policyId;
  } else {
    filter.$or = [{ compulsoryPolicyId: policyId }, { complementaryPolicyId: policyId }];
  }
  return await Vehicle.find(filter)
    .populate('customerId')
    .lean();
};

module.exports = {
  findByPlateAndOrganization,
  findByIdAndOrganization,
  findByIdsAndOrganization,
  findAllByPolicyAndOrganization,
  create,
};

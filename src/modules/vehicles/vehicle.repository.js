const Vehicle = require('./vehicle.model');


const findByPlateAndOrganization = async (plateNumber, organizationId) => {
  return await Vehicle.findOne({ plateNumber, organizationId })
    .populate('customerId')
    .populate('policyId')
    .lean();
};


const create = async (data) => {
  const vehicle = new Vehicle(data);
  return await vehicle.save();
};

const findByIdAndOrganization = async (vehicleId, organizationId) => {
  return await Vehicle.findOne({ _id: vehicleId, organizationId }).lean();
};

module.exports = {
  findByPlateAndOrganization,
  findByIdAndOrganization,
  create,
};

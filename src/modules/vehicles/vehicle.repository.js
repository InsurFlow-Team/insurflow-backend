const Vehicle = require('./vehicle.model');

/**
 * Find a vehicle by plate number and organization.
 * Populates customer and policy references.
 *
 * @param {string} plateNumber
 * @param {string} organizationId
 * @returns {Promise<Vehicle|null>}
 */
const findByPlateAndOrganization = async (plateNumber, organizationId) => {
  return await Vehicle.findOne({ plateNumber, organizationId })
    .populate('customerId')
    .populate('policyId')
    .lean();
};

/**
 * Insert a mock vehicle directly into the DB.
 * Only used for testing/seeding.
 */
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

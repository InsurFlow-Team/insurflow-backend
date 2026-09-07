const vehicleService = require('./vehicle.service');
const { successResponse } = require('../../utils/apiResponse');
const asyncWrapper = require('../../utils/asyncWrapper');

/**
 * GET /api/v1/vehicles/lookup
 * Look up a vehicle by plate number.
 */
const lookupVehicle = async (req, res) => {
  const result = await vehicleService.lookupVehicle(req.query.plateNumber, req.user);
  return res.status(200).json(successResponse('Vehicle found successfully', result));
};

module.exports = {
  lookupVehicle: asyncWrapper(lookupVehicle),
};

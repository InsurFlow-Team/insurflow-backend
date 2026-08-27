const vehicleService = require('./vehicle.service');
const { lookupVehicleSchema } = require('./vehicle.validation');
const { successResponse, errorResponse } = require('../../utils/apiResponse');

/**
 * GET /api/v1/vehicles/lookup
 * Look up a vehicle by plate number.
 */
const lookupVehicle = async (req, res) => {
  const { error, value } = lookupVehicleSchema.validate(req.query, { abortEarly: false });
  if (error) {
    const validationErrors = error.details.map((e) => ({
      code: 'VALIDATION_ERROR',
      details: e.message,
    }));
    return res.status(400).json(errorResponse('Validation Error', validationErrors));
  }

  const result = await vehicleService.lookupVehicle(value.plateNumber, req.user);
  return res.status(200).json(successResponse('Vehicle found successfully', result));
};

module.exports = {
  lookupVehicle,
};

const Joi = require('joi');

const lookupVehicleSchema = Joi.object({
  plate_number: Joi.string().trim().required().messages({
    'string.empty': 'Plate number is required',
    'any.required': 'Plate number is required',
  }),
});

module.exports = {
  lookupVehicleSchema,
};

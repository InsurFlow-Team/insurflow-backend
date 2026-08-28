const Joi = require('joi');

/**
 * Validation schema for POST /claims
 * Only the fields the CLIENT is allowed to send.
 * organizationId, createdBy, status are set by the Backend — never from the client.
 */
const createClaimSchema = Joi.object({
  customerName: Joi.string().trim().required().messages({
    'string.empty': 'Customer name is required',
    'any.required': 'Customer name is required',
  }),
  customerPhone: Joi.string().trim().required().messages({
    'string.empty': 'Customer phone is required',
    'any.required': 'Customer phone is required',
  }),
  initialPlateNumber: Joi.string().trim().required().messages({
    'string.empty': 'Initial plate number is required',
    'any.required': 'Initial plate number is required',
  }),
  incidentType: Joi.string()
    .valid('COLLISION', 'REAR_END_COLLISION', 'SIDE_IMPACT', 'PARKING_DAMAGE', 'OTHER')
    .required()
    .messages({
      'any.only': 'incidentType must be one of: COLLISION, REAR_END_COLLISION, SIDE_IMPACT, PARKING_DAMAGE, OTHER',
      'any.required': 'Incident type is required',
    }),
  incidentLocation: Joi.string().trim().required().messages({
    'string.empty': 'Incident location is required',
    'any.required': 'Incident location is required',
  }),
});

/**
 * Validation schema for POST /claims/:claimId/assign
 */
const assignClaimSchema = Joi.object({
  adjusterId: Joi.string().trim().required().messages({
    'string.empty': 'Adjuster ID is required',
    'any.required': 'Adjuster ID is required',
  }),
  priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH').optional().default('MEDIUM'),
  notes: Joi.string().trim().optional().allow('', null),
});

const updateVehicleSchema = Joi.object({
  vehicleId: Joi.string().trim().required(),
  policyId: Joi.string().trim().required(),
  customerId: Joi.string().trim().required(),
  plateNumber: Joi.string().trim().required(),
});

const updateAccidentSchema = Joi.object({
  accidentType: Joi.string()
    .valid('COLLISION', 'REAR_END_COLLISION', 'SIDE_IMPACT', 'PARKING_DAMAGE', 'OTHER')
    .required(),
  accidentDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required().messages({
    'string.pattern.base': 'accidentDate must be in YYYY-MM-DD format',
  }),
  accidentTime: Joi.string().pattern(/^\d{2}:\d{2}$/).required().messages({
    'string.pattern.base': 'accidentTime must be in HH:mm format',
  }),
  description: Joi.string().trim().required(),
  damageDescription: Joi.string().trim().required(),
});

const updateLocationSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  address: Joi.string().trim().required(),
  capturedAt: Joi.date().iso().required(),
});

module.exports = {
  createClaimSchema,
  assignClaimSchema,
  updateVehicleSchema,
  updateAccidentSchema,
  updateLocationSchema,
};

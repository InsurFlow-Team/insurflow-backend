const Joi = require('joi');
const { objectIdPattern } = require('../../middlewares/validate.middleware');

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
  adjusterId: Joi.string()
    .trim()
    .pattern(objectIdPattern)
    .required()
    .messages({
      'string.pattern.base': 'Invalid ID format',
      'string.empty': 'Adjuster ID is required',
      'any.required': 'Adjuster ID is required',
    }),
  priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH').optional().default('MEDIUM'),
  notes: Joi.string().trim().optional().allow('', null),
});

const updateVehicleSchema = Joi.object({
  vehicleId: Joi.string()
    .trim()
    .pattern(objectIdPattern)
    .required()
    .messages({
      'string.pattern.base': 'Invalid ID format',
      'string.empty': 'Vehicle ID is required',
      'any.required': 'Vehicle ID is required',
    }),
  policyId: Joi.string()
    .trim()
    .pattern(objectIdPattern)
    .required()
    .messages({
      'string.pattern.base': 'Invalid ID format',
      'string.empty': 'Policy ID is required',
      'any.required': 'Policy ID is required',
    }),
  customerId: Joi.string()
    .trim()
    .pattern(objectIdPattern)
    .required()
    .messages({
      'string.pattern.base': 'Invalid ID format',
      'string.empty': 'Customer ID is required',
      'any.required': 'Customer ID is required',
    }),
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

const listClaimsQuerySchema = Joi.object({
  status: Joi.string()
    .valid('NEW', 'ASSIGNED', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED')
    .optional()
    .messages({
      'any.only': 'status must be one of: NEW, ASSIGNED, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, CLOSED',
    }),
});

/**
 * Validation schema for POST /claims/:claimId/decision
 * Transitions: UNDER_REVIEW → APPROVED | REJECTED
 */
const decisionSchema = Joi.object({
  decision: Joi.string()
    .valid('APPROVED', 'REJECTED')
    .required()
    .messages({
      'any.only': 'decision must be one of: APPROVED, REJECTED',
      'string.empty': 'Decision is required',
      'any.required': 'Decision is required',
    }),
  notes: Joi.string().trim().optional().allow('', null),
});

/**
 * Validation schema for POST /claims/:claimId/close
 * Transitions: APPROVED → CLOSED
 */
const closeClaimSchema = Joi.object({
  closingNotes: Joi.string().trim().optional().allow('', null),
});

module.exports = {
  createClaimSchema,
  assignClaimSchema,
  updateVehicleSchema,
  updateAccidentSchema,
  updateLocationSchema,
  listClaimsQuerySchema,
  decisionSchema,
  closeClaimSchema,
};


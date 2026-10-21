const Joi = require('joi');
const { objectIdPattern } = require('../../middlewares/validate.middleware');

const createIncidentSchema = Joi.object({
  incidentType: Joi.string()
    .valid(
      'COLLISION',
      'REAR_END_COLLISION',
      'SIDE_IMPACT',
      'PARKING_DAMAGE',
      'OTHER',
      'THEFT',
      'FIRE',
      'NATURAL_DISASTER'
    )
    .required()
    .messages({
      'any.only':
        'incidentType must be one of: COLLISION, REAR_END_COLLISION, SIDE_IMPACT, PARKING_DAMAGE, OTHER, THEFT, FIRE, NATURAL_DISASTER',
      'any.required': 'Incident type is required',
    }),
  incidentLocation: Joi.string().trim().required().messages({
    'string.empty': 'Incident location is required',
    'any.required': 'Incident location is required',
  }),
  incidentDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required()
    .messages({
      'string.pattern.base': 'incidentDate must be in YYYY-MM-DD format',
      'string.empty': 'incidentDate is required',
      'any.required': 'incidentDate is required',
    }),
  description: Joi.string()
    .trim()
    .max(1000)
    .allow('', null)
    .optional()
    .messages({
      'string.max': 'description cannot exceed 1000 characters',
    }),
  latitude: Joi.number().min(-90).max(90).optional().messages({
    'number.base': 'Latitude must be a valid number between -90 and 90',
    'number.min': 'Latitude must be at least -90',
    'number.max': 'Latitude cannot exceed 90',
  }),
  longitude: Joi.number().min(-180).max(180).optional().messages({
    'number.base': 'Longitude must be a valid number between -180 and 180',
    'number.min': 'Longitude must be at least -180',
    'number.max': 'Longitude cannot exceed 180',
  }),
});

const listIncidentsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  incidentNumber: Joi.string().trim().optional(),
  from: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const createSubClaimSchema = Joi.object({
  claimType: Joi.string()
    .valid('OWN_DAMAGE', 'THIRD_PARTY_PD')
    .required()
    .messages({
      'any.only': 'claimType must be one of: OWN_DAMAGE, THIRD_PARTY_PD',
      'any.required': 'claimType is required',
    }),
  policyId: Joi.string()
    .trim()
    .pattern(objectIdPattern)
    .required()
    .messages({
      'string.pattern.base': 'policyId must be a valid MongoDB ObjectId',
      'string.empty': 'policyId is required',
      'any.required': 'policyId is required',
    }),
  plateNumber: Joi.string().trim().optional().messages({
    'string.base': 'Plate number must be a string',
  }),
});

module.exports = {
  createIncidentSchema,
  listIncidentsQuerySchema,
  createSubClaimSchema,
};

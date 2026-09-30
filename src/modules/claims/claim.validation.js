const Joi = require('joi');
const config = require('../../config/env');
const { objectIdPattern } = require('../../middlewares/validate.middleware');

/**
 * Validation schema for POST /claims
 * Only the fields the CLIENT is allowed to send.
 * organizationId, createdBy, status are set by the Backend — never from the client.
 */
const createClaimSchema = Joi.object({
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
  overrideCapacity: Joi.boolean().optional().default(false),
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
    .valid('NEW', 'PENDING_ACCEPTANCE', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'APPROVED', 'REJECTED', 'CLOSED')
    .optional()
    .messages({
      'any.only': 'status must be one of: NEW, PENDING_ACCEPTANCE, ASSIGNED, IN_PROGRESS, SUBMITTED, UNDER_REVIEW, CORRECTION_REQUIRED, APPROVED, REJECTED, CLOSED',
    }),
  adjusterId: Joi.string()
    .trim()
    .pattern(objectIdPattern)
    .optional()
    .messages({
      'string.pattern.base': 'Invalid ID format',
    }),
  assignedTo: Joi.string()
    .trim()
    .pattern(objectIdPattern)
    .optional()
    .messages({
      'string.pattern.base': 'Invalid ID format',
    }),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
});

/**
 * Validation schema for POST /claims/:claimId/review/request-correction
 * Transitions: UNDER_REVIEW → CORRECTION_REQUIRED
 */
const requestCorrectionSchema = Joi.object({
  notes: Joi.string().trim().required().messages({
    'string.empty': 'Notes are required',
    'any.required': 'Notes are required',
  }),
});

const twoDecimalValidator = (value, helpers) => {
  if (typeof value !== 'number') return value;
  if (Math.round(value * 100) / 100 !== value) {
    return helpers.message('"{#label}" must have at most 2 decimal places');
  }
  return value;
};

const lossAssessmentInputSchema = Joi.object({
  estimatedPartsCost: Joi.number()
    .strict()
    .min(0)
    .max(config.maxFinancialAmount)
    .custom(twoDecimalValidator)
    .required()
    .messages({
      'number.base': 'estimatedPartsCost must be a valid number',
      'number.min': 'estimatedPartsCost cannot be negative',
      'number.max': `estimatedPartsCost cannot exceed ${config.maxFinancialAmount}`,
      'any.required': 'estimatedPartsCost is required',
    }),
  laborCost: Joi.number()
    .strict()
    .min(0)
    .max(config.maxFinancialAmount)
    .custom(twoDecimalValidator)
    .required()
    .messages({
      'number.base': 'laborCost must be a valid number',
      'number.min': 'laborCost cannot be negative',
      'number.max': `laborCost cannot exceed ${config.maxFinancialAmount}`,
      'any.required': 'laborCost is required',
    }),
  deductibleApplied: Joi.number()
    .strict()
    .min(0)
    .max(config.maxFinancialAmount)
    .custom(twoDecimalValidator)
    .optional()
    .messages({
      'number.base': 'deductibleApplied must be a valid number',
      'number.min': 'deductibleApplied cannot be negative',
      'number.max': `deductibleApplied cannot exceed ${config.maxFinancialAmount}`,
    }),
  deductibleOverrideReason: Joi.string()
    .trim()
    .max(1000)
    .allow('', null)
    .optional()
    .messages({
      'string.max': 'deductibleOverrideReason cannot exceed 1000 characters',
    }),
}).unknown(false);

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
  lossAssessment: Joi.when('decision', {
    is: 'REJECTED',
    then: Joi.forbidden().messages({
      'any.unknown': 'lossAssessment is not allowed when decision is REJECTED',
    }),
    otherwise: lossAssessmentInputSchema.required().messages({
      'any.required': 'lossAssessment is required when decision is APPROVED',
    }),
  }),
});

/**
 * Validation schema for POST /claims/:claimId/close
 * Transitions: APPROVED → CLOSED
 */
const closeClaimSchema = Joi.object({
  closingNotes: Joi.string().trim().optional().allow('', null),
});

const uploadEvidenceSchema = Joi.object({
  imageType: Joi.string()
    .valid('VEHICLE_FRONT', 'VEHICLE_REAR', 'VEHICLE_SIDE', 'DAMAGE_CLOSEUP', 'DRIVER_LICENSE', 'OTHER')
    .required(),
});

const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validation schema for GET /claims/stats query parameters.
 * Optional query params: from, to
 * Format: Joi.date().iso(), accepting either YYYY-MM-DD or a full ISO 8601 timestamp.
 */
const getClaimStatsQuerySchema = Joi.object({
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional(),
}).custom((value, helpers) => {
  const original = helpers.original || {};
  const now = new Date();

  // 1. Expand date-only 'from' (Joi date().iso() already converted it to 00:00:00.000Z)
  // 2. Expand date-only 'to' to 23:59:59.999Z of that day
  if (original.to && typeof original.to === 'string' && dateOnlyRegex.test(original.to.trim())) {
    const d = new Date(value.to);
    d.setUTCHours(23, 59, 59, 999);
    value.to = d;
  }

  // If from is in the future
  if (value.from && value.from > now) {
    return helpers.message('from date cannot be in the future');
  }

  // If from > to when to was explicitly supplied
  if (value.from && value.to && value.from > value.to) {
    return helpers.message('from date must be before or equal to to date');
  }

  // If to is in the future, silently cap to to current server timestamp
  if (value.to && value.to > now) {
    value.to = now;
  }

  // If the resolved range exceeds 5 years
  if (value.from) {
    const effectiveTo = value.to || now;
    const maxTo = new Date(value.from);
    maxTo.setUTCFullYear(maxTo.getUTCFullYear() + 5);
    const isToDateOnly = original.to && typeof original.to === 'string' && dateOnlyRegex.test(original.to.trim());
    const isFromDateOnly = original.from && typeof original.from === 'string' && dateOnlyRegex.test(original.from.trim());
    if (isToDateOnly || (!original.to && isFromDateOnly)) {
      maxTo.setUTCHours(23, 59, 59, 999);
    }
    if (effectiveTo > maxTo) {
      return helpers.message('date range cannot exceed 5 years');
    }
  }

  return value;
});

/**
 * Validation schema for POST /claims/:claimId/accept-assignment
 * Transitions: PENDING_ACCEPTANCE → ASSIGNED
 */
const acceptAssignmentSchema = Joi.object({});

/**
 * Validation schema for POST /claims/:claimId/decline-assignment
 * Transitions: PENDING_ACCEPTANCE → NEW
 */
const declineAssignmentSchema = Joi.object({
  reason: Joi.string()
    .trim()
    .max(300)
    .required()
    .messages({
      'string.empty': 'Reason is required',
      'any.required': 'Reason is required',
      'string.max': 'Reason cannot exceed 300 characters',
    }),
});

module.exports = {
  createClaimSchema,
  assignClaimSchema,
  acceptAssignmentSchema,
  declineAssignmentSchema,
  updateVehicleSchema,
  updateAccidentSchema,
  updateLocationSchema,
  listClaimsQuerySchema,
  requestCorrectionSchema,
  decisionSchema,
  closeClaimSchema,
  uploadEvidenceSchema,
  getClaimStatsQuerySchema,
};



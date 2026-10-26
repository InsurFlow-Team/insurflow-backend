const Joi = require('joi');

const issueLetterSchema = Joi.object({
  type: Joi.string().valid('APPROVAL', 'REJECTION', 'REPAIR_AUTHORIZATION').required().messages({
    'any.required': 'Letter type is required',
    'any.only': 'Letter type must be APPROVAL, REJECTION, or REPAIR_AUTHORIZATION',
  }),
  reason: Joi.when('type', {
    is: 'REJECTION',
    then: Joi.string().trim().min(10).max(500).required().messages({
      'any.required': 'reason is required for REJECTION letters',
      'string.empty': 'reason cannot be empty',
      'string.min': 'reason must be at least 10 characters long',
      'string.max': 'reason cannot exceed 500 characters',
    }),
    otherwise: Joi.forbidden().messages({
      'any.unknown': 'reason is not allowed for this letter type',
    }),
  }),
  supersedesLetterNumber: Joi.string().trim().optional(),
});

const letterNumberParamSchema = Joi.object({
  claimId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required().messages({
    'string.pattern.base': 'Invalid ID format',
  }),
  letterNumber: Joi.string().trim().required().messages({
    'any.required': 'letterNumber is required',
    'string.empty': 'letterNumber cannot be empty',
  }),
});

module.exports = {
  issueLetterSchema,
  letterNumberParamSchema,
};

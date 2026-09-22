const Joi = require('joi');

/**
 * Validation schema for POST /api/v1/policies/verify
 * Used by Claims Officers and Admins to verify policy eligibility
 * before creating a new claim.
 */
const verifyPolicySchema = Joi.object({
  policyNumber: Joi.string().trim().optional().messages({
    'string.base': 'Policy number must be a string',
    'string.empty': 'Policy number cannot be empty',
  }),
  plateNumber: Joi.string().trim().optional().messages({
    'string.base': 'Plate number must be a string',
    'string.empty': 'Plate number cannot be empty',
  }),
  incidentDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .messages({
      'string.pattern.base': 'incidentDate must be in YYYY-MM-DD format',
    }),
})
  .or('policyNumber', 'plateNumber')
  .messages({
    'object.missing': 'Either policyNumber or plateNumber must be provided',
  });

module.exports = {
  verifyPolicySchema,
};

const Joi = require('joi');
const Policy = require('./policy.model');

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
  policyKind: Joi.string()
    .valid(...Policy.POLICY_KINDS)
    .optional()
    .messages({
      'any.only': `policyKind must be one of: ${Policy.POLICY_KINDS.join(', ')}`,
      'string.base': 'policyKind must be a string',
    }),
  incidentDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .messages({
      'string.pattern.base': 'incidentDate must be in YYYY-MM-DD format',
    }),
  incidentType: Joi.string()
    .valid(...Policy.COVERED_PERILS)
    .optional()
    .messages({
      'any.only': `incidentType must be one of: ${Policy.COVERED_PERILS.join(', ')}`,
      'string.base': 'incidentType must be a string',
    }),
})
  .or('policyNumber', 'plateNumber')
  .without('policyNumber', ['policyKind'])
  .messages({
    'object.without': 'policyKind is not allowed with policyNumber',
    'object.missing': 'Either policyNumber or plateNumber must be provided',
  });

module.exports = {
  verifyPolicySchema,
};

const Joi = require('joi');
const { errorResponse } = require('../utils/apiResponse');

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

/**
 * Creates a Joi schema for validating a 24-character hexadecimal MongoDB ObjectId in params.
 * @param {string} paramName - Name of the route param (e.g. 'claimId', 'userId')
 */
const objectIdSchema = (paramName) =>
  Joi.object({
    [paramName]: Joi.string()
      .pattern(objectIdPattern)
      .required()
      .messages({
        'string.pattern.base': 'Invalid ID format',
        'string.empty': `${paramName} is required`,
        'any.required': `${paramName} is required`,
      }),
  });

/**
 * Middleware to validate request properties against a Joi schema.
 * @param {Object} schema - The Joi schema to validate against.
 * @param {String} property - The request property to validate ('body', 'query', 'params'). Defaults to 'body'.
 */
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], { abortEarly: false });
    
    if (error) {
      const validationErrors = error.details.map(err => ({
        code: 'VALIDATION_ERROR',
        details: err.message
      }));
      return res.status(400).json(errorResponse('Validation Error', validationErrors));
    }
    
    // Replace the request property with the validated and transformed value
    if (property === 'query') {
      Object.defineProperty(req, 'query', {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      req[property] = value;
    }
    next();
  };
};

/**
 * Reusable middleware to validate an ObjectId route parameter.
 * @param {string} paramName - Parameter name to validate in req.params (e.g. 'claimId', 'userId')
 */
const validateObjectId = (paramName) => validate(objectIdSchema(paramName), 'params');

// Support both direct function import: const validate = require('...')
// and destructuring: const { validate, validateObjectId } = require('...')
module.exports = validate;
module.exports.validate = validate;
module.exports.validateObjectId = validateObjectId;
module.exports.objectIdSchema = objectIdSchema;
module.exports.objectIdPattern = objectIdPattern;


const { errorResponse } = require('../utils/apiResponse');

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
    req[property] = value;
    next();
  };
};

module.exports = validate;

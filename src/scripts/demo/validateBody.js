/**
 * C1: Strict Joi validation wrapper mirroring validate.middleware.js.
 * Validates request bodies and parameters before invoking service functions directly.
 */

const validateBody = (schema, body) => {
  if (!schema || typeof schema.validate !== 'function') {
    throw new Error('validateBody: A valid Joi schema is required');
  }
  const { error, value } = schema.validate(body, { abortEarly: false });
  if (error) {
    const errorDetails = error.details.map((d) => d.message).join('; ');
    throw new Error(`Validation Error: ${errorDetails}`);
  }
  return value;
};

const validateParams = (schema, params) => {
  if (!schema || typeof schema.validate !== 'function') {
    throw new Error('validateParams: A valid Joi schema is required');
  }
  const { error, value } = schema.validate(params, { abortEarly: false });
  if (error) {
    const errorDetails = error.details.map((d) => d.message).join('; ');
    throw new Error(`Parameter Validation Error: ${errorDetails}`);
  }
  return value;
};

module.exports = {
  validateBody,
  validateParams,
};

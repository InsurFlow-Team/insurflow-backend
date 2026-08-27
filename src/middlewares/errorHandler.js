const { errorResponse } = require('../utils/apiResponse');
const config = require('../config/env');

/**
 * Global Error Handler Middleware
 */
const errorHandler = (err, req, res, next) => {
  console.error(`[Error] ${err.message}`);
  
  // Default status code
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let code = err.code || 'INTERNAL_ERROR';

  // Handle specific error types if needed (e.g., Mongoose Validation Error)
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation Error';
    code = 'VALIDATION_ERROR';
  } else if (err.name === 'CastError' && err.kind === 'ObjectId') {
    statusCode = 404;
    message = 'Resource not found';
    code = 'RESOURCE_NOT_FOUND';
  }

  // Include stack trace only in development
  if (config.nodeEnv === 'development' && statusCode === 500) {
    console.error(err.stack);
  }

  const errors = [{ code, details: message }];

  res.status(statusCode).json(errorResponse(message, errors));
};

module.exports = errorHandler;

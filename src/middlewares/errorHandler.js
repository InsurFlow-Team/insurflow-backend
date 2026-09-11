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
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    message = 'File size exceeds limit of 10MB';
    code = 'VALIDATION_ERROR';
  }

  // Environment check: identify production mode
  const isProduction = config.nodeEnv === 'production' || process.env.NODE_ENV === 'production';

  // In production, mask unexpected 500 internal errors to prevent leaking system details
  if (isProduction && statusCode >= 500) {
    message = 'Internal Server Error';
    code = 'INTERNAL_ERROR';
  }

  // Server-side diagnostic logging: log stack trace for 500 errors
  if (statusCode >= 500 && err.stack) {
    console.error(err.stack);
  }

  const errors = [{ code, details: message }];

  res.status(statusCode).json(errorResponse(message, errors));
};

module.exports = errorHandler;

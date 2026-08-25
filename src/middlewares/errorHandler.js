const { errorResponse } = require('../utils/apiResponse');
const config = require('../config/env');

/**
 * Global Error Handler Middleware
 */
const errorHandler = (err, req, res, next) => {
  console.error(`[Error] ${err.message}`);
  
  // Default status code
  let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  let message = err.message || 'Internal Server Error';

  // Handle specific error types if needed (e.g., Mongoose Validation Error)
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation Error';
  } else if (err.name === 'CastError' && err.kind === 'ObjectId') {
    statusCode = 404;
    message = 'Resource not found';
  }

  // Include stack trace only in development
  const errors = config.nodeEnv === 'development' ? err.stack : null;

  res.status(statusCode).json(errorResponse(message, errors));
};

module.exports = errorHandler;

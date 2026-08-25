/**
 * Formats a successful response
 * @param {string} message - Success message
 * @param {object} data - Payload data
 * @returns {object} Formatted response object
 */
const successResponse = (message, data = null) => {
  const response = {
    success: true,
    message,
  };
  
  if (data) {
    response.data = data;
  }
  
  return response;
};

/**
 * Formats an error response
 * @param {string} message - Error message
 * @param {Array} errors - Detailed validation or other errors
 * @returns {object} Formatted error object
 */
const errorResponse = (message, errors = null) => {
  const response = {
    success: false,
    message,
  };

  if (errors) {
    response.errors = errors;
  }

  return response;
};

module.exports = {
  successResponse,
  errorResponse
};

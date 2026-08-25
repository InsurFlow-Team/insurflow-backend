const { errorResponse } = require('../utils/apiResponse');

/**
 * Handle undefined routes (404 Not Found)
 */
const notFoundHandler = (req, res, next) => {
  res.status(404).json(errorResponse(`Endpoint Not Found - ${req.originalUrl}`));
};

module.exports = notFoundHandler;

const { errorResponse } = require('../utils/apiResponse');

/**
 * Role Authorization Middleware
 * Factory function that accepts an array of allowed roles.
 * Must be used AFTER the authenticate middleware.
 * 
 * @param {string[]} allowedRoles - Array of roles permitted to access the endpoint.
 */
const authorizeRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json(errorResponse('Forbidden: User role not identified'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json(errorResponse('Forbidden: Insufficient permissions'));
    }

    next();
  };
};

module.exports = authorizeRole;

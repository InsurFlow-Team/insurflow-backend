const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { errorResponse } = require('../utils/apiResponse');

/**
 * Authentication Middleware
 * Validates the JWT and attaches user context to the request.
 */
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json(errorResponse('Unauthorized: Missing or invalid token format'));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    
    // Attach the authenticated user context to the request object
    req.user = {
      userId: decoded.userId,
      role: decoded.role,
      organizationId: decoded.organizationId,
    };
    
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json(errorResponse('Unauthorized: Token has expired'));
    }
    return res.status(401).json(errorResponse('Unauthorized: Invalid token'));
  }
};

module.exports = authenticate;

const { rateLimit, MemoryStore } = require('express-rate-limit');
const config = require('../config/env');
const { errorResponse } = require('../utils/apiResponse');

// In-memory store for tracking request hits
const loginRateLimitStore = new MemoryStore();

/**
 * Dedicated rate limiter for the authentication login endpoint.
 * Throttles repeated failed login attempts to protect against brute-force and credential-stuffing attacks.
 */
const loginLimiter = rateLimit({
  windowMs: config.rateLimit?.windowMs || 15 * 60 * 1000, // 15 minutes default
  max: config.rateLimit?.max || 5, // 5 attempts default
  standardHeaders: true, // Draft-6/Draft-7 RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  skipSuccessfulRequests: true, // Only count failed attempts (preserves legitimate user access)
  store: loginRateLimitStore,
  handler: (req, res, next, options) => {
    const message = 'Too many login attempts. Please try again later.';
    const errors = [
      {
        code: 'TOO_MANY_REQUESTS',
        details: message,
      },
    ];
    return res.status(options.statusCode || 429).json(errorResponse(message, errors));
  },
});

// Utility method for test isolation: resets the store
loginLimiter.reset = () => loginRateLimitStore.resetAll();

module.exports = {
  loginLimiter,
  loginRateLimitStore,
};

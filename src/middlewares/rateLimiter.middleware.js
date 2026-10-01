const { rateLimit, MemoryStore } = require('express-rate-limit');
const config = require('../config/env');
const { errorResponse } = require('../utils/apiResponse');

// In-memory store for tracking request hits
const loginRateLimitStore = new MemoryStore();
const apiRateLimitStore = new MemoryStore();

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

/**
 * General API rate limiter applied to all `/api/v1` routes.
 * Defends against API abuse, volumetric DoS, and automated scraping.
 * Automatically bypassed in test mode unless specifically flagged for testing.
 */
const apiLimiter = rateLimit({
  windowMs: config.apiRateLimit?.windowMs || 15 * 60 * 1000,
  max: (req) =>
    (config.nodeEnv === 'test' && req.headers['x-test-rate-limit-max']
      ? parseInt(req.headers['x-test-rate-limit-max'], 10)
      : config.apiRateLimit?.max || 300),
  standardHeaders: true,

  legacyHeaders: false,
  skip: (req) => config.nodeEnv === 'test' && !req.headers['x-test-rate-limit'],

  store: apiRateLimitStore,
  handler: (req, res, next, options) => {
    const message = 'Too many requests. Please try again later.';
    const errors = [
      {
        code: 'TOO_MANY_REQUESTS',
        details: message,
      },
    ];
    return res.status(options.statusCode || 429).json(errorResponse(message, errors));
  },
});

apiLimiter.reset = () => apiRateLimitStore.resetAll();

// In-memory store for public tracking rate limiting hits
const publicTrackingRateLimitStore = new MemoryStore();

/**
 * Dedicated rate limiter for the public claim tracking endpoint.
 * Throttles public token lookups to prevent brute-forcing tokens and scraping claim data.
 * Keyed by client IP address.
 */
const publicTrackingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) =>
    (config.nodeEnv === 'test' && req.headers['x-test-rate-limit-max']
      ? parseInt(req.headers['x-test-rate-limit-max'], 10)
      : config.publicTrackingRateLimitMax || 60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  skip: (req) => config.nodeEnv === 'test' && !req.headers['x-test-rate-limit'],
  store: publicTrackingRateLimitStore,
  handler: (req, res, next, options) => {
    const message = 'Too many requests. Please try again later.';
    const errors = [
      {
        code: 'TOO_MANY_REQUESTS',
        details: message,
      },
    ];
    return res.status(options.statusCode || 429).json(errorResponse(message, errors));
  },
});

publicTrackingLimiter.reset = () => publicTrackingRateLimitStore.resetAll();

module.exports = {
  loginLimiter,
  loginRateLimitStore,
  apiLimiter,
  apiRateLimitStore,
  publicTrackingLimiter,
  publicTrackingRateLimitStore,
};


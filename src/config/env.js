const dotenv = require('dotenv');

// Load environment variables from .env file if it exists
dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET', 'DATABASE_URL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const missing = requiredEnvVars.filter((key) => !process.env[key]);
if (missing.length > 0 && process.env.NODE_ENV !== 'test') {
  console.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const config = {
  port: process.env.PORT || 3000,
  databaseUrl: process.env.DATABASE_URL || 'mongodb://localhost:27017/insurflow',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  jwtSecret: process.env.JWT_SECRET || 'test-secret-do-not-use-in-prod',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  nodeEnv: process.env.NODE_ENV || 'development',
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,
  rateLimit: {
    windowMs: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutes default
    max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) || 5, // 5 attempts default
  },
  apiRateLimit: {
    windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutes default
    max: parseInt(process.env.API_RATE_LIMIT_MAX, 10) || 300, // 300 requests default
  },
  get requireLossAssessment() {
    return process.env.REQUIRE_LOSS_ASSESSMENT === 'true';
  },
  currency: process.env.APP_CURRENCY || 'ILS',
  maxFinancialAmount: parseInt(process.env.MAX_FINANCIAL_AMOUNT, 10) || 1000000,
  publicFrontendUrl: process.env.PUBLIC_FRONTEND_URL ? process.env.PUBLIC_FRONTEND_URL.trim().replace(/\/+$/, '') || null : null,
};


module.exports = config;

const dotenv = require('dotenv');

// Load environment variables from .env file if it exists
dotenv.config();

const config = {
  port: process.env.PORT || 3000,
  databaseUrl: process.env.DATABASE_URL || 'mongodb://localhost:27017/insurflow',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  jwtSecret: process.env.JWT_SECRET || 'fallback_secret_do_not_use_in_prod',
  nodeEnv: process.env.NODE_ENV || 'development'
};

module.exports = config;

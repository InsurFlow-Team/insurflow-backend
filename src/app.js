const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config/env');
const errorHandler = require('./middlewares/errorHandler');
const notFoundHandler = require('./middlewares/notFound');
const { successResponse } = require('./utils/apiResponse');

// Initialize express app
const app = express();

// Global Middlewares
app.use(helmet()); // Security headers
app.use(express.json()); // Parse JSON payloads
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded payloads

// CORS Configuration
app.use(cors({
  origin: config.corsOrigin,
  optionsSuccessStatus: 200
}));

// Request Logging
if (config.nodeEnv === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json(successResponse('Backend service is running properly'));
});

// Module Routes
// TODO: Mount routes here as they are implemented, e.g.:
// const authRoutes = require('./modules/auth/routes');
// app.use('/api/v1/auth', authRoutes);

// 404 Handler for undefined routes
app.use(notFoundHandler);

// Global Error Handler
app.use(errorHandler);

module.exports = app;

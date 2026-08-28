const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config/env');
const errorHandler = require('./middlewares/errorHandler');
const notFoundHandler = require('./middlewares/notFound');
const { successResponse } = require('./utils/apiResponse');

const app = express();
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));//! this is for sending requests with files and images
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
const authRoutes = require('./modules/auth/auth.routes');
const claimRoutes = require('./modules/claims/claim.routes');
const userRoutes = require('./modules/users/user.routes');
const vehicleRoutes = require('./modules/vehicles/vehicle.routes');

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/claims', claimRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/vehicles', vehicleRoutes);

// 404 Handler for undefined routes
app.use(notFoundHandler);

// Global Error Handler
app.use(errorHandler);

module.exports = app;

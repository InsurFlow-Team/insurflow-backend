const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const config = require('./config/env');
const errorHandler = require('./middlewares/errorHandler');
const notFoundHandler = require('./middlewares/notFound');
const { apiLimiter } = require('./middlewares/rateLimiter.middleware');
const { successResponse } = require('./utils/apiResponse');
const redactTrackingToken = require('./utils/redactTrackingToken');


const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));//! this is for sending requests with files and images
app.use(cookieParser());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = config.corsOrigin;
    if (!allowed || allowed === '*' || (Array.isArray(allowed) && allowed.includes('*'))) {
      return callback(null, true);
    }
    if (Array.isArray(allowed)) {
      return callback(null, allowed.includes(origin));
    }
    return callback(null, allowed === origin);
  },
  optionsSuccessStatus: 200,
  credentials: true,
  exposedHeaders: [
    'X-Total-Count',
    'X-Page',
    'X-Limit',
    'X-Total-Pages',
    'RateLimit-Limit',
    'RateLimit-Remaining',
    'RateLimit-Reset',
  ],
}));


// Request Logging: sanitize URLs to prevent tracking tokens from leaking into logs
morgan.token('url', (req) => redactTrackingToken(req.originalUrl || req.url));

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
const publicClaimRoutes = require('./modules/claims/claim.public.routes');
const userRoutes = require('./modules/users/user.routes');
const vehicleRoutes = require('./modules/vehicles/vehicle.routes');
const policyRoutes = require('./modules/policies/policy.routes');
const notificationRoutes = require('./modules/notifications/notification.routes');
const incidentRoutes = require('./modules/incidents/incident.routes');

// API Rate Limiter & Module Routes
app.use('/api/v1', apiLimiter);
app.use('/api/v1/public', publicClaimRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/claims', claimRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/vehicles', vehicleRoutes);
app.use('/api/v1/policies', policyRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/incidents', incidentRoutes);

// 404 Handler for undefined routes
app.use(notFoundHandler);

// Global Error Handler
app.use(errorHandler);

module.exports = app;

const express = require('express');
const vehicleController = require('./vehicle.controller');
const authenticate = require('../../middlewares/auth.middleware');

const router = express.Router();

// Require authentication for vehicle lookup
router.use(authenticate);

// GET /api/v1/vehicles/lookup
router.get('/lookup', vehicleController.lookupVehicle);

module.exports = router;

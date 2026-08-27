const express = require('express');
const vehicleController = require('./vehicle.controller');
const authenticate = require('../../middlewares/auth.middleware');
const authorizeRole = require('../../middlewares/role.middleware');

const router = express.Router();

// GET /api/v1/vehicles/lookup
router.get('/lookup', authenticate, authorizeRole(['FIELD_ADJUSTER']), vehicleController.lookupVehicle);

module.exports = router;

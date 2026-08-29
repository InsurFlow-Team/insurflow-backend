const express = require('express');
const vehicleController = require('./vehicle.controller');
const authenticate = require('../../middlewares/auth.middleware');
const authorizeRole = require('../../middlewares/role.middleware');
const validate = require('../../middlewares/validate.middleware');
const { lookupVehicleSchema } = require('./vehicle.validation');

const router = express.Router();

// GET /api/v1/vehicles/lookup
router.get('/lookup', authenticate, authorizeRole(['FIELD_ADJUSTER']), validate(lookupVehicleSchema, 'query'), vehicleController.lookupVehicle);

module.exports = router;

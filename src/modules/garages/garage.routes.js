const express = require('express');
const garageController = require('./garage.controller');
const authenticate = require('../../middlewares/auth.middleware');
const adjusterLocationMiddleware = require('../../middlewares/adjusterLocation.middleware');
const authorizeRole = require('../../middlewares/role.middleware');
const { validate, validateObjectId } = require('../../middlewares/validate.middleware');
const {
  createGarageSchema,
  listGaragesQuerySchema,
  updateGarageSchema,
} = require('./garage.validation');

const router = express.Router();

router.use(authenticate);
router.use(adjusterLocationMiddleware);

// POST /api/v1/garages - ADMIN only
router.post(
  '/',
  authorizeRole(['ADMIN']),
  validate(createGarageSchema),
  garageController.createGarage
);

// GET /api/v1/garages - ADMIN, CLAIMS_OFFICER, FIELD_ADJUSTER
router.get(
  '/',
  authorizeRole(['ADMIN', 'CLAIMS_OFFICER', 'FIELD_ADJUSTER']),
  validate(listGaragesQuerySchema, 'query'),
  garageController.listGarages
);

// GET /api/v1/garages/:garageId - ADMIN, CLAIMS_OFFICER, FIELD_ADJUSTER
router.get(
  '/:garageId',
  authorizeRole(['ADMIN', 'CLAIMS_OFFICER', 'FIELD_ADJUSTER']),
  validateObjectId('garageId'),
  garageController.getGarageById
);

// PATCH /api/v1/garages/:garageId - ADMIN only
router.patch(
  '/:garageId',
  authorizeRole(['ADMIN']),
  validateObjectId('garageId'),
  validate(updateGarageSchema),
  garageController.updateGarage
);

module.exports = router;

const express = require('express');
const incidentController = require('./incident.controller');
const authenticate = require('../../middlewares/auth.middleware');
const authorizeRole = require('../../middlewares/role.middleware');
const { validate, validateObjectId } = require('../../middlewares/validate.middleware');
const {
  createIncidentSchema,
  listIncidentsQuerySchema,
  createSubClaimSchema,
  vehicleItemSchema,
  appendPartyItemSchema,
  damagedItemItemSchema,
  patchIncidentReportSchema,
} = require('./incident.validation');

const router = express.Router();

router.use(authenticate);
router.use(authorizeRole(['CLAIMS_OFFICER', 'ADMIN']));

router.post('/', validate(createIncidentSchema), incidentController.createIncident);
router.get('/', validate(listIncidentsQuerySchema, 'query'), incidentController.getIncidents);
router.get('/:incidentId', validateObjectId('incidentId'), incidentController.getIncidentById);
router.post(
  '/:incidentId/claims',
  validateObjectId('incidentId'),
  validate(createSubClaimSchema),
  incidentController.createSubClaim
);
router.post(
  '/:incidentId/vehicles',
  validateObjectId('incidentId'),
  validate(vehicleItemSchema),
  incidentController.addVehicle
);
router.post(
  '/:incidentId/parties',
  validateObjectId('incidentId'),
  validate(appendPartyItemSchema),
  incidentController.addParty
);
router.post(
  '/:incidentId/damaged-items',
  validateObjectId('incidentId'),
  validate(damagedItemItemSchema),
  incidentController.addDamagedItem
);
router.patch(
  '/:incidentId/report',
  validateObjectId('incidentId'),
  validate(patchIncidentReportSchema),
  incidentController.patchReport
);

module.exports = router;

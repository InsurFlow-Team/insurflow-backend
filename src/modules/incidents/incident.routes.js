const express = require('express');
const incidentController = require('./incident.controller');
const authenticate = require('../../middlewares/auth.middleware');
const authorizeRole = require('../../middlewares/role.middleware');
const { validate, validateObjectId } = require('../../middlewares/validate.middleware');
const {
  createIncidentSchema,
  listIncidentsQuerySchema,
  createSubClaimSchema,
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

module.exports = router;

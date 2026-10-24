const incidentService = require('./incident.service');
const claimService = require('../claims/claim.service');
const { successResponse } = require('../../utils/apiResponse');

const createIncident = async (req, res) => {
  const result = await incidentService.createIncident(req.body, req.user);
  return res.status(201).json(successResponse('Incident created successfully', result));
};

const getIncidents = async (req, res) => {
  const { page, limit, incidentNumber, from, to } = req.query;
  const { incidents, pagination } = await incidentService.getIncidents(
    req.user,
    { incidentNumber, from, to },
    { page, limit }
  );

  res.set('X-Total-Count', String(pagination.totalCount));
  res.set('X-Page', String(pagination.page));
  res.set('X-Limit', String(pagination.limit));
  res.set('X-Total-Pages', String(pagination.totalPages));

  return res.status(200).json(successResponse('Incidents retrieved successfully', incidents));
};

const getIncidentById = async (req, res) => {
  const { incidentId } = req.params;
  const result = await incidentService.getIncidentById(incidentId, req.user);
  return res.status(200).json(successResponse('Incident retrieved successfully', result));
};

const createSubClaim = async (req, res) => {
  const { incidentId } = req.params;
  const result = await claimService.createSubClaim(incidentId, req.body, req.user);
  return res.status(201).json(successResponse('Claim created successfully', result));
};

const addVehicle = async (req, res) => {
  const { incidentId } = req.params;
  const result = await incidentService.addVehicle(incidentId, req.body, req.user);
  return res.status(201).json(successResponse('Vehicle added successfully', result));
};

const addParty = async (req, res) => {
  const { incidentId } = req.params;
  const result = await incidentService.addParty(incidentId, req.body, req.user);
  return res.status(201).json(successResponse('Party added successfully', result));
};

const addDamagedItem = async (req, res) => {
  const { incidentId } = req.params;
  const result = await incidentService.addDamagedItem(incidentId, req.body, req.user);
  return res.status(201).json(successResponse('Damaged item added successfully', result));
};

const patchReport = async (req, res) => {
  const { incidentId } = req.params;
  const result = await incidentService.patchReport(incidentId, req.body, req.user);
  return res.status(200).json(successResponse('Report updated successfully', result));
};

const getCoverageSuggestions = async (req, res) => {
  const { incidentId } = req.params;
  const result = await incidentService.getCoverageSuggestions(incidentId, req.user);
  return res.status(200).json(successResponse('Coverage suggestions retrieved successfully', result));
};

module.exports = {
  createIncident,
  getIncidents,
  getIncidentById,
  createSubClaim,
  addVehicle,
  addParty,
  addDamagedItem,
  patchReport,
  getCoverageSuggestions,
};

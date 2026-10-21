const incidentRepository = require('./incident.repository');
const claimRepository = require('../claims/claim.repository');
const AppError = require('../../utils/appError');

const createIncident = async (body, authUser) => {
  const {
    incidentType,
    incidentLocation,
    incidentDate,
    description,
    latitude,
    longitude,
  } = body;

  const now = new Date();
  if (incidentDate) {
    const incident = new Date(incidentDate + 'T00:00:00.000Z');
    if (incident > now) {
      throw new AppError('Incident date cannot be in the future', 400, 'INVALID_INCIDENT_DATE');
    }
  }

  let incidentCoordinates = null;
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    incidentCoordinates = {
      latitude,
      longitude,
      capturedAt: new Date(),
    };
  }

  const incident = await incidentRepository.create({
    organizationId: authUser.organizationId,
    incidentDate,
    incidentType,
    incidentLocation,
    incidentDescription: description || null,
    incidentCoordinates,
    createdBy: authUser.userId,
  });

  return {
    id: incident._id,
    incidentNumber: incident.incidentNumber,
    incidentDate: incident.incidentDate,
    incidentType: incident.incidentType,
    incidentLocation: incident.incidentLocation,
    incidentDescription: incident.incidentDescription ?? null,
    incidentCoordinates: incident.incidentCoordinates ?? null,
    createdAt: incident.createdAt,
  };
};

const getIncidents = async (authUser, filter = {}, pagination = {}) => {
  const { page = 1, limit = 50 } = pagination;
  const { totalCount, incidents } = await incidentRepository.findByOrganization(
    authUser.organizationId,
    filter,
    { page, limit }
  );

  const totalPages = Math.ceil(totalCount / limit);

  const formattedIncidents = incidents.map((inc) => ({
    id: inc._id,
    incidentNumber: inc.incidentNumber,
    incidentDate: inc.incidentDate,
    incidentType: inc.incidentType,
    incidentLocation: inc.incidentLocation,
    createdAt: inc.createdAt,
  }));

  return {
    incidents: formattedIncidents,
    pagination: {
      totalCount,
      page,
      limit,
      totalPages,
    },
  };
};

const getIncidentById = async (incidentId, authUser) => {
  const incident = await incidentRepository.findByIdAndOrganization(incidentId, authUser.organizationId);
  if (!incident) {
    throw new AppError('Incident not found', 404, 'INCIDENT_NOT_FOUND');
  }

  const claims = await claimRepository.findByIncidentId(authUser.organizationId, incidentId);

  const formattedClaims = claims.map((c) => ({
    id: c._id,
    claimNumber: c.claimNumber,
    claimType: c.claimType,
    status: c.status,
    plateNumber: c.vehicle?.plateNumber ?? null,
  }));

  return {
    id: incident._id,
    incidentNumber: incident.incidentNumber,
    incidentDate: incident.incidentDate,
    incidentType: incident.incidentType,
    incidentLocation: incident.incidentLocation,
    incidentDescription: incident.incidentDescription ?? null,
    incidentCoordinates: incident.incidentCoordinates ?? null,
    createdAt: incident.createdAt,
    claims: formattedClaims,
  };
};

module.exports = {
  createIncident,
  getIncidents,
  getIncidentById,
};

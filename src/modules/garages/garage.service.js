const garageRepository = require('./garage.repository');
const config = require('../../config/env');
const { toMinor, fromMinor } = require('../../utils/money');
const AppError = require('../../utils/appError');

/**
 * Normalizes a garage name by trimming outer whitespace, collapsing internal
 * whitespace to a single space, and converting to lowercase.
 *
 * @param {string} name
 * @returns {string}
 */
const normalizeGarageName = (name) => {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
};

/**
 * Escapes regex special characters to prevent regex injection.
 *
 * @param {string} str
 * @returns {string}
 */
const escapeRegex = (str) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Formats a garage document for API responses.
 *
 * @param {object} garage
 * @returns {object}
 */
const formatGarageResponse = (garage) => ({
  id: garage._id,
  name: garage.name,
  governorate: garage.governorate,
  city: garage.city,
  phone: garage.phone,
  laborRate: fromMinor(garage.laborRate, config.currency),
  approved: garage.approved,
  createdAt: garage.createdAt,
  updatedAt: garage.updatedAt,
});

/**
 * Creates a new garage.
 *
 * @param {object} body
 * @param {object} authUser
 * @returns {Promise<object>}
 */
const createGarage = async (body, authUser) => {
  try {
    const garageData = {
      name: body.name.trim(),
      normalizedName: normalizeGarageName(body.name),
      governorate: body.governorate,
      city: body.city.trim(),
      phone: body.phone.trim(),
      laborRate: toMinor(body.laborRate, config.currency),
      approved: body.approved !== undefined ? body.approved : true,
      organizationId: authUser.organizationId,
    };

    const newGarage = await garageRepository.create(garageData);
    return formatGarageResponse(newGarage);
  } catch (err) {
    if (
      err.code === 11000 &&
      ((err.keyPattern && err.keyPattern.normalizedName) ||
        (err.keyValue && err.keyValue.normalizedName !== undefined))
    ) {
      throw new AppError(
        'A garage with this name already exists in your organization',
        409,
        'GARAGE_ALREADY_EXISTS'
      );
    }
    throw err;
  }
};

/**
 * Retrieves a single garage by ID within the authenticated organization.
 * Non-ADMIN callers can only retrieve approved garages.
 *
 * @param {string} garageId
 * @param {object} authUser
 * @returns {Promise<object>}
 */
const getGarageById = async (garageId, authUser) => {
  const filter = {};
  if (authUser.role !== 'ADMIN') {
    filter.approved = true;
  }

  const garage = await garageRepository.findByIdAndOrganization(
    garageId,
    authUser.organizationId,
    filter
  );

  if (!garage) {
    throw new AppError('Garage not found', 404, 'GARAGE_NOT_FOUND');
  }

  return formatGarageResponse(garage);
};

/**
 * Lists garages within the authenticated organization with pagination and filters.
 * Non-ADMIN callers only see approved garages and cannot use the `approved` filter.
 *
 * @param {object} authUser
 * @param {object} query
 * @returns {Promise<object>}
 */
const listGarages = async (authUser, query) => {
  const { page = 1, limit = 50, governorate, approved, q } = query;

  if (authUser.role !== 'ADMIN' && approved !== undefined) {
    throw new AppError('Only ADMIN can filter by approved status', 400, 'VALIDATION_ERROR');
  }

  const filter = {};
  if (authUser.role !== 'ADMIN') {
    filter.approved = true;
  } else if (approved !== undefined) {
    filter.approved = approved;
  }

  if (governorate) {
    filter.governorate = governorate;
  }

  if (q) {
    filter.name = { $regex: escapeRegex(q.trim()), $options: 'i' };
  }

  const { totalCount, garages } = await garageRepository.findAllByOrganization(
    authUser.organizationId,
    filter,
    { page, limit },
    { name: 1, _id: 1 }
  );

  const totalPages = Math.ceil(totalCount / limit);

  return {
    garages: garages.map(formatGarageResponse),
    pagination: {
      totalCount,
      page,
      limit,
      totalPages,
    },
  };
};

/**
 * Updates a garage by ID.
 *
 * @param {string} garageId
 * @param {object} body
 * @param {object} authUser
 * @returns {Promise<object>}
 */
const updateGarage = async (garageId, body, authUser) => {
  try {
    const updateData = {};

    if (body.name !== undefined) {
      updateData.name = body.name.trim();
      updateData.normalizedName = normalizeGarageName(body.name);
    }
    if (body.governorate !== undefined) {
      updateData.governorate = body.governorate;
    }
    if (body.city !== undefined) {
      updateData.city = body.city.trim();
    }
    if (body.phone !== undefined) {
      updateData.phone = body.phone.trim();
    }
    if (body.laborRate !== undefined) {
      updateData.laborRate = toMinor(body.laborRate, config.currency);
    }
    if (body.approved !== undefined) {
      updateData.approved = body.approved;
    }

    const updated = await garageRepository.updateByIdAndOrganization(
      garageId,
      authUser.organizationId,
      updateData
    );

    if (!updated) {
      throw new AppError('Garage not found', 404, 'GARAGE_NOT_FOUND');
    }

    return formatGarageResponse(updated);
  } catch (err) {
    if (
      err.code === 11000 &&
      ((err.keyPattern && err.keyPattern.normalizedName) ||
        (err.keyValue && err.keyValue.normalizedName !== undefined))
    ) {
      throw new AppError(
        'A garage with this name already exists in your organization',
        409,
        'GARAGE_ALREADY_EXISTS'
      );
    }
    throw err;
  }
};

module.exports = {
  normalizeGarageName,
  escapeRegex,
  formatGarageResponse,
  createGarage,
  getGarageById,
  listGarages,
  updateGarage,
};

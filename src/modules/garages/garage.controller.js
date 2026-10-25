const garageService = require('./garage.service');
const { successResponse } = require('../../utils/apiResponse');
const asyncWrapper = require('../../utils/asyncWrapper');

const createGarage = async (req, res) => {
  const garage = await garageService.createGarage(req.body, req.user);
  return res.status(201).json(successResponse('Garage created successfully', garage));
};

const getGarageById = async (req, res) => {
  const garage = await garageService.getGarageById(req.params.garageId, req.user);
  return res.status(200).json(successResponse('Garage retrieved successfully', garage));
};

const listGarages = async (req, res) => {
  const { garages, pagination } = await garageService.listGarages(req.user, req.query);

  res.set('X-Total-Count', String(pagination.totalCount));
  res.set('X-Page', String(pagination.page));
  res.set('X-Limit', String(pagination.limit));
  res.set('X-Total-Pages', String(pagination.totalPages));

  return res.status(200).json(successResponse('Garages retrieved successfully', garages));
};

const updateGarage = async (req, res) => {
  const garage = await garageService.updateGarage(req.params.garageId, req.body, req.user);
  return res.status(200).json(successResponse('Garage updated successfully', garage));
};

module.exports = {
  createGarage: asyncWrapper(createGarage),
  getGarageById: asyncWrapper(getGarageById),
  listGarages: asyncWrapper(listGarages),
  updateGarage: asyncWrapper(updateGarage),
};

const Joi = require('joi');
const config = require('../../config/env');
const { validateCurrencyDecimals } = require('../../utils/money');
const { GOVERNORATES } = require('../../utils/governorates');

const phonePattern = /^\+?\d{9,15}$/;

const createGarageSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': 'name is required',
    'string.min': 'name must be between 2 and 100 characters',
    'string.max': 'name must be between 2 and 100 characters',
    'any.required': 'name is required',
  }),
  governorate: Joi.string().valid(...GOVERNORATES).required().messages({
    'any.only': 'Invalid governorate',
    'any.required': 'governorate is required',
  }),
  city: Joi.string().trim().min(2).max(60).required().messages({
    'string.empty': 'city is required',
    'string.min': 'city must be between 2 and 60 characters',
    'string.max': 'city must be between 2 and 60 characters',
    'any.required': 'city is required',
  }),
  phone: Joi.string().trim().pattern(phonePattern).required().messages({
    'string.pattern.base': 'phone must be a valid phone number',
    'string.empty': 'phone is required',
    'any.required': 'phone is required',
  }),
  laborRate: Joi.number()
    .strict()
    .min(0)
    .max(config.maxFinancialAmount)
    .custom(validateCurrencyDecimals)
    .required()
    .messages({
      'number.base': 'laborRate must be a valid number',
      'number.min': 'laborRate cannot be negative',
      'number.max': `laborRate cannot exceed ${config.maxFinancialAmount}`,
      'any.required': 'laborRate is required',
    }),
  approved: Joi.boolean().default(true).optional(),
});

const listGaragesQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  governorate: Joi.string().valid(...GOVERNORATES).optional().messages({
    'any.only': 'Invalid governorate',
  }),
  approved: Joi.boolean().optional(),
  q: Joi.string().trim().max(50).optional(),
});

const updateGarageSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).optional().messages({
    'string.empty': 'name cannot be empty',
    'string.min': 'name must be between 2 and 100 characters',
    'string.max': 'name must be between 2 and 100 characters',
  }),
  governorate: Joi.string().valid(...GOVERNORATES).optional().messages({
    'any.only': 'Invalid governorate',
  }),
  city: Joi.string().trim().min(2).max(60).optional().messages({
    'string.empty': 'city cannot be empty',
    'string.min': 'city must be between 2 and 60 characters',
    'string.max': 'city must be between 2 and 60 characters',
  }),
  phone: Joi.string().trim().pattern(phonePattern).optional().messages({
    'string.pattern.base': 'phone must be a valid phone number',
  }),
  laborRate: Joi.number()
    .strict()
    .min(0)
    .max(config.maxFinancialAmount)
    .custom(validateCurrencyDecimals)
    .optional()
    .messages({
      'number.base': 'laborRate must be a valid number',
      'number.min': 'laborRate cannot be negative',
      'number.max': `laborRate cannot exceed ${config.maxFinancialAmount}`,
    }),
  approved: Joi.boolean().optional(),
}).min(1);

module.exports = {
  createGarageSchema,
  listGaragesQuerySchema,
  updateGarageSchema,
};

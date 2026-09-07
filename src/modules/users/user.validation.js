const Joi = require('joi');

const createUserSchema = Joi.object({
  name: Joi.string().trim().required(),
  employeeCode: Joi.string().trim().required(),
  password: Joi.string().min(8).required(),
  role: Joi.string().valid('CLAIMS_OFFICER', 'FIELD_ADJUSTER').required(),
});

const updateStatusSchema = Joi.object({
  status: Joi.string().valid('ACTIVE', 'INACTIVE').required(),
});

const resetPasswordSchema = Joi.object({
  newPassword: Joi.string().min(8).required(),
});

module.exports = { createUserSchema, updateStatusSchema, resetPasswordSchema };

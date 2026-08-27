const Joi = require('joi');

const loginSchema = Joi.object({
  organizationCode: Joi.string().required().trim().messages({
    'string.empty': 'Organization code is required',
    'any.required': 'Organization code is required',
  }),
  employeeCode: Joi.string().required().trim().messages({
    'string.empty': 'Employee code is required',
    'any.required': 'Employee code is required',
  }),
  password: Joi.string().required().messages({
    'string.empty': 'Password is required',
    'any.required': 'Password is required',
  }),
});

module.exports = {
  loginSchema,
};

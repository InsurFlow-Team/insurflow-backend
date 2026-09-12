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

const getAdjustersQuerySchema = Joi.object({
  status: Joi.string()
    .valid('available')
    .optional()
    .messages({
      'any.only': 'status must be: available',
    }),
});

const listUsersQuerySchema = Joi.object({
  role: Joi.string()
    .valid('ADMIN', 'CLAIMS_OFFICER', 'FIELD_ADJUSTER')
    .optional()
    .messages({
      'any.only': 'role must be one of: ADMIN, CLAIMS_OFFICER, FIELD_ADJUSTER',
    }),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
});


const updateUserSchema = Joi.object({
  name: Joi.string().trim().min(1).optional(),
  employeeCode: Joi.string().trim().min(1).optional(),
}).min(1);

module.exports = {
  createUserSchema,
  updateUserSchema,
  updateStatusSchema,
  resetPasswordSchema,
  getAdjustersQuerySchema,
  listUsersQuerySchema,
};

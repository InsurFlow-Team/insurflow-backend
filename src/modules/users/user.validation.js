const Joi = require('joi');
const { objectIdPattern } = require('../../middlewares/validate.middleware');

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
  claimId: Joi.string().pattern(objectIdPattern).optional().messages({
    'string.pattern.base': 'Invalid ID format',
  }),
  latitude: Joi.number().min(-90).max(90).optional().messages({
    'number.base': 'Latitude must be a valid number between -90 and 90',
    'number.min': 'Latitude must be at least -90',
    'number.max': 'Latitude cannot exceed 90',
  }),
  longitude: Joi.number().min(-180).max(180).optional().messages({
    'number.base': 'Longitude must be a valid number between -180 and 180',
    'number.min': 'Longitude must be at least -180',
    'number.max': 'Longitude cannot exceed 180',
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

const updateFcmTokenSchema = Joi.object({
  fcmToken: Joi.string().trim().min(1).required().messages({
    'string.base': 'fcmToken must be a string',
    'string.empty': 'fcmToken cannot be empty',
    'any.required': 'fcmToken is required',
  }),
});

module.exports = {
  createUserSchema,
  updateUserSchema,
  updateStatusSchema,
  resetPasswordSchema,
  getAdjustersQuerySchema,
  listUsersQuerySchema,
  updateFcmTokenSchema,
};


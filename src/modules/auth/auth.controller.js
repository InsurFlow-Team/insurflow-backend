const authService = require('./auth.service');
const { loginSchema } = require('./auth.validation');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const config = require('../../config/env');

/**
 * Handle POST /auth/login
 */
const login = async (req, res, next) => {
  // 1. Validate request body
  const { error, value } = loginSchema.validate(req.body, { abortEarly: false });
  if (error) {
    const validationErrors = error.details.map(err => ({
      code: 'VALIDATION_ERROR',
      details: err.message
    }));
    return res.status(400).json(errorResponse('Validation Error', validationErrors));
  }

  const { organizationCode, employeeCode, password } = value;

  // 2. Call service to login
  const loginData = await authService.login(organizationCode, employeeCode, password);

  // 3. Set cookie
  res.cookie('token', loginData.accessToken, {
    httpOnly: config.nodeEnv === 'production' ? true : false,
    secure: config.nodeEnv === 'production' ? true : false,
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  });

  // 4. Return success response
  return res.status(200).json(successResponse('Login successful', loginData));
};

module.exports = {
  login,
};

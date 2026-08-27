const authService = require('./auth.service');
const { loginSchema } = require('./auth.validation');
const { successResponse, errorResponse } = require('../../utils/apiResponse');

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

  // 3. Return success response
  return res.status(200).json(successResponse('Login successful', loginData));
};

module.exports = {
  login,
};

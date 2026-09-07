const authService = require('./auth.service');
const { successResponse } = require('../../utils/apiResponse');
const config = require('../../config/env');
const asyncWrapper = require('../../utils/asyncWrapper');


const login = async (req, res, next) => {
  const { organizationCode, employeeCode, password } = req.body;

  // 2. Call service to login
  const loginData = await authService.login(organizationCode, employeeCode, password);

  // 3. Set cookie
  const isProduction = config.nodeEnv === 'production';
  res.cookie('token', loginData.accessToken, {
    httpOnly: true,                              // دائماً true للأمان
    secure: isProduction,                        // false في dev (http), true في prod (https)
    sameSite: isProduction ? 'none' : 'lax',    // none في prod (cross-site), lax في dev
    maxAge: 8 * 60 * 60 * 1000                  // 8 ساعات
  });

  // 4. Return success response
  return res.status(200).json(successResponse('Login successful', loginData));
};

const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const result = await authService.changePassword(currentPassword, newPassword, req.user);
  return res.status(200).json(successResponse('Password changed successfully', result));
};

module.exports = {
  login: asyncWrapper(login),
  changePassword: asyncWrapper(changePassword),
};

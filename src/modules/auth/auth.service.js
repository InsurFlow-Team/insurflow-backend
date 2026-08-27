const jwt = require('jsonwebtoken');
const Organization = require('../organizations/organization.model');
const User = require('../users/user.model');
const config = require('../../config/env');

/**
 * Authenticates a user and generates a JWT.
 * @param {string} organizationCode - The organization's code.
 * @param {string} employeeCode - The user's employee code.
 * @param {string} password - The user's password.
 * @returns {object} Object containing the access token and user information.
 */
const login = async (organizationCode, employeeCode, password) => {
  // 1. Find organization by code
  const organization = await Organization.findOne({ code: organizationCode.toUpperCase() });
  if (!organization) {
    const error = new Error('Invalid credentials');
    error.statusCode = 401;
    throw error;
  }

  // 2. Find user by employee code and organization ID
  const user = await User.findOne({ 
    employeeCode, 
    organizationId: organization._id 
  });
  
  if (!user) {
    const error = new Error('Invalid credentials');
    error.statusCode = 401;
    throw error;
  }

  // 3. Check user status
  if (user.status !== 'ACTIVE') {
    const error = new Error('User is inactive');
    error.statusCode = 401;
    throw error;
  }

  // 4. Verify password
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    const error = new Error('Invalid credentials');
    error.statusCode = 401;
    throw error;
  }

  // 5. Generate JWT
  const payload = {
    userId: user._id,
    role: user.role,
    organizationId: organization._id,
  };

  const accessToken = jwt.sign(payload, config.jwtSecret, { expiresIn: '8h' });

  // 6. Return response data as per API contract
  return {
    accessToken,
    user: {
      id: user._id,
      name: user.name,
      employeeCode: user.employeeCode,
      role: user.role,
      organizationId: organization._id,
      organizationName: organization.name,
    },
  };
};

module.exports = {
  login,
};

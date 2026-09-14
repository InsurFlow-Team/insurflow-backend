const express = require('express');
const authController = require('./auth.controller');
const validate = require('../../middlewares/validate.middleware');
const authenticate = require('../../middlewares/auth.middleware');
const adjusterLocationMiddleware = require('../../middlewares/adjusterLocation.middleware');
const { loginLimiter } = require('../../middlewares/rateLimiter.middleware');
const { loginSchema, changePasswordSchema } = require('./auth.validation');

const router = express.Router();

router.post('/login', loginLimiter, validate(loginSchema), authController.login);
router.put('/change-password', authenticate, adjusterLocationMiddleware, validate(changePasswordSchema), authController.changePassword);

module.exports = router;

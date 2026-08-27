const jwt = require('jsonwebtoken');
const authenticate = require('../src/middlewares/auth.middleware');
const authorizeRole = require('../src/middlewares/role.middleware');
const config = require('../src/config/env');

describe('Middlewares', () => {
  describe('auth.middleware', () => {
    it('should attach user to req and call next if token is valid', () => {
      const payload = { userId: '123', role: 'ADMIN', organizationId: '456' };
      const token = jwt.sign(payload, config.jwtSecret);
      
      const req = {
        headers: { authorization: `Bearer ${token}` }
      };
      const res = {};
      const next = jest.fn();

      authenticate(req, res, next);

      expect(req.user).toBeDefined();
      expect(req.user.userId).toBe('123');
      expect(req.user.role).toBe('ADMIN');
      expect(req.user.organizationId).toBe('456');
      expect(next).toHaveBeenCalled();
    });

    it('should return 401 if token is missing', () => {
      const req = { headers: {} };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('role.middleware', () => {
    it('should call next if user role is allowed', () => {
      const req = {
        user: { role: 'ADMIN' }
      };
      const res = {};
      const next = jest.fn();

      const middleware = authorizeRole(['ADMIN']);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should return 403 if user role is not allowed', () => {
      const req = {
        user: { role: 'FIELD_ADJUSTER' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      const middleware = authorizeRole(['ADMIN', 'CLAIMS_OFFICER']);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });
  });
});

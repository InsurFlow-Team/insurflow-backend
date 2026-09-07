const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const authenticate = require('../src/middlewares/auth.middleware');
const authorizeRole = require('../src/middlewares/role.middleware');
const errorHandler = require('../src/middlewares/errorHandler');
const AppError = require('../src/utils/appError');
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

  describe('errorHandler (SEC-03 Production 500 Error Masking)', () => {
    let originalEnv;
    let originalConfigEnv;
    let consoleSpy;
    let app;

    beforeEach(() => {
      originalEnv = process.env.NODE_ENV;
      originalConfigEnv = config.nodeEnv;
      consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      app = express();
      app.use(express.json());

      app.get('/test/unexpected-error', (req, res, next) => {
        next(new Error('SECRET_INTERNAL_DATABASE_FAILURE_123: MongoServerError connection timeout at mongodb://internal-db:27017'));
      });

      app.get('/test/secret-marker-error', (req, res, next) => {
        next(new Error('Internal failure with marker SEC03_INTERNAL_SECRET_MARKER_98765'));
      });

      app.get('/test/operational-400', (req, res, next) => {
        next(new AppError('Invalid request parameters', 400, 'VALIDATION_ERROR'));
      });

      app.get('/test/operational-404', (req, res, next) => {
        next(new AppError('Resource not found', 404, 'RESOURCE_NOT_FOUND'));
      });

      app.get('/test/mongoose-validation', (req, res, next) => {
        const err = new Error('Validation failed');
        err.name = 'ValidationError';
        next(err);
      });

      app.get('/test/mongoose-cast-error', (req, res, next) => {
        const err = new Error('Cast failed');
        err.name = 'CastError';
        err.kind = 'ObjectId';
        next(err);
      });

      app.use(errorHandler);
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
      config.nodeEnv = originalConfigEnv;
      consoleSpy.mockRestore();
    });

    it('TEST 1: should mask unexpected 500 errors in production with generic Internal Server Error and INTERNAL_ERROR', async () => {
      config.nodeEnv = 'production';
      process.env.NODE_ENV = 'production';

      const res = await request(app).get('/test/unexpected-error');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Internal Server Error');
      expect(res.body.errors).toEqual([
        { code: 'INTERNAL_ERROR', details: 'Internal Server Error' }
      ]);

      const rawBody = JSON.stringify(res.body);
      expect(rawBody).not.toContain('SECRET_INTERNAL_DATABASE_FAILURE_123');
      expect(rawBody).not.toContain('MongoServerError');
      expect(rawBody).not.toContain('internal-db:27017');
    });

    it('TEST 2: should preserve safe operational 4xx errors unchanged in production', async () => {
      config.nodeEnv = 'production';
      process.env.NODE_ENV = 'production';

      const res400 = await request(app).get('/test/operational-400');
      expect(res400.status).toBe(400);
      expect(res400.body.success).toBe(false);
      expect(res400.body.message).toBe('Invalid request parameters');
      expect(res400.body.errors[0]).toEqual({
        code: 'VALIDATION_ERROR',
        details: 'Invalid request parameters'
      });

      const res404 = await request(app).get('/test/operational-404');
      expect(res404.status).toBe(404);
      expect(res404.body.success).toBe(false);
      expect(res404.body.message).toBe('Resource not found');
      expect(res404.body.errors[0]).toEqual({
        code: 'RESOURCE_NOT_FOUND',
        details: 'Resource not found'
      });
    });

    it('TEST 2 (continued): should preserve Mongoose validation and cast errors in production', async () => {
      config.nodeEnv = 'production';
      process.env.NODE_ENV = 'production';

      const resVal = await request(app).get('/test/mongoose-validation');
      expect(resVal.status).toBe(400);
      expect(resVal.body.message).toBe('Validation Error');
      expect(resVal.body.errors[0].code).toBe('VALIDATION_ERROR');

      const resCast = await request(app).get('/test/mongoose-cast-error');
      expect(resCast.status).toBe(404);
      expect(resCast.body.message).toBe('Resource not found');
      expect(resCast.body.errors[0].code).toBe('RESOURCE_NOT_FOUND');
    });

    it('TEST 3: should keep diagnostic details in response when running in development mode', async () => {
      config.nodeEnv = 'development';
      process.env.NODE_ENV = 'development';

      const res = await request(app).get('/test/unexpected-error');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('SECRET_INTERNAL_DATABASE_FAILURE_123');
      expect(res.body.errors[0].details).toContain('SECRET_INTERNAL_DATABASE_FAILURE_123');
    });

    it('TEST 5: should not leak err.stack or stack trace information in production response', async () => {
      config.nodeEnv = 'production';
      process.env.NODE_ENV = 'production';

      const res = await request(app).get('/test/unexpected-error');

      expect(res.status).toBe(500);
      expect(res.body.stack).toBeUndefined();
      const rawBody = JSON.stringify(res.body);
      expect(rawBody).not.toMatch(/\s+at\s+/);
      expect(rawBody).not.toContain('errorHandler.js');
    });

    it('TEST 6: should preserve the standard InsurFlow unified API error envelope in production 500 responses', async () => {
      config.nodeEnv = 'production';
      process.env.NODE_ENV = 'production';

      const res = await request(app).get('/test/unexpected-error');

      expect(res.status).toBe(500);
      expect(Object.keys(res.body).sort()).toEqual(['errors', 'message', 'success']);
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0]).toHaveProperty('code');
      expect(res.body.errors[0]).toHaveProperty('details');
    });

    it('should never leak SEC03_INTERNAL_SECRET_MARKER_98765 in production response', async () => {
      config.nodeEnv = 'production';
      process.env.NODE_ENV = 'production';

      const res = await request(app).get('/test/secret-marker-error');

      expect(res.status).toBe(500);
      const rawBody = JSON.stringify(res.body);
      expect(rawBody).not.toContain('SEC03_INTERNAL_SECRET_MARKER_98765');
      expect(res.body.message).toBe('Internal Server Error');
      expect(res.body.errors[0].code).toBe('INTERNAL_ERROR');
      expect(res.body.errors[0].details).toBe('Internal Server Error');
    });

    it('should preserve server-side diagnostic logging (console.error) for unexpected production 500 errors', async () => {
      config.nodeEnv = 'production';
      process.env.NODE_ENV = 'production';

      await request(app).get('/test/unexpected-error');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('SECRET_INTERNAL_DATABASE_FAILURE_123')
      );
      const stackCalls = consoleSpy.mock.calls.some((args) =>
        args.some((arg) => typeof arg === 'string' && arg.includes('Error: SECRET_INTERNAL_DATABASE_FAILURE_123'))
      );
      expect(stackCalls).toBe(true);
    });
  });
});

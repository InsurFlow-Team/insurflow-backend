const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { loginLimiter, apiLimiter } = require('../src/middlewares/rateLimiter.middleware');
const config = require('../src/config/env');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Rate Limiting Middleware', () => {
  beforeEach(() => {
    loginLimiter.reset();
    apiLimiter.reset();
  });

  afterEach(() => {
    loginLimiter.reset();
    apiLimiter.reset();
  });


  // ─── General API Limiter (apiLimiter) ───────────────────────────────────────
  describe('apiLimiter on /api/v1', () => {
    it('should include standard RateLimit-* headers when enabled', async () => {
      const res = await request(app)
        .get('/api/v1/auth/login') // GET on login endpoint (returns 404/405, but hits /api/v1)
        .set('x-test-rate-limit', 'true');

      expect(res.headers).toHaveProperty('ratelimit-limit');
      expect(res.headers).toHaveProperty('ratelimit-remaining');
      expect(res.headers).toHaveProperty('ratelimit-reset');
    });

    it('should block requests with 429 when apiRateLimit threshold is exceeded', async () => {
      // Temporarily override limit for this specific test
      const maxLimit = 3;
      const originalMax = config.apiRateLimit.max;
      config.apiRateLimit.max = maxLimit;

      try {
        // Send requests up to limit
        for (let i = 0; i < maxLimit; i++) {
          const res = await request(app)
            .get('/api/v1/auth/does-not-exist')
            .set('x-test-rate-limit', 'true')
            .set('x-test-rate-limit-max', String(maxLimit));
          expect(res.status).not.toBe(429);
        }

        // The next request should be blocked with 429
        const blockedRes = await request(app)
          .get('/api/v1/auth/does-not-exist')
          .set('x-test-rate-limit', 'true')
          .set('x-test-rate-limit-max', String(maxLimit));

        expect(blockedRes.status).toBe(429);
        expect(blockedRes.body.success).toBe(false);
        expect(blockedRes.body.message).toBe('Too many requests. Please try again later.');
        expect(blockedRes.body.errors[0].code).toBe('TOO_MANY_REQUESTS');
      } finally {
        config.apiRateLimit.max = originalMax;
        apiLimiter.reset();
      }
    });

    it('should never rate limit /health check endpoint', async () => {
      // Exceed apiLimiter
      const maxLimit = 2;
      const originalMax = config.apiRateLimit.max;
      config.apiRateLimit.max = maxLimit;

      try {
        for (let i = 0; i < maxLimit + 2; i++) {
          await request(app)
            .get('/api/v1/auth/does-not-exist')
            .set('x-test-rate-limit', 'true')
            .set('x-test-rate-limit-max', String(maxLimit));
        }

        // /health is outside /api/v1 and must return 200 OK
        const healthRes = await request(app).get('/health');
        expect(healthRes.status).toBe(200);
        expect(healthRes.body.success).toBe(true);
      } finally {
        config.apiRateLimit.max = originalMax;
        apiLimiter.reset();
      }

    });

    it('should ignore x-test-rate-limit-max when nodeEnv is not test', async () => {
      const originalEnv = config.nodeEnv;
      config.nodeEnv = 'production';

      try {
        // Send a request with x-test-rate-limit-max header attempting to set limit to 1
        const res1 = await request(app)
          .get('/api/v1/auth/does-not-exist')
          .set('x-test-rate-limit-max', '1');

        // In production, x-test-rate-limit-max must be completely ignored.
        // RateLimit-Limit header reflects the configured production max (300), not 1.
        expect(res1.headers).toHaveProperty('ratelimit-limit');
        expect(parseInt(res1.headers['ratelimit-limit'], 10)).toBe(config.apiRateLimit.max || 300);

        // A second request must NOT be blocked with 429
        const res2 = await request(app)
          .get('/api/v1/auth/does-not-exist')
          .set('x-test-rate-limit-max', '1');
        expect(res2.status).not.toBe(429);
      } finally {
        config.nodeEnv = originalEnv;
        apiLimiter.reset();
      }
    });
  });

  // ─── Login Limiter Independence ─────────────────────────────────────────────
  describe('loginLimiter isolation', () => {
    it('should track login rate limiting independently from apiLimiter', async () => {
      // Exhaust login attempts
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/v1/auth/login')
          .send({
            organizationCode: 'NON_EXISTENT',
            employeeCode: 'FA-999',
            password: 'wrong',
          });
      }

      // 6th login attempt is blocked with 429
      const blockedLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({
          organizationCode: 'NON_EXISTENT',
          employeeCode: 'FA-999',
          password: 'wrong',
        });
      expect(blockedLogin.status).toBe(429);
      expect(blockedLogin.body.message).toBe('Too many login attempts. Please try again later.');

      // General endpoint /health or vehicle lookup without login is NOT blocked by loginLimiter
      const healthRes = await request(app).get('/health');
      expect(healthRes.status).toBe(200);
    });
  });
});

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const parseCorsOrigins = require('../src/utils/parseCorsOrigins');
const app = require('../src/app');
const config = require('../src/config/env');

describe('CORS Origins — Unit & Integration Tests (B1)', () => {
  describe('Unit tests for parseCorsOrigins', () => {
    it('single origin', () => {
      expect(parseCorsOrigins('http://localhost:3000')).toEqual(['http://localhost:3000']);
    });

    it('two origins with spaces', () => {
      expect(parseCorsOrigins('https://a.com ,  https://b.com ')).toEqual([
        'https://a.com',
        'https://b.com',
      ]);
    });

    it('trailing slash', () => {
      expect(parseCorsOrigins('https://a.com/')).toEqual(['https://a.com']);
    });

    it('empty input', () => {
      expect(parseCorsOrigins('')).toBe('');
      expect(parseCorsOrigins(undefined)).toBe('');
      expect(parseCorsOrigins('   ')).toBe('');
    });

    it('*', () => {
      expect(parseCorsOrigins('*')).toEqual(['*']);
    });
  });

  describe('Integration tests with supertest', () => {
    let mongoServer;
    let originalCorsOrigin;

    beforeAll(async () => {
      mongoServer = await MongoMemoryServer.create();
      await mongoose.connect(mongoServer.getUri());

      originalCorsOrigin = config.corsOrigin;
      // Configure two allowed origins for integration testing
      config.corsOrigin = ['https://frontend.insurflow.com', 'https://admin.insurflow.com'];
    });

    afterAll(async () => {
      config.corsOrigin = originalCorsOrigin;
      await mongoose.disconnect();
      await mongoServer.stop();
    });

    it('an allowed origin gets Access-Control-Allow-Origin equal to the request origin', async () => {
      const res = await request(app)
        .get('/health')
        .set('Origin', 'https://frontend.insurflow.com');

      expect(res.headers['access-control-allow-origin']).toBe('https://frontend.insurflow.com');
    });

    it('a second allowed origin also works', async () => {
      const res = await request(app)
        .get('/health')
        .set('Origin', 'https://admin.insurflow.com');

      expect(res.headers['access-control-allow-origin']).toBe('https://admin.insurflow.com');
    });

    it('a disallowed origin gets no such header', async () => {
      const res = await request(app)
        .get('/health')
        .set('Origin', 'https://malicious.com');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('an OPTIONS preflight with an Authorization header on a protected route returns 200 with the allow headers', async () => {
      const res = await request(app)
        .options('/api/v1/claims')
        .set('Origin', 'https://frontend.insurflow.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Authorization, Content-Type');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://frontend.insurflow.com');
      expect(res.headers['access-control-allow-headers']).toMatch(/authorization/i);
    });

    it('GET on the public tracking route with an allowed origin succeeds without Authorization', async () => {
      // 64-hex token that does not exist in DB returns 404 (valid cycle without 401 Unauthorized)
      const testToken = 'a'.repeat(64);
      const res = await request(app)
        .get(`/api/v1/public/claims/track/${testToken}`)
        .set('Origin', 'https://frontend.insurflow.com');

      expect(res.status).toBe(404);
      expect(res.body.errors[0].code).toBe('CLAIM_NOT_FOUND');
      expect(res.headers['access-control-allow-origin']).toBe('https://frontend.insurflow.com');
    });
  });
});

const redactTrackingToken = require('../src/utils/redactTrackingToken');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');

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

describe('redactTrackingToken utility', () => {
  const token64 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('redacts a 64-hex token in a standard tracking URL', () => {
    const url = `/api/v1/public/claims/track/${token64}`;
    expect(redactTrackingToken(url)).toBe('/api/v1/public/claims/track/[redacted]');
  });

  it('redacts a 64-hex token with trailing slash', () => {
    const url = `/api/v1/public/claims/track/${token64}/`;
    expect(redactTrackingToken(url)).toBe('/api/v1/public/claims/track/[redacted]/');
  });

  it('redacts a 64-hex token with query parameters', () => {
    const url = `/api/v1/public/claims/track/${token64}?utm_source=sms&lang=ar`;
    expect(redactTrackingToken(url)).toBe('/api/v1/public/claims/track/[redacted]?utm_source=sms&lang=ar');
  });

  it('redacts a 64-hex token with trailing slash and query parameters', () => {
    const url = `/api/v1/public/claims/track/${token64}/?ref=dashboard`;
    expect(redactTrackingToken(url)).toBe('/api/v1/public/claims/track/[redacted]/?ref=dashboard');
  });

  it('leaves URL unchanged when token is shorter than 64 hex characters', () => {
    const url = '/api/v1/public/claims/track/short123';
    expect(redactTrackingToken(url)).toBe('/api/v1/public/claims/track/short123');
  });

  it('leaves URL unchanged when token has non-hex characters', () => {
    const url = `/api/v1/public/claims/track/${'z'.repeat(64)}`;
    expect(redactTrackingToken(url)).toBe(`/api/v1/public/claims/track/${'z'.repeat(64)}`);
  });

  it('leaves URLs without /track/ segment unchanged', () => {
    const url = '/api/v1/claims/12345';
    expect(redactTrackingToken(url)).toBe('/api/v1/claims/12345');
  });

  it('safely handles non-string, null, or undefined input', () => {
    expect(redactTrackingToken(null)).toBeNull();
    expect(redactTrackingToken(undefined)).toBeUndefined();
    expect(redactTrackingToken('')).toBe('');
    expect(redactTrackingToken(12345)).toBe(12345);
  });
});

describe('Morgan log redaction integration', () => {
  it('ensures tracking token is redacted in morgan log output and never appears', async () => {
    const token = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const morgan = require('morgan');

    let capturedLog = '';
    const originalConsole = console.log;
    // We capture process.stdout.write or morgan stream output
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      capturedLog += chunk.toString();
      return true;
    });

    try {
      await request(app).get(`/api/v1/public/claims/track/${token}?testParam=1`);
      
      expect(capturedLog).toContain('/api/v1/public/claims/track/[redacted]?testParam=1');
      expect(capturedLog).not.toContain(token);
    } finally {
      writeSpy.mockRestore();
    }
  });
});

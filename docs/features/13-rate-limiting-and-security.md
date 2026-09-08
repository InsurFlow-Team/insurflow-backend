# Feature Specification: API Rate Limiting & Security Hardening

## 1. Feature Overview
To safeguard InsurFlow against brute-force credential stuffing, volumetric Denial-of-Service (DoS), automated data scraping, and resource exhaustion, the backend implements a multi-tiered rate-limiting strategy using `express-rate-limit@8.7.0`.

Two distinct rate limiters operate in tandem:
1. **`loginLimiter` (Authentication Defense):** Strictly throttles failed login attempts on `POST /api/v1/auth/login`.
2. **`apiLimiter` (API Protection):** Throttles overall request volume across all `/api/v1` routes.

---

## 2. Technical Architecture & Middleware

Implemented in [src/middlewares/rateLimiter.middleware.js](file:///c:/Users/HP/Desktop/INSURFLOW/src/middlewares/rateLimiter.middleware.js):

### 2.1 Login Rate Limiter (`loginLimiter`)
Mounted on `POST /api/v1/auth/login` in [src/modules/auth/auth.routes.js:L10](file:///c:/Users/HP/Desktop/INSURFLOW/src/modules/auth/auth.routes.js#L10):

```javascript
const loginLimiter = rateLimit({
  windowMs: config.rateLimit?.windowMs || 15 * 60 * 1000, // 15 minutes
  max: config.rateLimit?.max || 5, // 5 failed attempts allowed
  standardHeaders: true, // RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
  legacyHeaders: false,
  skipSuccessfulRequests: true, // CRITICAL: Only count failed attempts
  store: loginRateLimitStore,
  handler: (req, res, next, options) => {
    const message = 'Too many login attempts. Please try again later.';
    return res.status(429).json(errorResponse(message, [
      { code: 'TOO_MANY_REQUESTS', details: message },
    ]));
  },
});
```

* **Failed-Only Accounting (`skipSuccessfulRequests: true`):** Legitimate users with valid credentials never consume rate-limit quota. Only 4xx and 5xx responses (such as invalid password or wrong employee code) decrement the remaining budget.
* **Lockout Behavior:** Upon the 6th failed attempt from an IP address within a 15-minute sliding window, the request is blocked with `429 Too Many Requests`.

---

### 2.2 General API Rate Limiter (`apiLimiter`)
Mounted globally across `/api/v1` in [src/app.js:L55](file:///c:/Users/HP/Desktop/INSURFLOW/src/app.js#L55):

```javascript
const apiLimiter = rateLimit({
  windowMs: config.apiRateLimit?.windowMs || 15 * 60 * 1000,
  max: (req) =>
    (config.nodeEnv === 'test' && req.headers['x-test-rate-limit-max']
      ? parseInt(req.headers['x-test-rate-limit-max'], 10)
      : config.apiRateLimit?.max || 300),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => config.nodeEnv === 'test' && !req.headers['x-test-rate-limit'],
  store: apiRateLimitStore,
  handler: (req, res, next, options) => {
    const message = 'Too many requests. Please try again later.';
    return res.status(429).json(errorResponse(message, [
      { code: 'TOO_MANY_REQUESTS', details: message },
    ]));
  },
});
```

* **Production Security Guard:** The `x-test-rate-limit-max` header is only inspected when `config.nodeEnv === 'test'`. In production, client headers cannot manipulate or override the rate limit ceiling.
* **Test Isolation:** In test environments, `apiLimiter` is skipped by default so unit/integration tests do not interfere with one another, unless explicitly activated with `x-test-rate-limit: true`.

---

## 3. Infrastructure & Additional Hardening

1. **Reverse Proxy Configuration:**
   `app.set('trust proxy', 1)` is enabled in [src/app.js:L15](file:///c:/Users/HP/Desktop/INSURFLOW/src/app.js#L15). This ensures `req.ip` reflects the actual client IP forwarding from NGINX / Cloudflare rather than the internal load balancer's loopback address.
2. **Health Check Immunity:**
   The `/health` route is mounted directly on `app.get('/health')` before `/api/v1` routes and `apiLimiter`. Container orchestrators (Kubernetes / Docker) and uptime monitors are never throttled.
3. **Production Internal Error Masking:**
   In [src/middlewares/errorHandler.js:L16](file:///c:/Users/HP/Desktop/INSURFLOW/src/middlewares/errorHandler.js#L16), when `NODE_ENV === 'production'`, unhandled 500 errors return a generic message (`"Internal Server Error"`, code: `"INTERNAL_ERROR"`), preventing stack trace or database driver leakage.
4. **Helmet & Security Headers:**
   `helmet()` is active in [src/app.js:L16](file:///c:/Users/HP/Desktop/INSURFLOW/src/app.js#L16), securing HTTP headers against clickjacking, XSS, and MIME sniffing.

---

## 4. Automated Testing Suite

Tested in [tests/rateLimiting.test.js](file:///c:/Users/HP/Desktop/INSURFLOW/tests/rateLimiting.test.js) (5 tests):
* Standard `RateLimit-*` headers emitted on API requests.
* Blocking with `429 Too Many Requests` when limit is exceeded.
* Immunity of `/health` check endpoint from rate limiting.
* Non-test environment security: ensuring `x-test-rate-limit-max` is ignored when `nodeEnv !== 'test'`.
* Isolation of `loginLimiter` (trips on 6th failed attempt while leaving general API access intact).

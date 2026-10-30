const { validateDemoAssets } = require('./demoAssets');

/**
 * Pre-connection guard assertions for PB-03.
 * Checks ALLOW_DEMO_SEED, NODE_ENV, DEMO_SEED_PASSWORD, and optional asset validation.
 *
 * @param {object} env - Environment variables dictionary (defaults to process.env)
 * @param {object} options - Execution options
 * @param {boolean} options.checkAssets - Whether to assert asset URLs are not placeholders (defaults to false for CLI/tests unless requested)
 */
const checkDemoGuard = (env = process.env, options = {}) => {
  if (env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error("FATAL: ALLOW_DEMO_SEED must be exactly 'true' to run demo seeding.");
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('FATAL: Demo seed cannot run in production environment.');
  }

  const password = env.DEMO_SEED_PASSWORD;
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('FATAL: DEMO_SEED_PASSWORD environment variable is required and must be at least 12 characters.');
  }


  if (options.assets) {
    validateDemoAssets(options.assets);
  } else if (options.checkAssets) {
    validateDemoAssets();
  }

  return true;
};

module.exports = {
  checkDemoGuard,
};

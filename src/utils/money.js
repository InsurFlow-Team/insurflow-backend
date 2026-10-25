const CURRENCY_SCALE = Object.freeze({
  ILS: 2,
  USD: 2,
  JOD: 3,
});

/**
 * Returns the decimal scale for the given currency.
 * Throws if the currency is not registered.
 *
 * @param {string} currency
 * @returns {number}
 */
const getCurrencyScale = (currency) => {
  if (typeof currency !== 'string' || !(currency in CURRENCY_SCALE)) {
    throw new Error(`Unsupported currency: ${currency}`);
  }
  return CURRENCY_SCALE[currency];
};

/**
 * Counts the number of decimal places of a finite number.
 *
 * @param {number} n
 * @returns {number}
 */
const countDecimals = (n) => {
  if (Math.floor(n) === n) return 0;
  const str = n.toString();
  if (str.includes('e-')) {
    const parts = str.split('e-');
    return (parts[0].split('.')[1]?.length || 0) + parseInt(parts[1], 10);
  }
  return str.split('.')[1]?.length || 0;
};

/**
 * Converts a major unit amount to exact integer minor units.
 *
 * @param {number} amount - Major unit amount (e.g., 19.99)
 * @param {string} currency - Currency code (e.g., 'ILS')
 * @returns {number} - Integer minor units (e.g., 1999)
 */
const toMinor = (amount, currency) => {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new TypeError('Amount must be a finite number');
  }
  const scale = getCurrencyScale(currency);

  if (countDecimals(amount) > scale) {
    throw new Error(`Amount ${amount} exceeds allowed decimal scale of ${scale} for currency ${currency}`);
  }

  const factor = 10 ** scale;
  const minor = Math.round(amount * factor);

  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`Amount ${amount} exceeds safe integer bounds when converted to minor units`);
  }

  return minor;
};

/**
 * Converts integer minor units to a major unit number.
 * Null/undefined inputs return null.
 *
 * @param {number|null|undefined} minor - Minor units integer (e.g., 1999)
 * @param {string} currency - Currency code (e.g., 'ILS')
 * @returns {number|null} - Major unit number (e.g., 19.99)
 */
const fromMinor = (minor, currency) => {
  if (minor === null || minor === undefined) {
    return null;
  }
  if (typeof minor !== 'number' || !Number.isInteger(minor)) {
    throw new TypeError('Minor unit amount must be an integer');
  }
  const scale = getCurrencyScale(currency);
  const factor = 10 ** scale;
  return minor / factor;
};

/**
 * Joi custom validator that checks if a major unit number conforms to the allowed decimal scale of config.currency.
 *
 * @param {number} value
 * @param {object} helpers
 * @returns {number}
 */
const validateCurrencyDecimals = (value, helpers) => {
  if (typeof value !== 'number') return value;
  const config = require('../config/env');
  const scale = getCurrencyScale(config.currency);
  const factor = 10 ** scale;
  if (Math.round(value * factor) / factor !== value) {
    return helpers.message(`"{#label}" must have at most ${scale} decimal places`);
  }
  return value;
};

module.exports = {
  CURRENCY_SCALE,
  getCurrencyScale,
  toMinor,
  fromMinor,
  validateCurrencyDecimals,
};

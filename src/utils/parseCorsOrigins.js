/**
 * Parses and sanitizes CORS origins from an environment string or config.
 * Supports comma-separated origins, trims whitespace, strips trailing slashes,
 * and drops empty entries.
 *
 * @param {string|undefined} raw - Raw origins string from environment or config
 * @returns {string[]|string} Array of sanitized origins or empty string '' if input is empty
 */
const parseCorsOrigins = (raw) => {
  if (raw === undefined || raw === null) {
    return '';
  }

  if (typeof raw !== 'string') {
    return '';
  }

  const trimmed = raw.trim();
  if (trimmed === '') {
    return '';
  }

  const list = trimmed
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);

  return list.length === 0 ? '' : list;
};

module.exports = parseCorsOrigins;

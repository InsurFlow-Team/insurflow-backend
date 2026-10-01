/**
 * Redacts 64-character hexadecimal tracking tokens from URLs to prevent sensitive tracking
 * identifiers from leaking into server access logs and monitoring systems.
 * Preserves path structure, trailing slashes, and query strings.
 *
 * @param {string} url - The URL or path string to sanitize
 * @returns {string} The sanitized URL with tracking token replaced by [redacted]
 */
const redactTrackingToken = (url) => {
  if (typeof url !== 'string' || !url) {
    return url;
  }

  return url.replace(/(?<=\/track\/)[0-9a-fA-F]{64}(?![0-9a-fA-F])/gi, '[redacted]');
};

module.exports = redactTrackingToken;

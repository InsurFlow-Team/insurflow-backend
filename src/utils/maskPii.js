/**
 * Masks an ID number (national ID, passport, Israeli ID, etc.).
 * Replaces every character except the last 4 with '*'.
 * Returns null for null, undefined, or non-string input.
 *
 * @param {string|null|undefined} idNumber
 * @returns {string|null}
 */
const maskIdNumber = (idNumber) => {
  if (typeof idNumber !== 'string') {
    return null;
  }
  const trimmed = idNumber.trim();
  if (!trimmed) {
    return null;
  }
  const keep = 4;
  if (trimmed.length <= keep) {
    return trimmed;
  }
  return '*'.repeat(trimmed.length - keep) + trimmed.slice(-keep);
};

/**
 * Masks a phone number.
 * Keeps the leading '+' if present, and preserves only the last 3 digits,
 * replacing all preceding characters/digits with '*'.
 * Returns null for null, undefined, or non-string input.
 *
 * @param {string|null|undefined} phone
 * @returns {string|null}
 */
const maskPhone = (phone) => {
  if (typeof phone !== 'string') {
    return null;
  }
  const trimmed = phone.trim();
  if (!trimmed) {
    return null;
  }
  const hasPlus = trimmed.startsWith('+');
  const rest = hasPlus ? trimmed.slice(1) : trimmed;
  const keep = 3;
  if (rest.length <= keep) {
    return trimmed;
  }
  const maskedRest = '*'.repeat(rest.length - keep) + rest.slice(-keep);
  return hasPlus ? `+${maskedRest}` : maskedRest;
};

module.exports = {
  maskIdNumber,
  maskPhone,
};

/**
 * Masks a vehicle plate number for public-facing status display.
 * With a dash, preserves everything up to and including the last dash,
 * replacing the remaining characters with 'x' except the last character.
 * Without a dash, preserves the last two characters and replaces the rest with 'x'
 * (plates with two or fewer characters become all 'x').
 *
 * @param {string|null|undefined} plateNumber
 * @returns {string|null}
 */
const maskPlateNumber = (plateNumber) => {
  if (typeof plateNumber !== 'string') {
    return null;
  }

  const trimmed = plateNumber.trim();
  if (!trimmed) {
    return null;
  }

  const lastDashIndex = trimmed.lastIndexOf('-');

  if (lastDashIndex !== -1) {
    const prefix = trimmed.slice(0, lastDashIndex + 1);
    const rest = trimmed.slice(lastDashIndex + 1);

    if (rest.length <= 1) {
      return prefix + rest;
    }

    const maskedRest = 'x'.repeat(rest.length - 1) + rest.slice(-1);
    return prefix + maskedRest;
  }

  const len = trimmed.length;
  if (len <= 2) {
    return 'x'.repeat(len);
  }

  return 'x'.repeat(len - 2) + trimmed.slice(-2);
};

module.exports = maskPlateNumber;

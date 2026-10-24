const { toHebronDate } = require('./hebronDate');

const LICENSE_STATE = Object.freeze({
  MISSING: 'MISSING',
  EXPIRED: 'EXPIRED',
  EXPIRING_SOON: 'EXPIRING_SOON',
  VALID: 'VALID',
});

const isValidCalendarDay = (str) => {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = str.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const getLicenseState = (user, now = new Date()) => {
  if (!user) return LICENSE_STATE.MISSING;
  const { surveyorLicenseNumber, surveyorLicenseExpiry } = user;

  if (
    typeof surveyorLicenseNumber !== 'string' ||
    !surveyorLicenseNumber.trim() ||
    !isValidCalendarDay(surveyorLicenseExpiry)
  ) {
    return LICENSE_STATE.MISSING;
  }

  const today = toHebronDate(now);
  if (!today) {
    return LICENSE_STATE.MISSING;
  }

  if (surveyorLicenseExpiry < today) {
    return LICENSE_STATE.EXPIRED;
  }

  const [y1, m1, d1] = today.split('-').map(Number);
  const [y2, m2, d2] = surveyorLicenseExpiry.split('-').map(Number);
  const diffDays = Math.round(
    (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000
  );

  if (diffDays >= 0 && diffDays <= 30) {
    return LICENSE_STATE.EXPIRING_SOON;
  }

  return LICENSE_STATE.VALID;
};

module.exports = {
  LICENSE_STATE,
  isValidCalendarDay,
  getLicenseState,
};

/**
 * Centralized date conversion helper for Asia/Hebron timezone.
 */

const toHebronDate = (dateInput) => {
  if (!dateInput) return null;
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hebron',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
};

module.exports = {
  toHebronDate,
  deriveIncidentDate: toHebronDate,
};

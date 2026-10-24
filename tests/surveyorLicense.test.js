const {
  getLicenseState,
  isValidCalendarDay,
  LICENSE_STATE,
} = require('../src/utils/surveyorLicense');
const { toHebronDate } = require('../src/utils/hebronDate');

const addDaysToHebron = (now, days) => {
  const hebronStr = toHebronDate(now);
  const [y, m, d] = hebronStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

describe('Surveyor License Helper Unit Tests (HLP-01 to HLP-11)', () => {
  const now = new Date();
  const todayStr = toHebronDate(now);

  it('HLP-01. returns MISSING when surveyorLicenseNumber is null, empty string, or missing', () => {
    expect(getLicenseState(null, now)).toBe(LICENSE_STATE.MISSING);
    expect(getLicenseState({}, now)).toBe(LICENSE_STATE.MISSING);
    expect(
      getLicenseState(
        { surveyorLicenseNumber: null, surveyorLicenseExpiry: '2099-12-31' },
        now
      )
    ).toBe(LICENSE_STATE.MISSING);
    expect(
      getLicenseState(
        { surveyorLicenseNumber: '', surveyorLicenseExpiry: '2099-12-31' },
        now
      )
    ).toBe(LICENSE_STATE.MISSING);
    expect(
      getLicenseState(
        { surveyorLicenseNumber: '   ', surveyorLicenseExpiry: '2099-12-31' },
        now
      )
    ).toBe(LICENSE_STATE.MISSING);
  });

  it('HLP-02. returns MISSING when surveyorLicenseExpiry is null, invalid, or impossible calendar day', () => {
    expect(
      getLicenseState(
        { surveyorLicenseNumber: 'LIC-101', surveyorLicenseExpiry: null },
        now
      )
    ).toBe(LICENSE_STATE.MISSING);
    expect(
      getLicenseState(
        { surveyorLicenseNumber: 'LIC-101', surveyorLicenseExpiry: '' },
        now
      )
    ).toBe(LICENSE_STATE.MISSING);
    expect(
      getLicenseState(
        { surveyorLicenseNumber: 'LIC-101', surveyorLicenseExpiry: 'invalid-date' },
        now
      )
    ).toBe(LICENSE_STATE.MISSING);
    expect(
      getLicenseState(
        { surveyorLicenseNumber: 'LIC-101', surveyorLicenseExpiry: '2026-02-30' },
        now
      )
    ).toBe(LICENSE_STATE.MISSING);
  });

  it('HLP-03. returns EXPIRED when expiry day is yesterday in Asia/Hebron', () => {
    const yesterday = addDaysToHebron(now, -1);
    expect(
      getLicenseState(
        { surveyorLicenseNumber: 'LIC-101', surveyorLicenseExpiry: yesterday },
        now
      )
    ).toBe(LICENSE_STATE.EXPIRED);
  });

  it('HLP-04. returns EXPIRING_SOON on the expiry day itself', () => {
    expect(
      getLicenseState(
        { surveyorLicenseNumber: 'LIC-101', surveyorLicenseExpiry: todayStr },
        now
      )
    ).toBe(LICENSE_STATE.EXPIRING_SOON);
  });

  it('HLP-05. returns EXPIRED on the day after expiry day', () => {
    const expiry = addDaysToHebron(now, 10);
    const dayAfterExpiry = new Date(Date.UTC(
      parseInt(expiry.split('-')[0], 10),
      parseInt(expiry.split('-')[1], 10) - 1,
      parseInt(expiry.split('-')[2], 10) + 1,
      12, 0, 0
    ));
    expect(
      getLicenseState(
        { surveyorLicenseNumber: 'LIC-101', surveyorLicenseExpiry: expiry },
        dayAfterExpiry
      )
    ).toBe(LICENSE_STATE.EXPIRED);
  });

  it('HLP-06. 30th day boundary returns EXPIRING_SOON when expiry is exactly 30 days after today', () => {
    const day30 = addDaysToHebron(now, 30);
    expect(
      getLicenseState(
        { surveyorLicenseNumber: 'LIC-101', surveyorLicenseExpiry: day30 },
        now
      )
    ).toBe(LICENSE_STATE.EXPIRING_SOON);
  });

  it('HLP-07. 31st day boundary returns VALID when expiry is 31 days after today', () => {
    const day31 = addDaysToHebron(now, 31);
    expect(
      getLicenseState(
        { surveyorLicenseNumber: 'LIC-101', surveyorLicenseExpiry: day31 },
        now
      )
    ).toBe(LICENSE_STATE.VALID);
  });

  it('HLP-08. returns VALID when expiry is far in the future', () => {
    const futureDay = addDaysToHebron(now, 100);
    expect(
      getLicenseState(
        { surveyorLicenseNumber: 'LIC-101', surveyorLicenseExpiry: futureDay },
        now
      )
    ).toBe(LICENSE_STATE.VALID);
  });

  it('HLP-09. timestamp near midnight Asia/Hebron evaluates correctly without day slippage', () => {
    const lateNightUtc = new Date('2026-10-24T20:59:59.000Z'); // 23:59:59 in Asia/Hebron (+03:00)
    const hebronLateDay = toHebronDate(lateNightUtc);
    expect(hebronLateDay).toBe('2026-10-24');

    expect(
      getLicenseState(
        { surveyorLicenseNumber: 'LIC-101', surveyorLicenseExpiry: '2026-10-24' },
        lateNightUtc
      )
    ).toBe(LICENSE_STATE.EXPIRING_SOON);

    expect(
      getLicenseState(
        { surveyorLicenseNumber: 'LIC-101', surveyorLicenseExpiry: '2026-10-23' },
        lateNightUtc
      )
    ).toBe(LICENSE_STATE.EXPIRED);
  });

  it('HLP-10. compares by Asia/Hebron day across the DST change', () => {
    // Spring DST: 2026-03-27T22:30:00Z -> 2026-03-28 00:30 Hebron
    const springNow = new Date('2026-03-27T22:30:00Z');
    expect(toHebronDate(springNow)).toBe('2026-03-28');
    expect(
      getLicenseState(
        { surveyorLicenseNumber: 'LIC-101', surveyorLicenseExpiry: '2026-03-27' },
        springNow
      )
    ).toBe(LICENSE_STATE.EXPIRED);
    expect(
      getLicenseState(
        { surveyorLicenseNumber: 'LIC-101', surveyorLicenseExpiry: '2026-03-28' },
        springNow
      )
    ).toBe(LICENSE_STATE.EXPIRING_SOON);

    // Autumn DST: 2026-10-23T21:30:00Z -> 2026-10-24 00:30 Hebron
    const autumnNow = new Date('2026-10-23T21:30:00Z');
    expect(toHebronDate(autumnNow)).toBe('2026-10-24');
    expect(
      getLicenseState(
        { surveyorLicenseNumber: 'LIC-101', surveyorLicenseExpiry: '2026-10-23' },
        autumnNow
      )
    ).toBe(LICENSE_STATE.EXPIRED);
    expect(
      getLicenseState(
        { surveyorLicenseNumber: 'LIC-101', surveyorLicenseExpiry: '2026-10-24' },
        autumnNow
      )
    ).toBe(LICENSE_STATE.EXPIRING_SOON);
  });

  it('HLP-11. isValidCalendarDay rejects impossible and non-date strings', () => {
    expect(isValidCalendarDay('2026-02-30')).toBe(false);
    expect(isValidCalendarDay('2026-13-01')).toBe(false);
    expect(isValidCalendarDay('2027-12-31T10:00:00Z')).toBe(false);
    expect(isValidCalendarDay('31-12-2027')).toBe(false);
    expect(isValidCalendarDay('2027-02-29')).toBe(false); // non leap year
    expect(isValidCalendarDay('2028-02-29')).toBe(true);  // leap year
    expect(isValidCalendarDay('2026-10-24')).toBe(true);
  });
});

const { toMinor, fromMinor, getCurrencyScale, CURRENCY_SCALE } = require('../src/utils/money');

describe('money utility (PB-39)', () => {
  test('MON-01 toMinor converts ILS amounts exactly: 0, 0.01, 0.1, 0.29, 19.99, 1234567.89', () => {
    expect(toMinor(0, 'ILS')).toBe(0);
    expect(toMinor(0.01, 'ILS')).toBe(1);
    expect(toMinor(0.1, 'ILS')).toBe(10);
    expect(toMinor(0.29, 'ILS')).toBe(29);
    expect(toMinor(19.99, 'ILS')).toBe(1999);
    expect(toMinor(1234567.89, 'ILS')).toBe(123456789);
  });

  test('MON-02 toMinor converts 12.345 JOD to 12345', () => {
    expect(toMinor(12.345, 'JOD')).toBe(12345);
  });

  test('MON-03 toMinor throws on too many decimals: 19.999 ILS, 1.005 ILS', () => {
    expect(() => toMinor(19.999, 'ILS')).toThrow();
    expect(() => toMinor(1.005, 'ILS')).toThrow();
  });

  test("MON-04 toMinor throws on an unsupported currency: 'EUR', undefined", () => {
    expect(() => toMinor(100, 'EUR')).toThrow();
    expect(() => toMinor(100, undefined)).toThrow();
  });

  test("MON-05 toMinor throws on a non-finite or non-number amount: NaN, Infinity, '10'", () => {
    expect(() => toMinor(NaN, 'ILS')).toThrow();
    expect(() => toMinor(Infinity, 'ILS')).toThrow();
    expect(() => toMinor('10', 'ILS')).toThrow();
  });

  test('MON-06 fromMinor converts exactly: 1999 ILS, 123456789 ILS, 12345 JOD', () => {
    expect(fromMinor(1999, 'ILS')).toBe(19.99);
    expect(fromMinor(123456789, 'ILS')).toBe(1234567.89);
    expect(fromMinor(12345, 'JOD')).toBe(12.345);
  });

  test('MON-07 toMinor then fromMinor returns every MON-01 value', () => {
    const amounts = [0, 0.01, 0.1, 0.29, 19.99, 1234567.89];
    for (const amt of amounts) {
      expect(fromMinor(toMinor(amt, 'ILS'), 'ILS')).toBe(amt);
    }
  });

  test('MON-08 fromMinor returns null for null and undefined', () => {
    expect(fromMinor(null, 'ILS')).toBeNull();
    expect(fromMinor(undefined, 'ILS')).toBeNull();
  });

  test('MON-09 fromMinor throws on a non-integer: 19.5', () => {
    expect(() => fromMinor(19.5, 'ILS')).toThrow();
  });

  test('MON-10 getCurrencyScale returns 2 for ILS and USD and 3 for JOD', () => {
    expect(getCurrencyScale('ILS')).toBe(2);
    expect(getCurrencyScale('USD')).toBe(2);
    expect(getCurrencyScale('JOD')).toBe(3);
    expect(CURRENCY_SCALE).toEqual({ ILS: 2, USD: 2, JOD: 3 });
  });
});

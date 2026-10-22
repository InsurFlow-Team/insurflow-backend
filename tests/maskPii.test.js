const { maskIdNumber, maskPhone } = require('../src/utils/maskPii');

describe('maskPii utility (PB-02b)', () => {
  it('maskIdNumber keeps the last 4 characters', () => {
    expect(maskIdNumber('000123456')).toBe('*****3456');
    expect(maskIdNumber('123456789')).toBe('*****6789');
    expect(maskIdNumber('A1234567')).toBe('****4567');
    expect(maskIdNumber('1234')).toBe('1234');
    expect(maskIdNumber('123')).toBe('123');
  });

  it('maskPhone keeps the last 3 digits and the plus sign', () => {
    expect(maskPhone('+970599123456')).toBe('+*********456');
    expect(maskPhone('+111111111')).toBe('+******111');
    expect(maskPhone('0599123456')).toBe('*******456');
    expect(maskPhone('+123')).toBe('+123');
    expect(maskPhone('123')).toBe('123');
  });

  it('mask functions return null for null and undefined', () => {
    expect(maskIdNumber(null)).toBeNull();
    expect(maskIdNumber(undefined)).toBeNull();
    expect(maskIdNumber('')).toBeNull();
    expect(maskIdNumber('   ')).toBeNull();
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone(undefined)).toBeNull();
    expect(maskPhone('')).toBeNull();
    expect(maskPhone('   ')).toBeNull();
  });
});

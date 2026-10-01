const maskPlateNumber = require('../src/utils/maskPlateNumber');

describe('maskPlateNumber utility (B1)', () => {
  it('masks plate with dash: keeps prefix up to last dash, replaces rest with x except last character', () => {
    expect(maskPlateNumber('ABC-1234')).toBe('ABC-xxx4');
    expect(maskPlateNumber('12-345678')).toBe('12-xxxxx8');
  });

  it('masks plate without dash: keeps last two characters and replaces rest with x', () => {
    expect(maskPlateNumber('ABC1234')).toBe('xxxxx34');
  });

  it('masks plate without dash of two characters or fewer to all x', () => {
    expect(maskPlateNumber('AB')).toBe('xx');
    expect(maskPlateNumber('A')).toBe('x');
  });

  it('handles edge cases with dash: A-1 gives A-1, ABC- gives ABC-', () => {
    expect(maskPlateNumber('A-1')).toBe('A-1');
    expect(maskPlateNumber('ABC-')).toBe('ABC-');
  });

  it('returns null for empty, null, undefined, or non-string input', () => {
    expect(maskPlateNumber('')).toBeNull();
    expect(maskPlateNumber(null)).toBeNull();
    expect(maskPlateNumber(undefined)).toBeNull();
    expect(maskPlateNumber('   ')).toBeNull();
  });

  it('applies the same masking rules to Arabic-letter plates', () => {
    expect(maskPlateNumber('فلسطين-1234')).toBe('فلسطين-xxx4');
    expect(maskPlateNumber('رام-الله-5678')).toBe('رام-الله-xxx8');
    expect(maskPlateNumber('فلسطين1234')).toBe('xxxxxxxx34');
    expect(maskPlateNumber('قد')).toBe('xx');
    expect(maskPlateNumber('ط-9')).toBe('ط-9');
  });
});

/**
 * Reserved fake identity generators for PB-03.
 * B4, R6, C8:
 * - PALESTINIAN_ID starts with '000' and has exactly 9 digits.
 * - Phone starts with '+97050000' and has 4 digits. Throws if sequence > 9999.
 */

const generateFakePalestinianId = (sequence) => {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 999999) {
    throw new Error(`Sequence out of range for fake Palestinian ID: ${sequence}`);
  }
  const seqPadded = String(sequence).padStart(6, '0');
  return `000${seqPadded}`;
};

const generateFakePhone = (sequence) => {
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error(`Sequence must be a non-negative integer for fake phone: ${sequence}`);
  }
  if (sequence > 9999) {
    throw new Error(`Fake phone sequence exhausted (max 9999): ${sequence}`);
  }
  const seqPadded = String(sequence).padStart(4, '0');
  return `+97050000${seqPadded}`;
};

module.exports = {
  generateFakePalestinianId,
  generateFakePhone,
};

const Letter = require('./letter.model');

/**
 * Creates a new immutable letter record.
 */
const create = async (letterData) => {
  const letter = new Letter(letterData);
  return await letter.save();
};

/**
 * Finds all letters for a given claim within an organization, ordered newest first.
 */
const findByClaim = async (organizationId, claimId) => {
  return await Letter.find({ organizationId, claimId })
    .sort({ issuedAt: -1 })
    .lean();
};

/**
 * Finds a specific letter by organization, claim, and letter number.
 */
const findByNumber = async (organizationId, claimId, letterNumber) => {
  return await Letter.findOne({ organizationId, claimId, letterNumber }).lean();
};

/**
 * Checks if a given letter has already been superseded.
 */
const isSuperseded = async (organizationId, letterId) => {
  const existing = await Letter.exists({ organizationId, supersedesLetterId: letterId });
  return !!existing;
};

module.exports = {
  create,
  findByClaim,
  findByNumber,
  isSuperseded,
};

/**
 * Deterministic pseudo-random number generator for PB-03.
 * Mulberry32 implementation provides reproducible names, plates, amounts, and dates.
 */

const createPrng = (seed = 0x5a1711) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const createRandomHelpers = (rnd) => ({
  int: (min, max) => Math.floor(rnd() * (max - min + 1)) + min,
  pick: (arr) => arr[Math.floor(rnd() * arr.length)],
  shuffle: (arr) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  },
  boolean: (chance = 0.5) => rnd() < chance,
});

module.exports = {
  createPrng,
  createRandomHelpers,
};

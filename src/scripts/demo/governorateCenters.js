const { GOVERNORATES } = require('../../utils/governorates');

const governorateCenters = Object.freeze({
  JENIN: Object.freeze({ latitude: 32.4610, longitude: 35.2950 }),
  TUBAS: Object.freeze({ latitude: 32.3209, longitude: 35.3699 }),
  TULKARM: Object.freeze({ latitude: 32.3104, longitude: 35.0286 }),
  NABLUS: Object.freeze({ latitude: 32.2211, longitude: 35.2544 }),
  QALQILYA: Object.freeze({ latitude: 32.1897, longitude: 34.9706 }),
  SALFIT: Object.freeze({ latitude: 32.0850, longitude: 35.1800 }),
  RAMALLAH_AL_BIREH: Object.freeze({ latitude: 31.9038, longitude: 35.2034 }),
  JERICHO: Object.freeze({ latitude: 31.8569, longitude: 35.4615 }),
  JERUSALEM: Object.freeze({ latitude: 31.7767, longitude: 35.2345 }),
  BETHLEHEM: Object.freeze({ latitude: 31.7054, longitude: 35.2024 }),
  HEBRON: Object.freeze({ latitude: 31.5326, longitude: 35.0998 }),
  NORTH_GAZA: Object.freeze({ latitude: 31.5280, longitude: 34.4830 }),
  GAZA: Object.freeze({ latitude: 31.5017, longitude: 34.4668 }),
  DEIR_AL_BALAH: Object.freeze({ latitude: 31.4180, longitude: 34.3500 }),
  KHAN_YUNIS: Object.freeze({ latitude: 31.3460, longitude: 34.3060 }),
  RAFAH: Object.freeze({ latitude: 31.2969, longitude: 34.2455 }),
});

/**
 * Returns deterministic mock coordinates for a given governorate and index.
 *
 * @param {string} governorate - One of the valid Palestinian governorates
 * @param {number} [index=0] - Running index for deterministic offset
 * @returns {{ latitude: number, longitude: number }}
 */
const demoCoordinatesFor = (governorate, index = 0) => {
  const center = governorateCenters[governorate];
  if (!center) {
    throw new Error(`Unknown governorate: ${governorate}`);
  }

  const latOffset = (index % 10) * 0.002;
  const lonOffset = Math.floor(index / 10) * 0.002;

  const latitude = Number((center.latitude + latOffset).toFixed(6));
  const longitude = Number((center.longitude + lonOffset).toFixed(6));

  return { latitude, longitude };
};

module.exports = {
  governorateCenters,
  demoCoordinatesFor,
};

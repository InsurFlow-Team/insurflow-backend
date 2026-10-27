const pdfMake = require('pdfmake-rtl');
const robotoFonts = require('pdfmake-rtl/fonts/Roboto');
const cairoFonts = require('pdfmake-rtl/fonts/Cairo');
const { buildLetterDocDefinition, buildDischargeDocDefinition } = require('./letter.templates');

// Register fonts
pdfMake.addFonts(robotoFonts);
pdfMake.addFonts(cairoFonts);

if (typeof pdfMake.setUrlAccessPolicy === 'function') {
  pdfMake.setUrlAccessPolicy(() => false);
}
if (typeof pdfMake.setLocalAccessPolicy === 'function') {
  pdfMake.setLocalAccessPolicy(() => true);
}

/**
 * Generates an in-memory PDF buffer from a frozen letter snapshot.
 *
 * @param {object} snapshot - The frozen letter snapshot.
 * @returns {Promise<Buffer>} - The compiled PDF buffer.
 */
const generateLetterPdf = async (snapshot) => {
  const docDefinition = buildLetterDocDefinition(snapshot);
  const doc = pdfMake.createPdf(docDefinition);
  return await doc.getBuffer();
};

/**
 * Generates an in-memory PDF buffer from a frozen discharge snapshot.
 *
 * @param {object} snapshot - The frozen discharge snapshot.
 * @returns {Promise<Buffer>} - The compiled PDF buffer.
 */
const generateDischargePdf = async (snapshot) => {
  const docDefinition = buildDischargeDocDefinition(snapshot);
  const doc = pdfMake.createPdf(docDefinition);
  return await doc.getBuffer();
};

module.exports = {
  generateLetterPdf,
  generateDischargePdf,
};

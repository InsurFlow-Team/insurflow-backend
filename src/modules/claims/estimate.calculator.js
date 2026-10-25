const { toMinor, fromMinor } = require('../../utils/money');

/**
 * Pure calculation module for claim estimates in integer minor units.
 *
 * @param {Array<object>} lines - Array of validated estimate lines (unitPrice in major units)
 * @param {boolean} vatApplied - Whether VAT applies to repairSubtotal
 * @param {number} vatRatePercent - VAT percentage (e.g. 16)
 * @param {string} currency - Currency code (e.g. 'ILS')
 * @returns {object} Calculated lines, totals, and decision-mapped values in integer minor units
 */
const calculateEstimate = (lines, vatApplied, vatRatePercent, currency) => {
  let partsNet = 0;
  let labor = 0;
  let paint = 0;
  let surveyorFee = 0;
  let towing = 0;

  const calculatedLines = lines.map((line) => {
    const unitPriceMinor = toMinor(line.unitPrice, currency);
    const gross = Math.round(line.quantity * unitPriceMinor);
    let depreciation = 0;
    let net = gross;

    if (line.lineType === 'PART') {
      const depRate = line.depreciationPercent || 0;
      depreciation = Math.round((gross * depRate) / 100);
      net = gross - depreciation;
      partsNet += net;
    } else if (line.lineType === 'LABOR') {
      labor += net;
    } else if (line.lineType === 'PAINT') {
      paint += net;
    } else if (line.lineType === 'SURVEYOR_FEE') {
      surveyorFee += net;
    } else if (line.lineType === 'TOWING') {
      towing += net;
    }

    return {
      lineType: line.lineType,
      description: line.description,
      quantity: line.quantity,
      unitPrice: unitPriceMinor,
      partCondition: line.partCondition || null,
      depreciationPercent: line.depreciationPercent || 0,
      gross,
      depreciation,
      net,
    };
  });

  const repairSubtotal = partsNet + labor + paint;
  const vat = vatApplied ? Math.round((repairSubtotal * vatRatePercent) / 100) : 0;
  const repairTotal = repairSubtotal + vat;
  const expenses = surveyorFee + towing;

  const mapped = {
    estimatedPartsCost: partsNet + paint + vat,
    laborCost: labor,
  };

  return {
    lines: calculatedLines,
    totals: {
      partsNet,
      labor,
      paint,
      surveyorFee,
      towing,
      repairSubtotal,
      vat,
      repairTotal,
      expenses,
    },
    mapped,
  };
};

/**
 * Formats a stored estimate (with minor integer amounts) into major currency units.
 *
 * @param {object} estimate - Stored estimate document or plain object
 * @param {string} currency - Currency code (e.g. 'ILS')
 * @returns {object} Formatted estimate in major units
 */
const formatEstimate = (estimate, currency) => {
  if (!estimate) return null;

  const formatLine = (line) => ({
    lineType: line.lineType,
    description: line.description,
    quantity: line.quantity,
    unitPrice: fromMinor(line.unitPrice, currency),
    partCondition: line.partCondition || null,
    depreciationPercent: line.depreciationPercent || 0,
    gross: fromMinor(line.gross, currency),
    depreciation: fromMinor(line.depreciation, currency),
    net: fromMinor(line.net, currency),
  });

  const totals = estimate.totals || {};
  const mapped = estimate.mapped || {};

  return {
    version: estimate.version,
    source: estimate.source,
    garageId: estimate.garageId ? estimate.garageId.toString() : null,
    vatApplied: estimate.vatApplied,
    vatRatePercent: estimate.vatRatePercent,
    lines: (estimate.lines || []).map(formatLine),
    totals: {
      partsNet: fromMinor(totals.partsNet, currency),
      labor: fromMinor(totals.labor, currency),
      paint: fromMinor(totals.paint, currency),
      surveyorFee: fromMinor(totals.surveyorFee, currency),
      towing: fromMinor(totals.towing, currency),
      repairSubtotal: fromMinor(totals.repairSubtotal, currency),
      vat: fromMinor(totals.vat, currency),
      repairTotal: fromMinor(totals.repairTotal, currency),
      expenses: fromMinor(totals.expenses, currency),
    },
    mapped: {
      estimatedPartsCost: fromMinor(mapped.estimatedPartsCost, currency),
      laborCost: fromMinor(mapped.laborCost, currency),
    },
    createdBy: estimate.createdBy,
    createdByRole: estimate.createdByRole,
    createdAt: estimate.createdAt,
  };
};

module.exports = {
  calculateEstimate,
  formatEstimate,
};

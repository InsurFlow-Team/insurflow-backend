const {
  calculateEstimate,
  formatEstimate,
} = require('../src/modules/claims/estimate.calculator');

describe('Estimate Calculator', () => {
  // ─── CALC-01 ─────────────────────────────────────────────────────────────
  it('CALC-01: reproduces the worked example totals and mapped values exactly', () => {
    const lines = [
      {
        lineType: 'PART',
        description: 'New original front bumper',
        quantity: 1,
        unitPrice: 1200.0,
        partCondition: 'NEW_ORIGINAL',
        depreciationPercent: 10,
      },
      {
        lineType: 'PART',
        description: 'Used headlight unit',
        quantity: 2,
        unitPrice: 150.0,
        partCondition: 'USED',
        depreciationPercent: 0,
      },
      {
        lineType: 'LABOR',
        description: 'Panel repair and alignment',
        quantity: 6.5,
        unitPrice: 80.0,
      },
      {
        lineType: 'PAINT',
        description: 'Bumper repaint and clear coat',
        quantity: 1,
        unitPrice: 400.0,
      },
      {
        lineType: 'SURVEYOR_FEE',
        description: 'Field inspection fee',
        quantity: 1,
        unitPrice: 250.0,
      },
      {
        lineType: 'TOWING',
        description: 'Accident scene towing',
        quantity: 1,
        unitPrice: 150.0,
      },
    ];

    const vatApplied = true;
    const vatRatePercent = 16;
    const currency = 'ILS';

    const calculated = calculateEstimate(lines, vatApplied, vatRatePercent, currency);

    // Stored minor units verification
    expect(calculated.totals).toEqual({
      partsNet: 138000,
      labor: 52000,
      paint: 40000,
      surveyorFee: 25000,
      towing: 15000,
      repairSubtotal: 230000,
      vat: 36800,
      repairTotal: 266800,
      expenses: 40000,
    });

    expect(calculated.mapped).toEqual({
      estimatedPartsCost: 214800,
      laborCost: 52000,
    });

    // Formatted major units verification
    const formatted = formatEstimate(
      {
        version: 1,
        source: 'SURVEYOR',
        vatApplied,
        vatRatePercent,
        lines: calculated.lines,
        totals: calculated.totals,
        mapped: calculated.mapped,
        createdBy: 'user123',
        createdByRole: 'FIELD_ADJUSTER',
        createdAt: new Date(),
      },
      currency
    );

    expect(formatted.totals).toEqual({
      partsNet: 1380.0,
      labor: 520.0,
      paint: 400.0,
      surveyorFee: 250.0,
      towing: 150.0,
      repairSubtotal: 2300.0,
      vat: 368.0,
      repairTotal: 2668.0,
      expenses: 400.0,
    });

    expect(formatted.mapped).toEqual({
      estimatedPartsCost: 2148.0,
      laborCost: 520.0,
    });
  });

  // ─── CALC-02 ─────────────────────────────────────────────────────────────
  it('CALC-02: rounds depreciation and VAT half up on odd minor amounts', () => {
    // 10.05 ILS = 1005 minor. 1005 * 15% = 150.75 -> 151 minor depreciation. Net = 854.
    // 10.01 ILS = 1001 minor. Labor = 1001 minor.
    // Repair subtotal = 854 + 1001 = 1855 minor.
    // VAT = 1855 * 16% = 296.8 -> 297 minor VAT.
    const lines = [
      {
        lineType: 'PART',
        description: 'Quarter panel',
        quantity: 1,
        unitPrice: 10.05,
        partCondition: 'NEW_ORIGINAL',
        depreciationPercent: 15,
      },
      {
        lineType: 'LABOR',
        description: 'Dent removal',
        quantity: 1,
        unitPrice: 10.01,
      },
    ];

    const calculated = calculateEstimate(lines, true, 16, 'ILS');

    expect(calculated.lines[0].gross).toBe(1005);
    expect(calculated.lines[0].depreciation).toBe(151);
    expect(calculated.lines[0].net).toBe(854);

    expect(calculated.lines[1].gross).toBe(1001);
    expect(calculated.lines[1].depreciation).toBe(0);
    expect(calculated.lines[1].net).toBe(1001);

    expect(calculated.totals.repairSubtotal).toBe(1855);
    expect(calculated.totals.vat).toBe(297);
    expect(calculated.totals.repairTotal).toBe(2152);
  });

  // ─── CALC-03 ─────────────────────────────────────────────────────────────
  it('CALC-03: sets vat to 0 and keeps the subtotal when vatApplied is false', () => {
    const lines = [
      {
        lineType: 'PART',
        description: 'Fender',
        quantity: 1,
        unitPrice: 500.0,
        partCondition: 'NEW_ORIGINAL',
        depreciationPercent: 10,
      },
      {
        lineType: 'LABOR',
        description: 'Fitting',
        quantity: 2,
        unitPrice: 100.0,
      },
    ];

    const calculated = calculateEstimate(lines, false, 16, 'ILS');

    // 500.00 -> 50000. 10% dep = 5000. Net = 45000.
    // Labor = 2 * 100.00 = 20000.
    // Subtotal = 65000.
    // vatApplied = false -> vat = 0, repairTotal = 65000.
    expect(calculated.totals.repairSubtotal).toBe(65000);
    expect(calculated.totals.vat).toBe(0);
    expect(calculated.totals.repairTotal).toBe(65000);
    expect(calculated.mapped.estimatedPartsCost).toBe(45000);
    expect(calculated.mapped.laborCost).toBe(20000);
  });
});

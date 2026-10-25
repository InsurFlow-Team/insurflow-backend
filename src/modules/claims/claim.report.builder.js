const pdfMake = require('pdfmake');
const robotoFonts = require('pdfmake/fonts/Roboto');
const config = require('../../config/env');
const { fromMinor, getCurrencyScale } = require('../../utils/money');

// Register fonts and security access policies once
pdfMake.addFonts(robotoFonts);
pdfMake.setUrlAccessPolicy(() => false); // pdfmake never fetches external URLs on its own
pdfMake.setLocalAccessPolicy(() => true); // allows loading the bundled Roboto TTF files

const formatDate = (date) => {
  if (!date) return 'N/A';
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  } catch {
    return 'N/A';
  }
};

/**
 * Fetches an image from a URL, applying Cloudinary dynamic resizing if applicable,
 * and converts it to a base64 Data URI for embedding into pdfmake.
 * Catches errors per-image and returns null on failure to enable graceful degradation.
 */
const fetchImageAsDataUri = async (rawUrl, label) => {
  if (!rawUrl) return null;
  try {
    let fetchUrl = rawUrl;
    if (typeof fetchUrl === 'string' && fetchUrl.includes('/upload/') && !fetchUrl.includes('/upload/w_800')) {
      fetchUrl = fetchUrl.replace('/upload/', '/upload/w_800,c_limit,q_auto:good,f_jpg/');
    }

    const response = await fetch(fetchUrl, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(`[Warning] Failed to fetch image (${label}): HTTP ${response.status} from ${fetchUrl}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const mimeType = contentType.split(';')[0].trim();
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (err) {
    console.warn(`[Warning] Failed to fetch image (${label}): ${err.message}`);
    return null;
  }
};

/**
 * Creates a stylized placeholder block when an image fails to load.
 */
const createPlaceholderBox = (label) => ({
  table: {
    widths: ['*'],
    body: [
      [
        {
          text: `[Image unavailable: ${label} — Failed to retrieve remote asset]`,
          alignment: 'center',
          margin: [8, 16, 8, 16],
          fillColor: '#f9fafb',
          color: '#6b7280',
          fontSize: 9,
          italics: true,
        },
      ],
    ],
  },
  layout: {
    hLineWidth: () => 1,
    vLineWidth: () => 1,
    hLineColor: () => '#d1d5db',
    vLineColor: () => '#d1d5db',
  },
  margin: [0, 4, 0, 8],
});

/**
 * Builds the pdfmake document definition for the Final Claim Report.
 */
const buildClaimReportDocDefinition = async ({ claim, organization, vehicle, policy }) => {
  const generatedAt = formatDate(new Date());

  // Resolve Decider from Timeline or fields
  let deciderName = 'N/A';
  let deciderEmployeeCode = '';
  let decidedAt = null;
  let decisionNotes = claim.decisionNotes || null;

  if (Array.isArray(claim.timeline)) {
    const decisionEvent = [...claim.timeline].reverse().find(
      (e) =>
        e.newStatus === 'APPROVED' ||
        e.newStatus === 'REJECTED' ||
        e.action === 'Claim Approved' ||
        e.action === 'Claim Rejected'
    );
    if (decisionEvent) {
      if (decisionEvent.performedBy) {
        deciderName = decisionEvent.performedBy.name || deciderName;
        deciderEmployeeCode = decisionEvent.performedBy.employeeCode || '';
      }
      decidedAt = decisionEvent.timestamp;
      if (!decisionNotes && decisionEvent.notes) {
        decisionNotes = decisionEvent.notes;
      }
    }
  }

  // Resolve Closer if claim is CLOSED
  let closerName = 'N/A';
  let closerEmployeeCode = '';
  let closedAt = claim.closedAt || null;
  let closingNotes = claim.closingNotes || null;

  if (claim.status === 'CLOSED') {
    if (claim.closedBy) {
      closerName = claim.closedBy.name || closerName;
      closerEmployeeCode = claim.closedBy.employeeCode || '';
    } else if (Array.isArray(claim.timeline)) {
      const closeEvent = [...claim.timeline].reverse().find(
        (e) => e.action === 'Claim Closed' || e.newStatus === 'CLOSED'
      );
      if (closeEvent) {
        if (closeEvent.performedBy) {
          closerName = closeEvent.performedBy.name || closerName;
          closerEmployeeCode = closeEvent.performedBy.employeeCode || '';
        }
        closedAt = closedAt || closeEvent.timestamp;
        closingNotes = closingNotes || closeEvent.notes;
      }
    }
  }

  // ── 1. Fetch Images (Evidence & Signature) Concurrently ─────────────
  const evidencePromises = (claim.evidence || []).map(async (item) => {
    const dataUri = await fetchImageAsDataUri(item.url, item.imageType);
    return {
      imageType: item.imageType,
      uploadedBy: item.uploadedBy?.name || 'Adjuster',
      uploadedAt: formatDate(item.uploadedAt),
      dataUri,
    };
  });

  const signaturePromise = claim.signature?.url
    ? fetchImageAsDataUri(claim.signature.url, 'Signature')
    : Promise.resolve(null);

  const [evidenceImages, signatureDataUri] = await Promise.all([
    Promise.all(evidencePromises),
    signaturePromise,
  ]);

  // ── 2. Construct Evidence Photo Blocks ─────────────────────────────
  const evidenceBlocks = [];
  if (evidenceImages.length === 0) {
    evidenceBlocks.push({
      text: 'No evidence photos on record.',
      italics: true,
      color: '#6b7280',
      margin: [0, 4, 0, 10],
    });
  } else {
    // Lay out evidence in a 2-column format
    const rows = [];
    for (let i = 0; i < evidenceImages.length; i += 2) {
      const col1 = evidenceImages[i];
      const col2 = evidenceImages[i + 1] || null;

      const buildCell = (img) => {
        if (!img) return { text: '' };
        const content = [
          { text: img.imageType, bold: true, fontSize: 9, color: '#1e3a8a', margin: [0, 0, 0, 2] },
          { text: `Uploaded by: ${img.uploadedBy} • ${img.uploadedAt}`, fontSize: 8, color: '#6b7280', margin: [0, 0, 0, 4] },
        ];

        if (img.dataUri) {
          content.push({ image: img.dataUri, width: 230, alignment: 'center' });
        } else {
          content.push(createPlaceholderBox(img.imageType));
        }

        return {
          stack: content,
          margin: [4, 4, 4, 8],
        };
      };

      rows.push([buildCell(col1), buildCell(col2)]);
    }

    evidenceBlocks.push({
      table: {
        widths: ['50%', '50%'],
        body: rows,
      },
      layout: 'noBorders',
      margin: [0, 4, 0, 10],
    });
  }

  // ── 3. Construct Signature Block ───────────────────────────────────
  const signatureBlocks = [];
  if (!claim.signature || !claim.signature.url) {
    signatureBlocks.push({
      text: 'No digital signature captured on record.',
      italics: true,
      color: '#6b7280',
      margin: [0, 4, 0, 10],
    });
  } else {
    const sigCapturedBy = claim.signature.capturedBy?.name || 'Adjuster';
    const sigRole = claim.signature.capturedBy?.role || 'FIELD_ADJUSTER';
    const sigCapturedAt = formatDate(claim.signature.capturedAt);

    if (signatureDataUri) {
      signatureBlocks.push({
        image: signatureDataUri,
        width: 180,
        margin: [0, 4, 0, 4],
      });
    } else {
      signatureBlocks.push(createPlaceholderBox('Signature'));
    }

    signatureBlocks.push({
      text: `Captured by: ${sigCapturedBy} (${sigRole}) on ${sigCapturedAt}`,
      fontSize: 8,
      color: '#4b5563',
      margin: [0, 2, 0, 10],
    });
  }

  // ── 4. Construct Audit Trail Rows ──────────────────────────────────
  const timelineRows = [
    [
      { text: 'Timestamp', bold: true, fillColor: '#1e3a8a', color: '#ffffff', fontSize: 8 },
      { text: 'Action', bold: true, fillColor: '#1e3a8a', color: '#ffffff', fontSize: 8 },
      { text: 'Performer', bold: true, fillColor: '#1e3a8a', color: '#ffffff', fontSize: 8 },
      { text: 'Transition', bold: true, fillColor: '#1e3a8a', color: '#ffffff', fontSize: 8 },
      { text: 'Notes', bold: true, fillColor: '#1e3a8a', color: '#ffffff', fontSize: 8 },
    ],
  ];

  if (Array.isArray(claim.timeline) && claim.timeline.length > 0) {
    claim.timeline.forEach((event, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      const performer = event.performedBy?.name
        ? `${event.performedBy.name} (${event.role || ''})`
        : `User (${event.role || ''})`;
      const transition = event.previousStatus || event.newStatus
        ? `${event.previousStatus || '-'} → ${event.newStatus || '-'}`
        : '-';

      timelineRows.push([
        { text: formatDate(event.timestamp), fontSize: 8, fillColor: bg },
        { text: event.action || '-', fontSize: 8, fillColor: bg, bold: true },
        { text: performer, fontSize: 8, fillColor: bg },
        { text: transition, fontSize: 8, fillColor: bg },
        { text: event.notes || '-', fontSize: 8, fillColor: bg },
      ]);
    });
  } else {
    timelineRows.push([
      { text: 'No timeline events recorded.', colSpan: 5, italics: true, color: '#6b7280', fontSize: 8 },
      {}, {}, {}, {},
    ]);
  }

  // ── 5. Status Badge Color ──────────────────────────────────────────
  let statusColor = '#2563eb';
  if (claim.status === 'APPROVED') statusColor = '#16a34a';
  if (claim.status === 'REJECTED') statusColor = '#dc2626';
  if (claim.status === 'CLOSED') statusColor = '#475569';

  // ── 6. Assemble Full Document Definition ───────────────────────────
  const content = [
    // ── 1. Header ──
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: organization?.name || 'InsurFlow Insurance', fontSize: 16, bold: true, color: '#1e3a8a' },
            { text: `Org Code: ${organization?.code || 'N/A'}`, fontSize: 9, color: '#6b7280', margin: [0, 2, 0, 0] },
            { text: 'FINAL CLAIM REPORT', fontSize: 14, bold: true, color: '#0f172a', margin: [0, 6, 0, 0] },
          ],
        },
        {
          width: 'auto',
          stack: [
            { text: `Claim #: ${claim.claimNumber || 'N/A'}`, bold: true, fontSize: 11, alignment: 'right' },
            {
              text: claim.status,
              bold: true,
              fontSize: 10,
              color: statusColor,
              alignment: 'right',
              margin: [0, 2, 0, 0],
            },
            { text: `Generated: ${generatedAt}`, fontSize: 8, color: '#6b7280', alignment: 'right', margin: [0, 4, 0, 0] },
          ],
        },
      ],
    },
    { canvas: [{ type: 'line', x1: 0, y1: 8, x2: 515, y2: 8, lineWidth: 1.5, lineColor: '#1e3a8a' }], margin: [0, 0, 0, 12] },

    // ── 2. Customer Info ──
    { text: '1. Customer Information', style: 'sectionHeader' },
    {
      table: {
        widths: ['25%', '75%'],
        body: [
          [{ text: 'Customer Name', bold: true, style: 'labelCell' }, { text: claim.customer?.name || 'N/A', style: 'valueCell' }],
          [{ text: 'Phone Number', bold: true, style: 'labelCell' }, { text: claim.customer?.phone || 'N/A', style: 'valueCell' }],
          [{ text: 'Incident Location', bold: true, style: 'labelCell' }, { text: claim.incidentLocation || 'N/A', style: 'valueCell' }],
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 4, 0, 12],
    },

    // ── 3. Vehicle & Policy Info (Hydrated) ──
    { text: '2. Vehicle & Policy Details', style: 'sectionHeader' },
    {
      table: {
        widths: ['25%', '25%', '25%', '25%'],
        body: [
          [
            { text: 'Plate Number', bold: true, style: 'labelCell' },
            { text: vehicle?.plateNumber || claim.vehicle?.plateNumber || 'N/A', style: 'valueCell' },
            { text: 'Policy Number', bold: true, style: 'labelCell' },
            { text: policy?.policyNumber || 'N/A', style: 'valueCell' },
          ],
          [
            { text: 'Make / Model', bold: true, style: 'labelCell' },
            { text: `${vehicle?.make || 'N/A'} ${vehicle?.model || ''}`.trim(), style: 'valueCell' },
            { text: 'Policy Status', bold: true, style: 'labelCell' },
            { text: policy?.status || 'N/A', style: 'valueCell' },
          ],
          [
            { text: 'Year / Color', bold: true, style: 'labelCell' },
            { text: `${vehicle?.year || 'N/A'} / ${vehicle?.color || 'N/A'}`, style: 'valueCell' },
            { text: 'Policy Coverage', bold: true, style: 'labelCell' },
            { text: policy?.startDate && policy?.expiryDate ? `${formatDate(policy.startDate)} to ${formatDate(policy.expiryDate)}` : 'N/A', style: 'valueCell' },
          ],
          ...(claim.coverageSnapshot?.policyType
            ? [
                [
                  { text: 'Coverage at Intake', bold: true, style: 'labelCell' },
                  { text: claim.coverageSnapshot.policyType === 'COMPREHENSIVE' ? 'Comprehensive (شامل)' : 'Third-Party (ضد الغير)', style: 'valueCell' },
                  { text: 'Intake Deductible', bold: true, style: 'labelCell' },
                  { text: claim.coverageSnapshot.deductibleAmount !== null && claim.coverageSnapshot.deductibleAmount !== undefined ? `${fromMinor(claim.coverageSnapshot.deductibleAmount, config.currency)}` : 'N/A', style: 'valueCell' },
                ],
              ]
            : []),
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 4, 0, 12],
    },

    // ── 4. Accident Details ──
    { text: '3. Accident Details', style: 'sectionHeader' },
    {
      table: {
        widths: ['25%', '75%'],
        body: [
          [{ text: 'Accident Type', bold: true, style: 'labelCell' }, { text: claim.accident?.accidentType || claim.incidentType || 'N/A', style: 'valueCell' }],
          [{ text: 'Date & Time', bold: true, style: 'labelCell' }, { text: `${claim.accident?.accidentDate || 'N/A'} at ${claim.accident?.accidentTime || 'N/A'}`, style: 'valueCell' }],
          [{ text: 'Description', bold: true, style: 'labelCell' }, { text: claim.accident?.description || 'N/A', style: 'valueCell' }],
          [{ text: 'Damage Description', bold: true, style: 'labelCell' }, { text: claim.accident?.damageDescription || 'N/A', style: 'valueCell' }],
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 4, 0, 12],
    },

    // ── 5. Location ──
    { text: '4. Location & GPS Coordinates', style: 'sectionHeader' },
    {
      table: {
        widths: ['25%', '75%'],
        body: [
          [{ text: 'Address', bold: true, style: 'labelCell' }, { text: claim.location?.address || claim.incidentLocation || 'N/A', style: 'valueCell' }],
          [
            { text: 'GPS Coordinates', bold: true, style: 'labelCell' },
            {
              text: claim.location?.latitude != null && claim.location?.longitude != null
                ? `${claim.location.latitude}, ${claim.location.longitude}`
                : 'N/A',
              style: 'valueCell',
            },
          ],
          [{ text: 'Captured At', bold: true, style: 'labelCell' }, { text: formatDate(claim.location?.capturedAt), style: 'valueCell' }],
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 4, 0, 12],
    },

    // ── 6. Evidence Photos ──
    { text: '5. Evidence Photos', style: 'sectionHeader' },
    ...evidenceBlocks,

    // ── 7. Digital Signature ──
    { text: '6. Digital Signature', style: 'sectionHeader' },
    ...signatureBlocks,

    // ── 8. Decision Outcome Block ──
    { text: '7. Decision Outcome', style: 'sectionHeader' },
    {
      table: {
        widths: ['25%', '75%'],
        body: [
          [{ text: 'Final Decision', bold: true, style: 'labelCell' }, { text: claim.status, bold: true, color: statusColor, style: 'valueCell' }],
          [
            { text: 'Decided By', bold: true, style: 'labelCell' },
            { text: `${deciderName}${deciderEmployeeCode ? ` (${deciderEmployeeCode})` : ''}`, style: 'valueCell' },
          ],
          [{ text: 'Decided At', bold: true, style: 'labelCell' }, { text: formatDate(decidedAt), style: 'valueCell' }],
          [{ text: 'Decision Notes', bold: true, style: 'labelCell' }, { text: decisionNotes || 'None', style: 'valueCell' }],
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 4, 0, 12],
    },
  ];

  // ── 8. Loss Assessment Financial Table (Only if present) ──
  if (claim.lossAssessment) {
    const la = claim.lossAssessment;
    const currency = config.currency;
    const scale = getCurrencyScale(config.currency);
    const formatAmount = (minorVal) => minorVal != null ? fromMinor(minorVal, config.currency).toFixed(scale) : (0).toFixed(scale);
    const assessorName = la.assessedBy?.name || deciderName || 'Claims Officer';
    const assessorCode = la.assessedBy?.employeeCode ? ` (${la.assessedBy.employeeCode})` : '';

    const financialBody = [
      [{ text: 'Estimated Parts Cost', bold: true, style: 'labelCell' }, { text: `${formatAmount(la.estimatedPartsCost)} ${currency}`, style: 'valueCell' }],
      [{ text: 'Labor Cost', bold: true, style: 'labelCell' }, { text: `${formatAmount(la.laborCost)} ${currency}`, style: 'valueCell' }],
      [{ text: 'Total Assessed Damage', bold: true, style: 'labelCell' }, { text: `${formatAmount(la.totalDamage)} ${currency}`, bold: true, style: 'valueCell' }],
      [{ text: 'Policy Deductible', bold: true, style: 'labelCell' }, { text: `${formatAmount(la.policyDeductible)} ${currency}`, style: 'valueCell' }],
      [{ text: 'Deductible Applied', bold: true, style: 'labelCell' }, { text: `${formatAmount(la.deductibleApplied)} ${currency}`, style: 'valueCell' }],
      [{ text: 'Deductible Overridden', bold: true, style: 'labelCell' }, { text: la.deductibleOverridden ? 'Yes' : 'No', style: 'valueCell' }],
    ];

    // Display deductible override justification when override is present
    if (la.deductibleOverrideReason) {
      financialBody.push([
        { text: 'Deductible Override Reason', bold: true, style: 'labelCell' },
        { text: la.deductibleOverrideReason, style: 'valueCell' },
      ]);
    }

    financialBody.push(
      [{ text: 'Net Approved Payout', bold: true, style: 'labelCell' }, { text: `${formatAmount(la.netApprovedPayout)} ${currency}`, bold: true, color: '#16a34a', style: 'valueCell' }],
      [{ text: 'Assessed By', bold: true, style: 'labelCell' }, { text: `${assessorName}${assessorCode}`, style: 'valueCell' }],
      [{ text: 'Assessed At', bold: true, style: 'labelCell' }, { text: formatDate(la.assessedAt), style: 'valueCell' }]
    );

    content.push(
      { text: '8. Financial Loss Assessment', style: 'sectionHeader' },
      {
        table: {
          widths: ['35%', '65%'],
          body: financialBody,
        },
        layout: 'lightHorizontalLines',
        margin: [0, 4, 0, 12],
      }
    );
  }

  let nextSectionIndex = claim.lossAssessment ? 9 : 8;

  // ── 9. Closure Block (Only if CLOSED) ──
  if (claim.status === 'CLOSED') {
    content.push(
      { text: `${nextSectionIndex}. Claim Closure`, style: 'sectionHeader' },
      {
        table: {
          widths: ['25%', '75%'],
          body: [
            [
              { text: 'Closed By', bold: true, style: 'labelCell' },
              { text: `${closerName}${closerEmployeeCode ? ` (${closerEmployeeCode})` : ''}`, style: 'valueCell' },
            ],
            [{ text: 'Closed At', bold: true, style: 'labelCell' }, { text: formatDate(closedAt), style: 'valueCell' }],
            [{ text: 'Closing Notes', bold: true, style: 'labelCell' }, { text: closingNotes || 'None', style: 'valueCell' }],
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 4, 0, 12],
      }
    );
    nextSectionIndex++;
  }

  // ── 10. Full Timeline Audit Trail ──
  content.push(
    { text: `${nextSectionIndex}. Timeline Audit Trail`, style: 'sectionHeader' },
    {
      table: {
        headerRows: 1,
        widths: ['18%', '20%', '20%', '17%', '25%'],
        body: timelineRows,
      },
      layout: 'lightHorizontalLines',
      margin: [0, 4, 0, 12],
    }
  );

  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    content,
    styles: {
      sectionHeader: {
        fontSize: 11,
        bold: true,
        color: '#1e3a8a',
        margin: [0, 8, 0, 4],
      },
      labelCell: {
        fontSize: 8.5,
        color: '#374151',
      },
      valueCell: {
        fontSize: 8.5,
        color: '#111827',
      },
    },
    defaultStyle: {
      fontSize: 9,
      color: '#1f2937',
    },
    footer: (currentPage, pageCount) => ({
      text: `InsurFlow Confidential • Page ${currentPage} of ${pageCount}`,
      alignment: 'center',
      fontSize: 7.5,
      color: '#9ca3af',
      margin: [0, 10, 0, 0],
    }),
  };
};

/**
 * Generates an in-memory PDF Buffer for the given claim data.
 */
const generateClaimReportPdf = async ({ claim, organization, vehicle, policy }) => {
  const docDefinition = await buildClaimReportDocDefinition({
    claim,
    organization,
    vehicle,
    policy,
  });

  const doc = pdfMake.createPdf(docDefinition);
  return await doc.getBuffer();
};

module.exports = {
  generateClaimReportPdf,
  buildClaimReportDocDefinition,
  fetchImageAsDataUri,
};

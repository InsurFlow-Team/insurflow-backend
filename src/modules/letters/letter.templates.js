const { fromMinor, getCurrencyScale } = require('../../utils/money');

/**
 * Builds the header block for the letter:
 * Organization name (bold), address (if present), phone (if present),
 * followed by a 2-row table for Letter Number and Issue Date.
 */
const buildHeaderBlock = (letterhead = {}, letterNumber = '', issueDate = '', numberLabel = 'رقم الرسالة') => {
  const elements = [];

  if (letterhead?.organizationName) {
    elements.push({
      text: letterhead.organizationName,
      fontSize: 14,
      bold: true,
      color: '#1e3a8a',
      margin: [0, 0, 0, 4],
    });
  }

  if (letterhead?.address) {
    elements.push({
      text: letterhead.address,
      fontSize: 9,
      color: '#4b5563',
      margin: [0, 0, 0, 2],
    });
  }

  if (letterhead?.phone) {
    elements.push({
      text: letterhead.phone,
      fontSize: 9,
      color: '#4b5563',
      margin: [0, 0, 0, 4],
    });
  }

  elements.push({
    table: {
      widths: ['30%', '70%'],
      body: [
        [
          { text: numberLabel, bold: true, fontSize: 9 },
          { text: letterNumber || '', fontSize: 9 },
        ],
        [
          { text: 'التاريخ', bold: true, fontSize: 9 },
          { text: issueDate || '', fontSize: 9 },
        ],
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 6, 0, 16],
  });

  return elements;
};

/**
 * Shared signature builder (C3)
 */
const buildSignatureElement = (orgName = '') => {
  const orgPart = orgName ? `، ${orgName}` : '';
  return {
    text: `دائرة المطالبات${orgPart}`,
    fontSize: 10.5,
    bold: true,
    alignment: 'left',
    margin: [0, 12, 0, 0],
  };
};

/**
 * Builds the APPROVAL document definition.
 */
const buildApprovalDocDefinition = (snapshot = {}) => {
  const currency = snapshot.currency || 'ILS';
  const scale = getCurrencyScale(currency);
  const formatAmount = (val) =>
    val != null ? `${fromMinor(val, currency).toFixed(scale)} ${currency}` : '';

  const orgName = snapshot.letterhead?.organizationName || '';

  const tableBody = [
    [
      { text: 'رقم المطالبة', bold: true, fontSize: 9.5 },
      { text: snapshot.claimNumber || '', fontSize: 9.5 },
    ],
    [
      { text: 'رقم المركبة', bold: true, fontSize: 9.5 },
      { text: snapshot.plateNumber || '', fontSize: 9.5 },
    ],
    [
      { text: 'تاريخ الحادث', bold: true, fontSize: 9.5 },
      { text: snapshot.incidentDate || '', fontSize: 9.5 },
    ],
    [
      { text: 'قيمة الأضرار المقدرة', bold: true, fontSize: 9.5 },
      { text: formatAmount(snapshot.financials?.totalDamage), fontSize: 9.5 },
    ],
    [
      { text: 'التحمل المطبق', bold: true, fontSize: 9.5 },
      { text: formatAmount(snapshot.financials?.deductibleApplied), fontSize: 9.5 },
    ],
    [
      { text: 'صافي مبلغ التعويض', bold: true, fontSize: 9.5 },
      { text: formatAmount(snapshot.financials?.netApprovedPayout), bold: true, color: '#16a34a', fontSize: 9.5 },
    ],
  ];

  const claimNumberPart = snapshot.claimNumber ? ` رقم ${snapshot.claimNumber}` : '';
  const addresseePart = snapshot.addresseeName ? ` ${snapshot.addresseeName}` : '';
  const orgPart = orgName ? `، ${orgName}` : '';

  return {
    pageSize: 'A4',
    pageMargins: [45, 45, 45, 45],
    rtl: true,
    content: [
      ...buildHeaderBlock(snapshot.letterhead, snapshot.letterNumber, snapshot.issueDate),
      {
        text: `الموافقة على مطالبة التعويض${claimNumberPart}`,
        fontSize: 13,
        bold: true,
        alignment: 'center',
        margin: [0, 8, 0, 16],
      },
      {
        text: `السيد/السيدة${addresseePart} المحترم/ة`,
        fontSize: 10.5,
        bold: true,
        margin: [0, 0, 0, 8],
      },
      {
        text: 'تحية طيبة وبعد،',
        fontSize: 10,
        margin: [0, 0, 0, 10],
      },
      {
        text: 'نفيدكم بأنه تمت الموافقة على مطالبتكم المتعلقة بالمركبة المذكورة أدناه، وفق التفاصيل التالية:',
        fontSize: 10,
        margin: [0, 0, 0, 12],
      },
      {
        table: {
          widths: ['35%', '65%'],
          body: tableBody,
        },
        layout: 'lightHorizontalLines',
        margin: [0, 4, 0, 16],
      },
      {
        text: 'وسيتم التواصل معكم لاستكمال إجراءات الإصلاح والصرف. وتفضلوا بقبول فائق الاحترام،',
        fontSize: 10,
        margin: [0, 8, 0, 24],
      },
      buildSignatureElement(orgName),
    ],
    defaultStyle: {
      font: 'Cairo',
      fontSize: 10,
      color: '#1f2937',
    },
  };
};

/**
 * Builds the REJECTION document definition.
 */
const buildRejectionDocDefinition = (snapshot = {}) => {
  const orgName = snapshot.letterhead?.organizationName || '';

  const tableBody = [
    [
      { text: 'رقم المطالبة', bold: true, fontSize: 9.5 },
      { text: snapshot.claimNumber || '', fontSize: 9.5 },
    ],
    [
      { text: 'رقم المركبة', bold: true, fontSize: 9.5 },
      { text: snapshot.plateNumber || '', fontSize: 9.5 },
    ],
    [
      { text: 'تاريخ الحادث', bold: true, fontSize: 9.5 },
      { text: snapshot.incidentDate || '', fontSize: 9.5 },
    ],
  ];

  const claimNumberPart = snapshot.claimNumber ? ` رقم ${snapshot.claimNumber}` : '';
  const addresseePart = snapshot.addresseeName ? ` ${snapshot.addresseeName}` : '';
  const orgPart = orgName ? `، ${orgName}` : '';

  return {
    pageSize: 'A4',
    pageMargins: [45, 45, 45, 45],
    rtl: true,
    content: [
      ...buildHeaderBlock(snapshot.letterhead, snapshot.letterNumber, snapshot.issueDate),
      {
        text: `الاعتذار عن قبول مطالبة التعويض${claimNumberPart}`,
        fontSize: 13,
        bold: true,
        alignment: 'center',
        margin: [0, 8, 0, 16],
      },
      {
        text: `السيد/السيدة${addresseePart} المحترم/ة`,
        fontSize: 10.5,
        bold: true,
        margin: [0, 0, 0, 8],
      },
      {
        text: 'تحية طيبة وبعد،',
        fontSize: 10,
        margin: [0, 0, 0, 10],
      },
      {
        text: 'نأسف لإبلاغكم بأنه تعذر قبول مطالبتكم المتعلقة بالمركبة المذكورة أدناه، وذلك للسبب التالي:',
        fontSize: 10,
        margin: [0, 0, 0, 10],
      },
      {
        text: snapshot.reason || '',
        fontSize: 10,
        italics: true,
        color: '#374151',
        margin: [10, 4, 10, 14],
      },
      {
        table: {
          widths: ['35%', '65%'],
          body: tableBody,
        },
        layout: 'lightHorizontalLines',
        margin: [0, 4, 0, 16],
      },
      {
        text: 'ويمكنكم مراجعة دائرة المطالبات لأي استفسار. وتفضلوا بقبول فائق الاحترام،',
        fontSize: 10,
        margin: [0, 8, 0, 24],
      },
      buildSignatureElement(orgName),
    ],
    defaultStyle: {
      font: 'Cairo',
      fontSize: 10,
      color: '#1f2937',
    },
  };
};

/**
 * Builds the REPAIR_AUTHORIZATION document definition (PB-10 R10).
 */
const buildRepairAuthorizationDocDefinition = (snapshot = {}) => {
  const currency = snapshot.currency || 'ILS';
  const scale = getCurrencyScale(currency);
  const formatAmount = (val) =>
    val != null ? `${fromMinor(val, currency).toFixed(scale)} ${currency}` : '';

  const orgName = snapshot.letterhead?.organizationName || '';

  const tableBody = [
    [
      { text: 'رقم أمر الإصلاح', bold: true, fontSize: 9.5 },
      { text: snapshot.orderNumber || '', fontSize: 9.5 },
    ],
    [
      { text: 'رقم المطالبة', bold: true, fontSize: 9.5 },
      { text: snapshot.claimNumber || '', fontSize: 9.5 },
    ],
    [
      { text: 'رقم المركبة', bold: true, fontSize: 9.5 },
      { text: snapshot.plateNumber || '', fontSize: 9.5 },
    ],
    [
      { text: 'اسم المؤمن له', bold: true, fontSize: 9.5 },
      { text: snapshot.insuredName || '', fontSize: 9.5 },
    ],
    [
      { text: 'المبلغ المفوض به على الشركة', bold: true, fontSize: 9.5 },
      { text: formatAmount(snapshot.authorizedAmount), bold: true, color: '#16a34a', fontSize: 9.5 },
    ],
    [
      { text: 'التحمل المستحق على المؤمن له', bold: true, fontSize: 9.5 },
      { text: formatAmount(snapshot.deductibleToCollect), fontSize: 9.5 },
    ],
  ];

  const claimNumberPart = snapshot.claimNumber ? ` رقم ${snapshot.claimNumber}` : '';
  const garageNamePart = snapshot.garageName ? ` ${snapshot.garageName}` : '';

  return {
    pageSize: 'A4',
    pageMargins: [45, 45, 45, 45],
    rtl: true,
    content: [
      ...buildHeaderBlock(snapshot.letterhead, snapshot.letterNumber, snapshot.issueDate),
      {
        text: `تفويض إصلاح المركبة، المطالبة${claimNumberPart}`,
        fontSize: 13,
        bold: true,
        alignment: 'center',
        margin: [0, 8, 0, 16],
      },
      {
        text: `السادة${garageNamePart} المحترمين`,
        fontSize: 10.5,
        bold: true,
        margin: [0, 0, 0, 8],
      },
      {
        text: 'تحية طيبة وبعد،',
        fontSize: 10,
        margin: [0, 0, 0, 10],
      },
      {
        text: 'نفوضكم بإصلاح المركبة المذكورة أدناه وفق التقدير المعتمد، على ألا تتجاوز التكلفة على الشركة المبلغ المفوض به:',
        fontSize: 10,
        margin: [0, 0, 0, 12],
      },
      {
        table: {
          widths: ['35%', '65%'],
          body: tableBody,
        },
        layout: 'lightHorizontalLines',
        margin: [0, 4, 0, 16],
      },
      {
        text: 'يرجى إبلاغنا قبل البدء بأي أعمال إضافية غير مشمولة بالتقدير المعتمد. وتفضلوا بقبول فائق الاحترام،',
        fontSize: 10,
        margin: [0, 8, 0, 24],
      },
      buildSignatureElement(orgName),
    ],
    defaultStyle: {
      font: 'Cairo',
      fontSize: 10,
      color: '#1f2937',
    },
  };
};

/**
 * Dispatcher for building letter document definitions.
 */
const buildLetterDocDefinition = (snapshot) => {
  if (snapshot.type === 'APPROVAL') {
    return buildApprovalDocDefinition(snapshot);
  }
  if (snapshot.type === 'REJECTION') {
    return buildRejectionDocDefinition(snapshot);
  }
  if (snapshot.type === 'REPAIR_AUTHORIZATION') {
    return buildRepairAuthorizationDocDefinition(snapshot);
  }
  throw new Error(`Unsupported letter type: ${snapshot.type}`);
};

/**
 * NOTE: The legal wording in this discharge template must be reviewed and approved by the insurer's legal counsel before production use.
 * Builds the FINAL DISCHARGE document definition (PB-15).
 */
const buildDischargeDocDefinition = (snapshot = {}) => {
  const currency = snapshot.currency || 'ILS';
  const scale = getCurrencyScale(currency);
  const formattedAmount =
    snapshot.amount != null
      ? `${fromMinor(snapshot.amount, currency).toFixed(scale)} ${currency}`
      : '';

  const tableBody = [
    [
      { text: 'رقم المخالصة', bold: true, fontSize: 9.5 },
      { text: snapshot.dischargeNumber || '', fontSize: 9.5 },
    ],
    [
      { text: 'رقم المطالبة', bold: true, fontSize: 9.5 },
      { text: snapshot.claimNumber || '', fontSize: 9.5 },
    ],
    [
      { text: 'رقم المركبة', bold: true, fontSize: 9.5 },
      { text: snapshot.plateNumber || '', fontSize: 9.5 },
    ],
    [
      { text: 'تاريخ الحادث', bold: true, fontSize: 9.5 },
      { text: snapshot.incidentDate || '', fontSize: 9.5 },
    ],
    [
      { text: 'اسم المقر', bold: true, fontSize: 9.5 },
      { text: snapshot.claimantName || '', fontSize: 9.5 },
    ],
    [
      { text: 'رقم الهوية', bold: true, fontSize: 9.5 },
      { text: snapshot.claimantIdNumber || '', fontSize: 9.5 },
    ],
    [
      { text: 'مبلغ التعويض', bold: true, fontSize: 9.5 },
      { text: formattedAmount, bold: true, color: '#16a34a', fontSize: 9.5 },
    ],
  ];

  const signatureTableBody = [
    [
      { text: 'توقيع المقر', bold: true, fontSize: 9.5, margin: [0, 8, 0, 8] },
      { text: '', fontSize: 9.5, margin: [0, 8, 0, 8] },
    ],
    [
      { text: 'التاريخ', bold: true, fontSize: 9.5, margin: [0, 8, 0, 8] },
      { text: '', fontSize: 9.5, margin: [0, 8, 0, 8] },
    ],
    [
      { text: 'اسم الشاهد وتوقيعه', bold: true, fontSize: 9.5, margin: [0, 8, 0, 8] },
      { text: '', fontSize: 9.5, margin: [0, 8, 0, 8] },
    ],
  ];

  return {
    pageSize: 'A4',
    pageMargins: [45, 45, 45, 45],
    rtl: true,
    content: [
      ...buildHeaderBlock(snapshot.letterhead, snapshot.dischargeNumber, snapshot.issueDate, 'رقم المخالصة'),
      {
        text: 'مخالصة نهائية وإبراء ذمة',
        fontSize: 14,
        bold: true,
        alignment: 'center',
        margin: [0, 10, 0, 14],
      },
      {
        text: 'أقر أنا الموقع أدناه، صاحب المطالبة المبينة في الجدول التالي، بأنني قبلت المبلغ المذكور فيه تعويضا نهائيا وشاملا عن جميع الأضرار المادية التي لحقت بالمركبة نتيجة الحادث المذكور.',
        fontSize: 10,
        margin: [0, 0, 0, 12],
        lineHeight: 1.3,
      },
      {
        table: {
          widths: ['35%', '65%'],
          body: tableBody,
        },
        layout: 'lightHorizontalLines',
        margin: [0, 4, 0, 14],
      },
      {
        text: 'وبموجب هذه المخالصة أبرئ ذمة الشركة إبراء تاما ونهائيا من أي مطالبة أخرى تتعلق بهذه الأضرار.',
        fontSize: 10,
        margin: [0, 4, 0, 20],
        lineHeight: 1.3,
      },
      {
        table: {
          widths: ['35%', '65%'],
          body: signatureTableBody,
        },
        layout: 'lightHorizontalLines',
        margin: [0, 6, 0, 10],
      },
    ],
    defaultStyle: {
      font: 'Cairo',
      fontSize: 10,
      color: '#1f2937',
    },
  };
};

module.exports = {
  buildLetterDocDefinition,
  buildApprovalDocDefinition,
  buildRejectionDocDefinition,
  buildRepairAuthorizationDocDefinition,
  buildDischargeDocDefinition,
  buildHeaderBlock,
  buildSignatureElement,
};

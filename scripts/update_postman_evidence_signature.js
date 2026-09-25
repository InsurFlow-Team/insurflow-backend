const fs = require('fs');
const path = require('path');

const collectionPath = path.resolve(__dirname, '../InsurFlow.postman_collection.json');
const rawData = fs.readFileSync(collectionPath, 'utf8');
const data = JSON.parse(rawData);
const collection = data.collection || data;

// Helper to find requests recursively
function findItem(items, nameQuery) {
  for (const it of items) {
    if (it.name && it.name.includes(nameQuery)) {
      return it;
    }
    if (it.item) {
      const found = findItem(it.item, nameQuery);
      if (found) return found;
    }
  }
  return null;
}

const req16 = findItem(collection.item, '16. Upload Evidence Photo');
const req17 = findItem(collection.item, '17. Upload Digital Signature');

if (!req16) {
  console.error('Request 16 not found!');
  process.exit(1);
}

if (!req17) {
  console.error('Request 17 not found!');
  process.exit(1);
}

// 1. Update Request 16 (Upload Evidence Photo)
req16.request.body = {
  mode: 'formdata',
  formdata: [
    {
      key: 'file',
      type: 'file',
      description: '[REQUIRED] Binary image file (JPEG, PNG, WebP up to 10MB). Picked from camera or gallery in mobile app.'
    },
    {
      key: 'imageType',
      value: 'DAMAGE_CLOSEUP',
      type: 'text',
      description: '[REQUIRED] Enum category. Must be EXACTLY one of: VEHICLE_FRONT, VEHICLE_REAR, VEHICLE_SIDE, DAMAGE_CLOSEUP, DRIVER_LICENSE, OTHER'
    }
  ]
};

req16.request.description = `### Upload Inspection Evidence Photo (Mobile Adjuster)
**طريقة الإرسال:** \`POST /api/v1/claims/:claimId/evidence\`
**نوع المحتوى:** \`multipart/form-data\`
**الصلاحية:** \`FIELD_ADJUSTER\` (المساح المعين فقط)

#### الـ Form Fields المطلوبة في الـ Body:
1. **\`file\`** *(File - Required)*: ملف الصورة بصيغة JPEG أو PNG أو WebP بحجم أقصى 10MB.
2. **\`imageType\`** *(Text/String - Required)*: يجب أن يكون واحداً حصراً من قيم الـ Enum التالية:
   - \`VEHICLE_FRONT\`: مقدمة المركبة
   - \`VEHICLE_REAR\`: خلفية المركبة
   - \`VEHICLE_SIDE\`: جانب المركبة
   - \`DAMAGE_CLOSEUP\`: صورة مقربة للضرر
   - \`DRIVER_LICENSE\`: رخصة القيادة
   - \`OTHER\`: مستند / زاوية أخرى

#### ملاحظات هامة:
- يجب أن تكون المطالبة في حالة \`IN_PROGRESS\` (تم استدعاء \`POST /inspection/start\` مسبقاً).
- كل استدعاء يرفع صورة ويضيفها لمصفوفة \`claim.evidence\` (Additive).`;

req16.event = [
  {
    listen: 'test',
    script: {
      exec: [
        'pm.test("Status code is 200 OK", function () {',
        '    pm.response.to.have.status(200);',
        '});',
        'pm.test("Evidence photo uploaded successfully", function () {',
        '    var jsonData = pm.response.json();',
        '    pm.expect(jsonData.success).to.be.true;',
        '    pm.expect(jsonData.data.status).to.eql("IN_PROGRESS");',
        '    pm.expect(jsonData.data.evidence).to.be.an("array");',
        '    pm.expect(jsonData.data.evidence.length).to.be.above(0);',
        '    var lastEvidence = jsonData.data.evidence[jsonData.data.evidence.length - 1];',
        '    pm.expect(lastEvidence.url).to.be.a("string");',
        '    pm.expect(lastEvidence.imageType).to.eql("DAMAGE_CLOSEUP");',
        '    pm.expect(lastEvidence.uploadedBy).to.be.ok;',
        '});'
      ],
      type: 'text/javascript'
    }
  }
];

req16.response = [
  {
    name: '200 OK - Evidence Uploaded',
    originalRequest: req16.request,
    status: 'OK',
    code: 200,
    _postman_previewlanguage: 'json',
    header: [
      { key: 'Content-Type', value: 'application/json' }
    ],
    cookie: [],
    body: JSON.stringify({
      success: true,
      message: 'Evidence uploaded successfully',
      data: {
        status: 'IN_PROGRESS',
        evidence: [
          {
            imageType: 'DAMAGE_CLOSEUP',
            url: 'https://res.cloudinary.com/demo/image/upload/v12345/insurflow/evidence/damage.jpg',
            publicId: 'insurflow/org-1/evidence/damage_001',
            uploadedBy: '6aa280c2ff3ba88a24c4e5dc',
            uploadedAt: '2026-09-25T11:40:00.000Z'
          }
        ]
      }
    }, null, 2)
  },
  {
    name: '400 Bad Request - Validation Error',
    originalRequest: req16.request,
    status: 'Bad Request',
    code: 400,
    _postman_previewlanguage: 'json',
    header: [
      { key: 'Content-Type', value: 'application/json' }
    ],
    cookie: [],
    body: JSON.stringify({
      success: false,
      message: 'imageType must be one of [VEHICLE_FRONT, VEHICLE_REAR, VEHICLE_SIDE, DAMAGE_CLOSEUP, DRIVER_LICENSE, OTHER]',
      errors: [
        {
          code: 'VALIDATION_ERROR',
          details: 'imageType must be one of [VEHICLE_FRONT, VEHICLE_REAR, VEHICLE_SIDE, DAMAGE_CLOSEUP, DRIVER_LICENSE, OTHER]'
        }
      ]
    }, null, 2)
  }
];

// 2. Update Request 17 (Upload Digital Signature)
req17.request.body = {
  mode: 'formdata',
  formdata: [
    {
      key: 'file',
      type: 'file',
      description: '[REQUIRED] Binary digital signature image file (PNG, JPEG, WebP up to 10MB) exported from mobile signature canvas/pad.'
    }
  ]
};

req17.request.description = `### Upload Inspection Digital Signature (Mobile Adjuster)
**طريقة الإرسال:** \`POST /api/v1/claims/:claimId/signature\`
**نوع المحتوى:** \`multipart/form-data\`
**الصلاحية:** \`FIELD_ADJUSTER\` (المساح المعين فقط)

#### الـ Form Fields المطلوبة في الـ Body:
1. **\`file\`** *(File - Required)*: ملف صورة التوقيع الرقمي (عادة PNG أو JPEG) بحجم أقصى 10MB.
*(لا يحتاج أي حقول نصية إضافية في البودي)*.

#### ملاحظات هامة:
- يجب أن تكون المطالبة في حالة \`IN_PROGRESS\` (تم استدعاء \`POST /inspection/start\` مسبقاً).
- التوقيع يخزن كعنصر مفرد يستبدل أي توقيع سابق تلقائياً (Overwritable) لضمان اعتماد التوقيع الأحدث.`;

req17.event = [
  {
    listen: 'test',
    script: {
      exec: [
        'pm.test("Status code is 200 OK", function () {',
        '    pm.response.to.have.status(200);',
        '});',
        'pm.test("Digital signature uploaded successfully", function () {',
        '    var jsonData = pm.response.json();',
        '    pm.expect(jsonData.success).to.be.true;',
        '    pm.expect(jsonData.data.status).to.eql("IN_PROGRESS");',
        '    pm.expect(jsonData.data.signature).to.be.an("object");',
        '    pm.expect(jsonData.data.signature.url).to.be.a("string");',
        '    pm.expect(jsonData.data.signature.capturedAt).to.be.ok;',
        '    pm.expect(jsonData.data.signature.capturedBy).to.be.ok;',
        '});'
      ],
      type: 'text/javascript'
    }
  }
];

req17.response = [
  {
    name: '200 OK - Signature Captured',
    originalRequest: req17.request,
    status: 'OK',
    code: 200,
    _postman_previewlanguage: 'json',
    header: [
      { key: 'Content-Type', value: 'application/json' }
    ],
    cookie: [],
    body: JSON.stringify({
      success: true,
      message: 'Signature captured successfully',
      data: {
        status: 'IN_PROGRESS',
        signature: {
          url: 'https://res.cloudinary.com/demo/image/upload/v12345/insurflow/signatures/sig.png',
          publicId: 'insurflow/org-1/signatures/sig_001',
          capturedBy: '6aa280c2ff3ba88a24c4e5dc',
          capturedAt: '2026-09-25T11:42:00.000Z'
        }
      }
    }, null, 2)
  },
  {
    name: '400 Bad Request - Missing File',
    originalRequest: req17.request,
    status: 'Bad Request',
    code: 400,
    _postman_previewlanguage: 'json',
    header: [
      { key: 'Content-Type', value: 'application/json' }
    ],
    cookie: [],
    body: JSON.stringify({
      success: false,
      message: 'An image file is required',
      errors: [
        {
          code: 'VALIDATION_ERROR',
          details: 'An image file is required'
        }
      ]
    }, null, 2)
  }
];

fs.writeFileSync(collectionPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('Successfully updated Postman collection requests 16 & 17!');

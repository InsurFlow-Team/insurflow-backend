const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../InsurFlow.postman_collection.json');
const d = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const col = d.collection || d;

// 1. Set collection-level variables
col.variable = [
  { key: 'URL', value: 'http://localhost:5000/', type: 'string' },
  { key: 'adminToken', value: '', type: 'string' },
  { key: 'officerToken', value: '', type: 'string' },
  { key: 'adjusterToken', value: '', type: 'string' },
  { key: 'policyId', value: '', type: 'string' },
  { key: 'claimId', value: '', type: 'string' },
  { key: 'adjusterId', value: '', type: 'string' },
  { key: 'verifiedPolicyNumber', value: '', type: 'string' },
  { key: 'verifiedPlateNumber', value: '', type: 'string' },
  { key: 'busyAdjusterId', value: '', type: 'string' }
];

let statsUpdated = 0;
let prerequestUpdated = 0;

function walk(items) {
  for (const it of items) {
    // Add tests to Stats endpoints
    if (it.name && (it.name.includes('Get Claim Stats') || it.name.includes('Get My KPI Stats'))) {
      if (!it.event || !it.event.some(e => e.listen === 'test')) {
        it.event = it.event || [];
        it.event.push({
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              'pm.test("Status code is 200 OK", function () {',
              '    pm.response.to.have.status(200);',
              '});',
              'pm.test("Stats response structure is valid", function () {',
              '    var jsonData = pm.response.json();',
              '    pm.expect(jsonData.success).to.be.true;',
              '    pm.expect(jsonData.data).to.have.property("total");',
              '    pm.expect(jsonData.data).to.have.property("byStatus");',
              '});'
            ]
          }
        });
        statsUpdated++;
      }
    }

    // Auto-set tokens in environment and collection variables upon login
    if (it.name === 'login (Admin)') {
      it.event = it.event || [];
      const testEv = it.event.find(e => e.listen === 'test');
      if (testEv) {
        testEv.script.exec = [
          'pm.test("Status code is 200", function () {',
          '    pm.response.to.have.status(200);',
          '});',
          'pm.test("Admin Login successful", function () {',
          '    var jsonData = pm.response.json();',
          '    pm.expect(jsonData.success).to.be.true;',
          '    pm.expect(jsonData.data.accessToken).to.be.a("string");',
          '    pm.environment.set("adminToken", jsonData.data.accessToken);',
          '    if (pm.collectionVariables) pm.collectionVariables.set("adminToken", jsonData.data.accessToken);',
          '});'
        ];
      }
    }
    if (it.name === 'login (Claims Officer)') {
      it.event = it.event || [];
      const testEv = it.event.find(e => e.listen === 'test');
      if (testEv) {
        testEv.script.exec = [
          'pm.test("Status code is 200", function () {',
          '    pm.response.to.have.status(200);',
          '});',
          'pm.test("Officer Login successful", function () {',
          '    var jsonData = pm.response.json();',
          '    pm.expect(jsonData.success).to.be.true;',
          '    pm.expect(jsonData.data.accessToken).to.be.a("string");',
          '    pm.environment.set("officerToken", jsonData.data.accessToken);',
          '    if (pm.collectionVariables) pm.collectionVariables.set("officerToken", jsonData.data.accessToken);',
          '});'
        ];
      }
    }
    if (it.name === 'login (Field Adjuster)' || it.name === '1. Login - Field Adjuster') {
      it.event = it.event || [];
      const testEv = it.event.find(e => e.listen === 'test');
      if (testEv) {
        testEv.script.exec = [
          'pm.test("Status code is 200", function () {',
          '    pm.response.to.have.status(200);',
          '});',
          'pm.test("Field Adjuster Login successful", function () {',
          '    var jsonData = pm.response.json();',
          '    pm.expect(jsonData.success).to.be.true;',
          '    pm.expect(jsonData.data.accessToken).to.be.a("string");',
          '    pm.environment.set("adjusterToken", jsonData.data.accessToken);',
          '    if (pm.collectionVariables) pm.collectionVariables.set("adjusterToken", jsonData.data.accessToken);',
          '});'
        ];
      }
    }

    // Add pre-request script to Create Claim
    if (it.name && it.name.includes('Create Claim with Incident Coordinates')) {
      it.event = it.event || [];
      const hasPrerequest = it.event.some(e => e.listen === 'prerequest');
      if (!hasPrerequest) {
        it.event.unshift({
          listen: 'prerequest',
          script: {
            type: 'text/javascript',
            exec: [
              '// Dynamically inject verified policyId and plateNumber if set by intake verification',
              'if (pm.environment.get("policyId")) {',
              '    try {',
              '        var body = JSON.parse(pm.request.body.raw);',
              '        body.policyId = pm.environment.get("policyId");',
              '        if (pm.environment.get("verifiedPlateNumber")) {',
              '            body.plateNumber = pm.environment.get("verifiedPlateNumber");',
              '        }',
              '        pm.request.body.raw = JSON.stringify(body, null, 2);',
              '    } catch (e) {',
              '        console.error("Failed to inject dynamic policyId in pre-request:", e);',
              '    }',
              '}'
            ]
          }
        });
        prerequestUpdated++;
      }
    }

    if (it.item) walk(it.item);
  }
}

walk(col.item);
console.log('Stats tests updated:', statsUpdated);
console.log('Pre-request scripts updated:', prerequestUpdated);
fs.writeFileSync(filePath, JSON.stringify(d, null, 2) + '\n', 'utf8');

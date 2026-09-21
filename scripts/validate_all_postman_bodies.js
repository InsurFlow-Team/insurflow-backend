const fs = require('fs');
const path = require('path');

const { loginSchema, changePasswordSchema } = require('../src/modules/auth/auth.validation');
const {
  createUserSchema,
  updateUserSchema,
  updateStatusSchema,
  resetPasswordSchema,
  updateFcmTokenSchema
} = require('../src/modules/users/user.validation');
const {
  createClaimSchema,
  assignClaimSchema,
  acceptAssignmentSchema,
  declineAssignmentSchema,
  updateVehicleSchema,
  updateAccidentSchema,
  updateLocationSchema,
  requestCorrectionSchema,
  decisionSchema,
  closeClaimSchema,
  uploadEvidenceSchema
} = require('../src/modules/claims/claim.validation');

const collectionPath = path.resolve(__dirname, '../InsurFlow.postman_collection.json');
const d = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));
const col = d.collection || d;

function findRequests(items, folder = '') {
  let list = [];
  for (const it of items) {
    if (it.item) {
      list.push(...findRequests(it.item, folder ? folder + ' > ' + it.name : it.name));
    } else {
      list.push({
        folder,
        item: it
      });
    }
  }
  return list;
}

const allReqs = findRequests(col.item);

function normalizeUrl(url) {
  return url
    .replace(/^https?:\/\/[^\/]+/, '')
    .replace(/^{{URL}}\/?/, '/')
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '');
}

console.log(`Auditing all ${allReqs.length} requests in Postman Collection...\n`);

const issues = [];

allReqs.forEach(({ folder, item }) => {
  const method = item.request.method;
  const rawUrl = typeof item.request.url === 'string' ? item.request.url : (item.request.url ? item.request.url.raw : '');
  const normPath = normalizeUrl(rawUrl);
  const isNegative = item.name.includes('[Negative Test]');
  const body = item.request.body;

  let schema = null;
  let schemaName = '';

  // Match schema based on method & normPath
  if (normPath === '/api/v1/auth/login' && method === 'POST') {
    schema = loginSchema;
    schemaName = 'loginSchema';
  } else if (normPath === '/api/v1/auth/change-password' && method === 'PUT') {
    schema = changePasswordSchema;
    schemaName = 'changePasswordSchema';
  } else if (normPath === '/api/v1/users' && method === 'POST') {
    schema = createUserSchema;
    schemaName = 'createUserSchema';
  } else if (/^\/api\/v1\/users\/[^\/]+$/.test(normPath) && method === 'PATCH') {
    schema = updateUserSchema;
    schemaName = 'updateUserSchema';
  } else if (/^\/api\/v1\/users\/[^\/]+\/status$/.test(normPath) && method === 'PATCH') {
    schema = updateStatusSchema;
    schemaName = 'updateStatusSchema';
  } else if (/^\/api\/v1\/users\/[^\/]+\/reset-password$/.test(normPath) && method === 'PATCH') {
    schema = resetPasswordSchema;
    schemaName = 'resetPasswordSchema';
  } else if (normPath === '/api/v1/users/me/fcm-token' && method === 'PATCH') {
    schema = updateFcmTokenSchema;
    schemaName = 'updateFcmTokenSchema';
  } else if (normPath === '/api/v1/claims' && method === 'POST') {
    schema = createClaimSchema;
    schemaName = 'createClaimSchema';
  } else if (/^\/api\/v1\/claims\/[^\/]+\/assign$/.test(normPath) && method === 'POST') {
    schema = assignClaimSchema;
    schemaName = 'assignClaimSchema';
  } else if (/^\/api\/v1\/claims\/[^\/]+\/accept-assignment$/.test(normPath) && method === 'POST') {
    schema = acceptAssignmentSchema;
    schemaName = 'acceptAssignmentSchema';
  } else if (/^\/api\/v1\/claims\/[^\/]+\/decline-assignment$/.test(normPath) && method === 'POST') {
    schema = declineAssignmentSchema;
    schemaName = 'declineAssignmentSchema';
  } else if (/^\/api\/v1\/claims\/[^\/]+\/vehicle$/.test(normPath) && method === 'PUT') {
    schema = updateVehicleSchema;
    schemaName = 'updateVehicleSchema';
  } else if (/^\/api\/v1\/claims\/[^\/]+\/accident$/.test(normPath) && method === 'PUT') {
    schema = updateAccidentSchema;
    schemaName = 'updateAccidentSchema';
  } else if (/^\/api\/v1\/claims\/[^\/]+\/location$/.test(normPath) && method === 'PUT') {
    schema = updateLocationSchema;
    schemaName = 'updateLocationSchema';
  } else if (/^\/api\/v1\/claims\/[^\/]+\/evidence$/.test(normPath) && method === 'POST') {
    schema = uploadEvidenceSchema;
    schemaName = 'uploadEvidenceSchema';
  } else if (/^\/api\/v1\/claims\/[^\/]+\/review\/request-correction$/.test(normPath) && method === 'POST') {
    schema = requestCorrectionSchema;
    schemaName = 'requestCorrectionSchema';
  } else if (/^\/api\/v1\/claims\/[^\/]+\/decision$/.test(normPath) && method === 'POST') {
    schema = decisionSchema;
    schemaName = 'decisionSchema';
  } else if (/^\/api\/v1\/claims\/[^\/]+\/close$/.test(normPath) && method === 'POST') {
    schema = closeClaimSchema;
    schemaName = 'closeClaimSchema';
  }

  // Check for GET with body or unexpected body
  if (method === 'GET' && body && (body.raw || (body.formdata && body.formdata.length > 0))) {
    issues.push({
      folder,
      name: item.name,
      method,
      normPath,
      issue: 'GET request should not have a request body'
    });
  }

  // If there is a schema, validate the body
  if (schema) {
    let bodyObj = {};
    if (body) {
      if (body.mode === 'raw' && body.raw) {
        try {
          bodyObj = JSON.parse(body.raw);
        } catch (e) {
          issues.push({
            folder,
            name: item.name,
            method,
            normPath,
            issue: 'Invalid JSON in raw body: ' + e.message
          });
          return;
        }
      } else if (body.mode === 'formdata' && body.formdata) {
        body.formdata.forEach(f => {
          if (f.type !== 'file') {
            bodyObj[f.key] = f.value;
          }
        });
      }
    }

    const { error } = schema.validate(bodyObj, { abortEarly: false });

    if (error && !isNegative) {
      issues.push({
        folder,
        name: item.name,
        method,
        normPath,
        schemaName,
        issue: 'Positive test body fails schema: ' + error.details.map(d => d.message).join('; ')
      });
    } else if (!error && isNegative) {
      // Check if it was supposed to fail on body
      if (item.name.includes('Empty Body') || item.name.includes('Invalid Role') || item.name.includes('without Reason')) {
        issues.push({
          folder,
          name: item.name,
          method,
          normPath,
          schemaName,
          issue: 'Negative test body surprisingly passed validation!'
        });
      }
    } else if (!error && !isNegative) {
      console.log(`[VALID] [${folder}] ${item.name} (${schemaName})`);
    }
  }
});

console.log('\n========================================');
console.log(`Total issues found: ${issues.length}`);
console.log('========================================');
issues.forEach((iss, i) => {
  console.log(`\nIssue #${i + 1}: [${iss.folder}] ${iss.name}`);
  console.log(`  Endpoint: ${iss.method} ${iss.normPath}`);
  console.log(`  Issue: ${iss.issue}`);
});

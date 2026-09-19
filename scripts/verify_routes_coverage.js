const fs = require('fs');
const path = require('path');

const routes = [
  { method: 'GET', path: '/health' },
  { method: 'POST', path: '/api/v1/auth/login' },
  { method: 'PUT', path: '/api/v1/auth/change-password' },
  { method: 'GET', path: '/api/v1/users/adjusters' },
  { method: 'PATCH', path: '/api/v1/users/me/fcm-token' },
  { method: 'POST', path: '/api/v1/users' },
  { method: 'GET', path: '/api/v1/users' },
  { method: 'PATCH', path: '/api/v1/users/:userId' },
  { method: 'PATCH', path: '/api/v1/users/:userId/status' },
  { method: 'PATCH', path: '/api/v1/users/:userId/reset-password' },
  { method: 'GET', path: '/api/v1/vehicles/lookup' },
  { method: 'POST', path: '/api/v1/claims' },
  { method: 'GET', path: '/api/v1/claims' },
  { method: 'GET', path: '/api/v1/claims/stats' },
  { method: 'GET', path: '/api/v1/claims/:claimId' },
  { method: 'POST', path: '/api/v1/claims/:claimId/assign' },
  { method: 'POST', path: '/api/v1/claims/:claimId/decline-assignment' },
  { method: 'POST', path: '/api/v1/claims/:claimId/accept-assignment' },
  { method: 'POST', path: '/api/v1/claims/:claimId/inspection/start' },
  { method: 'PUT', path: '/api/v1/claims/:claimId/vehicle' },
  { method: 'PUT', path: '/api/v1/claims/:claimId/accident' },
  { method: 'PUT', path: '/api/v1/claims/:claimId/location' },
  { method: 'POST', path: '/api/v1/claims/:claimId/evidence' },
  { method: 'POST', path: '/api/v1/claims/:claimId/signature' },
  { method: 'POST', path: '/api/v1/claims/:claimId/inspection/submit' },
  { method: 'POST', path: '/api/v1/claims/:claimId/review/start' },
  { method: 'POST', path: '/api/v1/claims/:claimId/review/request-correction' },
  { method: 'POST', path: '/api/v1/claims/:claimId/decision' },
  { method: 'POST', path: '/api/v1/claims/:claimId/close' },
  { method: 'GET', path: '/api/v1/claims/:claimId/report' }
];

function normalizeUrl(url) {
  return url
    .replace(/^https?:\/\/[^\/]+/, '')
    .replace(/^{{URL}}\/?/, '/')
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '');
}

const collectionPath = path.resolve(__dirname, '../InsurFlow.postman_collection.json');
const root = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));
const collection = root.collection || root;

function getReqs(items) {
  let list = [];
  for (const item of (items || [])) {
    if (item.item) list.push(...getReqs(item.item));
    else if (item.request) {
      const rawUrl = typeof item.request.url === 'string' ? item.request.url : (item.request.url ? item.request.url.raw : '');
      list.push({
        name: item.name,
        method: item.request.method,
        rawUrl,
        normPath: normalizeUrl(rawUrl)
      });
    }
  }
  return list;
}

const reqs = getReqs(collection.item);
console.log('Total requests in collection:', reqs.length);

let allMatched = true;
routes.forEach((r, idx) => {
  const regexPattern = '^' + r.path
    .replace(/:[a-zA-Z0-9_]+/g, '([^/]+)')
    .replace(/\//g, '\\/') + '$';
  const reg = new RegExp(regexPattern);
  
  const matched = reqs.filter(req => req.method === r.method && reg.test(req.normPath));
  if (matched.length === 0) {
    console.log('[MISSING] ' + r.method + ' ' + r.path);
    allMatched = false;
  } else {
    console.log('[OK ' + (idx + 1) + '/30] ' + r.method + ' ' + r.path + ' -> ' + matched.length + ' matching requests');
  }
});

if (allMatched) {
  console.log('\nSUCCESS: ALL 30 EXPRESS ROUTES ARE 100% COVERED IN POSTMAN COLLECTION!');
} else {
  console.log('\nFAILURE: SOME ROUTES ARE STILL MISSING!');
  process.exit(1);
}

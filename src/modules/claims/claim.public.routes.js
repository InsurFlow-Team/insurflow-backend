const express = require('express');
const publicClaimController = require('./claim.public.controller');

const router = express.Router();

// GET /api/v1/public/claims/track/:trackingToken — Public claim status lookup
// No authentication middleware applied — this is intentionally public.
router.get(
  '/claims/track/:trackingToken',
  publicClaimController.getPublicClaimStatus
);

module.exports = router;

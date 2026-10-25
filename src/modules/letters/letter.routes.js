const express = require('express');
const letterController = require('./letter.controller');
const authorizeRole = require('../../middlewares/role.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const { issueLetterSchema, letterNumberParamSchema } = require('./letter.validation');

// C1: mergeParams: true so claimId reaches subresource handlers
const router = express.Router({ mergeParams: true });

// All letter routes restricted to CLAIMS_OFFICER and ADMIN
router.use(authorizeRole(['CLAIMS_OFFICER', 'ADMIN']));

// POST /api/v1/claims/:claimId/letters — Issue an approval or rejection letter
router.post('/', validate(issueLetterSchema), letterController.issueLetter);

// GET /api/v1/claims/:claimId/letters — List all letters for a claim
router.get('/', letterController.getLetters);

// GET /api/v1/claims/:claimId/letters/:letterNumber/pdf — Download letter PDF
router.get('/:letterNumber/pdf', validate(letterNumberParamSchema, 'params'), letterController.downloadLetterPdf);

module.exports = router;

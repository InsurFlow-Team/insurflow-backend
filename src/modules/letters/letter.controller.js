const letterService = require('./letter.service');
const { successResponse } = require('../../utils/apiResponse');
const asyncWrapper = require('../../utils/asyncWrapper');

const issueLetter = async (req, res) => {
  const { claimId } = req.params;
  const result = await letterService.issueLetter(claimId, req.body, req.user);
  return res.status(201).json(successResponse('Letter issued successfully', result));
};

const getLetters = async (req, res) => {
  const { claimId } = req.params;
  const result = await letterService.getLetters(claimId, req.user);
  return res.status(200).json(successResponse('Letters retrieved successfully', result));
};

const downloadLetterPdf = async (req, res) => {
  const { claimId, letterNumber } = req.params;
  const { buffer, letterNumber: fileName } = await letterService.getLetterPdf(
    claimId,
    letterNumber,
    req.user
  );

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}.pdf"`);
  return res.status(200).send(buffer);
};

module.exports = {
  issueLetter: asyncWrapper(issueLetter),
  getLetters: asyncWrapper(getLetters),
  downloadLetterPdf: asyncWrapper(downloadLetterPdf),
};

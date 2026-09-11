const multer = require('multer');
const AppError = require('../utils/appError');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new AppError('Only JPEG, PNG, and WEBP images are allowed', 400, 'VALIDATION_ERROR'));
    }
    cb(null, true);
  },
});

module.exports = upload;

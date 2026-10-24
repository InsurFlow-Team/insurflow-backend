class AppError extends Error {
  constructor(message, statusCode, code, reason) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    if (reason !== undefined) {
      this.reason = reason;
    }
  }
}

module.exports = AppError;

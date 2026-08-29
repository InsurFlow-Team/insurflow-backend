/**
 * Wrapper to catch errors in async route handlers and pass them to the express error handler.
 * Eliminates the need to wrap every route handler in a try-catch block.
 *
 * @param {Function} fn - The asynchronous route handler (controller function).
 * @returns {Function} - An Express middleware function.
 */
const asyncWrapper = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = asyncWrapper;

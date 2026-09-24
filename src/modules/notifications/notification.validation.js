const Joi = require('joi');

const listNotificationsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  unreadOnly: Joi.boolean().optional().default(false),
});

module.exports = {
  listNotificationsQuerySchema,
};

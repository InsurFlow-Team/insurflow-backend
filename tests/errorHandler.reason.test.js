const mongoose = require('mongoose');
const errorHandler = require('../src/middlewares/errorHandler');

describe('errorHandler reason handling', () => {
  it('does not add reason for a Mongoose CastError', () => {
    const err = new mongoose.Error.CastError('ObjectId', 'not-an-id', '_id');
    const req = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.errors[0].code).toBe('RESOURCE_NOT_FOUND');
    expect(Object.keys(body.errors[0]).sort()).toEqual(['code', 'details'].sort());
    expect(body.errors[0].reason).toBeUndefined();
  });
});

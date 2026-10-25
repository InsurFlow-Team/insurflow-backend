const Garage = require('./garage.model');

const create = async (data) => {
  const garage = new Garage(data);
  return await garage.save();
};

const findByIdAndOrganization = async (garageId, organizationId, filter = {}) => {
  return await Garage.findOne({ _id: garageId, organizationId, ...filter }).lean();
};

const findAllByOrganization = async (
  organizationId,
  filter = {},
  pagination = {},
  sort = { name: 1, _id: 1 }
) => {
  const { page = 1, limit = 50 } = pagination;
  const skip = (page - 1) * limit;
  const query = { organizationId, ...filter };

  const [totalCount, garages] = await Promise.all([
    Garage.countDocuments(query),
    Garage.find(query).sort(sort).skip(skip).limit(limit).lean(),
  ]);

  return { totalCount, garages };
};

const updateByIdAndOrganization = async (garageId, organizationId, updateData) => {
  return await Garage.findOneAndUpdate(
    { _id: garageId, organizationId },
    { $set: updateData },
    { returnDocument: 'after', runValidators: true }
  ).lean();
};

module.exports = {
  create,
  findByIdAndOrganization,
  findAllByOrganization,
  updateByIdAndOrganization,
};

const mongoose = require('mongoose');
const User = require('./user.model');
const Claim = require('../claims/claim.model');
const { toHebronDate } = require('../../utils/hebronDate');

const findAdjustersByOrganization = async (organizationId) => {
  return await User.find({
    organizationId,
    role: 'FIELD_ADJUSTER',
  })
    .select('name employeeCode role status')
    .lean();
};

const findByIdAndOrganization = async (userId, organizationId) => {
  return await User.findOne({ _id: userId, organizationId }).lean();
};

const findByIdWithPassword = async (userId, organizationId) => {
  return await User.findOne({ _id: userId, organizationId }).select('+password');
};

const create = async (data) => {
  const user = new User(data);
  return await user.save();
};

const findAllByOrganization = async (organizationId, role, pagination = {}) => {
  const { page = 1, limit = 50 } = pagination;
  const skip = (page - 1) * limit;
  const query = { organizationId, ...(role && { role }) };

  const [totalCount, users] = await Promise.all([
    User.countDocuments(query),
    User.find(query)
      .select('name employeeCode role status createdAt surveyorLicenseNumber surveyorLicenseExpiry')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return { totalCount, users };
};

const resetPassword = async (userId, organizationId, newPassword) => {
  const user = await User.findOne({ _id: userId, organizationId });
  if (!user) return null;
  user.password = newPassword;
  await user.save();
  return user;
};

const updateStatus = async (userId, organizationId, status) => {
  return await User.findOneAndUpdate(
    { _id: userId, organizationId },
    { $set: { status } },
    { returnDocument: 'after' }
  ).lean();
};

const updateStatusToActiveWithLicenseCheck = async (userId, organizationId) => {
  const todayHebron = toHebronDate(new Date());
  const filter = {
    _id: userId,
    organizationId,
    $or: [
      { role: { $ne: 'FIELD_ADJUSTER' } },
      {
        role: 'FIELD_ADJUSTER',
        surveyorLicenseNumber: { $type: 'string', $ne: '' },
        surveyorLicenseExpiry: { $type: 'string', $gte: todayHebron },
      },
    ],
  };
  return await User.findOneAndUpdate(
    filter,
    { $set: { status: 'ACTIVE' } },
    { returnDocument: 'after' }
  ).lean();
};

const updateSurveyorLicense = async (userId, organizationId, updateData) => {
  return await User.findOneAndUpdate(
    { _id: userId, organizationId, role: 'FIELD_ADJUSTER' },
    {
      $set: {
        surveyorLicenseNumber: updateData.surveyorLicenseNumber.trim().toUpperCase(),
        surveyorLicenseExpiry: updateData.surveyorLicenseExpiry,
      },
    },
    { returnDocument: 'after' }
  ).lean();
};

const updateUser = async (userId, organizationId, updateData) => {
  return await User.findOneAndUpdate(
    { _id: userId, organizationId },
    { $set: updateData },
    { returnDocument: 'after', runValidators: true }
  )
    .select('name employeeCode role status createdAt updatedAt')
    .lean();
};

const updateFcmToken = async (userId, organizationId, fcmToken) => {
  return await User.findOneAndUpdate(
    { _id: userId, organizationId },
    { $set: { fcmToken } },
    { returnDocument: 'after' }
  )
    .select('_id fcmToken')
    .lean();
};

/**
 * Aggregates field adjusters in an organization along with their active claim workload in a single query.
 * Eliminates the N+1 query loop.
 */
const findAdjustersWithWorkload = async (organizationId, statusFilter, options = {}) => {
  const orgObjectId =
    typeof organizationId === 'string'
      ? new mongoose.Types.ObjectId(organizationId)
      : organizationId;

  const matchConditions = {
    organizationId: orgObjectId,
    role: 'FIELD_ADJUSTER',
  };

  if (options && options.onlyValidLicense) {
    const todayHebron = toHebronDate(new Date());
    matchConditions.surveyorLicenseNumber = { $type: 'string', $ne: '' };
    matchConditions.surveyorLicenseExpiry = { $type: 'string', $gte: todayHebron };
  }

  const pipeline = [
    {
      $match: matchConditions,
    },
    {
      $lookup: {
        from: 'claims',
        let: { adjusterId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$assignedTo', '$$adjusterId'] },
                  { $in: ['$status', Claim.ACTIVE_ADJUSTER_STATUSES] },
                  { $eq: ['$organizationId', orgObjectId] },
                ],
              },
            },
          },
          {
            $count: 'count',
          },
        ],
        as: 'activeClaims',
      },
    },
    {
      $addFields: {
        activeTasksCount: {
          $ifNull: [{ $arrayElemAt: ['$activeClaims.count', 0] }, 0],
        },
        capacityLimit: Claim.MAX_ACTIVE_CLAIMS_PER_ADJUSTER ?? 3,
      },
    },
    {
      $addFields: {
        id: '$_id',
        availability: {
          $cond: {
            if: {
              $and: [
                { $eq: ['$status', 'ACTIVE'] },
                { $lte: ['$activeTasksCount', Claim.MAX_ACTIVE_CLAIMS_PER_ADJUSTER ?? 3] },
              ],
            },
            then: 'AVAILABLE',
            else: 'UNAVAILABLE',
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        id: 1,
        name: 1,
        employeeCode: 1,
        role: 1,
        status: 1,
        availability: 1,
        activeTasksCount: 1,
        capacityLimit: 1,
        surveyorLicenseNumber: 1,
        surveyorLicenseExpiry: 1,
        location: {
          $ifNull: [
            '$location',
            { latitude: null, longitude: null, updatedAt: null },
          ],
        },
      },
    },
  ];

  if (statusFilter === 'available') {
    pipeline.push({
      $match: {
        availability: 'AVAILABLE',
      },
    });
  }

  return await User.aggregate(pipeline);
};


const updatePaymentPermission = async (userId, organizationId, canRecordPayments) => {
  return await User.findOneAndUpdate(
    { _id: userId, organizationId },
    { $set: { canRecordPayments } },
    { returnDocument: 'after' }
  ).lean();
};

module.exports = {
  findAdjustersByOrganization,
  findAdjustersWithWorkload,
  findByIdAndOrganization,
  findByIdWithPassword,
  create,
  findAllByOrganization,
  resetPassword,
  updateStatus,
  updateStatusToActiveWithLicenseCheck,
  updateSurveyorLicense,
  updateUser,
  updateFcmToken,
  updatePaymentPermission,
};

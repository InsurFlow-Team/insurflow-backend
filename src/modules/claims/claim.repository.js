const mongoose = require('mongoose');
const Claim = require('./claim.model');


const create = async (data) => {
  const claim = new Claim(data);
  return await claim.save();
};


const CLAIM_LIST_PROJECTION = {
  claimNumber: 1,
  status: 1,
  'customer.name': 1,
  'vehicle.plateNumber': 1,
  incidentType: 1,
  createdAt: 1,
  assignedTo: 1,
  incidentCoordinates: 1,
  statusEnteredAt: {
    $let: {
      vars: {
        matchingTransitions: {
          $filter: {
            input: { $ifNull: ['$timeline', []] },
            as: 'evt',
            cond: {
              $and: [
                { $ne: ['$$evt.newStatus', null] },
                { $ne: ['$$evt.newStatus', '$$evt.previousStatus'] },
                { $eq: ['$$evt.newStatus', '$status'] },
              ],
            },
          },
        },
      },
      in: {
        $cond: [
          { $gt: [{ $size: '$$matchingTransitions' }, 0] },
          { $arrayElemAt: ['$$matchingTransitions.timestamp', -1] },
          {
            $cond: [
              { $eq: ['$status', 'NEW'] },
              {
                $let: {
                  vars: {
                    createdEvts: {
                      $filter: {
                        input: { $ifNull: ['$timeline', []] },
                        as: 'evt',
                        cond: { $eq: ['$$evt.action', 'Claim Created'] },
                      },
                    },
                  },
                  in: {
                    $cond: [
                      { $gt: [{ $size: '$$createdEvts' }, 0] },
                      { $arrayElemAt: ['$$createdEvts.timestamp', 0] },
                      '$createdAt',
                    ],
                  },
                },
              },
              null,
            ],
          },
        ],
      },
    },
  },
};

const findByOrganization = async (organizationId, filter = {}, pagination = {}) => {
  const { page = 1, limit = 50 } = pagination;
  const skip = (page - 1) * limit;

  // Support both legacy string status and filter object: { status, adjusterId }
  const status = typeof filter === 'string' ? filter : filter?.status;
  const adjusterId = typeof filter === 'object' ? (filter?.adjusterId || filter?.assignedTo) : undefined;

  const query = {
    organizationId,
    ...(status && { status }),
    ...(adjusterId && { assignedTo: adjusterId }),
  };

  const [totalCount, claims] = await Promise.all([
    Claim.countDocuments(query),
    Claim.find(query)
      .select(CLAIM_LIST_PROJECTION)
      .populate('assignedTo', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return { totalCount, claims };
};


const findByAssignee = async (organizationId, userId, status, pagination = {}) => {
  const { page = 1, limit = 50 } = pagination;
  const skip = (page - 1) * limit;
  const query = { organizationId, assignedTo: userId, ...(status && { status }) };

  const [totalCount, claims] = await Promise.all([
    Claim.countDocuments(query),
    Claim.find(query)
      .select(CLAIM_LIST_PROJECTION)
      .populate('assignedTo', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return { totalCount, claims };
};



const findByIdAndOrganization = async (claimId, organizationId) => {
  return await Claim.findOne({ _id: claimId, organizationId })
    .populate('createdBy', 'name employeeCode role')
    .populate('assignedTo', 'name employeeCode role')
    .populate('assignedBy', 'name employeeCode role')
    .populate('policyId', 'policyNumber status startDate expiryDate')
    .populate('vehicle.vehicleId', 'plateNumber make model year color')
    .populate('vehicle.customerId', 'fullName phone')
    .populate('evidence.uploadedBy', 'name employeeCode')
    .populate('timeline.performedBy', 'name employeeCode role')
    .populate('lossAssessment.assessedBy', 'name employeeCode role')
    .lean();
};

const findByIncidentId = async (organizationId, incidentId) => {
  return await Claim.find({ organizationId, incidentId })
    .select('claimNumber claimType status vehicle.plateNumber vehicle.vehicleId createdAt')
    .sort({ createdAt: 1 })
    .lean();
};

const findForReport = async (claimId, organizationId) => {
  return await Claim.findOne({ _id: claimId, organizationId })
    .populate('createdBy', 'name employeeCode role')
    .populate('assignedTo', 'name employeeCode role')
    .populate('assignedBy', 'name employeeCode role')
    .populate('closedBy', 'name employeeCode role')
    .populate('signature.capturedBy', 'name employeeCode role')
    .populate('evidence.uploadedBy', 'name employeeCode role')
    .populate('timeline.performedBy', 'name employeeCode role')
    .populate('lossAssessment.assessedBy', 'name employeeCode role')
    .lean();
};


const countActiveClaimsByAssignee = async (userId) => {
  return await Claim.countDocuments({
    assignedTo: userId,
    status: { $in: Claim.ACTIVE_ADJUSTER_STATUSES || ['ASSIGNED', 'IN_PROGRESS', 'CORRECTION_REQUIRED'] },
  });
};

const assignClaim = async (claimId, organizationId, updateData) => {
  const { assignedTo, assignedBy, assignedAt, status, priority, assignmentNotes, timelineEvent } = updateData;
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'NEW' },
    {
      $set: { assignedTo, assignedBy, assignedAt, status, priority, assignmentNotes },
      $push: { timeline: timelineEvent },
    },
    { returnDocument: 'after' }
  ).lean();
};

const startInspection = async (claimId, organizationId, assignedTo, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    {
      _id: claimId,
      organizationId,
      assignedTo,
      status: { $in: ['ASSIGNED', 'CORRECTION_REQUIRED'] },
    },
    {
      $set: { status: 'IN_PROGRESS' },
      $push: { timeline: timelineEvent },
    },
    { returnDocument: 'after' }
  ).lean();
};

const updateVehicle = async (claimId, organizationId, assignedTo, policyId, vehicleData, timelineEvent) => {
  if (!policyId) {
    throw new Error('updateVehicle requires the claim policyId');
  }
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'IN_PROGRESS', assignedTo, policyId },
    { $set: { vehicle: vehicleData }, $push: { timeline: timelineEvent } },
    { returnDocument: 'after' }
  ).lean();
};

const updateAccident = async (claimId, organizationId, assignedTo, accidentData, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'IN_PROGRESS', assignedTo },
    { $set: { accident: accidentData }, $push: { timeline: timelineEvent } },
    { returnDocument: 'after' }
  ).lean();
};

const updateLocation = async (claimId, organizationId, assignedTo, locationData, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'IN_PROGRESS', assignedTo },
    { $set: { location: locationData }, $push: { timeline: timelineEvent } },
    { returnDocument: 'after' }
  ).lean();
};

const addEvidence = async (claimId, organizationId, assignedTo, evidenceItem, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'IN_PROGRESS', assignedTo },
    { $push: { evidence: evidenceItem, timeline: timelineEvent } },
    { returnDocument: 'after' }
  ).lean();
};

const setSignature = async (claimId, organizationId, assignedTo, signatureData, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'IN_PROGRESS', assignedTo },
    { $set: { signature: signatureData }, $push: { timeline: timelineEvent } },
    { returnDocument: 'after' }
  ).lean();
};

const submitInspection = async (claimId, organizationId, assignedTo, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'IN_PROGRESS', assignedTo },
    { $set: { status: 'SUBMITTED' }, $push: { timeline: timelineEvent } },
    { returnDocument: 'after' }
  ).lean();
};

const startReview = async (claimId, organizationId, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'SUBMITTED' },
    { $set: { status: 'UNDER_REVIEW' }, $push: { timeline: timelineEvent } },
    { returnDocument: 'after' }
  ).lean();
};

const requestCorrection = async (claimId, organizationId, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'UNDER_REVIEW' },
    {
      $set: { status: 'CORRECTION_REQUIRED' },
      $push: { timeline: timelineEvent },
    },
    { returnDocument: 'after' }
  ).lean();
};

const makeDecision = async (claimId, organizationId, decision, decisionNotes, timelineEvent, lossAssessmentDoc = null) => {
  const userObjectId = new mongoose.Types.ObjectId(timelineEvent.performedBy);

  let pipeline;
  if (decision === 'REJECTED') {
    pipeline = [
      {
        $set: {
          status: { $literal: 'REJECTED' },
          decisionNotes: { $literal: decisionNotes || null },
          'reserve.indemnity': { $literal: 0 },
          'reserve.expense': { $literal: 0 },
          'reserve.history': {
            $concatArrays: [
              { $ifNull: ['$reserve.history', []] },
              [
                {
                  category: { $literal: 'INDEMNITY' },
                  previousAmount: { $ifNull: ['$reserve.indemnity', null] },
                  newAmount: { $literal: 0 },
                  source: { $literal: 'STATUS_ZERO' },
                  reason: { $literal: decisionNotes || null },
                  performedBy: { $literal: userObjectId },
                  role: { $literal: timelineEvent.role },
                  at: { $literal: timelineEvent.timestamp || new Date() },
                },
                {
                  category: { $literal: 'EXPENSE' },
                  previousAmount: { $ifNull: ['$reserve.expense', null] },
                  newAmount: { $literal: 0 },
                  source: { $literal: 'STATUS_ZERO' },
                  reason: { $literal: decisionNotes || null },
                  performedBy: { $literal: userObjectId },
                  role: { $literal: timelineEvent.role },
                  at: { $literal: timelineEvent.timestamp || new Date() },
                },
              ],
            ],
          },
          timeline: {
            $concatArrays: [
              { $ifNull: ['$timeline', []] },
              [
                {
                  action: { $literal: timelineEvent.action },
                  previousStatus: { $literal: timelineEvent.previousStatus },
                  newStatus: { $literal: timelineEvent.newStatus },
                  notes: { $literal: timelineEvent.notes || null },
                  performedBy: { $literal: userObjectId },
                  role: { $literal: timelineEvent.role },
                  timestamp: { $literal: timelineEvent.timestamp || new Date() },
                },
              ],
            ],
          },
        },
      },
    ];
  } else {
    // APPROVED
    const safeLossAssessment = lossAssessmentDoc
      ? {
          ...lossAssessmentDoc,
          ...(lossAssessmentDoc.assessedBy
            ? { assessedBy: new mongoose.Types.ObjectId(lossAssessmentDoc.assessedBy) }
            : {}),
        }
      : null;

    pipeline = [
      {
        $set: {
          status: { $literal: 'APPROVED' },
          decisionNotes: { $literal: decisionNotes || null },
          lossAssessment: { $literal: safeLossAssessment },
          'reserve.indemnity': { $literal: lossAssessmentDoc.netApprovedPayout },
          'reserve.history': {
            $concatArrays: [
              { $ifNull: ['$reserve.history', []] },
              [
                {
                  category: { $literal: 'INDEMNITY' },
                  previousAmount: { $ifNull: ['$reserve.indemnity', null] },
                  newAmount: { $literal: lossAssessmentDoc.netApprovedPayout },
                  source: { $literal: 'DECISION' },
                  reason: { $literal: decisionNotes || null },
                  performedBy: { $literal: userObjectId },
                  role: { $literal: timelineEvent.role },
                  at: { $literal: timelineEvent.timestamp || new Date() },
                },
              ],
            ],
          },
          timeline: {
            $concatArrays: [
              { $ifNull: ['$timeline', []] },
              [
                {
                  action: { $literal: timelineEvent.action },
                  previousStatus: { $literal: timelineEvent.previousStatus },
                  newStatus: { $literal: timelineEvent.newStatus },
                  notes: { $literal: timelineEvent.notes || null },
                  performedBy: { $literal: userObjectId },
                  role: { $literal: timelineEvent.role },
                  timestamp: { $literal: timelineEvent.timestamp || new Date() },
                },
              ],
            ],
          },
        },
      },
    ];
  }

  return await Claim.findOneAndUpdate(
    { _id: claimId, organizationId, status: 'UNDER_REVIEW' },
    pipeline,
    { returnDocument: 'after', updatePipeline: true }
  ).lean();
};

const closeClaim = async (claimId, organizationId, closedBy, closingNotes, timelineEvent) => {
  const userObjectId = new mongoose.Types.ObjectId(closedBy);
  const pipeline = [
    {
      $set: {
        status: { $literal: 'CLOSED' },
        closedBy: { $literal: userObjectId },
        closedAt: { $literal: timelineEvent.timestamp || new Date() },
        closingNotes: { $literal: closingNotes || null },
        'reserve.indemnity': { $literal: 0 },
        'reserve.expense': { $literal: 0 },
        'reserve.history': {
          $concatArrays: [
            { $ifNull: ['$reserve.history', []] },
            [
              {
                category: { $literal: 'INDEMNITY' },
                previousAmount: { $ifNull: ['$reserve.indemnity', null] },
                newAmount: { $literal: 0 },
                source: { $literal: 'STATUS_ZERO' },
                reason: { $literal: closingNotes || null },
                performedBy: { $literal: userObjectId },
                role: { $literal: timelineEvent.role || 'ADMIN' },
                at: { $literal: timelineEvent.timestamp || new Date() },
              },
              {
                category: { $literal: 'EXPENSE' },
                previousAmount: { $ifNull: ['$reserve.expense', null] },
                newAmount: { $literal: 0 },
                source: { $literal: 'STATUS_ZERO' },
                reason: { $literal: closingNotes || null },
                performedBy: { $literal: userObjectId },
                role: { $literal: timelineEvent.role || 'ADMIN' },
                at: { $literal: timelineEvent.timestamp || new Date() },
              },
            ],
          ],
        },
        timeline: {
          $concatArrays: [
            { $ifNull: ['$timeline', []] },
            [
              {
                action: { $literal: timelineEvent.action },
                previousStatus: { $literal: timelineEvent.previousStatus },
                newStatus: { $literal: timelineEvent.newStatus },
                notes: { $literal: timelineEvent.notes || null },
                performedBy: { $literal: userObjectId },
                role: { $literal: timelineEvent.role || 'ADMIN' },
                timestamp: { $literal: timelineEvent.timestamp || new Date() },
              },
            ],
          ],
        },
      },
    },
  ];

  const filter = {
    _id: claimId,
    organizationId,
    status: 'APPROVED',
    'lossAssessment.netApprovedPayout': { $type: 'number' },
    $expr: {
      $gte: [
        { $ifNull: ['$paidTotals.indemnity', 0] },
        '$lossAssessment.netApprovedPayout',
      ],
    },
    repairOrders: {
      $not: {
        $elemMatch: {
          status: { $in: Claim.ACTIVE_REPAIR_ORDER_STATUSES },
        },
      },
    },
  };

  return await Claim.findOneAndUpdate(
    filter,
    pipeline,
    { returnDocument: 'after', updatePipeline: true }
  ).lean();
};

const adjustReserve = async (filter, updateDoc) => {
  return await Claim.findOneAndUpdate(
    filter,
    updateDoc,
    { returnDocument: 'after' }
  )
    .populate('reserve.history.performedBy', 'name employeeCode')
    .lean();
};

const findReserveById = async (claimId, organizationId) => {
  return await Claim.findOne({ _id: claimId, organizationId })
    .select('reserve')
    .populate('reserve.history.performedBy', 'name employeeCode')
    .lean();
};

const getOutstandingReserve = async (organizationId) => {
  const orgObjectId =
    typeof organizationId === 'string'
      ? new mongoose.Types.ObjectId(organizationId)
      : organizationId;

  const match = {
    organizationId: orgObjectId,
    status: { $nin: ['REJECTED', 'CLOSED'] },
  };

  const results = await Claim.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalIndemnity: { $sum: '$reserve.indemnity' },
        totalExpense: { $sum: '$reserve.expense' },
      },
    },
  ]);

  const row = results[0] || { totalIndemnity: 0, totalExpense: 0 };
  return {
    indemnity: row.totalIndemnity,
    expense: row.totalExpense,
  };
};

/**
 * Aggregates claim status counts scoped by tenant (organizationId), optional assignee, and optional date range on createdAt.
 * @param {Object} options
 * @param {string|mongoose.Types.ObjectId} options.organizationId
 * @param {string|mongoose.Types.ObjectId} [options.assignedTo]
 * @param {Date} [options.fromDate]
 * @param {Date} [options.toDate]
 * @returns {Promise<Array<{ _id: string, count: number }>>}
 */
const getClaimStats = async ({ organizationId, assignedTo, fromDate, toDate }) => {
  const orgObjectId =
    typeof organizationId === 'string'
      ? new mongoose.Types.ObjectId(organizationId)
      : organizationId;

  const match = {
    organizationId: orgObjectId,
  };

  if (assignedTo) {
    match.assignedTo =
      typeof assignedTo === 'string'
        ? new mongoose.Types.ObjectId(assignedTo)
        : assignedTo;
  }

  if (fromDate || toDate) {
    match.createdAt = {
      ...(fromDate && { $gte: fromDate instanceof Date ? fromDate : new Date(fromDate) }),
      ...(toDate && { $lte: toDate instanceof Date ? toDate : new Date(toDate) }),
    };
  }


  const pipeline = [
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ];

  return await Claim.aggregate(pipeline);
};

const acceptAssignment = async (claimId, organizationId, assignedTo, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    {
      _id: claimId,
      organizationId,
      status: 'PENDING_ACCEPTANCE',
      assignedTo,
    },
    {
      $set: { status: 'ASSIGNED' },
      $push: { timeline: timelineEvent },
    },
    { returnDocument: 'after' }
  ).lean();
};

const declineAssignment = async (claimId, organizationId, assignedTo, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    {
      _id: claimId,
      organizationId,
      status: 'PENDING_ACCEPTANCE',
      assignedTo,
    },
    {
      $set: {
        status: 'NEW',
        assignedTo: null,
        assignedBy: null,
        assignedAt: null,
        assignmentNotes: null,
      },
      $push: { timeline: timelineEvent },
    },
    { returnDocument: 'after' }
  ).lean();
};

/**
 * Atomically rotates a claim's tracking token and appends a timeline audit event.
 * Allowed in every status.
 *
 * @param {string|ObjectId} claimId
 * @param {string|ObjectId} organizationId
 * @param {string} newToken
 * @param {string} reason
 * @param {string|ObjectId} userId
 * @param {string} role
 * @returns {Promise<Object|null>} Updated claim document (lean) or null
 */
const rotateTrackingToken = async (claimId, organizationId, newToken, reason, userId, role) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const now = new Date();

  const filter = {
    _id: claimId,
    organizationId,
  };

  const pipeline = [
    {
      $set: {
        trackingToken: { $literal: newToken },
        timeline: {
          $concatArrays: [
            { $ifNull: ['$timeline', []] },
            [
              {
                action: { $literal: 'Tracking Link Rotated' },
                previousStatus: '$status',
                newStatus: '$status',
                notes: { $literal: reason },
                performedBy: { $literal: userObjectId },
                role: { $literal: role },
                timestamp: { $literal: now },
              },
            ],
          ],
        },
      },
    },
  ];

  return await Claim.findOneAndUpdate(filter, pipeline, {
    returnDocument: 'after',
    updatePipeline: true,
  }).lean();
};

/**
 * Finds a claim by its public tracking token.
 * Populates vehicle details for public status display and selects only needed fields.
 */
const findByTrackingToken = async (trackingToken) => {
  return await Claim.findOne({ trackingToken })
    .select('claimNumber status vehicle timeline createdAt closedAt')
    .populate({
      path: 'vehicle.vehicleId',
      select: 'plateNumber make model year',
    })
    .lean();
};


const addEstimate = async (filter, updateDoc) => {
  return await Claim.findOneAndUpdate(
    filter,
    updateDoc,
    { returnDocument: 'after' }
  ).lean();
};

const approveEstimate = async (claimId, organizationId, version, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    {
      _id: claimId,
      organizationId,
      status: 'UNDER_REVIEW',
      'estimates.version': version,
    },
    {
      $set: { approvedEstimateVersion: version },
      $push: { timeline: timelineEvent },
    },
    { returnDocument: 'after' }
  ).lean();
};

const atomicCreateRepairOrder = async (filter, orderDoc, timelineEvent) => {
  return await Claim.findOneAndUpdate(
    filter,
    {
      $push: {
        repairOrders: orderDoc,
        timeline: timelineEvent,
      },
    },
    { returnDocument: 'after' }
  ).lean();
};

const atomicUpdateRepairOrderStatus = async (filter, updateDoc) => {
  return await Claim.findOneAndUpdate(
    filter,
    updateDoc,
    { returnDocument: 'after' }
  ).lean();
};

const atomicCreateDischarge = async (filter, updatePipeline) => {
  return await Claim.findOneAndUpdate(
    filter,
    updatePipeline,
    { returnDocument: 'after', updatePipeline: true }
  ).lean();
};

const atomicSignDischarge = async (filter, updateDoc) => {
  return await Claim.findOneAndUpdate(
    filter,
    updateDoc,
    { returnDocument: 'after' }
  ).lean();
};

const findDischargesByClaimId = async (claimId, organizationId) => {
  return await Claim.findOne({ _id: claimId, organizationId })
    .select('discharges')
    .lean();
};

const findDischargeByNumber = async (claimId, organizationId, dischargeNumber) => {
  return await Claim.findOne(
    { _id: claimId, organizationId, 'discharges.dischargeNumber': dischargeNumber },
    { 'discharges.$': 1, claimNumber: 1 }
  ).lean();
};


const atomicRecordPayment = async (filter, updateDoc) => {
  return await Claim.findOneAndUpdate(
    filter,
    updateDoc,
    { returnDocument: 'after' }
  ).lean();
};

const atomicReversePayment = async (filter, updateDoc) => {
  return await Claim.findOneAndUpdate(
    filter,
    updateDoc,
    { returnDocument: 'after' }
  ).lean();
};

const findPaymentsByClaimId = async (claimId, organizationId) => {
  return await Claim.findOne({ _id: claimId, organizationId })
    .select('payments paidTotals lossAssessment status reversedPaymentNumbers')
    .lean();
};

module.exports = {
  CLAIM_LIST_PROJECTION,
  create,
  findByOrganization,
  findByAssignee,
  findByIdAndOrganization,
  countActiveClaimsByAssignee,
  assignClaim,
  acceptAssignment,
  declineAssignment,
  startInspection,
  updateVehicle,
  updateAccident,
  updateLocation,
  addEvidence,
  setSignature,
  submitInspection,
  startReview,
  requestCorrection,
  makeDecision,
  closeClaim,
  getClaimStats,
  findForReport,
  findByTrackingToken,
  rotateTrackingToken,
  findByIncidentId,
  addEstimate,
  approveEstimate,
  atomicCreateRepairOrder,
  atomicUpdateRepairOrderStatus,
  adjustReserve,
  findReserveById,
  getOutstandingReserve,
  atomicCreateDischarge,
  atomicSignDischarge,
  findDischargesByClaimId,
  findDischargeByNumber,
  atomicRecordPayment,
  atomicReversePayment,
  findPaymentsByClaimId,
};

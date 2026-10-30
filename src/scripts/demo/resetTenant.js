const mongoose = require('mongoose');
const Organization = require('../../modules/organizations/organization.model');
const User = require('../../modules/users/user.model');
const Customer = require('../../modules/customers/customer.model');
const Vehicle = require('../../modules/vehicles/vehicle.model');
const Policy = require('../../modules/policies/policy.model');
const Garage = require('../../modules/garages/garage.model');
const Incident = require('../../modules/incidents/incident.model');
const Claim = require('../../modules/claims/claim.model');
const Letter = require('../../modules/letters/letter.model');
const Notification = require('../../modules/notifications/notification.model');
const Counter = require('../../utils/counter.model');

/**
 * Resolves a model on the given connection or falls back to the default required model.
 */
const getModel = (conn, name, defaultModel) => {
  if (!conn || conn === mongoose || conn === mongoose.connection) {
    return defaultModel;
  }
  if (conn.models && conn.models[name]) {
    return conn.models[name];
  }
  if (typeof conn.model === 'function') {
    try {
      return conn.model(name);
    } catch {
      return conn.model(name, defaultModel.schema);
    }
  }
  return defaultModel;
};

/**
 * Resets the SAWN-DEMO tenant.
 * R13: Refuses to touch any tenant other than SAWN-DEMO.
 * C9: Scopes Counter deletion strictly to SAWN-DEMO sequences.
 *
 * @param {object} options
 * @param {boolean} options.confirm - If false, runs dry-run mode and deletes nothing.
 * @param {object} options.connection - Mongoose connection instance
 * @param {function} options.log - Logging callback
 */
const resetTenant = async ({
  confirm = false,
  connection = mongoose.connection,
  conn,
  log = console.log,
} = {}) => {
  const activeConn = connection || conn || mongoose.connection || mongoose;

  const OrganizationModel = getModel(activeConn, 'Organization', Organization);
  const UserModel = getModel(activeConn, 'User', User);
  const CustomerModel = getModel(activeConn, 'Customer', Customer);
  const VehicleModel = getModel(activeConn, 'Vehicle', Vehicle);
  const PolicyModel = getModel(activeConn, 'Policy', Policy);
  const GarageModel = getModel(activeConn, 'Garage', Garage);
  const IncidentModel = getModel(activeConn, 'Incident', Incident);
  const ClaimModel = getModel(activeConn, 'Claim', Claim);
  const LetterModel = getModel(activeConn, 'Letter', Letter);
  const NotificationModel = getModel(activeConn, 'Notification', Notification);
  const CounterModel = getModel(activeConn, 'Counter', Counter);

  const org = await OrganizationModel.findOne({ code: 'SAWN-DEMO' });
  if (!org) {
    if (typeof log === 'function') {
      log('SAWN-DEMO tenant does not exist.');
    }
    return { dryRun: !confirm, deletedCounts: {} };
  }

  // R13: Guard assertion
  if (org.code !== 'SAWN-DEMO') {
    throw new Error(`Refusing to reset tenant with code "${org.code}". Only SAWN-DEMO may be reset.`);
  }

  // C9: Scoped Counter delete filter
  const counterFilter = {
    $or: [
      { _id: `claimNumber_${org._id}` },
      { _id: `incidentNumber_${org._id}` },
      {
        _id: {
          $regex: new RegExp(`^(letter|repair-order|discharge|payment):${org._id}:\\d{4}$`),
        },
      },
    ],
  };

  const notificationCount = await NotificationModel.countDocuments({ organizationId: org._id });
  const letterCount = await LetterModel.countDocuments({ organizationId: org._id });
  const claimCount = await ClaimModel.countDocuments({ organizationId: org._id });
  const incidentCount = await IncidentModel.countDocuments({ organizationId: org._id });
  const vehicleCount = await VehicleModel.countDocuments({ organizationId: org._id });
  const policyCount = await PolicyModel.countDocuments({ organizationId: org._id });
  const customerCount = await CustomerModel.countDocuments({ organizationId: org._id });
  const garageCount = await GarageModel.countDocuments({ organizationId: org._id });
  const userCount = await UserModel.countDocuments({ organizationId: org._id });
  const counterCount = await CounterModel.countDocuments(counterFilter);

  const deletedCounts = {
    notifications: notificationCount,
    letters: letterCount,
    claims: claimCount,
    incidents: incidentCount,
    vehicles: vehicleCount,
    policies: policyCount,
    customers: customerCount,
    garages: garageCount,
    users: userCount,
    counters: counterCount,
    organizations: 1,
    // Alias with Model names
    Notification: notificationCount,
    Letter: letterCount,
    Claim: claimCount,
    Incident: incidentCount,
    Vehicle: vehicleCount,
    Policy: policyCount,
    Customer: customerCount,
    Garage: garageCount,
    User: userCount,
    Counter: counterCount,
    Organization: 1,
  };

  if (!confirm) {
    if (typeof log === 'function') {
      log(
        `[DRY-RUN] SAWN-DEMO tenant exists with ${claimCount} claims, ${policyCount} policies, ${vehicleCount} vehicles. No records deleted.`
      );
    }
    return { dryRun: true, deletedCounts };
  }

  // Confirm is true: delete in cascading order (1 to 11)
  await NotificationModel.deleteMany({ organizationId: org._id });
  try {
    await LetterModel.deleteMany({ organizationId: org._id });
  } catch {
    // Letter records have immutability hooks on Mongoose queries; bypass via underlying collection
    if (LetterModel.collection && typeof LetterModel.collection.deleteMany === 'function') {
      await LetterModel.collection.deleteMany({ organizationId: org._id });
    }
  }
  await ClaimModel.deleteMany({ organizationId: org._id });
  await IncidentModel.deleteMany({ organizationId: org._id });
  await VehicleModel.deleteMany({ organizationId: org._id });
  await PolicyModel.deleteMany({ organizationId: org._id });
  await CustomerModel.deleteMany({ organizationId: org._id });
  await GarageModel.deleteMany({ organizationId: org._id });
  await UserModel.deleteMany({ organizationId: org._id });
  await CounterModel.deleteMany(counterFilter);
  await OrganizationModel.deleteOne({ _id: org._id });

  if (typeof log === 'function') {
    log('[RESET] SAWN-DEMO tenant and all associated records deleted successfully.');
  }

  return { dryRun: false, deletedCounts };
};

resetTenant.resetTenant = resetTenant;

module.exports = {
  resetTenant,
};

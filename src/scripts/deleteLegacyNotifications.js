const mongoose = require('mongoose');
const config = require('../config/env');
const Notification = require('../modules/notifications/notification.model');

/**
 * Cleanup Script: Delete Legacy Notifications
 * Permanently removes legacy notifications that lack the params object.
 *
 * Operational Safety Constraints:
 * 1. Default mode is strictly DRY-RUN. Actual database deletion requires the explicit --apply flag.
 * 2. Prints target database name and partially masked host before any operation.
 * 3. Target filter is strictly { params: { $exists: false } }.
 * 4. Idempotent: Subsequent executions find 0 records to delete.
 *
 * Usage:
 *   Dry-Run (Default): node src/scripts/deleteLegacyNotifications.js
 *   Live Apply:        node src/scripts/deleteLegacyNotifications.js --apply
 *
 * @param {object} options
 * @param {boolean} options.apply - When true, deletes matching records from the database. Defaults to false (dry-run).
 * @param {boolean} options.disconnect - Optional override for controlling mongoose disconnection.
 * @returns {Promise<{ found: number, deleted: number, isDryRun: boolean }>}
 */
const deleteLegacyNotifications = async ({ apply = false, disconnect } = {}) => {
  const isApply = apply || process.argv.includes('--apply');
  const isDryRun = !isApply;
  const shouldConnect = mongoose.connection.readyState === 0;
  const shouldDisconnect = disconnect !== undefined ? disconnect : (shouldConnect || require.main === module);

  try {
    if (shouldConnect) {
      const mongoUri = config.databaseUrl;
      await mongoose.connect(mongoUri);
    }

    const dbName = mongoose.connection.name || 'unknown_db';
    const rawHost = mongoose.connection.host || 'unknown_host';
    // Partially mask host for privacy/security: keep prefix and domain suffix
    const maskedHost =
      rawHost.length > 8
        ? `${rawHost.slice(0, 3)}***${rawHost.slice(-11)}`
        : '***';

    console.log(`======================================================`);
    console.log(`Legacy Notification Cleanup Script`);
    console.log(`Target Database: [${dbName}] | Target Host: [${maskedHost}]`);
    console.log(`Execution Mode:  [${isDryRun ? 'DRY-RUN (Safe Read-Only)' : 'APPLY (Live Deletion)'}]`);
    if (isDryRun) {
      console.log(`Notice: Running in dry-run mode. Pass --apply to persist changes.`);
    }
    console.log(`======================================================`);

    const query = { params: { $exists: false } };

    const legacyCount = await Notification.countDocuments(query);
    console.log(`Found ${legacyCount} legacy notifications requiring deletion.`);

    if (isDryRun) {
      console.log(`------------------------------------------------------`);
      console.log(
        `Cleanup Summary: Target DB: [${dbName}] | Host: [${maskedHost}] | DRY-RUN completed. 0 records modified. (Total eligible found: ${legacyCount})`
      );
      console.log(`======================================================`);

      return { found: legacyCount, deleted: 0, isDryRun: true };
    }

    const result = await Notification.deleteMany(query);

    console.log(`------------------------------------------------------`);
    console.log(
      `Cleanup Summary: Target DB: [${dbName}] | Host: [${maskedHost}] | Successfully deleted ${result.deletedCount} records. (Total eligible found: ${legacyCount})`
    );
    console.log(`======================================================`);

    return { found: legacyCount, deleted: result.deletedCount, isDryRun: false };
  } catch (error) {
    console.error('Cleanup failed with error:', error);
    throw error;
  } finally {
    if (shouldDisconnect && mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('Disconnected from MongoDB');
    }
  }
};

// Execute if run directly from CLI
if (require.main === module) {
  deleteLegacyNotifications().catch(() => process.exit(1));
}

module.exports = deleteLegacyNotifications;

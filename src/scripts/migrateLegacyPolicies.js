const mongoose = require('mongoose');
const config = require('../config/env');
const Policy = require('../modules/policies/policy.model');

/**
 * Migration Script: Backfill Legacy Policies
 * Idempotently updates legacy policies in MongoDB that lack policyType or deductibleAmount.
 *
 * Operational Safety Constraints:
 * 1. Default mode is strictly DRY-RUN. Actual database write requires the explicit --apply flag.
 * 2. Prints target database name and partially masked host before any operation.
 * 3. Uses $set exclusively on missing fields; never overwrites existing valid data.
 * 4. Safe defaults: policyType: 'THIRD_PARTY', coveredPerils: [], deductibleAmount: 0.
 * 5. Idempotent: Subsequent executions find 0 records to update.
 *
 * Usage:
 *   Dry-Run (Default): node src/scripts/migrateLegacyPolicies.js
 *   Live Apply:        node src/scripts/migrateLegacyPolicies.js --apply
 *
 * @param {object} options
 * @param {boolean} options.apply - When true, writes changes to the database. Defaults to false (dry-run).
 * @returns {Promise<{ found: number, updated: number, isDryRun: boolean }>}
 */
const migrateLegacyPolicies = async ({ apply = false, disconnect } = {}) => {
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
    console.log(`Legacy Policy Migration Script`);
    console.log(`Target Database: [${dbName}] | Target Host: [${maskedHost}]`);
    console.log(`Execution Mode:  [${isDryRun ? 'DRY-RUN (Safe Read-Only)' : 'APPLY (Live Updates)'}]`);
    if (isDryRun) {
      console.log(`Notice: Running in dry-run mode. Pass --apply to persist changes.`);
    }
    console.log(`======================================================`);

    // Find all policies missing policyType OR deductibleAmount
    const query = {
      $or: [
        { policyType: { $exists: false } },
        { policyType: null },
        { deductibleAmount: { $exists: false } },
        { deductibleAmount: null },
      ],
    };

    const legacyPolicies = await Policy.find(query);
    console.log(`Found ${legacyPolicies.length} legacy policies requiring migration.`);

    let updatedCount = 0;

    for (const policy of legacyPolicies) {
      const updateFields = {};

      if (!policy.policyType) {
        updateFields.policyType = 'THIRD_PARTY';
        updateFields.coveredPerils = [];
      }
      if (policy.deductibleAmount === undefined || policy.deductibleAmount === null) {
        updateFields.deductibleAmount = 0;
      }

      if (isDryRun) {
        console.log(
          `[DRY-RUN] Would update Policy ID: ${policy._id}, Number: ${policy.policyNumber} with:`,
          JSON.stringify(updateFields)
        );
      } else {
        await Policy.updateOne(
          { _id: policy._id },
          { $set: updateFields }
        );
        console.log(
          `[APPLIED] Policy ID: ${policy._id}, Number: ${policy.policyNumber} updated with: policyType=${updateFields.policyType || policy.policyType}, deductibleAmount=${updateFields.deductibleAmount ?? policy.deductibleAmount}`
        );
        updatedCount++;
      }
    }

    console.log(`------------------------------------------------------`);
    console.log(
      `Migration Summary: ${isDryRun ? 'DRY-RUN completed. 0 records modified.' : `Successfully updated ${updatedCount} records.`} (Total eligible found: ${legacyPolicies.length})`
    );
    console.log(`======================================================`);

    return { found: legacyPolicies.length, updated: updatedCount, isDryRun };
  } catch (error) {
    console.error('Migration failed with error:', error);
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
  migrateLegacyPolicies().catch(() => process.exit(1));
}

module.exports = migrateLegacyPolicies;

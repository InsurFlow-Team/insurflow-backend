const mongoose = require('mongoose');
const config = require('../config/env');
const { toMinor } = require('../utils/money');

/**
 * Migration Script: Migrate Money to Minor Units (PB-39)
 *
 * Converts major-unit currency fields in policies and claims to integer minor units.
 * Idempotent: Skips any document already tagged with moneyUnit: 'MINOR'.
 *
 * @param {object} options
 * @param {boolean} [options.apply=false] - If true, persists updates to the database.
 * @param {boolean} [options.disconnect] - If provided, controls MongoDB disconnection.
 * @returns {Promise<{
 *   isDryRun: boolean,
 *   policies: { found: number, updated: number, failed: number },
 *   claims: { found: number, updated: number, failed: number },
 *   failures: Array<{ collection: string, _id: any, field: string|null, value: any, error: string }>
 * }>}
 */
const migrateMoneyToMinorUnits = async ({ apply = false, disconnect } = {}) => {
  const isApply = Boolean(apply) || process.argv.includes('--apply');
  const isDryRun = !isApply;
  const shouldConnect = mongoose.connection.readyState === 0;
  const shouldDisconnect = disconnect !== undefined ? disconnect : (shouldConnect || require.main === module);

  try {
    if (shouldConnect) {
      await mongoose.connect(config.databaseUrl);
    }

    const dbName = mongoose.connection.name || 'unknown_db';
    const policiesColl = mongoose.connection.db.collection('policies');
    const claimsColl = mongoose.connection.db.collection('claims');

    const unmigratedFilter = { moneyUnit: { $ne: 'MINOR' } };

    const unmigratedPolicies = await policiesColl.find(unmigratedFilter).toArray();
    const unmigratedClaims = await claimsColl.find(unmigratedFilter).toArray();

    const failures = [];
    let policiesUpdated = 0;
    let policiesFailed = 0;
    let claimsUpdated = 0;
    let claimsFailed = 0;

    // Migrate Policies
    for (const doc of unmigratedPolicies) {
      let currentField = null;
      let currentValue = null;
      try {
        const updateFields = { moneyUnit: 'MINOR' };
        const policyFields = ['deductibleAmount', 'sumInsured', 'propertyDamageLimit'];
        for (const field of policyFields) {
          if (typeof doc[field] === 'number') {
            currentField = field;
            currentValue = doc[field];
            updateFields[field] = toMinor(doc[field], config.currency);
          }
        }

        if (isDryRun) {
          console.log(`[DRY-RUN] Policy ${doc._id} (${doc.policyNumber || ''}) would update with:`, updateFields);
        } else {
          currentField = null;
          currentValue = null;
          const res = await policiesColl.updateOne(
            { _id: doc._id, moneyUnit: { $ne: 'MINOR' } },
            { $set: updateFields }
          );
          if (res.matchedCount > 0) {
            policiesUpdated++;
          }
        }
      } catch (error) {
        policiesFailed++;
        failures.push({
          collection: 'policies',
          _id: doc._id,
          field: currentField,
          value: currentValue,
          error: error.message,
        });
      }
    }

    // Migrate Claims
    for (const doc of unmigratedClaims) {
      let currentField = null;
      let currentValue = null;
      try {
        const updateFields = { moneyUnit: 'MINOR' };

        if (doc.coverageSnapshot && typeof doc.coverageSnapshot === 'object') {
          const snapshotFields = ['deductibleAmount', 'sumInsured'];
          for (const field of snapshotFields) {
            if (typeof doc.coverageSnapshot[field] === 'number') {
              currentField = `coverageSnapshot.${field}`;
              currentValue = doc.coverageSnapshot[field];
              updateFields[`coverageSnapshot.${field}`] = toMinor(doc.coverageSnapshot[field], config.currency);
            }
          }
        }

        if (doc.lossAssessment && typeof doc.lossAssessment === 'object') {
          const lossFields = [
            'estimatedPartsCost',
            'laborCost',
            'totalDamage',
            'policyDeductible',
            'deductibleApplied',
            'netApprovedPayout',
          ];
          for (const field of lossFields) {
            if (typeof doc.lossAssessment[field] === 'number') {
              currentField = `lossAssessment.${field}`;
              currentValue = doc.lossAssessment[field];
              updateFields[`lossAssessment.${field}`] = toMinor(doc.lossAssessment[field], config.currency);
            }
          }
        }

        if (isDryRun) {
          console.log(`[DRY-RUN] Claim ${doc._id} (${doc.claimNumber || ''}) would update with:`, updateFields);
        } else {
          currentField = null;
          currentValue = null;
          const res = await claimsColl.updateOne(
            { _id: doc._id, moneyUnit: { $ne: 'MINOR' } },
            { $set: updateFields }
          );
          if (res.matchedCount > 0) {
            claimsUpdated++;
          }
        }
      } catch (error) {
        claimsFailed++;
        failures.push({
          collection: 'claims',
          _id: doc._id,
          field: currentField,
          value: currentValue,
          error: error.message,
        });
      }
    }

    return {
      dbName,
      isDryRun,
      policies: {
        found: unmigratedPolicies.length,
        updated: policiesUpdated,
        failed: policiesFailed,
      },
      claims: {
        found: unmigratedClaims.length,
        updated: claimsUpdated,
        failed: claimsFailed,
      },
      failures,
    };
  } catch (err) {
    console.error('Migration failed with fatal error:', err);
    throw err;
  } finally {
    if (shouldDisconnect && mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
};

if (require.main === module) {
  migrateMoneyToMinorUnits()
    .then((result) => {
      console.log(`Database: ${result.dbName}`);
      console.log(JSON.stringify(result, null, 2));
      if (result.failures && result.failures.length > 0) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration script failed:', err);
      process.exit(1);
    });
}

module.exports = migrateMoneyToMinorUnits;

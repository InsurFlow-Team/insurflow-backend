const config = require('../config/env')
const mongoose = require('mongoose');
const Organization = require('../modules/organizations/organization.model');
const Customer = require('../modules/customers/customer.model');
const Policy = require('../modules/policies/policy.model');
const Vehicle = require('../modules/vehicles/vehicle.model');
const User = require('../modules/users/user.model');
const Garage = require('../modules/garages/garage.model');
const { toMinor } = require('../utils/money');
const { normalizeGarageName } = require('../modules/garages/garage.service');

const seedMockData = async () => {
  try {
    const mongoUri = config.databaseUrl;
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    // Create a demo organization if it doesn't exist
    let organization = await Organization.findOne({ name: 'Demo Insurance Co' });
    if (!organization) {
      organization = await Organization.create({
        name: 'Demo Insurance Co',
        code: 'DEMO-INS',
        settings: {
          letterhead: {
            address: 'Al-Irsal St, Ramallah, Palestine',
            phone: '+97022987654',
          },
        },
      });
      console.log('Created Demo Organization');
    }

    // PB-09 (C5): update letterhead on existing mock organization if address is null
    await Organization.updateOne(
      { code: 'DEMO-INS', 'settings.letterhead.address': null },
      {
        $set: {
          'settings.letterhead': {
            address: 'Al-Irsal St, Ramallah, Palestine',
            phone: '+97022987654',
          },
        },
      }
    );

    // Create demo users only if they don't already exist (preserves passwords and accounts on live DB)
    const demoUsers = [
      {
        name: 'Admin User',
        employeeCode: 'AD-001',
        password: 'Password123!',
        role: 'ADMIN',
        organizationId: organization._id,
        status: 'ACTIVE',
      },
      {
        name: 'Sara Officer',
        employeeCode: 'CO-001',
        password: 'Password123!',
        role: 'CLAIMS_OFFICER',
        organizationId: organization._id,
        status: 'ACTIVE',
      },
      {
        name: 'Ahmed Adjuster',
        employeeCode: 'FA-001',
        password: 'Password123!',
        role: 'FIELD_ADJUSTER',
        organizationId: organization._id,
        status: 'ACTIVE',
        surveyorLicenseNumber: 'DEMO-FA-001',
        surveyorLicenseExpiry: '2027-12-31',
      },
      {
        name: 'Second Adjuster',
        employeeCode: 'FA-002',
        password: 'Password123!',
        role: 'FIELD_ADJUSTER',
        organizationId: organization._id,
        status: 'ACTIVE',
        surveyorLicenseNumber: 'DEMO-FA-002',
        surveyorLicenseExpiry: '2027-12-31',
      },
    ];

    for (const u of demoUsers) {
      const existingUser = await User.findOne({
        organizationId: organization._id,
        employeeCode: u.employeeCode,
      });
      if (!existingUser) {
        await User.create(u);
        console.log(`Created Demo User: ${u.employeeCode} (${u.role})`);
      } else {
        if (u.role === 'FIELD_ADJUSTER') {
          await User.updateOne(
            { organizationId: organization._id, employeeCode: u.employeeCode, surveyorLicenseNumber: null },
            {
              $set: {
                surveyorLicenseNumber: u.surveyorLicenseNumber,
                surveyorLicenseExpiry: u.surveyorLicenseExpiry,
              },
            }
          );
        }
        console.log(`Demo User ${u.employeeCode} already exists. Preserved without changes.`);
      }
    }

    // Create mock customers (idempotent upsert)
    const customersData = [
      { fullName: 'John Doe', phone: '+1234567890', organizationId: organization._id },
      { fullName: 'Jane Smith', phone: '+1987654321', organizationId: organization._id },
      { fullName: 'Tariq Mansour', phone: '+962795551234', organizationId: organization._id },
    ];

    const customers = [];
    for (const c of customersData) {
      const customer = await Customer.findOneAndUpdate(
        { organizationId: organization._id, phone: c.phone },
        { $set: c },
        { upsert: true, returnDocument: 'after' }
      );
      customers.push(customer);
    }
    console.log('Seeded Mock Customers');

    // Create mock policies (idempotent upsert on { organizationId, policyNumber })
    const policiesData = [
      {
        policyNumber: 'POL-1000',
        policyKind: 'COMPLEMENTARY',
        status: 'ACTIVE',
        policyType: 'COMPREHENSIVE',
        coveredPerils: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
        deductibleAmount: 50000,
        sumInsured: 5000000,
        propertyDamageLimit: null,
        moneyUnit: 'MINOR',
        startDate: new Date('2025-01-01'),
        expiryDate: new Date('2027-12-31'),
        organizationId: organization._id,
      },
      {
        policyNumber: 'POL-4000',
        policyKind: 'UNIFIED_COMPULSORY',
        status: 'ACTIVE',
        policyType: null,
        coveredPerils: [],
        deductibleAmount: 0,
        sumInsured: null,
        propertyDamageLimit: 10000000,
        moneyUnit: 'MINOR',
        startDate: new Date('2025-01-01'),
        expiryDate: new Date('2027-12-31'),
        organizationId: organization._id,
      },
      {
        policyNumber: 'POL-2000',
        policyKind: 'UNIFIED_COMPULSORY',
        status: 'EXPIRED',
        policyType: null,
        coveredPerils: [],
        deductibleAmount: 0,
        sumInsured: null,
        propertyDamageLimit: 10000000,
        moneyUnit: 'MINOR',
        startDate: new Date('2022-01-01'),
        expiryDate: new Date('2023-12-31'),
        organizationId: organization._id,
      },
      {
        policyNumber: 'POL-3000',
        policyKind: 'COMPLEMENTARY',
        status: 'CANCELLED',
        policyType: 'COMPREHENSIVE',
        coveredPerils: ['COLLISION'],
        deductibleAmount: 25000,
        sumInsured: 5000000,
        propertyDamageLimit: null,
        moneyUnit: 'MINOR',
        startDate: new Date('2025-06-01'),
        expiryDate: new Date('2026-06-01'),
        organizationId: organization._id,
      },
    ];

    const policies = [];
    for (const p of policiesData) {
      const policy = await Policy.findOneAndUpdate(
        { organizationId: organization._id, policyNumber: p.policyNumber },
        { $set: p },
        { upsert: true, returnDocument: 'after' }
      );
      policies.push(policy);
    }
    console.log('Seeded Mock Policies');

    // Create mock vehicles linked to customers and policies (idempotent upsert on plateNumber)
    const vehiclesData = [
      {
        plateNumber: 'ABC-1234',
        make: 'Toyota',
        model: 'Camry',
        year: 2022,
        color: 'White',
        customerId: customers[0]._id,
        complementaryPolicyId: policies[0]._id, compulsoryPolicyId: null, // POL-1000 (COMPLEMENTARY)
        organizationId: organization._id,
      },
      {
        plateNumber: 'TPL-4000',
        make: 'Hyundai',
        model: 'Elantra',
        year: 2023,
        color: 'Silver',
        customerId: customers[2]._id,
        compulsoryPolicyId: policies[1]._id, complementaryPolicyId: null, // POL-4000 (UNIFIED_COMPULSORY)
        organizationId: organization._id,
      },
      {
        plateNumber: 'XYZ-9876',
        make: 'Honda',
        model: 'Civic',
        year: 2019,
        color: 'Black',
        customerId: customers[1]._id,
        compulsoryPolicyId: policies[2]._id, complementaryPolicyId: null, // POL-2000 (EXPIRED)
        organizationId: organization._id,
      },
    ];

    for (const v of vehiclesData) {
      await Vehicle.findOneAndUpdate(
        { organizationId: organization._id, plateNumber: v.plateNumber },
        { $set: v },
        { upsert: true, returnDocument: 'after' }
      );
    }
    console.log('Seeded Mock Vehicles');

    // Create mock garages (idempotent upsert on { organizationId, normalizedName })
    const garagesData = [
      {
        name: 'Al-Manara Auto Repair',
        governorate: 'RAMALLAH_AL_BIREH',
        city: 'Ramallah',
        phone: '+970599111222',
        laborRate: toMinor(80, config.currency),
        approved: true,
        organizationId: organization._id,
      },
      {
        name: 'Nablus Central Garage',
        governorate: 'NABLUS',
        city: 'Nablus',
        phone: '+970599333444',
        laborRate: toMinor(75, config.currency),
        approved: true,
        organizationId: organization._id,
      },
      {
        name: 'Hebron Modern Workshop',
        governorate: 'HEBRON',
        city: 'Hebron',
        phone: '+970599555666',
        laborRate: toMinor(70, config.currency),
        approved: true,
        organizationId: organization._id,
      },
    ].map((g) => ({
      ...g,
      normalizedName: normalizeGarageName(g.name),
    }));

    for (const g of garagesData) {
      await Garage.findOneAndUpdate(
        { organizationId: organization._id, normalizedName: g.normalizedName },
        { $set: g },
        { upsert: true, returnDocument: 'after' }
      );
    }
    console.log('Seeded Mock Garages');

    console.log('Seed completed successfully.');
  } catch (error) {
    console.error('Error during seeding:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

// Run the script if called directly
if (require.main === module) {
  seedMockData();
}

module.exports = seedMockData;

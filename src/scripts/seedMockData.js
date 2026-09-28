const config = require('../config/env')
const mongoose = require('mongoose');
const Organization = require('../modules/organizations/organization.model');
const Customer = require('../modules/customers/customer.model');
const Policy = require('../modules/policies/policy.model');
const Vehicle = require('../modules/vehicles/vehicle.model');
const User = require('../modules/users/user.model');

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
      });
      console.log('Created Demo Organization');
    }

    // Create demo users
    await User.deleteMany({ organizationId: organization._id });
    await User.create([
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
      },
      {
        name: 'Second Adjuster',
        employeeCode: 'FA-002',
        password: 'Password123!',
        role: 'FIELD_ADJUSTER',
        organizationId: organization._id,
        status: 'ACTIVE',
      },
    ]);
    console.log('Created Demo Users');

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
        status: 'ACTIVE',
        policyType: 'COMPREHENSIVE',
        coveredPerils: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
        deductibleAmount: 500,
        startDate: new Date('2025-01-01'),
        expiryDate: new Date('2026-12-31'),
        organizationId: organization._id,
      },
      {
        policyNumber: 'POL-4000',
        status: 'ACTIVE',
        policyType: 'THIRD_PARTY',
        coveredPerils: [],
        deductibleAmount: 0,
        startDate: new Date('2025-01-01'),
        expiryDate: new Date('2026-12-31'),
        organizationId: organization._id,
      },
      {
        policyNumber: 'POL-2000',
        status: 'EXPIRED',
        policyType: 'THIRD_PARTY',
        coveredPerils: [],
        deductibleAmount: 0,
        startDate: new Date('2022-01-01'),
        expiryDate: new Date('2023-12-31'),
        organizationId: organization._id,
      },
      {
        policyNumber: 'POL-3000',
        status: 'CANCELLED',
        policyType: 'COMPREHENSIVE',
        coveredPerils: ['COLLISION'],
        deductibleAmount: 250,
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
        policyId: policies[0]._id, // POL-1000 (COMPREHENSIVE)
        organizationId: organization._id,
      },
      {
        plateNumber: 'TPL-4000',
        make: 'Hyundai',
        model: 'Elantra',
        year: 2023,
        color: 'Silver',
        customerId: customers[2]._id,
        policyId: policies[1]._id, // POL-4000 (THIRD_PARTY)
        organizationId: organization._id,
      },
      {
        plateNumber: 'XYZ-9876',
        make: 'Honda',
        model: 'Civic',
        year: 2019,
        color: 'Black',
        customerId: customers[1]._id,
        policyId: policies[2]._id, // POL-2000 (EXPIRED)
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


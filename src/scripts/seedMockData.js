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

    // Create mock customers
    const customersData = [
      { fullName: 'John Doe', phone: '+1234567890', organizationId: organization._id },
      { fullName: 'Jane Smith', phone: '+1987654321', organizationId: organization._id },
    ];

    // Clear existing mock customers for this org to prevent duplicates
    await Customer.deleteMany({ organizationId: organization._id });
    const customers = await Customer.insertMany(customersData);
    console.log('Created Mock Customers');

    // Create mock policies
    const policiesData = [
      {
        policyNumber: 'POL-1000',
        status: 'ACTIVE',
        startDate: new Date('2025-01-01'),
        expiryDate: new Date('2026-12-31'),
        organizationId: organization._id,
      },
      {
        policyNumber: 'POL-2000',
        status: 'EXPIRED',
        startDate: new Date('2022-01-01'),
        expiryDate: new Date('2023-12-31'),
        organizationId: organization._id,
      },
      {
        policyNumber: 'POL-3000',
        status: 'CANCELLED',
        startDate: new Date('2025-06-01'),
        expiryDate: new Date('2026-06-01'),
        organizationId: organization._id,
      },
    ];

    await Policy.deleteMany({ organizationId: organization._id });
    const policies = await Policy.insertMany(policiesData);
    console.log('Created Mock Policies');

    // Create mock vehicles linked to customers and policies
    const vehiclesData = [
      {
        plateNumber: 'ABC-1234',
        make: 'Toyota',
        model: 'Camry',
        year: 2022,
        color: 'White',
        customerId: customers[0]._id,
        policyId: policies[0]._id,
        organizationId: organization._id,
      },
      {
        plateNumber: 'XYZ-9876',
        make: 'Honda',
        model: 'Civic',
        year: 2019,
        color: 'Black',
        customerId: customers[1]._id,
        policyId: policies[1]._id,
        organizationId: organization._id,
      },
    ];

    await Vehicle.deleteMany({ organizationId: organization._id });
    await Vehicle.insertMany(vehiclesData);
    console.log('Created Mock Vehicles');

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

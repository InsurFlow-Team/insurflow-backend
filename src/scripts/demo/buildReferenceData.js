const mongoose = require('mongoose');
const Organization = require('../../modules/organizations/organization.model');
const User = require('../../modules/users/user.model');
const Customer = require('../../modules/customers/customer.model');
const Vehicle = require('../../modules/vehicles/vehicle.model');
const Policy = require('../../modules/policies/policy.model');
const Garage = require('../../modules/garages/garage.model');
const { normalizeGarageName } = require('../../modules/garages/garage.service');
const {
  ARABIC_FIRST_NAMES,
  ARABIC_LAST_NAMES,
  GOVERNORATE_PLATE_LETTERS,
  WEST_BANK_GOVERNORATES,
  VEHICLE_MAKES_MODELS,
  VEHICLE_COLORS,
  DEMO_GARAGES_DATA,
  DEMO_STAFF_DEFINITIONS,
} = require('./demoData');
const { generateFakePhone } = require('./fakeIdentity');
const { createPrng, createRandomHelpers } = require('./random');

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

const pickVehicleMakeModel = (helpers) => {
  const totalWeight = VEHICLE_MAKES_MODELS.reduce((sum, item) => sum + item.weight, 0);
  let roll = helpers.int(1, totalWeight);
  for (const item of VEHICLE_MAKES_MODELS) {
    if (roll <= item.weight) {
      return item;
    }
    roll -= item.weight;
  }
  return VEHICLE_MAKES_MODELS[0];
};

/**
 * Builds all demo reference data for PB-03:
 * - SAWN-DEMO organization
 * - 9 staff users (passwords hashed via pre-save)
 * - 12 garages across 6 West Bank governorates
 * - 250 customers
 * - 250 vehicles (with unique Palestinian plates)
 * - 400 policies (250 compulsory, 150 complementary)
 */
const buildReferenceData = async ({
  org,
  password,
  rndHelpers,
  now = new Date(),
  conn = mongoose,
  connection,
} = {}) => {
  const activeConn = connection || conn || mongoose;
  const OrganizationModel = getModel(activeConn, 'Organization', Organization);
  const UserModel = getModel(activeConn, 'User', User);
  const CustomerModel = getModel(activeConn, 'Customer', Customer);
  const VehicleModel = getModel(activeConn, 'Vehicle', Vehicle);
  const PolicyModel = getModel(activeConn, 'Policy', Policy);
  const GarageModel = getModel(activeConn, 'Garage', Garage);

  const helpers = rndHelpers || createRandomHelpers(createPrng(0x5a1711));
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('buildReferenceData: password is required (min 12 characters)');
  }
  const userPassword = password;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  // 1. Organization
  let organization = org;
  if (!organization) {
    organization = await OrganizationModel.findOne({ code: 'SAWN-DEMO' });
    if (!organization) {
      organization = await OrganizationModel.create({
        name: 'شركة صَوْن التجريبية للتأمين',
        code: 'SAWN-DEMO',
        settings: {
          vatRatePercent: 16,
          letterhead: {
            address: 'شارع الإرسال، رام الله، فلسطين',
            phone: generateFakePhone(9000),
          },
          reserveDefaults: {
            OWN_DAMAGE: { indemnity: 500000, expense: 50000 },
            THIRD_PARTY_PD: { indemnity: 500000, expense: 50000 },
          },
        },
      });
    }
  }

  // 2. Staff Users (9 total)
  const users = [];
  const staffByCode = {};
  for (const def of DEMO_STAFF_DEFINITIONS) {
    let user = await UserModel.findOne({
      organizationId: organization._id,
      employeeCode: def.employeeCode,
    });

    if (!user) {
      user = await UserModel.create({
        ...def,
        password: userPassword,
        organizationId: organization._id,
      });
    }

    users.push(user);
    staffByCode[def.employeeCode] = user;
  }

  // 3. Garages (12 total: 10 approved, 2 unapproved)
  const garages = [];
  for (let i = 0; i < DEMO_GARAGES_DATA.length; i++) {
    const gData = DEMO_GARAGES_DATA[i];
    const normalizedName = gData.normalizedName || normalizeGarageName(gData.name);
    let garage = await GarageModel.findOne({
      organizationId: organization._id,
      normalizedName,
    });

    if (!garage) {
      const phone = gData.phone || generateFakePhone(300 + i);
      garage = await GarageModel.create({
        name: gData.name,
        normalizedName,
        governorate: gData.governorate,
        city: gData.city,
        phone,
        laborRate: gData.laborRate,
        approved: gData.approved,
        organizationId: organization._id,
      });
    }

    garages.push(garage);
  }

  // 4. Customers (250 total)
  let customers = await CustomerModel.find({ organizationId: organization._id });
  if (customers.length !== 250) {
    if (customers.length > 0) {
      await CustomerModel.deleteMany({ organizationId: organization._id });
    }
    const customerDocs = [];
    for (let i = 0; i < 250; i++) {
      let fullName;
      if (i === 0) {
        fullName = 'محمد عبد الرحيم';
      } else {
        const firstName = helpers.pick(ARABIC_FIRST_NAMES);
        const lastName = helpers.pick(ARABIC_LAST_NAMES);
        fullName = `${firstName} ${lastName}`;
      }
      const phone = generateFakePhone(i);
      customerDocs.push({
        fullName,
        phone,
        organizationId: organization._id,
      });
    }
    customers = await CustomerModel.insertMany(customerDocs);
  } else {
    // Ensure sorted order by phone index
    customers.sort((a, b) => {
      const aIdx = parseInt(a.phone.replace('+97050000', ''), 10) || 0;
      const bIdx = parseInt(b.phone.replace('+97050000', ''), 10) || 0;
      return aIdx - bIdx;
    });
  }

  // 5. Policies (400 total: 250 compulsory, 150 complementary)
  let policies = await PolicyModel.find({ organizationId: organization._id });
  let compulsoryPolicies = [];
  let complementaryPolicies = [];

  if (policies.length !== 400) {
    if (policies.length > 0) {
      await PolicyModel.deleteMany({ organizationId: organization._id });
    }
    const policyDocs = [];

    // 250 UNIFIED_COMPULSORY
    for (let i = 0; i < 250; i++) {
      let status;
      let startDate;
      let expiryDate;
      if (i < 215) {
        status = 'ACTIVE';
        startDate = new Date(nowMs - 150 * DAY_MS);
        expiryDate = new Date(nowMs + 200 * DAY_MS);
      } else if (i < 240) {
        status = 'EXPIRED';
        startDate = new Date(nowMs - 730 * DAY_MS);
        expiryDate = new Date(nowMs - 365 * DAY_MS);
      } else {
        status = 'CANCELLED';
        startDate = new Date(nowMs - 150 * DAY_MS);
        expiryDate = new Date(nowMs + 200 * DAY_MS);
      }

      policyDocs.push({
        policyNumber: `POL-COMP-${String(i + 1).padStart(4, '0')}`,
        policyKind: 'UNIFIED_COMPULSORY',
        status,
        startDate,
        expiryDate,
        organizationId: organization._id,
        policyType: null,
        coveredPerils: [],
        moneyUnit: 'MINOR',
        deductibleAmount: 0,
        sumInsured: null,
        propertyDamageLimit: 10000000,
        vehicleUse: 'PRIVATE',
      });
    }

    // 150 COMPLEMENTARY
    for (let i = 0; i < 150; i++) {
      let status;
      let startDate;
      let expiryDate;
      if (i < 125) {
        status = 'ACTIVE';
        startDate = new Date(nowMs - 150 * DAY_MS);
        expiryDate = new Date(nowMs + 200 * DAY_MS);
      } else if (i < 140) {
        status = 'EXPIRED';
        startDate = new Date(nowMs - 730 * DAY_MS);
        expiryDate = new Date(nowMs - 365 * DAY_MS);
      } else {
        status = 'CANCELLED';
        startDate = new Date(nowMs - 150 * DAY_MS);
        expiryDate = new Date(nowMs + 200 * DAY_MS);
      }

      policyDocs.push({
        policyNumber: `POL-CMPL-${String(i + 1).padStart(4, '0')}`,
        policyKind: 'COMPLEMENTARY',
        status,
        startDate,
        expiryDate,
        organizationId: organization._id,
        policyType: 'COMPREHENSIVE',
        coveredPerils: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
        moneyUnit: 'MINOR',
        deductibleAmount: 50000,
        sumInsured: 8000000,
        propertyDamageLimit: null,
        vehicleUse: 'PRIVATE',
      });
    }

    policies = await PolicyModel.insertMany(policyDocs);
  }

  compulsoryPolicies = policies
    .filter((p) => p.policyKind === 'UNIFIED_COMPULSORY')
    .sort((a, b) => a.policyNumber.localeCompare(b.policyNumber));
  complementaryPolicies = policies
    .filter((p) => p.policyKind === 'COMPLEMENTARY')
    .sort((a, b) => a.policyNumber.localeCompare(b.policyNumber));

  // 6. Vehicles (250 total)
  let vehicles = await VehicleModel.find({ organizationId: organization._id });
  if (vehicles.length !== 250) {
    if (vehicles.length > 0) {
      await VehicleModel.deleteMany({ organizationId: organization._id });
    }
    const vehicleDocs = [];
    const plateSet = new Set();

    for (let i = 0; i < 250; i++) {
      const customer = customers[i];
      const compulsoryPolicy = compulsoryPolicies[i];
      const complementaryPolicy = i < 150 ? complementaryPolicies[i] : null;

      let plateNumber;
      let make;
      let model;
      let year;
      let color;

      if (i === 0) {
        plateNumber = '1-1000-H';
        make = 'Hyundai';
        model = 'Elantra';
        year = 2023;
        color = 'Silver';
      } else if (i < 10) {
        plateNumber = `1-100${i}-H`;
        make = 'Hyundai';
        model = 'Elantra';
        year = 2023;
        color = 'Silver';
      } else {
        const gov = WEST_BANK_GOVERNORATES[(i - 10) % WEST_BANK_GOVERNORATES.length];
        const possibleLetters = GOVERNORATE_PLATE_LETTERS[gov];
        const letter =
          possibleLetters.length === 1
            ? possibleLetters[0]
            : possibleLetters[i % possibleLetters.length];

        const prefix = helpers.int(1, 9);
        const seq = String(1000 + i).padStart(4, '0');
        plateNumber = `${prefix}-${seq}-${letter}`;

        const mm = pickVehicleMakeModel(helpers);
        make = mm.make;
        model = mm.model;
        year = helpers.int(2015, 2024);
        color = helpers.pick(VEHICLE_COLORS);
      }

      if (plateSet.has(plateNumber)) {
        throw new Error(`Duplicate plateNumber generated: ${plateNumber}`);
      }
      plateSet.add(plateNumber);

      vehicleDocs.push({
        plateNumber,
        make,
        model,
        year,
        color,
        customerId: customer._id,
        compulsoryPolicyId: compulsoryPolicy ? compulsoryPolicy._id : null,
        complementaryPolicyId: complementaryPolicy ? complementaryPolicy._id : null,
        organizationId: organization._id,
      });
    }

    vehicles = await VehicleModel.insertMany(vehicleDocs);
  }

  // Ensure vehicles[0] is 1-1000-H and vehicles 1-9 are 1-1001-H to 1-1009-H
  const getPlateIndex = (plate) => {
    if (plate === '1-1000-H') return 0;
    const sMatch = plate.match(/^1-100(\d)-H$/);
    if (sMatch) return parseInt(sMatch[1], 10);
    const parts = plate.split('-');
    const seq = parseInt(parts[1], 10);
    if (!Number.isNaN(seq) && seq >= 1000) return seq - 1000;
    return 9999;
  };
  vehicles.sort((a, b) => getPlateIndex(a.plateNumber) - getPlateIndex(b.plateNumber));

  return {
    organization,
    users,
    staffByCode,
    customers,
    vehicles,
    policies,
    garages,
    cleanLiveRun: {
      customer: customers[0],
      vehicle: vehicles[0],
    },
  };
};

buildReferenceData.buildReferenceData = buildReferenceData;

module.exports = buildReferenceData;

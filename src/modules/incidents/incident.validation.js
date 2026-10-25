const Joi = require('joi');
const { objectIdPattern } = require('../../middlewares/validate.middleware');
const { GOVERNORATES } = require('../../utils/governorates');

const vehicleItemSchema = Joi.object({
  vehicleRole: Joi.string()
    .valid('INSURED', 'THIRD_PARTY', 'OTHER')
    .required()
    .messages({
      'any.only': 'vehicleRole must be one of: INSURED, THIRD_PARTY, OTHER',
      'any.required': 'vehicleRole is required',
    }),
  plateRegion: Joi.string()
    .valid('PALESTINIAN', 'ISRAELI', 'OTHER', 'UNKNOWN')
    .required()
    .messages({
      'any.only': 'plateRegion must be one of: PALESTINIAN, ISRAELI, OTHER, UNKNOWN',
      'any.required': 'plateRegion is required',
    }),
  plateNumber: Joi.when('plateRegion', {
    is: 'UNKNOWN',
    then: Joi.valid(null).default(null).messages({
      'any.only': 'plateNumber must be null when plateRegion is UNKNOWN',
    }),
    otherwise: Joi.string().trim().max(20).required().messages({
      'any.required': 'plateNumber is required unless plateRegion is UNKNOWN',
      'string.empty': 'plateNumber cannot be empty',
    }),
  }),
  vehicleId: Joi.when('vehicleRole', {
    is: 'INSURED',
    then: Joi.string().pattern(objectIdPattern).allow(null).optional().messages({
      'string.pattern.base': 'vehicleId must be a valid MongoDB ObjectId',
    }),
    otherwise: Joi.forbidden().messages({
      'any.unknown': 'vehicleId is only allowed for INSURED vehicles',
    }),
  }),
  make: Joi.string().trim().max(50).allow(null, '').optional(),
  model: Joi.string().trim().max(50).allow(null, '').optional(),
  year: Joi.number().integer().min(1950).max(new Date().getFullYear() + 1).allow(null).optional(),
  insurerName: Joi.string().trim().max(100).allow(null, '').optional(),
  vehicleUse: Joi.string().trim().uppercase().max(20).allow(null, '').optional(),
  lienholderBank: Joi.string().trim().max(100).allow(null, '').optional(),
});

const partyItemSchema = Joi.object({
  partyType: Joi.string()
    .valid('PERSON', 'COMPANY')
    .default('PERSON')
    .messages({
      'any.only': 'partyType must be one of: PERSON, COMPANY',
    }),
  role: Joi.when('partyType', {
    is: 'COMPANY',
    then: Joi.string()
      .valid('POLICYHOLDER', 'OWNER', 'LIENHOLDER')
      .required()
      .messages({
        'any.only': 'role for COMPANY must be one of: POLICYHOLDER, OWNER, LIENHOLDER',
        'any.required': 'role is required',
      }),
    otherwise: Joi.string()
      .valid(
        'INSURED_DRIVER',
        'OWNER',
        'THIRD_PARTY_DRIVER',
        'PASSENGER',
        'PEDESTRIAN',
        'WITNESS',
        'GUARDIAN',
        'HEIR',
        'POLICYHOLDER',
        'AUTHORIZED_REPRESENTATIVE',
        'LIENHOLDER'
      )
      .required()
      .messages({
        'any.only': 'Invalid party role',
        'any.required': 'role is required',
      }),
  }),
  fullName: Joi.string().trim().max(100).required().messages({
    'string.empty': 'fullName cannot be empty',
    'any.required': 'fullName is required',
  }),
  idType: Joi.when('partyType', {
    is: 'COMPANY',
    then: Joi.string()
      .valid('COMPANY_REGISTRATION')
      .allow(null)
      .optional()
      .messages({
        'any.only': 'idType for COMPANY must be COMPANY_REGISTRATION',
      }),
    otherwise: Joi.string()
      .valid('PALESTINIAN_ID', 'ISRAELI_ID', 'PASSPORT')
      .allow(null)
      .optional()
      .messages({
        'any.only': 'idType for PERSON must be one of: PALESTINIAN_ID, ISRAELI_ID, PASSPORT',
      }),
  }),
  idNumber: Joi.when('idType', {
    switch: [
      {
        is: Joi.valid('PALESTINIAN_ID', 'ISRAELI_ID').required(),
        then: Joi.string().pattern(/^\d{9}$/).required().messages({
          'string.pattern.base': 'idNumber must be exactly 9 digits',
          'any.required': 'idNumber is required when idType is provided',
        }),
      },
      {
        is: Joi.valid('PASSPORT').required(),
        then: Joi.string().uppercase().pattern(/^[A-Z0-9]{5,20}$/).required().messages({
          'string.pattern.base': 'idNumber for PASSPORT must be 5 to 20 letters or digits',
          'any.required': 'idNumber is required when idType is provided',
        }),
      },
      {
        is: Joi.valid('COMPANY_REGISTRATION').required(),
        then: Joi.string().pattern(/^[A-Za-z0-9-]{3,20}$/).required().messages({
          'string.pattern.base': 'idNumber for COMPANY_REGISTRATION must be 3 to 20 letters, digits or hyphens',
          'any.required': 'idNumber is required when idType is provided',
        }),
      },
      {
        is: Joi.valid(null).required(),
        then: Joi.valid(null).optional(),
      },
    ],
    otherwise: Joi.forbidden().messages({
      'any.unknown': 'idNumber is not allowed without idType',
    }),
  }),
  phone: Joi.string().pattern(/^\+?\d{9,15}$/).allow(null).optional().messages({
    'string.pattern.base': 'phone must be a valid phone number',
  }),
  licenseClass: Joi.when('role', {
    is: Joi.valid('INSURED_DRIVER', 'THIRD_PARTY_DRIVER'),
    then: Joi.string().trim().uppercase().max(20).allow(null, '').optional(),
    otherwise: Joi.forbidden().messages({
      'any.unknown': 'licenseClass is only allowed for driver roles',
    }),
  }),
  licenseExpiry: Joi.when('role', {
    is: Joi.valid('INSURED_DRIVER', 'THIRD_PARTY_DRIVER'),
    then: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(null).optional().messages({
      'string.pattern.base': 'licenseExpiry must be in YYYY-MM-DD format',
    }),
    otherwise: Joi.forbidden().messages({
      'any.unknown': 'licenseExpiry is only allowed for driver roles',
    }),
  }),
  nationalId: Joi.forbidden().messages({
    'any.unknown': 'nationalId has been replaced by partyType, idType and idNumber',
  }),
}).and('idType', 'idNumber');

const createPartyItemSchema = partyItemSchema.keys({
  vehicleIndex: Joi.when('role', {
    switch: [
      {
        is: Joi.valid(
          'INSURED_DRIVER',
          'THIRD_PARTY_DRIVER',
          'OWNER',
          'PASSENGER',
          'POLICYHOLDER',
          'AUTHORIZED_REPRESENTATIVE',
          'LIENHOLDER'
        ),
        then: Joi.number().integer().min(0).required().messages({
          'any.required': 'vehicleIndex is required for this role',
        }),
      },
      {
        is: Joi.valid('PEDESTRIAN', 'WITNESS'),
        then: Joi.forbidden().messages({
          'any.unknown': 'vehicleIndex is forbidden for PEDESTRIAN and WITNESS',
        }),
      },
      {
        is: Joi.valid('GUARDIAN', 'HEIR'),
        then: Joi.number().integer().min(0).allow(null).optional(),
      },
    ],
  }),
});

const appendPartyItemSchema = partyItemSchema.keys({
  vehicleRef: Joi.when('role', {
    switch: [
      {
        is: Joi.valid(
          'INSURED_DRIVER',
          'THIRD_PARTY_DRIVER',
          'OWNER',
          'PASSENGER',
          'POLICYHOLDER',
          'AUTHORIZED_REPRESENTATIVE',
          'LIENHOLDER'
        ),
        then: Joi.string().pattern(objectIdPattern).required().messages({
          'string.pattern.base': 'vehicleRef must be a valid MongoDB ObjectId',
          'any.required': 'vehicleRef is required for this role',
        }),
      },
      {
        is: Joi.valid('PEDESTRIAN', 'WITNESS'),
        then: Joi.forbidden().messages({
          'any.unknown': 'vehicleRef is forbidden for PEDESTRIAN and WITNESS',
        }),
      },
      {
        is: Joi.valid('GUARDIAN', 'HEIR'),
        then: Joi.string().pattern(objectIdPattern).allow(null).optional().messages({
          'string.pattern.base': 'vehicleRef must be a valid MongoDB ObjectId',
        }),
      },
    ],
  }),
});

const damagedItemItemSchema = Joi.object({
  itemType: Joi.string()
    .valid('BUILDING', 'OTHER')
    .required()
    .messages({
      'any.only': 'itemType must be one of: BUILDING, OTHER',
      'any.required': 'itemType is required',
    }),
  description: Joi.string().trim().max(500).required().messages({
    'string.empty': 'description cannot be empty',
    'any.required': 'description is required',
  }),
});

const createIncidentSchema = Joi.object({
  incidentType: Joi.string()
    .valid(
      'COLLISION',
      'REAR_END_COLLISION',
      'SIDE_IMPACT',
      'PARKING_DAMAGE',
      'OTHER',
      'THEFT',
      'FIRE',
      'NATURAL_DISASTER'
    )
    .required()
    .messages({
      'any.only':
        'incidentType must be one of: COLLISION, REAR_END_COLLISION, SIDE_IMPACT, PARKING_DAMAGE, OTHER, THEFT, FIRE, NATURAL_DISASTER',
      'any.required': 'Incident type is required',
    }),
  incidentLocation: Joi.string().trim().required().messages({
    'string.empty': 'Incident location is required',
    'any.required': 'Incident location is required',
  }),
  incidentDate: Joi.forbidden().messages({
    'any.unknown': 'incidentDate is not accepted in body; send incidentAt instead',
  }),
  reportedAt: Joi.forbidden().messages({
    'any.unknown': 'reportedAt is set by the server and cannot be provided',
  }),
  incidentAt: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/)
    .custom((value, helpers) => {
      if (Number.isNaN(Date.parse(value))) {
        return helpers.message('incidentAt must be a valid date');
      }
      return value;
    })
    .required()
    .messages({
      'string.pattern.base': 'incidentAt must be a valid ISO 8601 string with a timezone offset',
      'any.required': 'incidentAt is required',
    }),
  governorate: Joi.string()
    .valid(...GOVERNORATES)
    .required()
    .messages({
      'any.only': 'Invalid governorate',
      'any.required': 'governorate is required',
    }),
  reportSource: Joi.string()
    .valid(
      'PALESTINIAN_POLICE_EKROKA',
      'PALESTINIAN_POLICE_PAPER',
      'ISRAELI_POLICE',
      'AGREED_STATEMENT',
      'NONE'
    )
    .required()
    .messages({
      'any.only':
        'reportSource must be one of: PALESTINIAN_POLICE_EKROKA, PALESTINIAN_POLICE_PAPER, ISRAELI_POLICE, AGREED_STATEMENT, NONE',
      'any.required': 'reportSource is required',
    }),
  eKrokaReference: Joi.string().trim().max(50).allow(null).optional(),
  policeReportNumber: Joi.string().trim().max(50).allow(null).optional(),
  injuriesReported: Joi.boolean().required().messages({
    'any.required': 'injuriesReported is required',
  }),
  accidentArea: Joi.string()
    .valid('PALESTINIAN_AREA', 'ISRAEL', 'UNKNOWN')
    .allow(null)
    .optional()
    .messages({
      'any.only': 'accidentArea must be one of: PALESTINIAN_AREA, ISRAEL, UNKNOWN',
    }),
  description: Joi.string().trim().max(1000).allow('', null).optional(),
  latitude: Joi.number().min(-90).max(90).optional(),
  longitude: Joi.number().min(-180).max(180).optional(),
  vehicles: Joi.array().items(vehicleItemSchema).min(1).max(10).required().messages({
    'array.min': 'At least one vehicle is required',
    'array.max': 'Vehicles count cannot exceed 10',
    'any.required': 'vehicles array is required',
  }),
  parties: Joi.array().items(createPartyItemSchema).min(1).max(30).required().messages({
    'array.min': 'At least one party is required',
    'array.max': 'Parties count cannot exceed 30',
    'any.required': 'parties array is required',
  }),
  damagedItems: Joi.array().items(damagedItemItemSchema).max(20).default([]).messages({
    'array.max': 'Damaged items count cannot exceed 20',
  }),
}).custom((value, helpers) => {
  if (value.eKrokaReference && value.reportSource !== 'PALESTINIAN_POLICE_EKROKA') {
    return helpers.message(
      'eKrokaReference allowed only when reportSource is PALESTINIAN_POLICE_EKROKA'
    );
  }
  if (
    value.policeReportNumber &&
    !['PALESTINIAN_POLICE_PAPER', 'ISRAELI_POLICE'].includes(value.reportSource)
  ) {
    return helpers.message(
      'policeReportNumber allowed only when reportSource is PALESTINIAN_POLICE_PAPER or ISRAELI_POLICE'
    );
  }
  return value;
});

const patchIncidentReportSchema = Joi.object({
  reportSource: Joi.string()
    .valid(
      'PALESTINIAN_POLICE_EKROKA',
      'PALESTINIAN_POLICE_PAPER',
      'ISRAELI_POLICE',
      'AGREED_STATEMENT'
    )
    .optional()
    .messages({
      'any.only':
        'reportSource in report update must be one of: PALESTINIAN_POLICE_EKROKA, PALESTINIAN_POLICE_PAPER, ISRAELI_POLICE, AGREED_STATEMENT',
    }),
  eKrokaReference: Joi.string().trim().max(50).optional(),
  policeReportNumber: Joi.string().trim().max(50).optional(),
  injuriesReported: Joi.valid(true).optional().messages({
    'any.only': 'injuriesReported may only be set to true',
  }),
  accidentArea: Joi.string()
    .valid('PALESTINIAN_AREA', 'ISRAEL')
    .optional()
    .messages({
      'any.only': 'accidentArea in report update must be one of: PALESTINIAN_AREA, ISRAEL',
    }),
})
  .min(1)
  .oxor('eKrokaReference', 'policeReportNumber')
  .custom((value, helpers) => {
    if (value.reportSource) {
      if (value.eKrokaReference && value.reportSource !== 'PALESTINIAN_POLICE_EKROKA') {
        return helpers.message(
          'eKrokaReference requires reportSource PALESTINIAN_POLICE_EKROKA'
        );
      }
      if (
        value.policeReportNumber &&
        !['PALESTINIAN_POLICE_PAPER', 'ISRAELI_POLICE'].includes(value.reportSource)
      ) {
        return helpers.message(
          'policeReportNumber requires reportSource PALESTINIAN_POLICE_PAPER or ISRAELI_POLICE'
        );
      }
    }
    return value;
  });

const listIncidentsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  incidentNumber: Joi.string().trim().optional(),
  from: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const createSubClaimSchema = Joi.object({
  claimType: Joi.string()
    .valid('OWN_DAMAGE', 'THIRD_PARTY_PD')
    .required()
    .messages({
      'any.only': 'claimType must be one of: OWN_DAMAGE, THIRD_PARTY_PD',
      'any.required': 'claimType is required',
    }),
  policyId: Joi.string()
    .trim()
    .pattern(objectIdPattern)
    .required()
    .messages({
      'string.pattern.base': 'policyId must be a valid MongoDB ObjectId',
      'string.empty': 'policyId is required',
      'any.required': 'policyId is required',
    }),
  plateNumber: Joi.string().trim().optional().messages({
    'string.base': 'Plate number must be a string',
  }),
  claimantPartyId: Joi.string()
    .trim()
    .pattern(objectIdPattern)
    .required()
    .messages({
      'string.pattern.base': 'claimantPartyId must be a valid MongoDB ObjectId',
      'string.empty': 'claimantPartyId is required',
      'any.required': 'claimantPartyId is required',
    }),
  subjectRef: Joi.string()
    .trim()
    .pattern(objectIdPattern)
    .required()
    .messages({
      'string.pattern.base': 'subjectRef must be a valid MongoDB ObjectId',
      'string.empty': 'subjectRef is required',
      'any.required': 'subjectRef is required',
    }),
});

module.exports = {
  createIncidentSchema,
  listIncidentsQuerySchema,
  createSubClaimSchema,
  vehicleItemSchema,
  appendPartyItemSchema,
  damagedItemItemSchema,
  patchIncidentReportSchema,
};

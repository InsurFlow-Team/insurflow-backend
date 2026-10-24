const computeEligibilityHint = require('../src/utils/computeEligibilityHint');
const { ELIGIBILITY_HINTS } = require('../src/modules/policies/policy.model');

describe('computeEligibilityHint utility', () => {
  const basePolicy = {
    policyNumber: 'POL-1000',
    policyKind: 'COMPLEMENTARY',
    status: 'ACTIVE',
    startDate: new Date('2025-01-01T00:00:00.000Z'),
    // 23:59:59.999 Asia/Hebron on 2025-12-31 (winter offset +02:00 is 21:59:59.999Z) per C7
    expiryDate: new Date('2025-12-31T21:59:59.999Z'),
    policyType: 'COMPREHENSIVE',
    coveredPerils: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
    deductibleAmount: 500,
  };

  describe('Rule 1: incidentType supplied and policy.policyType missing', () => {
    it('returns COVERAGE_UNKNOWN when incidentType is provided but policy has no policyType', () => {
      const policy = { ...basePolicy, policyType: undefined };
      const hint = computeEligibilityHint({
        policy,
        incidentType: 'COLLISION',
        incidentDate: '2025-06-15',
      });
      expect(hint).toBe(ELIGIBILITY_HINTS.COVERAGE_UNKNOWN);
    });
  });

  describe('Rule 2: Incident date or reference date outside policy period', () => {
    it('returns INCIDENT_OUTSIDE_POLICY_PERIOD when incidentDate is before startDate', () => {
      const hint = computeEligibilityHint({
        policy: basePolicy,
        incidentType: 'COLLISION',
        incidentDate: '2024-12-31',
      });
      expect(hint).toBe(ELIGIBILITY_HINTS.INCIDENT_OUTSIDE_POLICY_PERIOD);
    });

    it('returns INCIDENT_OUTSIDE_POLICY_PERIOD when incidentDate is after expiryDate', () => {
      const hint = computeEligibilityHint({
        policy: basePolicy,
        incidentType: 'COLLISION',
        incidentDate: '2026-01-01',
      });
      expect(hint).toBe(ELIGIBILITY_HINTS.INCIDENT_OUTSIDE_POLICY_PERIOD);
    });

    it('returns INCIDENT_OUTSIDE_POLICY_PERIOD when incidentDate is null and now is after expiryDate', () => {
      const hint = computeEligibilityHint({
        policy: basePolicy,
        incidentType: 'COLLISION',
        incidentDate: null,
        now: new Date('2026-06-01T12:00:00.000Z'),
      });
      expect(hint).toBe(ELIGIBILITY_HINTS.INCIDENT_OUTSIDE_POLICY_PERIOD);
    });
  });

  describe('Rule 3: incidentType absent', () => {
    it('returns null when incidentType is null and incidentDate is within period', () => {
      const hint = computeEligibilityHint({
        policy: basePolicy,
        incidentType: null,
        incidentDate: '2025-06-15',
      });
      expect(hint).toBeNull();
    });

    it('returns null when incidentType is undefined and now is within period', () => {
      const hint = computeEligibilityHint({
        policy: basePolicy,
        incidentDate: null,
        now: new Date('2025-06-15T12:00:00.000Z'),
      });
      expect(hint).toBeNull();
    });
  });

  describe('Rule 4: incidentType missing from policy.coveredPerils or not an array', () => {
    it('returns NOT_COVERED_BY_POLICY_TYPE when incidentType is not in coveredPerils', () => {
      const policy = {
        ...basePolicy,
        coveredPerils: ['FIRE'],
      };
      const hint = computeEligibilityHint({
        policy,
        incidentType: 'COLLISION',
        incidentDate: '2025-06-15',
      });
      expect(hint).toBe(ELIGIBILITY_HINTS.NOT_COVERED_BY_POLICY_TYPE);
    });

    it('returns NOT_COVERED_BY_POLICY_TYPE when coveredPerils is not an array', () => {
      const policy = {
        ...basePolicy,
        coveredPerils: null,
      };
      const hint = computeEligibilityHint({
        policy,
        incidentType: 'COLLISION',
        incidentDate: '2025-06-15',
      });
      expect(hint).toBe(ELIGIBILITY_HINTS.NOT_COVERED_BY_POLICY_TYPE);
    });
  });

  describe('Rule 5: Otherwise ELIGIBLE_FOR_REVIEW', () => {
    it('returns ELIGIBLE_FOR_REVIEW when all conditions are satisfied and incident is covered', () => {
      const hint = computeEligibilityHint({
        policy: basePolicy,
        incidentType: 'COLLISION',
        incidentDate: '2025-06-15',
      });
      expect(hint).toBe(ELIGIBILITY_HINTS.ELIGIBLE_FOR_REVIEW);
    });
  });

  describe('Edge cases', () => {
    it('returns ELIGIBLE_FOR_REVIEW when incidentDate is equal to startDate', () => {
      const hint = computeEligibilityHint({
        policy: basePolicy,
        incidentType: 'COLLISION',
        incidentDate: '2025-01-01',
      });
      expect(hint).toBe(ELIGIBILITY_HINTS.ELIGIBLE_FOR_REVIEW);
    });

    it('returns ELIGIBLE_FOR_REVIEW when incidentDate is equal to expiryDate', () => {
      const hint = computeEligibilityHint({
        policy: basePolicy,
        incidentType: 'COLLISION',
        incidentDate: '2025-12-31',
      });
      expect(hint).toBe(ELIGIBILITY_HINTS.ELIGIBLE_FOR_REVIEW);
    });

    it('returns INCIDENT_OUTSIDE_POLICY_PERIOD when incidentDate is one day before start', () => {
      const hint = computeEligibilityHint({
        policy: basePolicy,
        incidentType: 'COLLISION',
        incidentDate: '2024-12-31',
      });
      expect(hint).toBe(ELIGIBILITY_HINTS.INCIDENT_OUTSIDE_POLICY_PERIOD);
    });

    it('returns INCIDENT_OUTSIDE_POLICY_PERIOD when incidentDate is one day after expiry', () => {
      const hint = computeEligibilityHint({
        policy: basePolicy,
        incidentType: 'COLLISION',
        incidentDate: '2026-01-01',
      });
      expect(hint).toBe(ELIGIBILITY_HINTS.INCIDENT_OUTSIDE_POLICY_PERIOD);
    });

    it('handles expiryDate stored with end-of-day timestamp 23:59:59.999Z cleanly', () => {
      const policy = {
        ...basePolicy,
        // 23:59:59.999 Asia/Hebron on 2025-12-31 (winter offset +02:00 is 21:59:59.999Z) per C7
    expiryDate: new Date('2025-12-31T21:59:59.999Z'),
      };
      const hint = computeEligibilityHint({
        policy,
        incidentType: 'COLLISION',
        incidentDate: '2025-12-31',
      });
      expect(hint).toBe(ELIGIBILITY_HINTS.ELIGIBLE_FOR_REVIEW);
    });

    it('returns null for legacy policy with no policyType and no incidentType when reference date is within period', () => {
      const legacyPolicy = {
        policyNumber: 'POL-LEGACY',
        status: 'ACTIVE',
        startDate: new Date('2025-01-01T00:00:00.000Z'),
        // 23:59:59.999 Asia/Hebron on 2025-12-31 (winter offset +02:00 is 21:59:59.999Z) per C7
    expiryDate: new Date('2025-12-31T21:59:59.999Z'),
      };
      const hint = computeEligibilityHint({
        policy: legacyPolicy,
        incidentType: null,
        incidentDate: '2025-06-15',
      });
      expect(hint).toBeNull();
    });

    it('returns ELIGIBLE_FOR_REVIEW for policy status EXPIRED with incidentDate inside the period', () => {
      const expiredPolicy = {
        ...basePolicy,
        status: 'EXPIRED',
      };
      const hint = computeEligibilityHint({
        policy: expiredPolicy,
        incidentType: 'COLLISION',
        incidentDate: '2025-06-15',
      });
      expect(hint).toBe(ELIGIBILITY_HINTS.ELIGIBLE_FOR_REVIEW);
    });

    it('returns NOT_COVERED_BY_POLICY_TYPE when coveredPerils is undefined', () => {
      const policy = {
        ...basePolicy,
        coveredPerils: undefined,
      };
      const hint = computeEligibilityHint({
        policy,
        incidentType: 'COLLISION',
        incidentDate: '2025-06-15',
      });
      expect(hint).toBe(ELIGIBILITY_HINTS.NOT_COVERED_BY_POLICY_TYPE);
    });
  });

  describe('Claim incident type to policy peril mapping', () => {
    const allPerilsPolicy = {
      ...basePolicy,
      coveredPerils: ['COLLISION', 'THEFT', 'FIRE', 'NATURAL_DISASTER'],
    };

    const thirdPartyPolicy = {
      ...basePolicy,
      policyKind: 'UNIFIED_COMPULSORY',
      policyType: null,
      coveredPerils: [],
    };

    const theftOnlyPolicy = {
      ...basePolicy,
      policyType: 'COMPREHENSIVE',
      coveredPerils: ['THEFT'],
    };

    it('maps collision claim subtypes to COLLISION peril on a comprehensive policy covering all perils', () => {
      const types = ['COLLISION', 'REAR_END_COLLISION', 'SIDE_IMPACT', 'PARKING_DAMAGE'];
      types.forEach((type) => {
        const hint = computeEligibilityHint({
          policy: allPerilsPolicy,
          incidentType: type,
          incidentDate: '2025-06-15',
        });
        expect(hint).toBe(ELIGIBILITY_HINTS.ELIGIBLE_FOR_REVIEW);
      });
    });

    it('maps OTHER to null returning null after validity period check passes', () => {
      const hint = computeEligibilityHint({
        policy: allPerilsPolicy,
        incidentType: 'OTHER',
        incidentDate: '2025-06-15',
      });
      expect(hint).toBeNull();
    });

    it('passes unmapped perils like THEFT, FIRE, and NATURAL_DISASTER through as given', () => {
      ['THEFT', 'FIRE', 'NATURAL_DISASTER'].forEach((type) => {
        const hint = computeEligibilityHint({
          policy: allPerilsPolicy,
          incidentType: type,
          incidentDate: '2025-06-15',
        });
        expect(hint).toBe(ELIGIBILITY_HINTS.ELIGIBLE_FOR_REVIEW);
      });
    });

    it('evaluates all claim types against a THIRD_PARTY policy', () => {
      ['COLLISION', 'REAR_END_COLLISION', 'SIDE_IMPACT', 'PARKING_DAMAGE'].forEach((type) => {
        const hint = computeEligibilityHint({
          policy: thirdPartyPolicy,
          incidentType: type,
          incidentDate: '2025-06-15',
        });
        expect(hint).toBe(ELIGIBILITY_HINTS.NOT_COVERED_BY_POLICY_TYPE);
      });

      const otherHint = computeEligibilityHint({
        policy: thirdPartyPolicy,
        incidentType: 'OTHER',
        incidentDate: '2025-06-15',
      });
      expect(otherHint).toBeNull();
    });

    it('evaluates all claim types against a policy covering only THEFT', () => {
      ['COLLISION', 'REAR_END_COLLISION', 'SIDE_IMPACT', 'PARKING_DAMAGE'].forEach((type) => {
        const hint = computeEligibilityHint({
          policy: theftOnlyPolicy,
          incidentType: type,
          incidentDate: '2025-06-15',
        });
        expect(hint).toBe(ELIGIBILITY_HINTS.NOT_COVERED_BY_POLICY_TYPE);
      });

      const otherHint = computeEligibilityHint({
        policy: theftOnlyPolicy,
        incidentType: 'OTHER',
        incidentDate: '2025-06-15',
      });
      expect(otherHint).toBeNull();

      const theftHint = computeEligibilityHint({
        policy: theftOnlyPolicy,
        incidentType: 'THEFT',
        incidentDate: '2025-06-15',
      });
      expect(theftHint).toBe(ELIGIBILITY_HINTS.ELIGIBLE_FOR_REVIEW);
    });
  });
  describe('Rule: Asia/Hebron day comparison (PB-04a)', () => {
    it('compares the policy period by Asia/Hebron day', () => {
      // startDate: 2026-03-01T22:30:00.000Z (2026-03-02 00:30 Asia/Hebron, winter offset +02:00)
      const policy = {
        ...basePolicy,
        policyKind: 'COMPLEMENTARY',
        policyType: 'COMPREHENSIVE',
        startDate: new Date('2026-03-01T22:30:00.000Z'),
        expiryDate: new Date('2026-12-31T21:59:59.999Z'),
      };
      const hint = computeEligibilityHint({
        policy,
        incidentType: 'COLLISION',
        incidentDate: '2026-03-01',
      });
      expect(hint).toBe(ELIGIBILITY_HINTS.INCIDENT_OUTSIDE_POLICY_PERIOD);
    });
  });
});

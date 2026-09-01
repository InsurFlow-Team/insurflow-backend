const userRepository = require('./user.repository');
const claimRepository = require('../claims/claim.repository');


const getAdjusters = async (organizationId, statusFilter) => {
  const adjusters = await userRepository.findAdjustersByOrganization(organizationId);

  const adjustersWithAvailability = await Promise.all(
    adjusters.map(async (adjuster) => {
      // Compute active tasks count
      const activeTasksCount = await claimRepository.countActiveClaimsByAssignee(adjuster._id);

      // Availability logic for Sprint 1
      const isAvailable = adjuster.status === 'ACTIVE' && activeTasksCount === 0;

      return {
        id: adjuster._id,
        name: adjuster.name,
        employeeCode: adjuster.employeeCode,
        role: adjuster.role,
        status: adjuster.status,
        availability: isAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
        activeTasksCount,
      };
    })
  );

  if (statusFilter === 'available') {
    return adjustersWithAvailability.filter((a) => a.availability === 'AVAILABLE');
  }

  return adjustersWithAvailability;
};

module.exports = {
  getAdjusters,
};

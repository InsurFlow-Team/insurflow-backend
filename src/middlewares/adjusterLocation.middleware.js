const User = require('../modules/users/user.model');

/**
 * Middleware to capture adjuster's real-time GPS location via X-Latitude / X-Longitude headers.
 * Runs only for authenticated FIELD_ADJUSTER requests.
 * Never fails or interrupts the primary request.
 */
const adjusterLocationMiddleware = async (req, res, next) => {
  try {
    if (req.user && req.user.role === 'FIELD_ADJUSTER') {
      const latHeader = req.headers['x-latitude'] || req.headers['x-adjuster-latitude'];
      const lonHeader = req.headers['x-longitude'] || req.headers['x-adjuster-longitude'];

      if (latHeader !== undefined && lonHeader !== undefined) {
        const lat = parseFloat(latHeader);
        const lon = parseFloat(lonHeader);

        if (
          !Number.isNaN(lat) &&
          !Number.isNaN(lon) &&
          lat >= -90 &&
          lat <= 90 &&
          lon >= -180 &&
          lon <= 180
        ) {
          await User.findOneAndUpdate(
            { _id: req.user.userId, organizationId: req.user.organizationId },
            {
              $set: {
                'location.latitude': lat,
                'location.longitude': lon,
                'location.updatedAt': new Date(),
              },
            }
          );
        } else {
          console.warn('[Warning] Adjuster location headers out of range or malformed:', { latHeader, lonHeader });
        }
      }
    }
  } catch (err) {
    console.warn(`[Warning] Failed to update adjuster location from headers: ${err.message}`);
  }

  next();
};

module.exports = adjusterLocationMiddleware;

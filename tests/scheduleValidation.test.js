const FerryService = require('../ferryService');
const moment = require('moment-timezone');

describe('Schedule Validation', () => {
  let ferryService;

  beforeEach(() => {
    ferryService = new FerryService();
  });

  /**
   * Test that validates GTFS parsing works correctly
   */
  it('should parse GTFS data and find Red Hook departures', async () => {
    // Skip if running in CI or without network access
    if (process.env.CI || process.env.SKIP_NETWORK_TESTS) {
      console.log('Skipping network-dependent schedule validation test');
      return;
    }

    try {
      await ferryService.initialize();
      
      // Verify Red Hook stop was found
      expect(ferryService.redHookStop).toBeTruthy();
      expect(ferryService.redHookStop.id).toBeTruthy();
      expect(ferryService.redHookStop.name).toMatch(/red hook/i);
      
      // Get real-time schedule
      const scheduleData = await ferryService.getFerrySchedule();
      
      // Parse departures
      const departures = ferryService.getNextRedHookDepartures(scheduleData);
      
      // Validate structure
      departures.forEach(departure => {
        expect(departure).toHaveProperty('timeFormatted');
        expect(departure).toHaveProperty('route');
        expect(departure).toHaveProperty('destinations');
        expect(Array.isArray(departure.destinations)).toBe(true);
        expect(departure.timeFormatted).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
      });
      
      // Should find at least some departures (unless outside service hours)
      const now = moment().tz('America/New_York');
      const isServiceHours = ferryService.isWithinServiceHours(now);
      
      if (isServiceHours) {
        expect(departures.length).toBeGreaterThan(0);
      }
      
    } catch (error) {
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        console.warn('Network error during schedule validation - skipping');
      } else {
        throw error;
      }
    }
  });

  /**
   * Test that static schedule fallback works
   */
  it('should fall back to static schedule when real-time data unavailable', async () => {
    if (process.env.CI || process.env.SKIP_NETWORK_TESTS) {
      console.log('Skipping network-dependent test');
      return;
    }

    try {
      await ferryService.initialize();
      
      // Force static schedule by passing null for real-time data
      const testTime = moment().tz('America/New_York').hour(8).minute(0);
      const departures = ferryService.getNextRedHookDepartures(null, testTime.toDate());
      
      // Should get static schedule departures
      expect(Array.isArray(departures)).toBe(true);
      
      // Validate structure
      departures.forEach(departure => {
        expect(departure).toHaveProperty('timeFormatted');
        expect(departure).toHaveProperty('route');
        expect(departure).toHaveProperty('isStatic');
        expect(departure.isStatic).toBe(true);
      });
      
    } catch (error) {
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        console.warn('Network error during static schedule test - skipping');
      } else {
        throw error;
      }
    }
  });

  /**
   * Test real-time data integration
   */
  it('should properly integrate real-time updates with static data', async () => {
    if (process.env.CI || process.env.SKIP_NETWORK_TESTS) {
      console.log('Skipping network-dependent test');
      return;
    }

    try {
      await ferryService.initialize();
      
      const scheduleData = await ferryService.getFerrySchedule();
      const departures = ferryService.getNextRedHookDepartures(scheduleData);
      
      // Check that departures have proper delay information
      departures.forEach(departure => {
        expect(departure).toHaveProperty('delay');
        expect(typeof departure.delay).toBe('number');
        
        // Real-time departures should have trip IDs
        if (!departure.isStatic && !departure.isFallback) {
          expect(departure.tripId).toBeTruthy();
        }
      });
      
    } catch (error) {
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        console.warn('Network error during real-time integration test - skipping');
      } else {
        throw error;
      }
    }
  });
});
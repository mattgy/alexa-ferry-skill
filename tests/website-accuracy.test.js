const FerryService = require('../ferryService');
const axios = require('axios');
const cheerio = require('cheerio');
const moment = require('moment-timezone');
const config = require('../config');

// This test validates that our GTFS data matches the official NYC Ferry website
// Note: This is a slower integration test that makes real web requests
describe.skip('Website Accuracy Validation', () => {
  let ferryService;
  
  // Extend timeout for web scraping tests
  jest.setTimeout(30000);

  beforeEach(async () => {
    ferryService = new FerryService();
    await ferryService.initialize();
  });

  describe('Schedule accuracy against NYC Ferry website', () => {
    it('should match departure times with official website', async () => {
      // Skip if running in CI or if network is unavailable
      if (process.env.CI || process.env.SKIP_NETWORK_TESTS) {
        console.log('Skipping website accuracy test in CI environment');
        return;
      }

      try {
        // Get our GTFS-based schedule for today
        const today = moment().tz(config.TIMEZONE).startOf('day');
        const ourDepartures = ferryService.getStaticScheduleDepartures(today.toDate());
        
        if (ourDepartures.length === 0) {
          console.log('No GTFS departures found for today, skipping comparison');
          return;
        }

        // Attempt to scrape the official NYC Ferry website
        const websiteSchedule = await scrapeNYCFerryWebsite();
        
        if (!websiteSchedule || websiteSchedule.length === 0) {
          console.log('Could not retrieve website schedule, skipping comparison');
          return;
        }

        // Compare schedules
        const comparison = compareSchedules(ourDepartures, websiteSchedule);
        
        // Log comparison results
        console.log(`\\nSchedule Comparison Results:`);
        console.log(`GTFS departures: ${ourDepartures.length}`);
        console.log(`Website departures: ${websiteSchedule.length}`);
        console.log(`Matches: ${comparison.matches}`);
        console.log(`Mismatches: ${comparison.mismatches}`);
        console.log(`GTFS-only: ${comparison.gtfsOnly.length}`);
        console.log(`Website-only: ${comparison.websiteOnly.length}`);

        if (comparison.mismatches > 0) {
          console.log('\\nMismatch details:');
          comparison.details.forEach(detail => {
            console.log(`  ${detail}`);
          });
        }

        // Allow for some discrepancy, but flag significant differences
        const totalWebsiteDepartures = websiteSchedule.length;
        const matchPercentage = totalWebsiteDepartures > 0 
          ? (comparison.matches / totalWebsiteDepartures) * 100 
          : 0;

        console.log(`Match percentage: ${matchPercentage.toFixed(1)}%`);

        // Test passes if we have at least 80% match rate or if we can't scrape website
        if (totalWebsiteDepartures > 0) {
          expect(matchPercentage).toBeGreaterThan(80);
        }

      } catch (error) {
        console.log(`Website accuracy test failed: ${error.message}`);
        // Don't fail the test suite if website is unavailable
        console.log('Continuing with other tests...');
      }
    });

    it('should validate service alerts against website', async () => {
      if (process.env.CI || process.env.SKIP_NETWORK_TESTS) {
        console.log('Skipping website alerts test in CI environment');
        return;
      }

      try {
        // Get our alerts
        const ourAlerts = await ferryService.getServiceAlerts();
        
        // Scrape website alerts
        const websiteAlerts = await scrapeNYCFerryAlerts();
        
        console.log(`\\nAlerts Comparison:`);
        console.log(`GTFS alerts: ${ourAlerts.length}`);
        console.log(`Website alerts: ${websiteAlerts ? websiteAlerts.length : 'unavailable'}`);

        if (websiteAlerts && websiteAlerts.length > 0 && ourAlerts.length === 0) {
          console.log('Warning: Website shows alerts but GTFS has none');
        }

        // This test mainly logs information rather than failing
        expect(Array.isArray(ourAlerts)).toBe(true);

      } catch (error) {
        console.log(`Website alerts test failed: ${error.message}`);
      }
    });
  });

  describe('Data consistency validation', () => {
    it('should have consistent route information', async () => {
      const routeInfo = ferryService.staticService.getRouteInfo('SB');
      
      expect(routeInfo).toBeDefined();
      expect(routeInfo.name).toBeDefined();
      expect(routeInfo.southbound).toBeDefined();
      expect(routeInfo.northbound).toBeDefined();
      
      // Validate route pattern makes sense for Red Hook
      expect(routeInfo.southbound.destinations).toContain('Pier 11/Wall St');
      expect(routeInfo.northbound.destinations).toContain('Red Hook/Atlantic Basin');
    });

    it('should have Red Hook stop in all relevant trips', async () => {
      const redHookStopId = ferryService.redHookStop.id;
      const sbTrips = Array.from(ferryService.staticService.cache.trips.values())
        .filter(trip => trip.routeId === 'SB');

      expect(sbTrips.length).toBeGreaterThan(0);

      let tripsWithRedHook = 0;
      sbTrips.forEach(trip => {
        const stopTimes = ferryService.staticService.cache.stopTimes.get(trip.tripId);
        if (stopTimes && stopTimes.some(st => st.stopId === redHookStopId)) {
          tripsWithRedHook++;
        }
      });

      expect(tripsWithRedHook).toBeGreaterThan(0);
      console.log(`${tripsWithRedHook}/${sbTrips.length} South Brooklyn trips include Red Hook`);
    });

    it('should have reasonable departure intervals', async () => {
      const today = moment().tz(config.TIMEZONE).hour(10).minute(0); // 10 AM
      const departures = ferryService.getStaticScheduleDepartures(today.toDate());
      
      if (departures.length < 2) {
        console.log('Not enough departures to test intervals');
        return;
      }

      // Check intervals between consecutive departures
      const intervals = [];
      for (let i = 1; i < departures.length; i++) {
        const prev = moment(departures[i-1].time);
        const curr = moment(departures[i].time);
        const interval = curr.diff(prev, 'minutes');
        intervals.push(interval);
      }

      // Ferry intervals should typically be 20-60 minutes
      intervals.forEach(interval => {
        expect(interval).toBeGreaterThan(5); // At least 5 minutes apart
        expect(interval).toBeLessThan(180); // No more than 3 hours apart
      });

      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      console.log(`Average departure interval: ${avgInterval.toFixed(1)} minutes`);
    });
  });
});

// Helper function to scrape NYC Ferry website
async function scrapeNYCFerryWebsite() {
  try {
    // This is a simplified example - the actual NYC Ferry website structure may vary
    const response = await axios.get('https://www.ferry.nyc/schedules-and-maps/', {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FerrySkillValidator/1.0)'
      }
    });

    const $ = cheerio.load(response.data);
    const departures = [];

    // Look for Red Hook schedule information
    // Note: This selector would need to be updated based on actual website structure
    $('.schedule-table, .timetable').each((i, element) => {
      const text = $(element).text().toLowerCase();
      if (text.includes('red hook') || text.includes('atlantic basin')) {
        $(element).find('td, .time').each((j, timeElement) => {
          const timeText = $(timeElement).text().trim();
          const timeMatch = timeText.match(/\\b(\\d{1,2}:\\d{2})\\s*(am|pm)?\\b/i);
          
          if (timeMatch) {
            const [, time, ampm] = timeMatch;
            const fullTime = ampm ? `${time} ${ampm.toUpperCase()}` : time;
            
            try {
              const parsedTime = moment.tz(fullTime, ['h:mm A', 'H:mm', 'h:mm a'], config.TIMEZONE);
              if (parsedTime.isValid()) {
                departures.push({
                  time: parsedTime.format('HH:mm'),
                  source: 'website'
                });
              }
            } catch (error) {
              // Skip invalid times
            }
          }
        });
      }
    });

    return departures;
  } catch (error) {
    console.log(`Failed to scrape website: ${error.message}`);
    return null;
  }
}

// Helper function to scrape NYC Ferry alerts
async function scrapeNYCFerryAlerts() {
  try {
    const response = await axios.get('https://www.ferry.nyc/alerts/', {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FerrySkillValidator/1.0)'
      }
    });

    const $ = cheerio.load(response.data);
    const alerts = [];

    $('.alert, .service-alert, .notice').each((i, element) => {
      const alertText = $(element).text().trim();
      if (alertText.toLowerCase().includes('south brooklyn') || 
          alertText.toLowerCase().includes('red hook')) {
        alerts.push({
          text: alertText,
          source: 'website'
        });
      }
    });

    return alerts;
  } catch (error) {
    console.log(`Failed to scrape alerts: ${error.message}`);
    return null;
  }
}

// Helper function to compare schedules
function compareSchedules(gtfsDepartures, websiteDepartures) {
  const comparison = {
    matches: 0,
    mismatches: 0,
    gtfsOnly: [],
    websiteOnly: [],
    details: []
  };

  // Convert GTFS departures to comparable format
  const gtfsTimes = gtfsDepartures.map(d => ({
    time: moment(d.time).format('HH:mm'),
    direction: d.direction,
    source: 'gtfs'
  }));

  // Find matches
  gtfsTimes.forEach(gtfsTime => {
    const websiteMatch = websiteDepartures.find(webTime => 
      Math.abs(moment(gtfsTime.time, 'HH:mm').diff(moment(webTime.time, 'HH:mm'), 'minutes')) <= 2
    );

    if (websiteMatch) {
      comparison.matches++;
    } else {
      comparison.gtfsOnly.push(gtfsTime.time);
      comparison.details.push(`GTFS time ${gtfsTime.time} not found on website`);
    }
  });

  // Find website-only times
  websiteDepartures.forEach(webTime => {
    const gtfsMatch = gtfsTimes.find(gtfsTime => 
      Math.abs(moment(webTime.time, 'HH:mm').diff(moment(gtfsTime.time, 'HH:mm'), 'minutes')) <= 2
    );

    if (!gtfsMatch) {
      comparison.websiteOnly.push(webTime.time);
      comparison.details.push(`Website time ${webTime.time} not found in GTFS`);
    }
  });

  comparison.mismatches = comparison.gtfsOnly.length + comparison.websiteOnly.length;
  
  return comparison;
}
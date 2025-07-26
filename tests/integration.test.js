const FerryService = require('../ferryService');
const GTFSStaticService = require('../gtfsStaticService');
const config = require('../config');
const moment = require('moment-timezone');

// Mock axios to avoid real network calls
const axios = require('axios');
jest.mock('axios');

describe.skip('Integration Tests - Ferry Service with Mocked GTFS', () => {
  let ferryService;
  
  const mockGTFSStaticData = {
    stops: new Map([
      ['24', { id: '24', name: 'Red Hook/Atlantic Basin', lat: 40.6756, lon: -74.0089 }],
      ['PIER11', { id: 'PIER11', name: 'Pier 11/Wall St', lat: 40.7037, lon: -74.0109 }],
      ['BAT', { id: 'BAT', name: 'Battery Park City/West Side', lat: 40.7096, lon: -74.0176 }]
    ]),
    routes: new Map([
      ['SB', { id: 'SB', name: 'South Brooklyn Route', type: 4 }]
    ]),
    trips: new Map([
      ['SB_001', { tripId: 'SB_001', routeId: 'SB', serviceId: '1', directionId: 0 }],
      ['SB_002', { tripId: 'SB_002', routeId: 'SB', serviceId: '1', directionId: 1 }]
    ]),
    stopTimes: new Map([
      ['SB_001', [
        { stopId: '24', arrivalTime: '09:00:00', departureTime: '09:00:00', stopSequence: 1 },
        { stopId: 'BAT', arrivalTime: '09:15:00', departureTime: '09:15:00', stopSequence: 2 },
        { stopId: 'PIER11', arrivalTime: '09:30:00', departureTime: '09:30:00', stopSequence: 3 }
      ]],
      ['SB_002', [
        { stopId: 'PIER11', arrivalTime: '10:00:00', departureTime: '10:00:00', stopSequence: 1 },
        { stopId: 'BAT', arrivalTime: '10:15:00', departureTime: '10:15:00', stopSequence: 2 },
        { stopId: '24', arrivalTime: '10:30:00', departureTime: '10:30:00', stopSequence: 3 }
      ]]
    ]),
    calendar: new Map([
      ['1', {
        serviceId: '1',
        monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1,
        saturday: 1, sunday: 1,
        startDate: '20240101', endDate: '20241231'
      }]
    ]),
    calendarDates: new Map(),
    routePatterns: new Map([
      ['SB', [
        {
          direction: 0,
          destinations: ['Battery Park City/West Side', 'Pier 11/Wall St'],
          direction_label: 'towards Manhattan'
        },
        {
          direction: 1,
          destinations: ['Red Hook/Atlantic Basin'],
          direction_label: 'towards Brooklyn'
        }
      ]]
    ]),
    lastUpdated: Date.now()
  };

  const mockRealTimeData = {
    entity: [
      {
        id: 'trip_update_1',
        tripUpdate: {
          trip: { tripId: 'SB_001' },
          stopTimeUpdate: [
            {
              stopId: '24',
              departure: {
                time: { low: moment().tz(config.TIMEZONE).add(15, 'minutes').unix() },
                delay: 300 // 5 minutes late
              }
            }
          ]
        }
      }
    ]
  };

  const mockAlertsData = {
    entity: [
      {
        id: 'alert_1',
        alert: {
          headerText: {
            translation: [{ text: 'Service Delay' }]
          },
          descriptionText: {
            translation: [{ text: 'Delays of up to 10 minutes due to weather conditions' }]
          },
          informedEntity: [{ routeId: 'SB' }],
          severityLevel: 'WARNING'
        }
      }
    ]
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock axios instance
    const mockAxiosInstance = {
      get: jest.fn()
    };
    axios.create.mockReturnValue(mockAxiosInstance);
    
    ferryService = new FerryService();
    
    // Mock the static service cache
    ferryService.staticService.cache = mockGTFSStaticData;
    ferryService.redHookStop = { id: '24', name: 'Red Hook/Atlantic Basin' };

    // Mock route info method
    ferryService.staticService.getRouteInfo = jest.fn().mockReturnValue({
      name: 'South Brooklyn Route',
      southbound: {
        destinations: ['Battery Park City/West Side', 'Pier 11/Wall St'],
        direction: 'towards Manhattan'
      },
      northbound: {
        destinations: ['Red Hook/Atlantic Basin'],
        direction: 'towards Brooklyn'
      }
    });

    // Mock service active check
    ferryService.staticService.isServiceActive = jest.fn().mockReturnValue(true);
  });

  describe('Real-time data integration', () => {
    it('should fetch and process real-time ferry data with delays', async () => {
      // Mock successful axios response for real-time data
      ferryService.axiosInstance.get.mockResolvedValueOnce({
        data: Buffer.from(JSON.stringify(mockRealTimeData))
      });

      const feed = await ferryService.getFerrySchedule();
      expect(feed).toBeDefined();
      expect(feed.entity).toHaveLength(1);
      
      const now = new Date();
      const departures = ferryService.getNextRedHookDepartures(feed, now);
      
      expect(departures).toHaveLength(1);
      expect(departures[0].delay).toBe(300); // 5 minutes in seconds
      expect(departures[0].isStatic).toBe(false);
    });

    it('should fall back to static data when real-time fails', async () => {
      // Mock failed axios response
      ferryService.axiosInstance.get.mockRejectedValueOnce(new Error('Network error'));

      const feed = await ferryService.getFerrySchedule();
      expect(feed).toBeNull();
      
      const now = moment().tz(config.TIMEZONE).hour(8).minute(30).toDate();
      const departures = ferryService.getNextRedHookDepartures(null, now);
      
      // Should get static departures
      expect(departures.length).toBeGreaterThan(0);
      expect(departures[0].isStatic).toBe(true);
    });

    it('should cache real-time data and reuse it', async () => {
      // Mock successful axios response
      axios.create().get.mockResolvedValueOnce({
        data: Buffer.from(JSON.stringify(mockRealTimeData))
      });

      // First call should hit the API
      const feed1 = await ferryService.getFerrySchedule();
      expect(axios.create().get).toHaveBeenCalledTimes(1);
      
      // Second call should use cache
      const feed2 = await ferryService.getFerrySchedule();
      expect(axios.create().get).toHaveBeenCalledTimes(1); // Still 1
      
      expect(feed1).toEqual(feed2);
    });
  });

  describe('Service alerts integration', () => {
    it('should fetch and process service alerts', async () => {
      // Mock successful axios response for alerts
      axios.create().get.mockResolvedValueOnce({
        data: Buffer.from(JSON.stringify(mockAlertsData))
      });

      const alerts = await ferryService.getServiceAlerts();
      
      expect(alerts).toHaveLength(1);
      expect(alerts[0].header).toBe('Service Delay');
      expect(alerts[0].description).toBe('Delays of up to 10 minutes due to weather conditions');
      expect(alerts[0].severity).toBe('WARNING');
    });

    it('should filter alerts for Red Hook route only', async () => {
      const mixedAlertsData = {
        entity: [
          {
            id: 'alert_sb',
            alert: {
              headerText: { translation: [{ text: 'SB Route Alert' }] },
              informedEntity: [{ routeId: 'SB' }]
            }
          },
          {
            id: 'alert_other',
            alert: {
              headerText: { translation: [{ text: 'Other Route Alert' }] },
              informedEntity: [{ routeId: 'OTHER' }]
            }
          }
        ]
      };

      axios.create().get.mockResolvedValueOnce({
        data: Buffer.from(JSON.stringify(mixedAlertsData))
      });

      const alerts = await ferryService.getServiceAlerts();
      
      // Should only return alerts for South Brooklyn route
      expect(alerts).toHaveLength(1);
      expect(alerts[0].header).toBe('SB Route Alert');
    });
  });

  describe('Full departure flow with speech formatting', () => {
    it('should generate complete departure speech with alerts', async () => {
      // Mock real-time data
      axios.create().get
        .mockResolvedValueOnce({
          data: Buffer.from(JSON.stringify(mockRealTimeData))
        })
        .mockResolvedValueOnce({
          data: Buffer.from(JSON.stringify(mockAlertsData))
        });

      const [feed, alerts] = await Promise.all([
        ferryService.getFerrySchedule(),
        ferryService.getServiceAlerts()
      ]);

      const now = new Date();
      const departures = ferryService.getNextRedHookDepartures(feed, now);
      const sessionAttributes = {};
      
      const speech = ferryService.formatDeparturesForSpeech(
        departures,
        alerts,
        null,
        null,
        sessionAttributes
      );

      expect(speech).toContain('next ferry from Red Hook');
      expect(speech).toContain('running');
      expect(speech).toContain('minutes late');
      expect(speech).toContain('Would you like to hear about current service alerts');
      expect(sessionAttributes.alertsOffered).toBe(true);
    });

    it('should handle no departures case with tomorrow schedule', async () => {
      // Mock empty real-time data
      const emptyRealTimeData = { entity: [] };
      
      axios.create().get.mockResolvedValueOnce({
        data: Buffer.from(JSON.stringify(emptyRealTimeData))
      });

      const feed = await ferryService.getFerrySchedule();
      
      // Mock time outside service hours
      const lateNight = moment().tz(config.TIMEZONE).hour(23).minute(30).toDate();
      const departures = ferryService.getNextRedHookDepartures(feed, lateNight);
      
      const speech = ferryService.formatDeparturesForSpeech(departures);

      expect(speech).toContain('Ferry service from Red Hook is currently not operating');
      expect(speech).toContain('Service resumes tomorrow');
    });
  });

  describe('Error handling and resilience', () => {
    it('should handle malformed GTFS data gracefully', async () => {
      // Mock malformed data
      const malformedData = { entity: [{ invalid: 'data' }] };
      
      axios.create().get.mockResolvedValueOnce({
        data: Buffer.from(JSON.stringify(malformedData))
      });

      const feed = await ferryService.getFerrySchedule();
      const now = new Date();
      const departures = ferryService.getNextRedHookDepartures(feed, now);
      
      // Should fall back gracefully
      expect(Array.isArray(departures)).toBe(true);
    });

    it('should retry network requests on failure', async () => {
      // Mock first two calls to fail, third to succeed
      axios.create().get
        .mockRejectedValueOnce(new Error('Network error 1'))
        .mockRejectedValueOnce(new Error('Network error 2'))
        .mockResolvedValueOnce({
          data: Buffer.from(JSON.stringify(mockRealTimeData))
        });

      const feed = await ferryService.getFerrySchedule();
      
      // Should have retried and eventually succeeded
      expect(axios.create().get).toHaveBeenCalledTimes(3);
      expect(feed).toBeDefined();
      expect(feed.entity).toHaveLength(1);
    });

    it('should use expired cache data when all retries fail', async () => {
      // Set up expired cache data
      ferryService.realTimeCache.schedule = {
        data: mockRealTimeData,
        timestamp: Date.now() - (5 * 60 * 60 * 1000) // 5 hours ago
      };

      // Mock all retries to fail
      axios.create().get.mockRejectedValue(new Error('Network error'));

      const feed = await ferryService.getFerrySchedule();
      
      // Should return cached data despite being expired
      expect(feed).toEqual(mockRealTimeData);
    });
  });
});
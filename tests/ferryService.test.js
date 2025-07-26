const FerryService = require('../ferryService');
const moment = require('moment-timezone');

// Mock axios
jest.mock('axios');
const axios = require('axios');

// Mock GTFSStaticService
jest.mock('../gtfsStaticService');
const GTFSStaticService = require('../gtfsStaticService');

// Mock GTFS bindings
jest.mock('gtfs-realtime-bindings', () => ({
  transit_realtime: {
    FeedMessage: {
      decode: jest.fn()
    }
  }
}));

describe('FerryService', () => {
  let ferryService;
  let mockStaticService;
  let mockAxiosInstance;
  
  beforeEach(() => {
    // Setup mock axios instance
    mockAxiosInstance = {
      get: jest.fn()
    };
    axios.create.mockReturnValue(mockAxiosInstance);
    
    // Setup mock static service
    mockStaticService = {
      loadGTFSData: jest.fn().mockResolvedValue(),
      findRedHookStop: jest.fn().mockReturnValue({ id: '24', name: 'Red Hook/Atlantic Basin' }),
      cache: {
        trips: new Map(),
        routes: new Map(),
        stops: new Map(),
        stopTimes: new Map(),
        routePatterns: new Map()
      },
      getRouteInfo: jest.fn().mockReturnValue({
        name: 'South Brooklyn',
        southbound: { destinations: ['Bay Ridge'], direction: 'towards Bay Ridge' }
      })
    };
    GTFSStaticService.mockImplementation(() => mockStaticService);
    
    ferryService = new FerryService();
    ferryService.redHookStop = { id: '24', name: 'Red Hook/Atlantic Basin' };
    jest.clearAllMocks();
  });

  describe('getFerrySchedule', () => {
    it('should fetch and decode GTFS data successfully', async () => {
      const mockFeed = { entity: [] };
      const mockResponse = { data: new ArrayBuffer(8) };
      
      mockAxiosInstance.get.mockResolvedValue(mockResponse);
      
      const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
      GtfsRealtimeBindings.transit_realtime.FeedMessage.decode.mockReturnValue(mockFeed);
      
      const result = await ferryService.getFerrySchedule();
      
      expect(result).toEqual(mockFeed);
    });

    it('should return null on error', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));
      
      const result = await ferryService.getFerrySchedule();
      
      expect(result).toBeNull();
    });
  });

  describe('getNextRedHookDepartures', () => {
    it('should integrate real-time and static data', () => {
      // Mock static schedule method
      ferryService.getStaticScheduleDepartures = jest.fn().mockReturnValue([
        {
          time: moment().add(30, 'minutes').toDate(),
          timeFormatted: '2:30 PM',
          route: 'South Brooklyn',
          destinations: ['Bay Ridge'],
          tripId: 'static-trip',
          isStatic: true
        }
      ]);
      
      const departures = ferryService.getNextRedHookDepartures(null);
      
      expect(departures.length).toBeGreaterThan(0);
      expect(departures[0]).toHaveProperty('isStatic', true);
    });

    it('should handle empty feeds gracefully', () => {
      ferryService.getStaticScheduleDepartures = jest.fn().mockReturnValue([]);
      ferryService.getFallbackDepartures = jest.fn().mockReturnValue([]);
      
      const departures = ferryService.getNextRedHookDepartures(null);
      
      expect(Array.isArray(departures)).toBe(true);
    });
  });

  describe('formatDeparturesForSpeech', () => {
    it('should format single departure correctly', () => {
      const departures = [
        {
          timeFormatted: '2:30 PM',
          route: 'South Brooklyn',
          destinations: ['Governors Island', 'Sunset Park/BAT', 'Bay Ridge'],
          delay: 0
        }
      ];
      
      const result = ferryService.formatDeparturesForSpeech(departures);
      
      expect(result).toContain('2:30 PM');
      expect(result).toContain('Governors Island');
    });

    it('should include service alerts', () => {
      const departures = [
        {
          timeFormatted: '2:30 PM',
          route: 'South Brooklyn',
          destinations: ['Governors Island', 'Sunset Park/BAT', 'Bay Ridge'],
          delay: 0
        }
      ];
      
      const alerts = [
        {
          description: 'Delays expected due to weather',
          informedEntity: [{ routeId: 'SB' }]
        }
      ];
      
      const sessionAttributes = {};
      const result = ferryService.formatDeparturesForSpeech(departures, alerts, null, null, sessionAttributes);
      
      expect(result).toContain('Would you like to hear about current service alerts');
      expect(result).not.toContain('weather'); // Alerts are now offered, not included directly
    });

    it('should handle empty departures', () => {
      ferryService.isWithinServiceHours = jest.fn().mockReturnValue(false);
      
      const result = ferryService.formatDeparturesForSpeech([]);
      
      expect(result).toContain('not operating');
    });
  });
});
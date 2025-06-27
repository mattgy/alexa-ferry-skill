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
      findRedHookStop: jest.fn().mockReturnValue({ id: 'RDHK', name: 'Red Hook' }),
      getRoutesServingStop: jest.fn().mockReturnValue([]),
      getNextStopsAfterRedHook: jest.fn().mockReturnValue(['Governors Island'])
    };
    GTFSStaticService.mockImplementation(() => mockStaticService);
    
    ferryService = new FerryService();
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
    it('should parse departures correctly', () => {
      const mockFeed = {
        entity: [
          {
            tripUpdate: {
              trip: {
                routeId: 'SB',
                tripId: 'trip1'
              },
              stopTimeUpdate: [
                {
                  stopId: '24',
                  departure: {
                    time: {
                      low: moment().add(30, 'minutes').unix()
                    }
                  }
                }
              ]
            }
          }
        ]
      };
      
      const departures = ferryService.getNextRedHookDepartures(mockFeed);
      
      expect(departures).toHaveLength(1);
      expect(departures[0]).toHaveProperty('route', 'South Brooklyn Route');
      expect(departures[0]).toHaveProperty('tripId', 'trip1');
    });

    it('should return fallback data when feed is invalid', () => {
      const departures = ferryService.getNextRedHookDepartures(null);
      
      expect(departures.length).toBeGreaterThan(0);
      expect(departures[0]).toHaveProperty('isFallback', true);
    });
  });

  describe('formatDeparturesForSpeech', () => {
    it('should format single departure correctly', () => {
      const departures = [
        {
          timeFormatted: '2:30 PM',
          route: 'South Brooklyn Route',
          destinations: ['Governors Island', 'Sunset Park/BAT', 'Bay Ridge'],
          delay: 0
        }
      ];
      
      const result = ferryService.formatDeparturesForSpeech(departures);
      
      expect(result).toContain('2:30 PM');
      expect(result).toContain('South Brooklyn Route');
      expect(result).toContain('Governors Island');
    });

    it('should include service alerts', () => {
      const departures = [
        {
          timeFormatted: '2:30 PM',
          route: 'South Brooklyn Route',
          destinations: ['Governors Island', 'Sunset Park/BAT', 'Bay Ridge'],
          delay: 0
        }
      ];
      
      const alerts = [
        {
          header: 'Delays expected due to weather'
        }
      ];
      
      const result = ferryService.formatDeparturesForSpeech(departures, alerts);
      
      expect(result).toContain('Service alert');
      expect(result).toContain('weather');
    });
  });
});

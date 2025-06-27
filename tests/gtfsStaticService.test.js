const GTFSStaticService = require('../gtfsStaticService');

// Mock axios and adm-zip for testing
jest.mock('axios');
jest.mock('adm-zip');

const axios = require('axios');
const AdmZip = require('adm-zip');

describe('GTFSStaticService', () => {
  let service;
  let mockZip;

  beforeEach(() => {
    service = new GTFSStaticService();
    mockZip = {
      getEntry: jest.fn(),
    };
    AdmZip.mockImplementation(() => mockZip);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('loadGTFSData', () => {
    it('should fetch and parse GTFS data successfully', async () => {
      // Mock axios response
      axios.get.mockResolvedValue({
        data: Buffer.from('mock zip data')
      });

      // Mock zip entries
      const mockStopsData = 'stop_id,stop_name,stop_lat,stop_lon\nRDHK,Red Hook,40.6782,-74.0151';
      const mockRoutesData = 'route_id,route_short_name,route_long_name,route_color\nSBK,SBK,South Brooklyn Route,0066CC';
      const mockTripsData = 'trip_id,route_id,service_id,direction_id\nSBK_001,SBK,WEEKDAY,0';
      const mockStopTimesData = 'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nSBK_001,RDHK,5,14:30:00,14:30:00';

      mockZip.getEntry.mockImplementation((filename) => {
        const mockEntry = {
          getData: () => ({
            toString: () => {
              switch (filename) {
                case 'stops.txt': return mockStopsData;
                case 'routes.txt': return mockRoutesData;
                case 'trips.txt': return mockTripsData;
                case 'stop_times.txt': return mockStopTimesData;
                default: return '';
              }
            }
          })
        };
        return mockEntry;
      });

      await service.loadGTFSData();

      expect(axios.get).toHaveBeenCalledWith(
        'http://nycferry.connexionz.net/rtt/public/utility/gtfs.aspx',
        expect.objectContaining({
          responseType: 'arraybuffer',
          timeout: 30000
        })
      );

      expect(service.cache.stops.has('RDHK')).toBe(true);
      expect(service.cache.routes.has('SBK')).toBe(true);
      expect(service.cache.trips.has('SBK_001')).toBe(true);
    });

    it('should use cached data if still valid', async () => {
      // Set cache as recently updated
      service.cache.lastUpdated = Date.now() - 1000; // 1 second ago

      await service.loadGTFSData();

      expect(axios.get).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      axios.get.mockRejectedValue(new Error('Network error'));

      await expect(service.loadGTFSData()).rejects.toThrow('Network error');
    });

    it('should handle missing trips.txt gracefully', async () => {
      axios.get.mockResolvedValue({
        data: Buffer.from('mock zip data')
      });

      const mockStopsData = 'stop_id,stop_name,stop_lat,stop_lon\nRDHK,Red Hook,40.6782,-74.0151';
      const mockRoutesData = 'route_id,route_short_name,route_long_name,route_color\nSBK,SBK,South Brooklyn Route,0066CC';
      const mockStopTimesData = 'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nSBK_001,RDHK,5,14:30:00,14:30:00';

      mockZip.getEntry.mockImplementation((filename) => {
        if (filename === 'trips.txt') return null; // Simulate missing trips.txt
        
        const mockEntry = {
          getData: () => ({
            toString: () => {
              switch (filename) {
                case 'stops.txt': return mockStopsData;
                case 'routes.txt': return mockRoutesData;
                case 'stop_times.txt': return mockStopTimesData;
                default: return '';
              }
            }
          })
        };
        return mockEntry;
      });

      await expect(service.loadGTFSData()).resolves.not.toThrow();
      expect(service.cache.trips.size).toBe(0);
    });
  });

  describe('findRedHookStop', () => {
    beforeEach(() => {
      service.cache.stops.set('RDHK', {
        id: 'RDHK',
        name: 'Red Hook',
        lat: 40.6782,
        lon: -74.0151
      });
      service.cache.stops.set('PIER11', {
        id: 'PIER11',
        name: 'Wall Street/Pier 11',
        lat: 40.7033,
        lon: -74.0117
      });
    });

    it('should find Red Hook stop by name', () => {
      const redHookStop = service.findRedHookStop();
      
      expect(redHookStop).toBeTruthy();
      expect(redHookStop.id).toBe('RDHK');
      expect(redHookStop.name).toBe('Red Hook');
    });

    it('should return null if Red Hook stop not found', () => {
      service.cache.stops.clear();
      
      const redHookStop = service.findRedHookStop();
      
      expect(redHookStop).toBeNull();
    });
  });

  describe('getRoutesServingStop', () => {
    beforeEach(() => {
      service.cache.routes.set('SBK', {
        id: 'SBK',
        shortName: 'SBK',
        longName: 'South Brooklyn Route'
      });
      
      service.cache.trips.set('SBK_001', {
        id: 'SBK_001',
        routeId: 'SBK'
      });
      
      service.cache.stopTimes.set('SBK_001', [
        { stopId: 'PIER11', sequence: 3 },
        { stopId: 'RDHK', sequence: 5 }
      ]);
    });

    it('should return routes serving the stop', () => {
      const routes = service.getRoutesServingStop('RDHK');
      
      expect(routes).toHaveLength(1);
      expect(routes[0].id).toBe('SBK');
      expect(routes[0].shortName).toBe('SBK');
    });

    it('should return empty array if stop not found', () => {
      const routes = service.getRoutesServingStop('NONEXISTENT');
      
      expect(routes).toHaveLength(0);
    });
  });

  describe('getNextStopsAfterRedHook', () => {
    beforeEach(() => {
      service.cache.stops.set('RDHK', { id: 'RDHK', name: 'Red Hook' });
      service.cache.stops.set('GOVI', { id: 'GOVI', name: 'Governors Island' });
      service.cache.stops.set('SUNP', { id: 'SUNP', name: 'Sunset Park/BAT' });
      
      service.cache.stopTimes.set('SBK_001', [
        { stopId: 'PIER11', sequence: 3 },
        { stopId: 'RDHK', sequence: 5 },
        { stopId: 'GOVI', sequence: 6 },
        { stopId: 'SUNP', sequence: 7 }
      ]);
    });

    it('should return stops after Red Hook in trip sequence', () => {
      const nextStops = service.getNextStopsAfterRedHook('RDHK');
      
      expect(nextStops).toContain('Governors Island');
      expect(nextStops).toContain('Sunset Park/BAT');
      expect(nextStops).not.toContain('Red Hook');
    });

    it('should return empty array if Red Hook is last stop', () => {
      service.cache.stopTimes.set('SBK_002', [
        { stopId: 'PIER11', sequence: 3 },
        { stopId: 'RDHK', sequence: 5 }
      ]);
      service.cache.stopTimes.delete('SBK_001'); // Remove the trip with stops after Red Hook
      
      const nextStops = service.getNextStopsAfterRedHook('RDHK');
      
      expect(nextStops).toHaveLength(0);
    });
  });

  describe('extractRouteFromTrip', () => {
    beforeEach(() => {
      service.cache.routes.set('SBK', { id: 'SBK' });
    });

    it('should extract route from underscore-separated trip ID', () => {
      const routeId = service.extractRouteFromTrip('SBK_WEEKDAY_001');
      expect(routeId).toBe('SBK');
    });

    it('should match known route IDs by prefix', () => {
      const routeId = service.extractRouteFromTrip('SBK001');
      expect(routeId).toBe('SBK');
    });

    it('should return null for unrecognizable trip ID', () => {
      const routeId = service.extractRouteFromTrip('UNKNOWN123');
      expect(routeId).toBeNull();
    });

    it('should handle null/undefined trip ID', () => {
      expect(service.extractRouteFromTrip(null)).toBeNull();
      expect(service.extractRouteFromTrip(undefined)).toBeNull();
    });
  });
});

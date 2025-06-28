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
      const mockStopsData = 'stop_id,stop_name,stop_lat,stop_lon\n24,Red Hook/Atlantic Basin,40.6782,-74.0151';
      const mockRoutesData = 'route_id,route_short_name,route_long_name,route_color\nSB,SB,South Brooklyn,0066CC';
      const mockTripsData = 'trip_id,route_id,service_id,direction_id\nSB_001,SB,WEEKDAY,0';
      const mockStopTimesData = 'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nSB_001,24,5,14:30:00,14:30:00';

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
          timeout: 10000
        })
      );

      expect(service.cache.stops.has('24')).toBe(true);
      expect(service.cache.routes.has('SB')).toBe(true);
      expect(service.cache.trips.has('SB_001')).toBe(true);
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
  });

  describe('findRedHookStop', () => {
    beforeEach(() => {
      service.cache.stops.set('24', {
        id: '24',
        name: 'Red Hook/Atlantic Basin',
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
      expect(redHookStop.id).toBe('24');
      expect(redHookStop.name).toBe('Red Hook/Atlantic Basin');
    });

    it('should return null if Red Hook stop not found', () => {
      service.cache.stops.clear();
      
      const redHookStop = service.findRedHookStop();
      
      expect(redHookStop).toBeNull();
    });
  });

  describe('getRouteInfo', () => {
    beforeEach(() => {
      service.cache.routes.set('SB', {
        id: 'SB',
        shortName: 'SB',
        longName: 'South Brooklyn'
      });
      
      service.cache.routePatterns.set('SB', [
        {
          stopIds: ['24', 'BAY'],
          stopNames: ['Red Hook/Atlantic Basin', 'Bay Ridge'],
          direction: 0
        }
      ]);
    });

    it('should return route information', () => {
      const routeInfo = service.getRouteInfo('SB');
      
      expect(routeInfo).toBeTruthy();
      expect(routeInfo.name).toBe('South Brooklyn');
      expect(routeInfo).toHaveProperty('southbound');
      expect(routeInfo).toHaveProperty('northbound');
    });

    it('should return null for non-existent route', () => {
      const routeInfo = service.getRouteInfo('NONEXISTENT');
      
      expect(routeInfo).toBeNull();
    });
  });

  describe('getDestinationsFromRedHook', () => {
    beforeEach(() => {
      service.cache.routePatterns.set('SB', [
        {
          stopIds: ['24', 'GOVI', 'BAY'],
          stopNames: ['Red Hook/Atlantic Basin', 'Governors Island', 'Bay Ridge'],
          direction: 0
        }
      ]);
    });

    it('should return destinations after Red Hook', () => {
      const destinations = service.getDestinationsFromRedHook();
      
      expect(destinations).toContain('Governors Island');
      expect(destinations).toContain('Bay Ridge');
      expect(destinations).not.toContain('Red Hook/Atlantic Basin');
    });

    it('should filter by direction', () => {
      const destinations = service.getDestinationsFromRedHook(0);
      
      expect(Array.isArray(destinations)).toBe(true);
    });
  });
});
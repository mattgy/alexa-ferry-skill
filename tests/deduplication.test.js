const FerryService = require('../ferryService');
const moment = require('moment-timezone');
const config = require('../config');

describe('Ferry Service Deduplication', () => {
  let ferryService;

  beforeEach(() => {
    ferryService = new FerryService();
    // Mock the static service to avoid actual GTFS loading
    ferryService.staticService = {
      cache: {
        trips: new Map([
          ['trip1', { tripId: 'trip1', routeId: config.SOUTH_BROOKLYN_ROUTE_ID, serviceId: '1', directionId: 0 }],
          ['trip2', { tripId: 'trip2', routeId: config.SOUTH_BROOKLYN_ROUTE_ID, serviceId: '1', directionId: 1 }],
          ['unknown1', { tripId: 'unknown1', routeId: config.SOUTH_BROOKLYN_ROUTE_ID, serviceId: '1', directionId: 0 }],
          ['unknown2', { tripId: 'unknown2', routeId: config.SOUTH_BROOKLYN_ROUTE_ID, serviceId: '1', directionId: 0 }]
        ]),
        stopTimes: new Map([
          ['trip1', [{ stopId: '24', departureTime: '11:20:00' }]],
          ['trip2', [{ stopId: '24', departureTime: '11:31:00' }]],
          ['unknown1', [{ stopId: '24', departureTime: '12:00:00' }]],
          ['unknown2', [{ stopId: '24', departureTime: '12:00:00' }]]
        ]),
        stops: new Map([
          ['24', { id: '24', name: 'Red Hook/Atlantic Basin' }]
        ])
      },
      getRouteInfo: jest.fn().mockReturnValue({
        name: 'South Brooklyn Route',
        southbound: { destinations: ['Bay Ridge'], direction: 'towards Bay Ridge' },
        northbound: { destinations: ['Manhattan'], direction: 'towards Manhattan' }
      })
    };
    ferryService.redHookStop = { id: '24', name: 'Red Hook/Atlantic Basin' };
  });

  test('should deduplicate same trip appearing in both static and real-time data', () => {
    const now = moment().tz('America/New_York');
    const departureTime = now.clone().add(1, 'hour');
    
    // Mock GTFS real-time feed with one trip
    const mockFeed = {
      entity: [
        {
          id: 'update1',
          tripUpdate: {
            trip: { tripId: 'trip1' },
            stopTimeUpdate: [
              {
                stopId: '24',
                departure: {
                  time: { low: departureTime.unix() },
                  delay: 300 // 5 minutes late
                }
              }
            ]
          }
        }
      ]
    };

    // This should return only one departure, not two
    const departures = ferryService.getNextRedHookDepartures(mockFeed, now.toDate());
    
    expect(departures).toHaveLength(1);
    expect(departures[0].tripId).toBe('trip1');
    expect(departures[0].delay).toBe(300);
    expect(departures[0].isStatic).toBeUndefined(); // Real-time data doesn't have isStatic flag
  });

  test('should prefer real-time data over static data for same trip', () => {
    const now = moment().tz('America/New_York');
    const staticTime = now.clone().add(1, 'hour');
    const realTimeTime = now.clone().add(1, 'hour').add(5, 'minutes'); // 5 minutes late
    
    // Mock GTFS real-time feed
    const mockFeed = {
      entity: [
        {
          id: 'update1',
          tripUpdate: {
            trip: { tripId: 'trip1' },
            stopTimeUpdate: [
              {
                stopId: '24',
                departure: {
                  time: { low: realTimeTime.unix() },
                  delay: 300
                }
              }
            ]
          }
        }
      ]
    };

    const departures = ferryService.getNextRedHookDepartures(mockFeed, now.toDate());
    
    expect(departures).toHaveLength(1);
    expect(departures[0].tripId).toBe('trip1');
    expect(departures[0].delay).toBe(300);
    expect(moment(departures[0].time).format('HH:mm')).toBe(realTimeTime.format('HH:mm'));
  });

  test('should not duplicate departures with same time but different trip IDs', () => {
    const now = moment().tz('America/New_York');
    const departureTime1 = now.clone().add(1, 'hour');
    const departureTime2 = now.clone().add(1, 'hour').add(1, 'minute'); // Different time
    
    // Mock GTFS real-time feed with two different trips at different times
    const mockFeed = {
      entity: [
        {
          id: 'update1',
          tripUpdate: {
            trip: { tripId: 'trip1' },
            stopTimeUpdate: [
              {
                stopId: '24',
                departure: {
                  time: { low: departureTime1.unix() },
                  delay: 0
                }
              }
            ]
          }
        },
        {
          id: 'update2',
          tripUpdate: {
            trip: { tripId: 'trip2' },
            stopTimeUpdate: [
              {
                stopId: '24',
                departure: {
                  time: { low: departureTime2.unix() },
                  delay: 0
                }
              }
            ]
          }
        }
      ]
    };

    const departures = ferryService.getNextRedHookDepartures(mockFeed, now.toDate());
    
    // Should have both departures since they're different trips at different times
    expect(departures).toHaveLength(2);
    expect(departures[0].tripId).toBe('trip1');
    expect(departures[1].tripId).toBe('trip2');
  });

  test('should handle departures without trip IDs using time-based deduplication', () => {
    const now = moment().tz('America/New_York');
    const departureTime = now.clone().add(1, 'hour');
    
    // Mock GTFS real-time feed with trips having empty string IDs (not null)
    const mockFeed = {
      entity: [
        {
          id: 'update1',
          tripUpdate: {
            trip: { tripId: 'unknown1' }, // Use unknown trip ID
            stopTimeUpdate: [
              {
                stopId: '24',
                departure: {
                  time: { low: departureTime.unix() },
                  delay: 0
                }
              }
            ]
          }
        },
        {
          id: 'update2',
          tripUpdate: {
            trip: { tripId: 'unknown2' }, // Different unknown trip ID
            stopTimeUpdate: [
              {
                stopId: '24',
                departure: {
                  time: { low: departureTime.unix() }, // Same time
                  delay: 60
                }
              }
            ]
          }
        }
      ]
    };

    const departures = ferryService.getNextRedHookDepartures(mockFeed, now.toDate());
    
    // Should only have one departure due to time-based deduplication
    expect(departures).toHaveLength(1);
    // Should prefer the first one processed
    expect(departures[0].delay).toBe(0);
  });
});

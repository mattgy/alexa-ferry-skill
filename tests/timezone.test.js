const FerryService = require('../ferryService');
const GTFSStaticService = require('../gtfsStaticService');
const Utils = require('../utils');
const config = require('../config');
const moment = require('moment-timezone');

describe.skip('Timezone Boundary Tests', () => {
  let ferryService;

  const mockStaticData = {
    stops: new Map([['24', { id: '24', name: 'Red Hook/Atlantic Basin' }]]),
    routes: new Map([['SB', { id: 'SB', name: 'South Brooklyn Route' }]]),
    trips: new Map([
      ['SB_001', { tripId: 'SB_001', routeId: 'SB', serviceId: '1', directionId: 0 }],
      ['SB_002', { tripId: 'SB_002', routeId: 'SB', serviceId: '1', directionId: 1 }]
    ]),
    stopTimes: new Map([
      ['SB_001', [
        { stopId: '24', arrivalTime: '23:45:00', departureTime: '23:45:00', stopSequence: 1 }
      ]],
      ['SB_002', [
        { stopId: '24', arrivalTime: '00:15:00', departureTime: '00:15:00', stopSequence: 1 }
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
    routePatterns: new Map(),
    lastUpdated: Date.now()
  };

  beforeEach(() => {
    ferryService = new FerryService();
    ferryService.staticService.cache = mockStaticData;
    ferryService.redHookStop = { id: '24', name: 'Red Hook/Atlantic Basin' };
    ferryService.staticService.isServiceActive = jest.fn().mockReturnValue(true);
    ferryService.staticService.getRouteInfo = jest.fn().mockReturnValue({
      name: 'South Brooklyn Route',
      southbound: { destinations: ['Pier 11'], direction: 'towards Manhattan' },
      northbound: { destinations: ['Red Hook'], direction: 'towards Brooklyn' }
    });
  });

  describe('Daylight Saving Time transitions', () => {
    it('should handle spring forward transition (2 AM -> 3 AM)', () => {
      // March 10, 2024 - Spring DST transition in US
      const springForward = moment.tz('2024-03-10 01:30:00', config.TIMEZONE);
      
      // Test time parsing around DST transition
      const beforeTransition = springForward.clone();
      const afterTransition = springForward.clone().add(2, 'hours'); // Will be 4:30 AM due to DST
      
      expect(beforeTransition.hour()).toBe(1);
      expect(afterTransition.hour()).toBe(4); // Skips 2-3 AM
      
      // Test that our departure times are handled correctly
      const departures = ferryService.getStaticScheduleDepartures(beforeTransition);
      expect(Array.isArray(departures)).toBe(true);
    });

    it('should handle fall back transition (2 AM -> 1 AM)', () => {
      // November 3, 2024 - Fall DST transition in US
      const fallBack = moment.tz('2024-11-03 01:30:00', config.TIMEZONE);
      
      // Test that times are still parsed correctly during ambiguous hour
      const departures = ferryService.getStaticScheduleDepartures(fallBack);
      expect(Array.isArray(departures)).toBe(true);
    });
  });

  describe('Cross-day schedule detection', () => {
    it('should find next day departures when current day service ended', () => {
      // Late night when service has ended
      const lateNight = moment.tz('2024-03-15 23:50:00', config.TIMEZONE);
      
      const departures = ferryService.getStaticScheduleDepartures(lateNight);
      
      // Should include tomorrow's early departures
      expect(departures.length).toBeGreaterThan(0);
      
      // Check that we get the 00:15:00 departure from tomorrow
      const earlyDeparture = departures.find(d => 
        moment(d.time).format('HH:mm') === '00:15'
      );
      expect(earlyDeparture).toBeDefined();
    });

    it('should handle midnight crossover correctly', () => {
      // Test right before midnight
      const beforeMidnight = moment.tz('2024-03-15 23:59:00', config.TIMEZONE);
      
      // Test right after midnight  
      const afterMidnight = moment.tz('2024-03-16 00:01:00', config.TIMEZONE);
      
      const departuresBefore = ferryService.getStaticScheduleDepartures(beforeMidnight);
      const departuresAfter = ferryService.getStaticScheduleDepartures(afterMidnight);
      
      expect(Array.isArray(departuresBefore)).toBe(true);
      expect(Array.isArray(departuresAfter)).toBe(true);
      
      // After midnight should include the 00:15 departure
      const postMidnightDeparture = departuresAfter.find(d => 
        moment(d.time).format('HH:mm') === '00:15'
      );
      expect(postMidnightDeparture).toBeDefined();
    });

    it('should not return past departures', () => {
      // Set time to 10 AM
      const morningTime = moment.tz('2024-03-15 10:00:00', config.TIMEZONE);
      
      const departures = ferryService.getStaticScheduleDepartures(morningTime);
      
      // All departures should be in the future
      departures.forEach(departure => {
        expect(moment(departure.time).isAfter(morningTime)).toBe(true);
      });
    });
  });

  describe('Service hours validation', () => {
    beforeEach(() => {
      // Mock that we have stop times data
      ferryService.staticService.cache.stopTimes.set('test', []);
    });

    it('should correctly identify weekday service hours', () => {
      const weekdayMorning = moment.tz('2024-03-15 08:00:00', config.TIMEZONE); // Friday
      const weekdayEvening = moment.tz('2024-03-15 20:00:00', config.TIMEZONE);
      const weekdayNight = moment.tz('2024-03-15 23:00:00', config.TIMEZONE);
      
      expect(ferryService.isWithinServiceHours(weekdayMorning)).toBe(true);
      expect(ferryService.isWithinServiceHours(weekdayEvening)).toBe(true);
      expect(ferryService.isWithinServiceHours(weekdayNight)).toBe(false);
    });

    it('should correctly identify weekend service hours', () => {
      const saturdayMorning = moment.tz('2024-03-16 08:00:00', config.TIMEZONE); // Saturday
      const saturdayEvening = moment.tz('2024-03-16 20:00:00', config.TIMEZONE);
      const saturdayNight = moment.tz('2024-03-16 22:30:00', config.TIMEZONE);
      
      expect(ferryService.isWithinServiceHours(saturdayMorning)).toBe(true);
      expect(ferryService.isWithinServiceHours(saturdayEvening)).toBe(true);
      expect(ferryService.isWithinServiceHours(saturdayNight)).toBe(false);
    });

    it('should handle timezone conversion correctly for service hours', () => {
      // Test with a UTC time that would be different in Eastern
      const utcTime = moment.utc('2024-03-15 13:00:00'); // 1 PM UTC
      const easternTime = utcTime.tz(config.TIMEZONE); // 9 AM or 8 AM Eastern depending on DST
      
      expect(easternTime.hour()).toBeLessThan(13); // Should be earlier in Eastern time
      expect(ferryService.isWithinServiceHours(easternTime)).toBe(true);
    });
  });

  describe('Time parsing from speech', () => {
    it('should handle various time formats in Eastern timezone', () => {
      const testCases = [
        { input: '3 PM', expectedHour: 15 },
        { input: '3:30 PM', expectedHour: 15, expectedMinute: 30 },
        { input: '8 AM', expectedHour: 8 },
        { input: '12:00', expectedHour: 12 },
        { input: '15:30', expectedHour: 15, expectedMinute: 30 }
      ];

      testCases.forEach(testCase => {
        const parsed = Utils.parseTimeFromSpeech(testCase.input);
        expect(parsed).toBeDefined();
        expect(parsed.hour()).toBe(testCase.expectedHour);
        if (testCase.expectedMinute !== undefined) {
          expect(parsed.minute()).toBe(testCase.expectedMinute);
        }
        expect(parsed.tz()).toBe(config.TIMEZONE);
      });
    });

    it('should handle ambiguous times correctly in context', () => {
      // Test parsing "2 AM" during DST transition when 2 AM doesn't exist
      const springForwardDay = '2024-03-10';
      const parsed = Utils.parseTimeFromSpeech('2 AM');
      
      // Should still parse successfully, moment will handle the DST adjustment
      expect(parsed).toBeDefined();
      expect(parsed.tz()).toBe(config.TIMEZONE);
    });
  });

  describe('Real-time data timezone handling', () => {
    it('should correctly convert UNIX timestamps to Eastern time', () => {
      // Create a UNIX timestamp for a specific Eastern time
      const easternTime = moment.tz('2024-03-15 14:30:00', config.TIMEZONE);
      const unixTimestamp = easternTime.unix();
      
      // Mock real-time data with this timestamp
      const mockStopUpdate = {
        stopId: '24',
        departure: {
          time: { low: unixTimestamp },
          delay: 0
        }
      };

      const isValidDeparture = ferryService.isRedHookDeparture(
        mockStopUpdate,
        easternTime.clone().subtract(1, 'hour')
      );

      expect(isValidDeparture).toBe(true);
    });

    it('should handle different timezone representations consistently', () => {
      const easternTime = moment.tz('2024-03-15 14:30:00', config.TIMEZONE);
      const utcTime = easternTime.utc();
      
      // Both should represent the same moment
      expect(easternTime.unix()).toBe(utcTime.unix());
      
      // Convert back to Eastern
      const convertedBack = utcTime.tz(config.TIMEZONE);
      expect(convertedBack.format()).toBe(easternTime.format());
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle invalid time strings gracefully', () => {
      const invalidTimes = ['25:00', '13:70', 'invalid', null, undefined, ''];
      
      invalidTimes.forEach(invalidTime => {
        const parsed = Utils.parseTimeFromSpeech(invalidTime);
        if (parsed !== null) {
          // If it parsed something, it should at least be a valid moment
          expect(parsed.isValid()).toBe(true);
        }
      });
    });

    it('should handle very far future times appropriately', () => {
      const farFuture = moment.tz(config.TIMEZONE).add(2, 'years');
      const departures = ferryService.getStaticScheduleDepartures(farFuture);
      
      // Should not return departures for times too far in future
      expect(departures).toHaveLength(0);
    });

    it('should maintain consistent timezone throughout processing', () => {
      const testTime = moment.tz('2024-03-15 14:30:00', config.TIMEZONE);
      const departures = ferryService.getStaticScheduleDepartures(testTime);
      
      departures.forEach(departure => {
        const departureTime = moment(departure.time);
        // All times should be interpretable in the correct timezone
        expect(departureTime.isValid()).toBe(true);
        
        // The formatted time should make sense
        expect(departure.timeFormatted).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
      });
    });
  });
});
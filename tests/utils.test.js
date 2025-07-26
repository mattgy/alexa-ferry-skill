const Utils = require('../utils');
const moment = require('moment-timezone');

describe('Utils', () => {
  describe('parseTimeFromSpeech', () => {
    it('should parse common time formats', () => {
      const testCases = [
        { input: '3 PM', expected: '15:00' },
        { input: '2:30 AM', expected: '02:30' },
        { input: 'after 5 PM', expected: '17:00' },
        { input: '12:45', expected: '12:45' }
      ];
      
      testCases.forEach(({ input, expected }) => {
        const result = Utils.parseTimeFromSpeech(input);
        expect(result).toBeTruthy();
        expect(result.format('HH:mm')).toBe(expected);
      });
    });

    it('should return null for invalid input', () => {
      const result = Utils.parseTimeFromSpeech('invalid time');
      expect(result).toBeNull();
    });

    it('should handle null input', () => {
      const result = Utils.parseTimeFromSpeech(null);
      expect(result).toBeNull();
    });
  });

  describe('getRelativeTime', () => {
    it('should format relative time correctly', () => {
      const testCases = [
        { minutes: 5, expected: 'in 5 minutes' },
        { minutes: 1, expected: 'in 1 minute' },
        { minutes: 60, expected: 'in 1 hour' },
        { minutes: 90, expected: 'in 1 hour and 30 minutes' }
      ];
      
      testCases.forEach(({ minutes, expected }) => {
        // Create a fixed future time to avoid timing issues
        const now = moment();
        const future = now.clone().add(minutes, 'minutes').toDate();
        const result = Utils.getRelativeTime(future, now.toDate());
        expect(result).toBe(expected);
      });
    });

    it('should handle immediate time', () => {
      const now = moment();
      const result = Utils.getRelativeTime(now.toDate());
      expect(result).toBe('now');
    });
  });

  describe('sanitizeInput', () => {
    it('should clean user input', () => {
      const input = '  Hello World! @#$  ';
      const result = Utils.sanitizeInput(input);
      expect(result).toBe('hello world');
    });

    it('should preserve time-related characters', () => {
      const input = '3:30 PM';
      const result = Utils.sanitizeInput(input);
      expect(result).toBe('3:30 pm');
    });

    it('should handle null input', () => {
      const result = Utils.sanitizeInput(null);
      expect(result).toBe('');
    });

    it('should limit input length', () => {
      const longInput = 'a'.repeat(200);
      const result = Utils.sanitizeInput(longInput);
      expect(result.length).toBe(100);
    });
  });

  describe('containsTimeKeywords', () => {
    it('should detect time keywords', () => {
      const testCases = [
        { input: 'after 3 PM', expected: true },
        { input: 'in the morning', expected: true },
        { input: 'around noon', expected: true },
        { input: 'hello world', expected: false }
      ];
      
      testCases.forEach(({ input, expected }) => {
        const result = Utils.containsTimeKeywords(input);
        expect(result).toBe(expected);
      });
    });
  });

  describe('formatDuration', () => {
    it('should format durations correctly', () => {
      const testCases = [
        { minutes: 30, expected: '30 minutes' },
        { minutes: 1, expected: '1 minute' },
        { minutes: 60, expected: '1 hour' },
        { minutes: 90, expected: '1 hour and 30 minutes' },
        { minutes: 121, expected: '2 hours and 1 minute' }
      ];
      
      testCases.forEach(({ minutes, expected }) => {
        const result = Utils.formatDuration(minutes);
        expect(result).toBe(expected);
      });
    });
  });

  describe('getDayType', () => {
    it('should identify weekdays and weekends', () => {
      // Monday
      const monday = moment().day(1);
      expect(Utils.getDayType(monday)).toBe('weekday');
      
      // Saturday
      const saturday = moment().day(6);
      expect(Utils.getDayType(saturday)).toBe('weekend');
      
      // Sunday
      const sunday = moment().day(0);
      expect(Utils.getDayType(sunday)).toBe('weekend');
    });
  });
});

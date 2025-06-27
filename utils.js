const moment = require('moment-timezone');
const config = require('./config');

/**
 * Utility functions for the Red Hook Ferry Skill
 */
class Utils {
  /**
   * Parse time from user input (e.g., "3 PM", "after 2:30")
   * @param {string} timeString - Time string from user
   * @returns {moment|null} Parsed time or null if invalid
   */
  static parseTimeFromSpeech(timeString) {
    if (!timeString) return null;
    
    try {
      // Handle common speech patterns
      const cleanTime = timeString
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/after\s+/, '')
        .replace(/before\s+/, '')
        .trim();
      
      // Try to parse with moment - order matters for specificity
      const formats = [
        'h:mm A', 'h:mm a',  // 2:30 PM, 2:30 am
        'h A', 'h a',        // 3 PM, 3 am  
        'HH:mm',             // 14:30
        'h:mm',              // 14:30 or 2:30 (24hr)
        'h.mm A', 'h.mm a',  // 2.30 PM
        'ha'                 // 3pm
      ];
      
      for (const format of formats) {
        const parsed = moment.tz(cleanTime, format, config.TIMEZONE);
        if (parsed.isValid()) {
          // If time is in the past, assume next day
          const now = moment().tz(config.TIMEZONE);
          if (parsed.isBefore(now)) {
            // For times without AM/PM, assume PM if it's a reasonable ferry time
            if (!cleanTime.includes('am') && !cleanTime.includes('pm') && parsed.hour() < 12) {
              parsed.add(12, 'hours');
            }
            // If still in the past, add a day
            if (parsed.isBefore(now)) {
              parsed.add(1, 'day');
            }
          }
          return parsed;
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error parsing time:', error);
      return null;
    }
  }

  /**
   * Get relative time description (e.g., "in 15 minutes")
   * @param {Date} futureTime - Future time
   * @returns {string} Relative time description
   */
  static getRelativeTime(futureTime) {
    const now = moment().tz(config.TIMEZONE);
    const future = moment(futureTime).tz(config.TIMEZONE);
    const diffMinutes = future.diff(now, 'minutes');
    
    if (diffMinutes < 1) {
      return 'now';
    } else if (diffMinutes < 60) {
      return `in ${diffMinutes} minute${diffMinutes === 1 ? '' : 's'}`;
    } else {
      const hours = Math.floor(diffMinutes / 60);
      const minutes = diffMinutes % 60;
      let result = `in ${hours} hour${hours === 1 ? '' : 's'}`;
      if (minutes > 0) {
        result += ` and ${minutes} minute${minutes === 1 ? '' : 's'}`;
      }
      return result;
    }
  }

  /**
   * Validate and sanitize user input
   * @param {string} input - User input
   * @returns {string} Sanitized input
   */
  static sanitizeInput(input) {
    if (!input || typeof input !== 'string') {
      return '';
    }
    
    return input
      .toLowerCase()
      .replace(/[^\w\s:.-]/g, '') // Remove special characters except time-related ones
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim() // Remove leading/trailing whitespace
      .substring(0, 100); // Limit length
  }

  /**
   * Log structured data for debugging
   * @param {string} level - Log level (info, warn, error)
   * @param {string} message - Log message
   * @param {Object} data - Additional data to log
   */
  static log(level, message, data = {}) {
    const timestamp = moment().tz(config.TIMEZONE).format();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...data
    };
    
    console.log(JSON.stringify(logEntry));
  }

  /**
   * Check if a string contains time-related keywords
   * @param {string} text - Text to check
   * @returns {boolean} True if contains time keywords
   */
  static containsTimeKeywords(text) {
    if (!text) return false;
    
    const timeKeywords = [
      'after', 'before', 'at', 'around', 'by',
      'morning', 'afternoon', 'evening', 'night',
      'am', 'pm', 'o\'clock', 'thirty', 'quarter',
      'half', 'past'
    ];
    
    const lowerText = text.toLowerCase();
    return timeKeywords.some(keyword => lowerText.includes(keyword));
  }

  /**
   * Format duration in a human-readable way
   * @param {number} minutes - Duration in minutes
   * @returns {string} Formatted duration
   */
  static formatDuration(minutes) {
    if (minutes < 60) {
      return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    let result = `${hours} hour${hours === 1 ? '' : 's'}`;
    if (remainingMinutes > 0) {
      result += ` and ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
    }
    
    return result;
  }

  /**
   * Get current day type (weekday/weekend)
   * @param {moment} time - Time to check (default: now)
   * @returns {string} 'weekday' or 'weekend'
   */
  static getDayType(time = null) {
    const checkTime = time || moment().tz(config.TIMEZONE);
    const dayOfWeek = checkTime.day();
    return (dayOfWeek === 0 || dayOfWeek === 6) ? 'weekend' : 'weekday';
  }
}

module.exports = Utils;

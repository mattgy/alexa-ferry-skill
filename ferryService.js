const axios = require('axios');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const moment = require('moment-timezone');
const config = require('./config');
const GTFSStaticService = require('./gtfsStaticService');

class FerryService {
  constructor() {
    this.axiosInstance = axios.create({
      timeout: config.REQUEST_TIMEOUT,
      headers: {
        'User-Agent': 'RedHookFerrySkill/1.0'
      }
    });
    this.staticService = new GTFSStaticService();
    this.redHookStop = null;
  }

  /**
   * Initialize the service by loading static GTFS data
   */
  async initialize() {
    try {
      await this.staticService.loadGTFSData();
      this.redHookStop = this.staticService.findRedHookStop();
      
      if (!this.redHookStop) {
        console.warn('Red Hook stop not found in GTFS data, falling back to configured stop ID');
        this.redHookStop = { id: config.RED_HOOK_STOP_ID, name: 'Red Hook' };
      } else {
        // Found Red Hook stop from GTFS data
      }
    } catch (error) {
      console.error('Failed to initialize GTFS static data:', error.message);
      // Fallback to configured values
      this.redHookStop = { id: config.RED_HOOK_STOP_ID, name: 'Red Hook' };
    }
  }

  /**
   * Fetch real-time ferry schedule data
   * @returns {Promise<Object|null>} GTFS feed or null if error
   */
  async getFerrySchedule() {
    try {
      const response = await this.axiosInstance.get(
        config.GTFS_REALTIME_TRIP_UPDATES, 
        { responseType: 'arraybuffer' }
      );
      
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
        new Uint8Array(response.data)
      );
      
      return feed;
    } catch (error) {
      console.error('Error fetching ferry data:', error.message);
      return null;
    }
  }

  /**
   * Fetch service alerts
   * @returns {Promise<Array>} Array of active alerts
   */
  async getServiceAlerts() {
    try {
      const response = await this.axiosInstance.get(
        config.GTFS_REALTIME_ALERTS,
        { responseType: 'arraybuffer' }
      );
      
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
        new Uint8Array(response.data)
      );
      
      return this.parseAlerts(feed);
    } catch (error) {
      console.error('Error fetching alerts:', error.message);
      return [];
    }
  }

  /**
   * Parse alerts from GTFS feed
   * @param {Object} feed - GTFS feed
   * @returns {Array} Parsed alerts
   */
  parseAlerts(feed) {
    const alerts = [];
    
    if (!feed || !feed.entity) {
      return alerts;
    }

    for (const entity of feed.entity) {
      if (entity.alert && entity.alert.headerText) {
        const alert = {
          id: entity.id,
          header: entity.alert.headerText.translation?.[0]?.text || 'Service Alert',
          description: entity.alert.descriptionText?.translation?.[0]?.text || '',
          severity: entity.alert.severityLevel || 'UNKNOWN'
        };
        
        // Check if alert affects Red Hook
        if (this.alertAffectsRedHook(entity.alert)) {
          alerts.push(alert);
        }
      }
    }
    
    return alerts;
  }

  /**
   * Check if alert affects Red Hook stop
   * @param {Object} alert - Alert object
   * @returns {boolean} True if affects Red Hook
   */
  alertAffectsRedHook(alert) {
    if (!alert.informedEntity) return true; // Assume system-wide if no specific entity
    
    // Use dynamically discovered Red Hook stop ID, fallback to config
    const redHookStopId = this.redHookStop ? this.redHookStop.id : config.RED_HOOK_STOP_ID;
    
    return alert.informedEntity.some(entity => 
      entity.stopId === redHookStopId ||
      !entity.stopId // System-wide alert
    );
  }

  /**
   * Find next departures from Red Hook
   * @param {Object} feed - GTFS real-time feed
   * @param {Date} fromTime - Time to search from (default: now)
   * @param {string} direction - 'northbound', 'southbound', or null for both
   * @returns {Array} Array of departure objects
   */
  getNextRedHookDepartures(feed, fromTime = new Date(), direction = null) {
    try {
      const searchTime = moment(fromTime).tz(config.TIMEZONE);
      let departures = [];
      let realTimeUpdates = new Map(); // Map of tripId -> real-time update

      // First, collect real-time updates
      if (feed && feed.entity) {
        for (const entity of feed.entity) {
          if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) {
            continue;
          }

          const tripId = entity.tripUpdate.trip.tripId;
          if (!tripId) continue;

          // Check if this trip has Red Hook updates
          for (const stopUpdate of entity.tripUpdate.stopTimeUpdate) {
            if (this.isRedHookDeparture(stopUpdate, searchTime)) {
              realTimeUpdates.set(tripId, {
                entity,
                stopUpdate,
                departureTime: moment.unix(stopUpdate.departure.time.low).tz(config.TIMEZONE),
                delay: stopUpdate.departure.delay || 0
              });
              break; // Only need one Red Hook update per trip
            }
          }
        }
      }

      // Get static schedule as base
      const staticDepartures = this.getStaticScheduleDepartures(searchTime, direction);
      
      // Merge static schedule with real-time updates
      for (const staticDep of staticDepartures) {
        const realTimeUpdate = realTimeUpdates.get(staticDep.tripId);
        
        if (realTimeUpdate) {
          // Use real-time data for this departure
          const departure = this.createDepartureObject(
            realTimeUpdate.entity, 
            realTimeUpdate.stopUpdate, 
            direction
          );
          if (departure) {
            departures.push(departure);
          }
          realTimeUpdates.delete(staticDep.tripId); // Mark as used
        } else {
          // Use static schedule data
          departures.push(staticDep);
        }
      }
      
      // Add any additional real-time departures not in static schedule
      for (const [tripId, realTimeUpdate] of realTimeUpdates) {
        const departure = this.createDepartureObject(
          realTimeUpdate.entity, 
          realTimeUpdate.stopUpdate, 
          direction
        );
        if (departure) {
          departures.push(departure);
        }
      }

      // Sort by departure time and remove duplicates
      departures.sort((a, b) => a.time - b.time);
      
      // Remove duplicates - prefer real-time over static, use tripId as primary key
      const uniqueDepartures = [];
      const seenTrips = new Map(); // Track by tripId first
      const seenTimes = new Map();  // Track by time as fallback
      
      for (const departure of departures) {
        const tripId = departure.tripId;
        const timeKey = moment(departure.time).format('HH:mm');
        
        // First check if we've seen this exact trip
        if (tripId && seenTrips.has(tripId)) {
          const existing = seenTrips.get(tripId);
          // Replace static with real-time for same trip
          if (!departure.isStatic && existing.isStatic) {
            const index = uniqueDepartures.indexOf(existing);
            uniqueDepartures[index] = departure;
            seenTrips.set(tripId, departure);
            seenTimes.set(timeKey, departure);
          }
          continue; // Skip this duplicate trip
        }
        
        // Then check if we've seen this time slot (for trips without IDs)
        const existingAtTime = seenTimes.get(timeKey);
        if (existingAtTime) {
          // Replace static with real-time for same time
          if (!departure.isStatic && existingAtTime.isStatic) {
            const index = uniqueDepartures.indexOf(existingAtTime);
            uniqueDepartures[index] = departure;
            seenTimes.set(timeKey, departure);
            if (tripId) seenTrips.set(tripId, departure);
          }
          continue; // Skip this duplicate time
        }
        
        // This is a new departure
        uniqueDepartures.push(departure);
        if (tripId) seenTrips.set(tripId, departure);
        seenTimes.set(timeKey, departure);
      }
      
      return uniqueDepartures.slice(0, config.MAX_DEPARTURES);
      
    } catch (error) {
      console.error('Error parsing ferry data:', error.message);
      return this.getFallbackDepartures(fromTime, direction);
    }
  }

  /**
   * Get departures from static GTFS schedule
   * @param {moment} searchTime - Time to search from
   * @param {string} direction - Direction filter
   * @returns {Array} Array of departure objects
   */
  getStaticScheduleDepartures(searchTime, direction = null) {
    const departures = [];
    const redHookStopId = '24'; // Red Hook stop ID from static data
    
    try {
      // Get current day of week (0 = Sunday, 1 = Monday, etc.)
      const dayOfWeek = searchTime.day();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
      const currentTimeStr = searchTime.format('HH:mm:ss');
      
      // Filter for appropriate service schedule
      
      // Find all South Brooklyn trips that serve Red Hook
      for (const [tripId, trip] of this.staticService.cache.trips) {
        if (trip.routeId !== config.SOUTH_BROOKLYN_ROUTE_ID) {
          continue;
        }
        
        // Apply service-based day-of-week filtering
        // Based on GTFS analysis:
        // - Service 7: Weekend service (42 trips)
        // - Services 1-5: Regular weekday service (32 trips each)
        // - Services 8,10,11,12: Limited weekday service (21 trips each)
        // - Services 6,9: Special/limited service (1 trip each)
        if (isWeekend) {
          // On weekends, only use Service 7 which has the correct weekend schedule
          if (trip.serviceId !== '7') continue;
          
          // Allow both directions for weekends - remove restrictive direction filter
        } else {
          // On weekdays, use Services 1-5 for regular service and 8,10,11,12 for limited service
          // Exclude Service 7 (weekend) and Services 6,9 (too limited)
          const weekdayServices = ['1', '2', '3', '4', '5', '8', '10', '11', '12'];
          if (!weekdayServices.includes(trip.serviceId)) continue;
        }
        
        // Apply direction filter if specified
        if (direction) {
          if (direction === 'northbound' && trip.directionId != 1) continue;
          if (direction === 'southbound' && trip.directionId != 0) continue;
        }
        
        // Get stop times for this trip
        const stopTimes = this.staticService.cache.stopTimes.get(tripId);
        if (!stopTimes) continue;
        
        // Find Red Hook stop in this trip
        const redHookStop = stopTimes.find(st => st.stopId === redHookStopId);
        if (!redHookStop) continue;
        
        // Parse departure time
        const [hours, minutes, seconds] = redHookStop.departureTime.split(':').map(Number);
        const departureTime = searchTime.clone().hour(hours).minute(minutes).second(seconds);
        
        // Skip if departure is in the past
        if (departureTime.isBefore(searchTime)) {
          // Try next day if it's a reasonable time (handle overnight schedules)
          if (hours < 6) {
            departureTime.add(1, 'day');
          } else {
            continue;
          }
        }
        
        // Skip if departure is too far in the future (next 12 hours for better user experience)
        if (departureTime.diff(searchTime, 'hours') > 12) {
          continue;
        }
        
        // Create departure object
        const departure = this.createStaticDepartureObject(trip, departureTime, redHookStop);
        if (departure) {
          departures.push(departure);
        }
      }
      
      return departures;
      
    } catch (error) {
      console.error('Error getting static schedule departures:', error.message);
      return [];
    }
  }

  /**
   * Create departure object from static GTFS data
   * @param {Object} trip - Trip info from static data
   * @param {moment} departureTime - Departure time
   * @param {Object} stopTime - Stop time info
   * @returns {Object} Departure object
   */
  createStaticDepartureObject(trip, departureTime, stopTime) {
    try {
      // Get route information
      const route = this.staticService.getRouteInfo(trip.routeId);
      let destinations = ['next stops'];
      let directionLabel = 'towards next stops';
      
      // Get actual destinations from this specific trip's stop sequence
      const tripStopTimes = this.staticService.cache.stopTimes.get(trip.tripId);
      if (tripStopTimes) {
        const redHookStopIndex = tripStopTimes.findIndex(st => st.stopId === this.redHookStop.id);
        if (redHookStopIndex >= 0) {
          // Get stops after Red Hook for this specific trip
          const stopsAfterRedHook = tripStopTimes.slice(redHookStopIndex + 1);
          destinations = stopsAfterRedHook.map(st => {
            const stopInfo = this.staticService.cache.stops.get(st.stopId);
            return stopInfo ? stopInfo.name : st.stopId;
          }).filter(name => name !== 'Red Hook/Atlantic Basin'); // Remove any duplicate Red Hook references
        }
      }
      
      // Fallback to route-level destinations if we couldn't get trip-specific ones
      if (destinations.length === 0 || destinations[0] === 'next stops') {
        if (route) {
          if (trip.directionId == 0) {
            // Southbound
            destinations = route.southbound.destinations;
            directionLabel = route.southbound.direction;
          } else if (trip.directionId == 1) {
            // Northbound  
            destinations = route.northbound.destinations;
            directionLabel = route.northbound.direction;
          }
        }
      }

      return {
        time: departureTime.toDate(),
        timeFormatted: departureTime.format('h:mm A'),
        timestamp: departureTime.unix(),
        route: route ? route.name : 'South Brooklyn Route',
        direction: trip.directionId,
        directionLabel: directionLabel,
        destinations: destinations.slice(0, 3),
        tripId: trip.tripId,
        delay: 0,
        isStatic: true // Flag to indicate this is from static data
      };
    } catch (error) {
      console.error('Error creating static departure object:', error.message);
      return null;
    }
  }

  /**
   * Check if stop update is a Red Hook departure
   * @param {Object} stopUpdate - Stop time update
   * @param {moment} searchTime - Time to search from
   * @returns {boolean} True if valid Red Hook departure
   */
  isRedHookDeparture(stopUpdate, searchTime) {
    // Use dynamically discovered Red Hook stop ID, fallback to config
    const redHookStopId = this.redHookStop ? this.redHookStop.id : config.RED_HOOK_STOP_ID;
    
    if (stopUpdate.stopId !== redHookStopId) {
      return false;
    }

    if (!stopUpdate.departure || !stopUpdate.departure.time) {
      return false;
    }

    const departureTime = moment.unix(stopUpdate.departure.time.low).tz(config.TIMEZONE);
    const isAfter = departureTime.isAfter(searchTime);
    
    return isAfter;
  }

  /**
   * Create departure object from GTFS data
   * @param {Object} entity - GTFS entity
   * @param {Object} stopUpdate - Stop time update
   * @param {string} direction - Direction filter
   * @returns {Object|null} Departure object or null if invalid
   */
  createDepartureObject(entity, stopUpdate, direction = null) {
    try {
      const departureTime = moment.unix(stopUpdate.departure.time.low).tz(config.TIMEZONE);
      const tripId = entity.tripUpdate.trip.tripId;
      
      // Look up route info using trip ID from static GTFS data
      let route = null;
      let destinations = [];
      let directionLabel = '';
      let routeId = null;
      let tripInfo = null;
      
      if (this.staticService && tripId) {
        // Get trip info from static data
        tripInfo = this.staticService.cache.trips.get(tripId);
        if (tripInfo) {
          routeId = tripInfo.routeId;
          
          // Only process South Brooklyn route trips
          if (routeId === config.SOUTH_BROOKLYN_ROUTE_ID) {
            route = this.staticService.getRouteInfo(routeId);
            
            if (route) {
              // Determine direction from trip data
              const tripDirection = tripInfo.directionId || entity.tripUpdate.trip.directionId;
              
              if (tripDirection == 0) {
                // Southbound
                destinations = route.southbound.destinations;
                directionLabel = route.southbound.direction;
              } else if (tripDirection == 1) {
                // Northbound  
                destinations = route.northbound.destinations;
                directionLabel = route.northbound.direction;
              }
            }
          } else {
            // Not a South Brooklyn route trip, skip it
            return null;
          }
        } else {
          // Trip not found in static data, skip it
          return null;
        }
      }
      
      // Fallback if no dynamic data available
      if (!route) {
        route = { name: 'South Brooklyn Route' };
        destinations = ['next stops'];
        directionLabel = 'towards next stops';
      }

      return {
        time: departureTime.toDate(),
        timeFormatted: departureTime.format('h:mm A'),
        timestamp: departureTime.unix(),
        route: route.name,
        direction: tripInfo?.directionId || entity.tripUpdate.trip.directionId,
        directionLabel: directionLabel || `towards ${destinations[destinations.length - 1] || 'next stops'}`,
        destinations: destinations.slice(0, 3), // Limit to first 3 stops
        tripId: entity.tripUpdate.trip.tripId,
        delay: stopUpdate.departure.delay || 0
      };
    } catch (error) {
      console.error('Error creating departure object:', error.message);
      return null;
    }
  }

  /**
   * Get fallback departures when real data is unavailable
   * @param {Date} fromTime - Time to base fallback on
   * @returns {Array} Array of fallback departures
   */
  getFallbackDepartures(fromTime) {
    const now = moment(fromTime).tz(config.TIMEZONE);
    const fallbackDepartures = [];
    
    // Check if we're within service hours
    if (!this.isWithinServiceHours(now)) {
      return [];
    }

    // Get dynamic route information if available
    let destinations = ['next stops'];
    let routeName = 'Ferry Route';
    let directionLabel = 'towards next stops';

    if (this.staticService) {
      const route = this.staticService.getRouteInfo(config.SOUTH_BROOKLYN_ROUTE_ID);
      if (route) {
        routeName = route.name;
        // Use southbound destinations as default for fallback
        destinations = route.southbound.destinations.slice(0, 3);
        directionLabel = route.southbound.direction;
      }
    }

    // Generate reasonable fallback times (every 30 minutes)
    for (let i = 1; i <= config.MAX_DEPARTURES; i++) {
      const departureTime = now.clone().add(i * 30, 'minutes');
      fallbackDepartures.push({
        time: departureTime.toDate(),
        timeFormatted: departureTime.format('h:mm A'),
        route: routeName,
        destinations: destinations,
        directionLabel: directionLabel,
        tripId: `fallback-${i}`,
        delay: 0,
        isFallback: true
      });
    }

    return fallbackDepartures;
  }

  /**
   * Check if current time is within service hours based on actual GTFS data
   * @param {moment} time - Time to check
   * @returns {boolean} True if within service hours
   */
  isWithinServiceHours(time) {
    if (!this.staticService || !this.staticService.cache.stopTimes.size) {
      // Fallback to configured hours if GTFS data not available
      const hour = time.hour();
      const isWeekend = time.day() === 0 || time.day() === 6;
      const serviceHours = isWeekend ? 
        config.SERVICE_HOURS.weekend : 
        config.SERVICE_HOURS.weekday;
      return hour >= serviceHours.start && hour < serviceHours.end;
    }

    // Use actual GTFS data to determine service hours
    const dayOfWeek = time.day();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const redHookStopId = '24';
    
    let earliestTime = null;
    let latestTime = null;
    
    // Find actual service hours from GTFS data
    for (const [tripId, trip] of this.staticService.cache.trips) {
      if (trip.routeId !== config.SOUTH_BROOKLYN_ROUTE_ID) continue;
      
      // Apply same service filtering as getStaticScheduleDepartures
      if (isWeekend) {
        if (trip.serviceId !== '7') continue;
      } else {
        const weekdayServices = ['1', '2', '3', '4', '5', '8', '10', '11', '12'];
        if (!weekdayServices.includes(trip.serviceId)) continue;
      }
      
      const stopTimes = this.staticService.cache.stopTimes.get(tripId);
      if (!stopTimes) continue;
      
      const redHookStop = stopTimes.find(st => st.stopId === redHookStopId);
      if (!redHookStop) continue;
      
      const [hours, minutes] = redHookStop.departureTime.split(':').map(Number);
      const timeMinutes = hours * 60 + minutes;
      
      if (earliestTime === null || timeMinutes < earliestTime) {
        earliestTime = timeMinutes;
      }
      if (latestTime === null || timeMinutes > latestTime) {
        latestTime = timeMinutes;
      }
    }
    
    if (earliestTime === null || latestTime === null) {
      return false; // No service found
    }
    
    const requestedMinutes = time.hour() * 60 + time.minute();
    return requestedMinutes >= earliestTime && requestedMinutes <= latestTime;
  }

  /**
   * Format departures for speech output
   * @param {Array} departures - Array of departure objects
   * @param {Array} alerts - Array of active alerts
   * @returns {string} Formatted speech text
   */
  formatDeparturesForSpeech(departures, alerts = [], direction = null, destination = null) {
    if (departures.length === 0) {
      const now = moment().tz(config.TIMEZONE);
      if (!this.isWithinServiceHours(now)) {
        return 'Ferry service from Red Hook is currently not operating. Service typically runs from early morning to late evening.';
      }
      return 'I couldn\'t find any upcoming ferries from Red Hook. The service might be suspended or done for the day.';
    }

    let speech = '';
    
    // Add alerts first if any
    if (alerts.length > 0) {
      const alertText = alerts.map(alert => alert.header).join('. ');
      speech += `Service alert: ${alertText}. `;
    }

    // Determine destination phrase for speech
    let destinationPhrase = '';
    if (destination) {
      destinationPhrase = ` to ${destination}`;
    } else if (direction === 'northbound') {
      destinationPhrase = ' to Manhattan';
    } else if (direction === 'southbound') {
      destinationPhrase = ' to Bay Ridge';
    }

    // Format departures
    if (departures.length === 1) {
      const dep = departures[0];
      speech += `The next ferry from Red Hook${destinationPhrase} is at ${dep.timeFormatted}`;
      if (dep.destinations.length > 0) {
        speech += `, heading to ${dep.destinations.join(' and ')}`;
      }
      if (dep.delay > 0) {
        speech += `, running ${Math.round(dep.delay / 60)} minutes late`;
      }
      speech += '.';
    } else {
      // Group departures by direction if showing both directions
      const groupedDepartures = this.groupDeparturesByDirection(departures);
      
      if (Object.keys(groupedDepartures).length > 1) {
        // Multiple directions - format separately
        speech += this.formatMultiDirectionDepartures(groupedDepartures);
      } else {
        // Single direction
        speech += `The next ${departures.length} ferries from Red Hook${destinationPhrase} are at `;
        
        // Get unique route names to avoid repetition
        const routeNames = [...new Set(departures.map(d => d.route))];
        const routePhrase = routeNames.length === 1 ? ` on the ${routeNames[0]}` : '';
        
        departures.forEach((departure, index) => {
          const delayText = departure.delay > 0 ? 
            ` (${Math.round(departure.delay / 60)} minutes late)` : '';
          
          if (index === departures.length - 1) {
            speech += `and ${departure.timeFormatted}${delayText}${routePhrase}.`;
          } else {
            speech += `${departure.timeFormatted}${delayText}, `;
          }
        });
      }
    }

    // Only add information about real-time adjustments if there are actual delays or real-time data
    const hasRealTimeData = departures.some(d => !d.isStatic && !d.isFallback);
    const hasDelays = departures.some(d => d.delay && d.delay > 0);
    
    if (hasRealTimeData && hasDelays) {
      speech += ' Times have been adjusted based on real-time ferry tracking.';
    } else if (hasRealTimeData) {
      speech += ' Times are based on real-time ferry data.';
    }
    // Don't mention anything if we're using static schedule data - that's the normal case

    return speech;
  }

  /**
   * Group departures by direction for multi-direction responses
   * @param {Array} departures - Array of departure objects
   * @returns {Object} Grouped departures by direction
   */
  groupDeparturesByDirection(departures) {
    const grouped = {};
    
    for (const departure of departures) {
      const directionKey = departure.direction == 1 ? 'northbound' : 'southbound';
      if (!grouped[directionKey]) {
        grouped[directionKey] = [];
      }
      grouped[directionKey].push(departure);
    }
    
    return grouped;
  }

  /**
   * Format departures when showing multiple directions
   * @param {Object} groupedDepartures - Departures grouped by direction
   * @returns {string} Formatted speech text
   */
  formatMultiDirectionDepartures(groupedDepartures) {
    let speech = 'Here are the next departures from Red Hook: ';
    const directions = Object.keys(groupedDepartures);
    
    directions.forEach((direction, dirIndex) => {
      const deps = groupedDepartures[direction];
      const destinationName = direction === 'northbound' ? 'Manhattan' : 'Bay Ridge';
      
      if (dirIndex > 0) {
        speech += ', and ';
      }
      
      if (deps.length === 1) {
        speech += `${deps[0].timeFormatted} to ${destinationName}`;
      } else {
        const times = deps.map(d => d.timeFormatted);
        speech += `${times.slice(0, -1).join(', ')} and ${times[times.length - 1]} to ${destinationName}`;
      }
    });
    
    speech += '.';
    return speech;
  }
}

module.exports = FerryService;

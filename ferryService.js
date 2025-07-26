const axios = require('axios');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const moment = require('moment-timezone');
const config = require('./config');
const GTFSStaticService = require('./gtfsStaticService');
const Utils = require('./utils');

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
    
    // Real-time data cache (4 hours)
    this.realTimeCache = {
      schedule: { data: null, timestamp: 0 },
      alerts: { data: null, timestamp: 0 }
    };
    this.realTimeCacheExpiry = 4 * 60 * 60 * 1000; // 4 hours
    
    // Retry configuration
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
  }

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

  async retryRequest(requestFunc, maxRetries = this.maxRetries) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await requestFunc();
      } catch (error) {
        lastError = error;
        Utils.log('warn', `Request attempt ${attempt} failed`, { error: error.message, attempt });
        
        if (attempt < maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
          Utils.log('info', `Retrying request`, { delay_ms: delay, attempt });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  async getFerrySchedule() {
    // Check if cached data is still valid
    const now = Date.now();
    const cacheEntry = this.realTimeCache.schedule;
    
    if (cacheEntry.data && (now - cacheEntry.timestamp) < this.realTimeCacheExpiry) {
      Utils.log('info', 'Using cached ferry schedule data', { cache_age_ms: now - cacheEntry.timestamp });
      return cacheEntry.data;
    }
    
    try {
      const response = await this.retryRequest(async () => {
        return await this.axiosInstance.get(
          config.GTFS_REALTIME_TRIP_UPDATES, 
          { responseType: 'arraybuffer' }
        );
      });
      
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
        new Uint8Array(response.data)
      );
      
      // Cache the data
      this.realTimeCache.schedule = {
        data: feed,
        timestamp: now
      };
      
      Utils.log('info', 'Fetched and cached new ferry schedule data', { entities: feed.entity?.length || 0 });
      return feed;
    } catch (error) {
      Utils.log('error', 'Error fetching ferry data after retries', { error: error.message });
      
      // If we have cached data, return it even if expired during network issues
      if (cacheEntry.data) {
        Utils.log('warn', 'Network error, falling back to expired cached data', { cache_age_ms: now - cacheEntry.timestamp });
        return cacheEntry.data;
      }
      
      return null;
    }
  }

  async getServiceAlerts() {
    // Check if cached data is still valid
    const now = Date.now();
    const cacheEntry = this.realTimeCache.alerts;
    
    if (cacheEntry.data && (now - cacheEntry.timestamp) < this.realTimeCacheExpiry) {
      Utils.log('info', 'Using cached service alerts data', { cache_age_ms: now - cacheEntry.timestamp });
      return cacheEntry.data;
    }
    
    try {
      const response = await this.retryRequest(async () => {
        return await this.axiosInstance.get(
          config.GTFS_REALTIME_ALERTS,
          { responseType: 'arraybuffer' }
        );
      });
      
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
        new Uint8Array(response.data)
      );
      
      Utils.log('debug', 'Raw alerts feed received', { entities: feed.entity?.length || 0 });
      
      const alerts = this.parseAlerts(feed);
      
      // Cache the data
      this.realTimeCache.alerts = {
        data: alerts,
        timestamp: now
      };
      
      Utils.log('info', 'Fetched and cached new service alerts data', { alerts_count: alerts.length });
      return alerts;
    } catch (error) {
      Utils.log('error', 'Error fetching alerts after retries', { error: error.message });
      
      // If we have cached data, return it even if expired during network issues
      if (cacheEntry.data) {
        Utils.log('warn', 'Network error, falling back to expired cached alerts', { cache_age_ms: now - cacheEntry.timestamp });
        return cacheEntry.data;
      }
      
      return [];
    }
  }

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
        
        if (this.alertAffectsRedHook(entity.alert)) {
          alerts.push(alert);
        }
      }
    }
    
    return alerts;
  }

  alertAffectsRedHook(alert) {
    if (!alert.informedEntity || alert.informedEntity.length === 0) {
      return false;
    }
    
    const redHookStopId = this.redHookStop ? this.redHookStop.id : config.RED_HOOK_STOP_ID;
    
    return alert.informedEntity.some(entity => 
      entity.routeId === config.SOUTH_BROOKLYN_ROUTE_ID
    );
  }

  getNextRedHookDepartures(feed, fromTime, direction = null) {
    try {
      const searchTime = moment(fromTime).tz(config.TIMEZONE);
      let departures = [];
      let realTimeUpdates = new Map();

      if (feed && feed.entity) {
        for (const entity of feed.entity) {
          if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) {
            continue;
          }

          const tripId = entity.tripUpdate.trip.tripId;
          if (!tripId) continue;

          for (const stopUpdate of entity.tripUpdate.stopTimeUpdate) {
            if (this.isRedHookDeparture(stopUpdate, searchTime)) {
              realTimeUpdates.set(tripId, {
                entity,
                stopUpdate,
                departureTime: moment.unix(stopUpdate.departure.time.low).tz(config.TIMEZONE),
                delay: stopUpdate.departure.delay || 0
              });
              break;
            }
          }
        }
      }

      Utils.log('debug', 'Real-time updates processed', { updates_count: realTimeUpdates.size });

      const staticDepartures = this.getStaticScheduleDepartures(searchTime, direction);
      Utils.log('debug', 'Static departures retrieved', { departures_count: staticDepartures.length });
      
      for (const staticDep of staticDepartures) {
        const realTimeUpdate = realTimeUpdates.get(staticDep.tripId);
        
        if (realTimeUpdate) {
          const departure = this.createDepartureObject(
            realTimeUpdate.entity, 
            realTimeUpdate.stopUpdate, 
            direction
          );
          if (departure) {
            departures.push(departure);
          }
          realTimeUpdates.delete(staticDep.tripId);
        } else {
          departures.push(staticDep);
        }
      }
      
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

      departures.sort((a, b) => a.time - b.time);
      
      const uniqueDepartures = [];
      const seenTrips = new Map();
      const seenTimes = new Map();
      
      for (const departure of departures) {
        const tripId = departure.tripId;
        const timeKey = moment(departure.time).format('HH:mm');
        
        if (tripId && seenTrips.has(tripId)) {
          const existing = seenTrips.get(tripId);
          if (!departure.isStatic && existing.isStatic) {
            const index = uniqueDepartures.indexOf(existing);
            uniqueDepartures[index] = departure;
            seenTrips.set(tripId, departure);
            seenTimes.set(timeKey, departure);
          }
          continue;
        }
        
        const existingAtTime = seenTimes.get(timeKey);
        if (existingAtTime) {
          if (!departure.isStatic && existingAtTime.isStatic) {
            const index = uniqueDepartures.indexOf(existingAtTime);
            uniqueDepartures[index] = departure;
            seenTimes.set(timeKey, departure);
            if (tripId) seenTrips.set(tripId, departure);
          }
          continue;
        }
        
        uniqueDepartures.push(departure);
        if (tripId) seenTrips.set(tripId, departure);
        seenTimes.set(timeKey, departure);
      }
      
      return uniqueDepartures.slice(0, Math.max(config.MAX_DEPARTURES, 5));
      
    } catch (error) {
      Utils.log('error', 'Error parsing ferry data', { error: error.message });
      return this.getFallbackDepartures(fromTime, direction);
    }
  }

  getStaticScheduleDepartures(searchTime, direction = null) {
    const departures = [];
    const redHookStopId = this.redHookStop ? this.redHookStop.id : config.RED_HOOK_STOP_ID;
    
    try {
      // Try to get departures for the current day first
      const todayDepartures = this._getStaticDeparturesForDay(searchTime, direction, redHookStopId);
      departures.push(...todayDepartures);
      
      // If no departures found for today and we're looking after service hours,
      // also check tomorrow
      if (departures.length === 0 || !this.isWithinServiceHours(searchTime)) {
        const tomorrow = searchTime.clone().add(1, 'day').startOf('day');
        const tomorrowDepartures = this._getStaticDeparturesForDay(tomorrow, direction, redHookStopId);
        departures.push(...tomorrowDepartures);
      }
      
      // Sort by time and deduplicate by time before limiting
      departures.sort((a, b) => a.time - b.time);
      
      // Deduplicate by time to avoid multiple trips at same time taking up all slots
      const uniqueTimesDepartures = [];
      const seenTimes = new Set();
      
      for (const departure of departures) {
        const timeKey = departure.timeFormatted;
        if (!seenTimes.has(timeKey)) {
          seenTimes.add(timeKey);
          uniqueTimesDepartures.push(departure);
        }
      }
      
      return uniqueTimesDepartures.slice(0, 15); // Allow reasonable number of unique time slots
      
    } catch (error) {
      Utils.log('error', 'Error getting static schedule departures', { error: error.message });
      return [];
    }
  }

  _getStaticDeparturesForDay(searchTime, direction, redHookStopId) {
    const departures = [];
    
    for (const [tripId, trip] of this.staticService.cache.trips) {
      if (trip.routeId !== config.SOUTH_BROOKLYN_ROUTE_ID) {
        continue;
      }

      if (!this.staticService.isServiceActive(trip.serviceId, searchTime)) {
        continue;
      }
      
      if (direction) {
        if (direction === 'northbound' && trip.directionId != 1) continue;
        if (direction === 'southbound' && trip.directionId != 0) continue;
      }
      
      const stopTimes = this.staticService.cache.stopTimes.get(tripId);
      if (!stopTimes) continue;
      
      const redHookStop = stopTimes.find(st => st.stopId === redHookStopId);
      if (!redHookStop) continue;
      
      const [hours, minutes, seconds] = redHookStop.departureTime.split(':').map(Number);
      const departureTime = searchTime.clone().hour(hours).minute(minutes).second(seconds);
      
      // For current day, skip if departure already passed
      if (departureTime.isBefore(moment().tz(config.TIMEZONE))) {
        continue;
      }
      
      // Ensure we are only looking at reasonable timeframe
      if (departureTime.diff(moment().tz(config.TIMEZONE), 'hours') > 48) {
        continue;
      }
      
      const departure = this.createStaticDepartureObject(trip, departureTime, redHookStop);
      if (departure) {
        departures.push(departure);
      }
    }
    
    return departures;
  }

  createStaticDepartureObject(trip, departureTime, stopTime) {
    try {
      const route = this.staticService.getRouteInfo(trip.routeId);
      let destinations = ['next stops'];
      let directionLabel = 'towards next stops';
      
      const tripStopTimes = this.staticService.cache.stopTimes.get(trip.tripId);
      if (tripStopTimes) {
        const redHookStopIndex = tripStopTimes.findIndex(st => st.stopId === this.redHookStop.id);
        if (redHookStopIndex >= 0) {
          const stopsAfterRedHook = tripStopTimes.slice(redHookStopIndex + 1);
          destinations = stopsAfterRedHook.map(st => {
            const stopInfo = this.staticService.cache.stops.get(st.stopId);
            return stopInfo ? stopInfo.name : st.stopId;
          }).filter(name => name !== 'Red Hook/Atlantic Basin');
        }
      }
      
      if (destinations.length === 0 || destinations[0] === 'next stops') {
        if (route) {
          if (trip.directionId == 0) {
            destinations = route.southbound.destinations;
            directionLabel = route.southbound.direction;
          } else if (trip.directionId == 1) {
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
        isStatic: true
      };
    } catch (error) {
      console.error('Error creating static departure object:', error.message);
      return null;
    }
  }

  isRedHookDeparture(stopUpdate, searchTime) {
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

  createDepartureObject(entity, stopUpdate, direction = null) {
    try {
      const departureTime = moment.unix(stopUpdate.departure.time.low).tz(config.TIMEZONE);
      const tripId = entity.tripUpdate.trip.tripId;
      
      let route = null;
      let destinations = [];
      let directionLabel = '';
      let routeId = null;
      let tripInfo = null;
      
      if (this.staticService && tripId) {
        tripInfo = this.staticService.cache.trips.get(tripId);
        if (tripInfo) {
          routeId = tripInfo.routeId;
          
          if (routeId === config.SOUTH_BROOKLYN_ROUTE_ID) {
            route = this.staticService.getRouteInfo(routeId);
            
            if (route) {
              const tripDirection = tripInfo.directionId || entity.tripUpdate.trip.directionId;
              
              if (tripDirection == 0) {
                destinations = route.southbound.destinations;
                directionLabel = route.southbound.direction;
              } else if (tripDirection == 1) {
                destinations = route.northbound.destinations;
                directionLabel = route.northbound.direction;
              }
            }
          } else {
            return null;
          }
        }
      } else {
        return null;
      }
      
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
        directionLabel: directionLabel || `towards ${destinations[destinations.length - 1] || 'next stops'} `,
        destinations: destinations.slice(0, 3),
        tripId: entity.tripUpdate.trip.tripId,
        delay: stopUpdate.departure.delay || 0,
        isStatic: false
      };
    } catch (error) {
      console.error('Error creating departure object:', error.message);
      return null;
    }
  }

  getFallbackDepartures(fromTime) {
    const now = moment(fromTime).tz(config.TIMEZONE);
    const fallbackDepartures = [];
    
    if (!this.isWithinServiceHours(now)) {
      return [];
    }

    let destinations = ['next stops'];
    let routeName = 'Ferry Route';
    let directionLabel = 'towards next stops';

    if (this.staticService) {
      const route = this.staticService.getRouteInfo(config.SOUTH_BROOKLYN_ROUTE_ID);
      if (route) {
        routeName = route.name;
        destinations = route.southbound.destinations.slice(0, 3);
        directionLabel = route.southbound.direction;
      }
    }

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

  isWithinServiceHours(time) {
    if (!this.staticService || !this.staticService.cache.stopTimes.size) {
      const hour = time.hour();
      const isWeekend = time.day() === 0 || time.day() === 6;
      const serviceHours = isWeekend ? 
        config.SERVICE_HOURS.weekend : 
        config.SERVICE_HOURS.weekday;
      return hour >= serviceHours.start && hour < serviceHours.end;
    }

    const redHookStopId = this.redHookStop ? this.redHookStop.id : config.RED_HOOK_STOP_ID;
    
    let earliestTime = null;
    let latestTime = null;
    
    for (const [tripId, trip] of this.staticService.cache.trips) {
      if (trip.routeId !== config.SOUTH_BROOKLYN_ROUTE_ID) continue;
      
      if (!this.staticService.isServiceActive(trip.serviceId, time)) {
        continue;
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
      return false;
    }
    
    const requestedMinutes = time.hour() * 60 + time.minute();
    return requestedMinutes >= earliestTime && requestedMinutes <= latestTime;
  }

  formatDeparturesForSpeech(departures, alerts = [], direction = null, destination = null, sessionAttributes = {}) {
    if (departures.length === 0) {
      const now = moment().tz(config.TIMEZONE);
      if (!this.isWithinServiceHours(now)) {
        const tomorrow = now.clone().add(1, 'day').startOf('day');
        const nextDayDepartures = this.getStaticScheduleDepartures(tomorrow);
        
        if (nextDayDepartures.length > 0) {
          const firstDepartureTime = moment(nextDayDepartures[0].time).format('h:mm A');
          return `Ferry service from Red Hook is currently not operating. Service resumes tomorrow at ${firstDepartureTime}. Would you like to hear more about tomorrow's schedule?`;
        } else {
          return 'Ferry service from Red Hook is currently not operating. Service typically runs from early morning to late evening.';
        }
      }
      return 'I couldn\'t find any upcoming ferries from Red Hook. The service might be suspended or done for the day.';
    }

    let speech = '';

    let destinationPhrase = '';
    if (destination) {
      destinationPhrase = ` to ${destination}`;
    } else if (direction === 'northbound') {
      destinationPhrase = ' to Manhattan';
    } else if (direction === 'southbound') {
      destinationPhrase = ' to Bay Ridge';
    }

    if (departures.length === 1) {
      const dep = departures[0];
      speech += `The next ferry from Red Hook${destinationPhrase} is at ${dep.timeFormatted}`;
      if (dep.destinations.length > 0) {
        speech += `, heading to ${dep.destinations.join(' and ')} `;
      }
      if (dep.delay > 0) {
        speech += `, running ${Math.round(dep.delay / 60)} minutes late`;
      }
      speech += '.';
    } else {
      const groupedDepartures = this.groupDeparturesByDirection(departures);
      
      if (Object.keys(groupedDepartures).length > 1) {
        speech += this.formatMultiDirectionDepartures(groupedDepartures);
      } else {
        speech += `The next ${departures.length} ferries from Red Hook${destinationPhrase} are at `;
        
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

    const hasRealTimeData = departures.some(d => !d.isStatic && !d.isFallback);
    const hasDelays = departures.some(d => d.delay && d.delay > 0);
    
    if (hasRealTimeData && hasDelays) {
      speech += ' Times have been adjusted based on real-time ferry tracking.';
    } else if (hasRealTimeData) {
      speech += ' Times are based on real-time ferry data.';
    }

    // Add service alerts after ferry times, only if relevant and not already mentioned in session
    if (alerts.length > 0 && !sessionAttributes.alertsMentioned) {
      const relevantAlerts = alerts.filter(alert => this.alertAffectsRedHookRoute(alert, departures));
      if (relevantAlerts.length > 0) {
        speech += ' Would you like to hear about current service alerts for this route?';
        // Mark that we've offered alerts in this session
        sessionAttributes.alertsOffered = true;
      }
    }

    return speech;
  }

  alertAffectsRedHookRoute(alert, departures) {
    // Check if this alert affects any of the departure routes/trips
    if (!alert.informedEntity || alert.informedEntity.length === 0) {
      return false;
    }
    
    const departureRoutes = new Set(departures.map(d => d.route || config.SOUTH_BROOKLYN_ROUTE_ID));
    const departureTrips = new Set(departures.map(d => d.tripId).filter(Boolean));
    
    return alert.informedEntity.some(entity => 
      entity.routeId === config.SOUTH_BROOKLYN_ROUTE_ID ||
      departureTrips.has(entity.tripId) ||
      (entity.stopId && this.redHookStop && entity.stopId === this.redHookStop.id)
    );
  }

  formatServiceAlertsForSpeech(alerts) {
    if (alerts.length === 0) {
      return 'There are currently no service alerts for Red Hook ferry service.';
    }
    
    const alertTexts = alerts.map(alert => {
      const header = alert.header || 'Service alert';
      const description = alert.description || '';
      return description ? `${header}: ${description}` : header;
    });
    
    return `Current service alert${alerts.length === 1 ? '' : 's'}: ${alertTexts.join('. ')}.`;
  }

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
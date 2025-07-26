const axios = require('axios');
const AdmZip = require('adm-zip');
const csv = require('csv-parser');
const { Readable } = require('stream');
const config = require('./config');
const moment = require('moment-timezone');

class GTFSStaticService {
    constructor() {
        this.cache = {
            stops: new Map(),
            routes: new Map(),
            trips: new Map(),
            stopTimes: new Map(),
            calendar: new Map(),
            calendarDates: new Map(),
            routePatterns: new Map(), // New: store different route patterns
            lastUpdated: null
        };
        this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
    }

    async loadGTFSData() {
        // Check if cache is still valid
        if (this.cache.lastUpdated && 
            (Date.now() - this.cache.lastUpdated) < this.cacheExpiry) {
            // Using cached GTFS data
            return;
        }

        // Fetching fresh GTFS static data
        
        try {
            const response = await axios.get(config.GTFS_STATIC_URL, {
                responseType: 'arraybuffer',
                timeout: config.REQUEST_TIMEOUT
            });

            const zip = new AdmZip(response.data);
            
            // Parse each required file
            await this.parseStops(zip);
            await this.parseRoutes(zip);
            await this.parseTrips(zip);
            await this.parseStopTimes(zip);
            await this.parseCalendar(zip);
            await this.parseCalendarDates(zip);

            // Analyze route patterns after loading all data
            this.analyzeRoutePatterns();
            
            this.cache.lastUpdated = Date.now();
            // GTFS static data loaded successfully
            
        } catch (error) {
            console.error('Error loading GTFS static data:', error.message);
            throw error;
        }
    }

    async parseStops(zip) {
        const stopsEntry = zip.getEntry('stops.txt');
        if (!stopsEntry) throw new Error('stops.txt not found in GTFS zip');
        
        let stopsData = stopsEntry.getData().toString('utf8');
        
        // Remove UTF-8 BOM if present
        if (stopsData.charCodeAt(0) === 0xFEFF) {
            stopsData = stopsData.slice(1);
        }
        
        return new Promise((resolve, reject) => {
            const stops = [];
            Readable.from([stopsData])
                .pipe(csv())
                .on('data', (row) => {
                    stops.push({
                        id: row.stop_id,
                        name: row.stop_name,
                        lat: parseFloat(row.stop_lat),
                        lon: parseFloat(row.stop_lon)
                    });
                })
                .on('end', () => {
                    stops.forEach(stop => {
                        this.cache.stops.set(stop.id, stop);
                    });
                    // Loaded stops data
                    resolve();
                })
                .on('error', reject);
        });
    }

    async parseRoutes(zip) {
        const routesEntry = zip.getEntry('routes.txt');
        if (!routesEntry) throw new Error('routes.txt not found in GTFS zip');
        
        let routesData = routesEntry.getData().toString('utf8');
        
        // Remove UTF-8 BOM if present
        if (routesData.charCodeAt(0) === 0xFEFF) {
            routesData = routesData.slice(1);
        }
        
        return new Promise((resolve, reject) => {
            const routes = [];
            Readable.from([routesData])
                .pipe(csv())
                .on('data', (row) => {
                    routes.push({
                        id: row.route_id,
                        shortName: row.route_short_name,
                        longName: row.route_long_name,
                        type: row.route_type
                    });
                })
                .on('end', () => {
                    routes.forEach(route => {
                        this.cache.routes.set(route.id, route);
                    });
                    // Loaded routes data
                    resolve();
                })
                .on('error', reject);
        });
    }

    async parseTrips(zip) {
        const tripsEntry = zip.getEntry('trips.txt');
        if (!tripsEntry) throw new Error('trips.txt not found in GTFS zip');
        
        let tripsData = tripsEntry.getData().toString('utf8');
        
        // Remove UTF-8 BOM if present
        if (tripsData.charCodeAt(0) === 0xFEFF) {
            tripsData = tripsData.slice(1);
        }
        
        return new Promise((resolve, reject) => {
            const trips = [];
            Readable.from([tripsData])
                .pipe(csv())
                .on('data', (row) => {
                    trips.push({
                        routeId: row.route_id,
                        serviceId: row.service_id,
                        tripId: row.trip_id,
                        headsign: row.trip_headsign,
                        directionId: row.direction_id,
                        blockId: row.block_id,
                        shapeId: row.shape_id
                    });
                })
                .on('end', () => {
                    trips.forEach(trip => {
                        this.cache.trips.set(trip.tripId, trip);
                    });
                    // Loaded trips data
                    resolve();
                })
                .on('error', reject);
        });
    }

    async parseStopTimes(zip) {
        const stopTimesEntry = zip.getEntry('stop_times.txt');
        if (!stopTimesEntry) throw new Error('stop_times.txt not found in GTFS zip');
        
        let stopTimesData = stopTimesEntry.getData().toString('utf8');
        
        // Remove UTF-8 BOM if present
        if (stopTimesData.charCodeAt(0) === 0xFEFF) {
            stopTimesData = stopTimesData.slice(1);
        }
        
        return new Promise((resolve, reject) => {
            const stopTimes = [];
            Readable.from([stopTimesData])
                .pipe(csv())
                .on('data', (row) => {
                    const tripId = row.trip_id;
                    if (!this.cache.stopTimes.has(tripId)) {
                        this.cache.stopTimes.set(tripId, []);
                    }
                    
                    this.cache.stopTimes.get(tripId).push({
                        stopId: row.stop_id,
                        arrivalTime: row.arrival_time,
                        departureTime: row.departure_time,
                        stopSequence: parseInt(row.stop_sequence)
                    });
                })
                .on('end', () => {
                    // Sort stop times by sequence for each trip
                    for (const [tripId, times] of this.cache.stopTimes) {
                        times.sort((a, b) => a.stopSequence - b.stopSequence);
                    }
                    
                    const totalStopTimes = Array.from(this.cache.stopTimes.values())
                        .reduce((sum, times) => sum + times.length, 0);
                    // Loaded stop times data
                    resolve();
                })
                .on('error', reject);
        });
    }

    async parseCalendar(zip) {
        const calendarEntry = zip.getEntry('calendar.txt');
        if (!calendarEntry) {
            // File might be optional, so just resolve
            return Promise.resolve();
        }
        
        let calendarData = calendarEntry.getData().toString('utf8');
        
        // Remove UTF-8 BOM if present
        if (calendarData.charCodeAt(0) === 0xFEFF) {
            calendarData = calendarData.slice(1);
        }
        
        return new Promise((resolve, reject) => {
            Readable.from([calendarData])
                .pipe(csv())
                .on('data', (row) => {
                    this.cache.calendar.set(row.service_id, {
                        serviceId: row.service_id,
                        monday: row.monday === '1',
                        tuesday: row.tuesday === '1',
                        wednesday: row.wednesday === '1',
                        thursday: row.thursday === '1',
                        friday: row.friday === '1',
                        saturday: row.saturday === '1',
                        sunday: row.sunday === '1',
                        startDate: row.start_date,
                        endDate: row.end_date,
                    });
                })
                .on('end', () => {
                    resolve();
                })
                .on('error', reject);
        });
    }

    async parseCalendarDates(zip) {
        const calendarDatesEntry = zip.getEntry('calendar_dates.txt');
        if (!calendarDatesEntry) {
            // File might be optional
            return Promise.resolve();
        }
        
        let calendarDatesData = calendarDatesEntry.getData().toString('utf8');
        
        // Remove UTF-8 BOM if present
        if (calendarDatesData.charCodeAt(0) === 0xFEFF) {
            calendarDatesData = calendarDatesData.slice(1);
        }
        
        return new Promise((resolve, reject) => {
            Readable.from([calendarDatesData])
                .pipe(csv())
                .on('data', (row) => {
                    const serviceId = row.service_id;
                    if (!this.cache.calendarDates.has(serviceId)) {
                        this.cache.calendarDates.set(serviceId, []);
                    }
                    this.cache.calendarDates.get(serviceId).push({
                        date: row.date,
                        exceptionType: row.exception_type,
                    });
                })
                .on('end', () => {
                    resolve();
                })
                .on('error', reject);
        });
    }

    isServiceActive(serviceId, searchDate) {
        const searchMoment = moment.tz(searchDate, 'America/New_York').startOf('day');
        const dayOfWeek = searchMoment.format('dddd').toLowerCase();

        const calendar = this.cache.calendar.get(serviceId);
        const calendarExceptions = this.cache.calendarDates.get(serviceId) || [];

        // Check for specific date exceptions
        for (const exception of calendarExceptions) {
            const exceptionDate = moment.tz(exception.date, 'YYYYMMDD', 'America/New_York').startOf('day');
            if (exceptionDate.isSame(searchMoment)) {
                return exception.exceptionType === '1'; // 1 = service added
            }
        }

        if (calendar) {
            const startDate = moment.tz(calendar.startDate, 'YYYYMMDD', 'America/New_York').startOf('day');
            const endDate = moment.tz(calendar.endDate, 'YYYYMMDD', 'America/New_York').startOf('day');

            if (searchMoment.isBetween(startDate, endDate, null, '[]')) {
                if (calendar[dayOfWeek]) {
                    return true;
                }
            }
        }

        return false;
    }

    analyzeRoutePatterns() {
        // Analyzing route patterns for South Brooklyn route
        
        // Focus on South Brooklyn route
        const sbTrips = Array.from(this.cache.trips.values())
            .filter(trip => trip.routeId === 'SB');
        
        const patterns = new Map();
        
        for (const trip of sbTrips) {
            const stopTimes = this.cache.stopTimes.get(trip.tripId);
            if (!stopTimes) continue;
            
            // Create a pattern signature based on stops in sequence
            const stopSequence = stopTimes.map(st => st.stopId).join('-');
            
            if (!patterns.has(stopSequence)) {
                patterns.set(stopSequence, {
                    stopIds: stopTimes.map(st => st.stopId),
                    stopNames: stopTimes.map(st => {
                        const stop = this.cache.stops.get(st.stopId);
                        return stop ? stop.name : `Stop ${st.stopId}`;
                    }),
                    tripCount: 0,
                    sampleTripId: trip.tripId,
                    direction: trip.directionId,
                    headsign: trip.headsign
                });
            }
            
            patterns.get(stopSequence).tripCount++;
        }
        
        // Store patterns for South Brooklyn route
        this.cache.routePatterns.set('SB', Array.from(patterns.values()));
        
        // Route pattern analysis complete - found patterns for South Brooklyn route
    }

    findRedHookStop() {
        // Look for Red Hook stop by name - it's called "Red Hook/Atlantic Basin" in the GTFS data
        for (const [stopId, stop] of this.cache.stops) {
            const name = stop.name.toLowerCase();
            if (name.includes('red hook') || name.includes('atlantic basin')) {
                return stop;
            }
        }
        return null;
    }

    getRedHookRoutePatterns() {
        // Get all South Brooklyn route patterns that include Red Hook
        const sbPatterns = this.cache.routePatterns.get('SB') || [];
        const redHookStopId = config.RED_HOOK_STOP_ID;
        
        return sbPatterns.filter(pattern => 
            pattern.stopIds.includes(redHookStopId)
        );
    }

    getDestinationsFromRedHook(direction = null) {
        const patterns = this.getRedHookRoutePatterns();
        const redHookStopId = config.RED_HOOK_STOP_ID;
        const destinations = new Set();
        
        for (const pattern of patterns) {
            // Skip if direction is specified and doesn't match
            if (direction !== null && pattern.direction != direction) continue;
            
            const redHookIndex = pattern.stopIds.indexOf(redHookStopId);
            if (redHookIndex === -1) continue;
            
            // Get stops after Red Hook in this pattern
            const stopsAfterRedHook = pattern.stopNames.slice(redHookIndex + 1);
            stopsAfterRedHook.forEach(stop => destinations.add(stop));
        }
        
        return Array.from(destinations);
    }

    getAllStopsForRoute(routeId) {
        const patterns = this.cache.routePatterns.get(routeId) || [];
        const allStops = new Set();
        
        for (const pattern of patterns) {
            pattern.stopNames.forEach(stop => allStops.add(stop));
        }
        
        return Array.from(allStops);
    }

    getRouteInfo(routeId) {
        const route = this.cache.routes.get(routeId);
        if (!route) return null;
        
        const patterns = this.getRedHookRoutePatterns();
        const allStops = this.getAllStopsForRoute(routeId);
        
        // Determine typical destinations from Red Hook
        const southboundDestinations = this.getDestinationsFromRedHook(0); // direction 0
        const northboundDestinations = this.getDestinationsFromRedHook(1); // direction 1
        
        return {
            name: route.longName || route.shortName,
            allStops,
            patterns,
            southbound: {
                direction: southboundDestinations.length > 0 ? 
                    `towards ${southboundDestinations[southboundDestinations.length - 1]}` : 
                    'southbound',
                destinations: southboundDestinations
            },
            northbound: {
                direction: northboundDestinations.length > 0 ? 
                    `towards ${northboundDestinations[northboundDestinations.length - 1]}` : 
                    'northbound',
                destinations: northboundDestinations
            }
        };
    }
}

module.exports = GTFSStaticService;
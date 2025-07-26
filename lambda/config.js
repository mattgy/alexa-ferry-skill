// Configuration settings for the Red Hook Ferry Skill
module.exports = {
  // NYC Ferry GTFS endpoints - using HTTPS where possible
  GTFS_STATIC_URL: process.env.GTFS_STATIC_URL || 'http://nycferry.connexionz.net/rtt/public/utility/gtfs.aspx',
  GTFS_REALTIME_TRIP_UPDATES: process.env.GTFS_TRIP_UPDATES_URL || 'http://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/tripupdate',
  GTFS_REALTIME_ALERTS: process.env.GTFS_ALERTS_URL || 'http://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/alert',
  
  // Red Hook stop ID in the GTFS data (discovered from GTFS analysis)
  RED_HOOK_STOP_ID: process.env.RED_HOOK_STOP_ID || '24',
  
  // South Brooklyn Route ID (discovered from GTFS analysis)
  SOUTH_BROOKLYN_ROUTE_ID: 'SB',
  
  // Time settings
  TIMEZONE: 'America/New_York',
  MAX_DEPARTURES: 3,
  
  // API timeout settings
  REQUEST_TIMEOUT: 10000, // 10 seconds
  
  // Service hours (24-hour format) - fallback only, real hours come from GTFS
  SERVICE_HOURS: {
    weekday: { start: 6, end: 22 },
    weekend: { start: 7, end: 21 }
  }
};

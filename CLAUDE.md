# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Testing
- `npm test` - Run all tests with Jest
- `npm run test:coverage` - Run tests with coverage reporting
- `npm run test:watch` - Run tests in watch mode

### Code Quality
- `npm run lint` - Run ESLint
- `npm run validate` - Run npm test (validation alias)

### Deployment
- `npm run deploy` - Create skill.zip deployment package
- `./deploy.sh` - Full deployment script (install, test, package)

### Utility Scripts
- `npm run compare-schedule` - Compare schedule with website data
- `npm run validate-gtfs` - Validate GTFS data structure

## Architecture Overview

This is an Alexa skill for NYC Ferry schedules from Red Hook terminal. The codebase uses a modular architecture with three main service layers:

### Core Components

**index.js** - Main Alexa skill handler with intent routing. Contains all Alexa-specific request handlers and integrates with the ferry service layer.

**FerryService** (`ferryService.js`) - Core business logic that combines real-time GTFS data with static schedules. Handles GTFS real-time parsing, departure filtering, and speech formatting.

**GTFSStaticService** (`gtfsStaticService.js`) - Manages static GTFS data loading and caching. Downloads NYC Ferry's GTFS ZIP file, parses CSV data, and provides route/stop information with 24-hour caching.

**Utils** (`utils.js`) - Time parsing, input validation, structured logging, and common utilities.

**config.js** - Centralized configuration including GTFS endpoints, timezone settings, and fallback values.

### Data Flow
1. GTFSStaticService loads and caches static GTFS data (routes, stops, schedules)
2. FerryService fetches real-time GTFS protobuf data for trip updates and alerts
3. Real-time data is merged with static schedules for accurate departure times
4. Results are formatted for natural speech output via Alexa

### Key Features
- **Dynamic GTFS Integration**: Automatically discovers Red Hook stop and route information from official NYC Ferry GTFS feed
- **Real-time Updates**: Combines static schedules with live trip updates and service alerts
- **Intelligent Caching**: 24-hour cache for static data with graceful fallback when APIs unavailable
- **Time-aware Queries**: Supports queries like "ferries after 3 PM" with natural language time parsing
- **Direction Filtering**: Handles northbound/southbound queries with destination information

### Environment Variables
Set these in Lambda or local .env:
- `GTFS_STATIC_URL` - NYC Ferry static GTFS ZIP endpoint
- `GTFS_TRIP_UPDATES_URL` - Real-time trip updates endpoint  
- `GTFS_ALERTS_URL` - Service alerts endpoint
- `RED_HOOK_STOP_ID` - Fallback stop ID (normally auto-discovered)

### Testing Structure
- Uses Jest with comprehensive unit tests for all service classes
- Tests cover GTFS parsing, time calculations, speech formatting, and error handling
- Coverage reporting available via `npm run test:coverage`

### Deployment Notes
- Target: AWS Lambda with Node.js 18.x runtime
- Package size optimized by excluding node_modules, tests, and coverage from deployment ZIP
- Requires 512MB memory for GTFS ZIP processing
- 30-second timeout recommended for GTFS downloads
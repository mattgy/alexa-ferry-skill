# CLAUDE.md - Development Notes for Red Hook Ferry Alexa Skill

This document contains specific guidelines and context for working with this project.

## Project Overview

This is an enhanced Alexa skill that provides comprehensive ferry information for the Red Hook terminal in Brooklyn, NY. The skill uses NYC Ferry's official GTFS (General Transit Feed Specification) data to provide real-time ferry schedules, service alerts, and interactive features.

## Key Project Information

- **Main Language**: JavaScript (Node.js)
- **Framework**: Alexa Skills Kit SDK for Node.js
- **Data Sources**: NYC Ferry GTFS static and real-time feeds
- **Testing**: Jest framework with comprehensive test coverage
- **Deployment**: AWS Lambda with automated deployment scripts

## Development Guidelines

### Git Commit Messages
- **IMPORTANT**: Do NOT mention AI tools (like Claude, ChatGPT, etc.) in commit messages or documentation
- Follow conventional commit format: `type: description`
- Use types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- Keep commit messages professional and focused on the technical change

### Code Quality Standards
- Use ESLint configuration (`eslint.config.mjs`)
- Maintain test coverage above 80%
- Run tests before committing: `npm test`
- Use JSDoc comments for new functions
- Follow existing code patterns and architecture

### Testing Commands
```bash
npm test                    # Run all tests
npm run test:coverage      # Run tests with coverage report
npm run test:watch         # Run tests in watch mode
npm run validate           # Alias for npm test
```

### Project Architecture

#### Core Services
1. **GTFSStaticService** (`gtfsStaticService.js`)
   - Downloads and parses NYC Ferry's static GTFS feed
   - Automatically discovers routes, stops, and trip sequences
   - Caches data for 24 hours with automatic refresh

2. **FerryService** (`ferryService.js`)
   - Handles GTFS real-time data (trip updates, service alerts)
   - Integrates static and real-time data
   - Provides fallback mechanisms when APIs are unavailable

3. **Utils** (`utils.js`)
   - Time parsing and formatting utilities
   - Input validation and sanitization
   - Logging helpers with Eastern Time timestamps

#### File Structure
```
/
├── index.js                 # Main Alexa skill handler
├── ferryService.js         # Real-time GTFS service
├── gtfsStaticService.js    # Static GTFS data processing
├── utils.js                # Utility functions
├── config.js               # Configuration management
├── tests/                  # Jest test files
├── scripts/                # Utility scripts
├── skill-package/          # Alexa interaction model
└── lambda/                 # Deployment package files
```

### Environment Configuration

#### Required Environment Variables
```bash
# GTFS API Endpoints
GTFS_STATIC_URL=http://nycferry.connexionz.net/rtt/public/utility/gtfs.aspx
GTFS_TRIP_UPDATES_URL=http://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/tripupdate
GTFS_ALERTS_URL=http://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/alert

# Stop Configuration (fallback - auto-discovered from GTFS)
RED_HOOK_STOP_ID=RDHK

# AWS Configuration
AWS_REGION=us-east-1
LAMBDA_FUNCTION_NAME=redHookFerrySkill
```

#### Security Files (Not in Git)
- `.env` - Environment variables and secrets
- `skill.json` - Contains AWS Lambda ARN (use `skill.json.template`)
- `*.zip` - Deployment packages
- Local test files with sensitive data

### Development Workflow

1. **Setup**
   ```bash
   npm install
   cp .env.example .env          # Configure environment
   cp skill.json.template skill.json  # Configure AWS details
   ```

2. **Development**
   ```bash
   npm test                      # Run tests frequently
   npm run lint                  # Check code style
   ```

3. **Deployment**
   ```bash
   ./deploy.sh                   # Automated deployment
   # OR
   npm run deploy               # Manual package creation
   ```

### Key Features to Understand

#### Dynamic GTFS Integration
- The skill automatically discovers routes and stops from NYC Ferry's official GTFS feed
- No hardcoded route information - all data comes from the live feed
- Handles ZIP file extraction and CSV parsing for static GTFS data
- 24-hour caching with automatic refresh

#### Real-time Capabilities
- Service alerts filtered specifically for Red Hook routes
- Trip updates with delay information
- Time-specific queries ("ferries after 3 PM")
- Interactive prompts for service alerts

#### Error Handling
- Graceful fallback when GTFS feeds are unavailable
- Comprehensive logging with request IDs
- Proper timezone handling (Eastern Time)
- Input validation and sanitization

### Testing Strategy

#### Test Coverage Areas
- Ferry service functionality (`tests/ferryService.test.js`)
- Static GTFS data processing (`tests/gtfsStaticService.test.js`)
- Utility functions (`tests/utils.test.js`)
- Integration tests (`tests/integration.test.js`)
- Schedule validation against official sources

#### Mock Data
- Tests use realistic mock GTFS data
- Covers both normal operations and error conditions
- Validates timezone handling and time parsing

### Common Issues and Solutions

#### GTFS Data Loading
- If static GTFS fails, service falls back to configured route data
- Check CloudWatch logs for detailed GTFS parsing errors
- Verify ZIP file format and CSV structure in feeds

#### Time Handling
- All times are converted to Eastern Time for consistency
- Uses moment-timezone for reliable timezone conversion
- Handles both 12-hour and 24-hour time formats from user input

#### Service Alerts
- Alerts are filtered using GTFS informedEntity for Red Hook routes
- Interactive "yes/no" responses for hearing alerts
- Proper session management for alert prompts

### Deployment Notes

#### AWS Lambda Configuration
- **Runtime**: Node.js 18.x or later
- **Memory**: 512 MB (needed for GTFS processing)
- **Timeout**: 30 seconds
- **Trigger**: Alexa Skills Kit

#### Deployment Package
- Created with `npm run deploy` or `./deploy.sh`
- Excludes development files (`node_modules`, tests, coverage)
- Includes only production dependencies

### Performance Considerations

- Parallel API calls for better response times
- Efficient CSV parsing with streaming
- Caching strategy for static GTFS data
- Optimized deployment package size

### Skill Interaction Examples

#### Voice Commands
```
"Alexa, open Red Hook Ferry"
"Alexa, ask Red Hook Ferry when is the next ferry"
"Alexa, ask Red Hook Ferry for ferries after 3 PM"
"Alexa, ask Red Hook Ferry are there any service alerts"
```

#### Interactive Features
- Skill prompts: "Would you like to hear about current service alerts?"
- User can respond with "Yes" or "No"
- Proper session handling for multi-turn conversations

### Recent Major Changes

#### v2.1.0 Features
- Dynamic GTFS integration replacing hardcoded routes
- Enhanced route discovery and destination accuracy
- Improved caching and fallback mechanisms
- Better integration between static and real-time data

#### Bug Fixes
- Fixed "yes" response handling for service alerts
- Proper intent handler separation
- Improved session management
- Better service alert filtering

This project demonstrates a production-ready Alexa skill with comprehensive real-time data integration, proper error handling, and user-friendly interactive features.
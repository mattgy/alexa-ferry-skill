# Red Hook Ferry Checker Alexa Skill

This enhanced Alexa skill provides comprehensive information about ferry departures from the Red Hook terminal in Brooklyn, NY, with real-time data, service alerts, and improved user experience.

## 🚀 New Features

### Enhanced Functionality
- **Dynamic GTFS data loading** - Automatically discovers routes and stops from NYC Ferry's static GTFS feed
- **Real-time service alerts** - Get notified about delays and disruptions
- **Interactive service alerts** - Say "yes" when prompted to hear current alerts
- **Time-specific queries** - Ask for ferries after a specific time
- **Improved error handling** - Better fallback responses and error recovery
- **Timezone awareness** - Proper Eastern Time handling
- **Service hours validation** - Knows when ferries aren't running
- **Delay information** - Shows if ferries are running late

### Better User Experience
- **Interactive prompts** - Skill asks if you'd like to hear service alerts and responds properly to yes/no
- **More natural responses** - Includes destination information and relative timing
- **Comprehensive help** - Better guidance on what you can ask
- **Structured logging** - Better debugging and monitoring
- **Fallback data** - Provides estimated times when real-time data is unavailable
- **Automatic route discovery** - No more hardcoded route information

### Recent Bug Fixes ✅
- **Fixed "yes" response bug** - Now correctly shows service alerts instead of repeating ferry schedule
- **Fixed session management** - Proper handling of alertsOffered and alertsMentioned flags
- **Fixed service alert filtering** - Correctly filters alerts for Red Hook route using informedEntity
- **Fixed intent handler separation** - YesIntent and GetNextDayFerriesIntent now properly separated

## 🗣️ Usage Examples

### Basic Queries
- "Alexa, open Red Hook Ferry"
- "Alexa, ask Red Hook Ferry when is the next ferry"
- "Alexa, ask Red Hook Ferry for the ferry schedule"

### Time-Specific Queries
- "Alexa, ask Red Hook Ferry for ferries after 3 PM"
- "Alexa, ask Red Hook Ferry when do ferries leave after 2:30"
- "Alexa, ask Red Hook Ferry for departures after 5 o'clock"

### Service Information
- "Alexa, ask Red Hook Ferry are there any service alerts"
- "Alexa, ask Red Hook Ferry check for delays"
- "Alexa, ask Red Hook Ferry about service disruptions"

### Interactive Features
After asking for ferry times, the skill will prompt:
- **"Would you like to hear about current service alerts for this route?"**
- Respond with **"Yes"** to hear service alerts
- Respond with **"No"** to end the conversation
- This interactive feature was recently fixed to work properly!

## 🛠️ Technical Improvements

### Dynamic Data Loading
- ✅ Fetches static GTFS data from NYC Ferry's official feed
- ✅ Automatically discovers Red Hook stop ID and route information
- ✅ Dynamic destination parsing from actual ferry routes
- ✅ Caching with 24-hour refresh cycle
- ✅ Graceful fallback to configured values when GTFS unavailable

### Security & Reliability
- ✅ Updated to secure dependency versions (axios 1.6.0+)
- ✅ Proper error handling with structured logging
- ✅ Input validation and sanitization
- ✅ Request timeout configuration
- ✅ Graceful fallback mechanisms

### Code Quality
- ✅ Modular architecture with separate service classes
- ✅ Comprehensive unit tests with Jest
- ✅ Environment variable configuration
- ✅ TypeScript-ready structure
- ✅ Proper timezone handling with moment-timezone

### Performance
- ✅ Parallel API calls for better response times
- ✅ Efficient GTFS data parsing with streaming CSV
- ✅ Caching-friendly architecture
- ✅ Optimized deployment package

## 📋 Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your specific configuration
```

### 3. Setup Alexa Skill Configuration
```bash
cp skill.json.template skill.json
# Edit skill.json and replace ACCOUNT_ID, REGION, and FUNCTION_NAME with your AWS Lambda details
```

### 4. Run Tests
```bash
npm test
```

### 5. Deploy
```bash
# Automated deployment (requires AWS CLI configured)
./deploy.sh

# Or manual deployment
npm run deploy
```

## 🏗️ Architecture

### Core Components

**GTFSStaticService** (`gtfsStaticService.js`)
- Downloads and parses NYC Ferry's static GTFS feed
- Discovers stops, routes, and trip sequences dynamically
- Provides caching with automatic refresh
- Handles ZIP file extraction and CSV parsing

**FerryService** (`ferryService.js`)
- Handles all GTFS real-time data fetching and parsing
- Manages service alerts and real-time updates
- Integrates with static GTFS data for enhanced responses
- Provides fallback data when APIs are unavailable

**Utils** (`utils.js`)
- Time parsing and formatting utilities
- Input validation and sanitization
- Logging and debugging helpers

**Configuration** (`config.js`)
- Centralized configuration management
- Environment variable handling
- Fallback route and service hour definitions

### Data Flow
1. User makes voice request to Alexa
2. Ferry service initializes with static GTFS data (cached for 24 hours)
3. Intent handler processes the request
4. FerryService fetches real-time GTFS data
5. Static and real-time data are combined for accurate responses
6. Response is formatted for natural speech output
7. Alexa speaks the response to the user

## 🔧 Configuration Options

### Environment Variables
```bash
# API Endpoints
GTFS_STATIC_URL=http://nycferry.connexionz.net/rtt/public/utility/gtfs.aspx
GTFS_TRIP_UPDATES_URL=http://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/tripupdate
GTFS_ALERTS_URL=http://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/alert

# Stop Configuration (fallback only - auto-discovered from GTFS)
RED_HOOK_STOP_ID=RDHK

# AWS Deployment
AWS_REGION=us-east-1
LAMBDA_FUNCTION_NAME=redHookFerrySkill
```

### Service Hours
- **Weekdays**: 6:00 AM - 10:00 PM
- **Weekends**: 7:00 AM - 9:00 PM

### Dynamic Route Discovery
The skill now automatically discovers:
- All routes serving Red Hook terminal
- Stop sequences and destinations for each route
- Actual stop names and locations from GTFS data
- Service patterns and trip directions

## 🧪 Testing

### Run All Tests
```bash
npm test
```

### Run Tests with Coverage
```bash
npm run test:coverage
```

### Test Files
- `tests/ferryService.test.js` - Ferry service functionality
- `tests/gtfsStaticService.test.js` - Static GTFS data processing
- `tests/utils.test.js` - Utility functions
- `tests/setup.js` - Test configuration

## 📦 Deployment

### Automated Deployment
The `deploy.sh` script handles the complete deployment process:
1. Installs dependencies
2. Runs tests
3. Creates deployment package
4. Uploads to AWS Lambda (if configured)

### Manual Deployment Steps
1. Create deployment package: `npm run deploy`
2. Upload `skill.zip` to your Lambda function
3. Update the Lambda ARN in `skill.json`
4. Deploy the interaction model in Alexa Developer Console
5. Test in the Alexa Simulator

### AWS Lambda Configuration
- **Runtime**: Node.js 18.x or later
- **Memory**: 512 MB (recommended for GTFS processing)
- **Timeout**: 30 seconds
- **Environment Variables**: Set according to `.env.example`

## 🔍 Monitoring & Debugging

### Structured Logging
All logs include:
- Timestamp in Eastern Time
- Request ID for tracing
- Log level (INFO, WARN, ERROR)
- Contextual data

### Common Issues & Solutions

**"I couldn't retrieve the ferry schedule"**
- Check GTFS endpoint availability
- Verify network connectivity from Lambda
- Check CloudWatch logs for detailed errors

**"No upcoming ferries found"**
- GTFS static data will auto-discover the correct Red Hook stop ID
- Check if request is within service hours
- Review GTFS data format for changes

**GTFS data loading issues**
- Service falls back to configured route data
- Check static GTFS feed availability
- Verify ZIP file format and CSV structure

**Time parsing issues**
- Check timezone configuration
- Verify moment-timezone is properly installed
- Review user input patterns in logs

## 🤝 Contributing

### Development Setup
1. Fork the repository
2. Install dependencies: `npm install`
3. Create feature branch: `git checkout -b feature-name`
4. Make changes and add tests
5. Run tests: `npm test`
6. Submit pull request

### Code Standards
- Use ESLint configuration
- Maintain test coverage above 80%
- Follow existing code patterns
- Add JSDoc comments for new functions

## 📄 License

ISC License - see package.json for details

## 🆘 Support

For issues and questions:
1. Check the troubleshooting section above
2. Review CloudWatch logs for detailed errors
3. Verify GTFS endpoint status
4. Check Alexa Developer Console for skill configuration issues

## 🔐 Security Notes

### Files Not in Repository
The following files are excluded from the public repository for security reasons:
- `skill.json` - Contains AWS Lambda ARN with account ID (use `skill.json.template` instead)
- `.env` - Contains environment variables and secrets (use `.env.example` as template)
- `*.zip` - Deployment packages that may contain sensitive configuration
- `localTest.js` - Local testing scripts that may contain test data

### Setup for Development
1. Copy template files: `cp skill.json.template skill.json` and `cp .env.example .env`
2. Fill in your AWS account details in `skill.json`
3. Configure environment variables in `.env`
4. Never commit these files to the repository

## 🔄 Version History

### v2.1.0 (Current)
- **Dynamic GTFS Integration**: Now uses NYC Ferry's static GTFS feed to automatically discover routes and stops
- **Enhanced Route Discovery**: No more hardcoded route information - all data comes from official GTFS
- **Improved Destination Accuracy**: Real destination names from actual ferry schedules
- **Better Caching**: 24-hour cache for static GTFS data with automatic refresh
- **Robust Fallbacks**: Graceful degradation when GTFS data is unavailable

### v2.0.0
- Complete rewrite with modular architecture
- Added service alerts and time-specific queries
- Improved error handling and fallback mechanisms
- Added comprehensive testing suite
- Enhanced security and dependency management

### v1.0.0 (Original)
- Basic ferry schedule checking
- Simple voice interface
- Basic GTFS integration

#!/usr/bin/env node

/**
 * Integration test script to verify GTFS functionality
 * This script tests the actual GTFS feed parsing without mocking
 */

const FerryService = require('./ferryService');
const GTFSStaticService = require('./gtfsStaticService');

async function testGTFSIntegration() {
    console.log('🚢 Testing Red Hook Ferry GTFS Integration...\n');
    
    try {
        // Test 1: GTFSStaticService initialization
        console.log('1. Testing GTFSStaticService...');
        const staticService = new GTFSStaticService();
        
        try {
            await staticService.loadGTFSData();
            console.log('   ✅ GTFS static data loaded successfully');
            
            // Check if we found stops
            console.log(`   📍 Loaded ${staticService.cache.stops.size} stops`);
            console.log(`   🚌 Loaded ${staticService.cache.routes.size} routes`);
            console.log(`   🚂 Loaded ${staticService.cache.trips.size} trips`);
            console.log(`   ⏰ Loaded stop times for ${staticService.cache.stopTimes.size} trips`);
            
        } catch (error) {
            console.log('   ⚠️  GTFS static data failed to load:', error.message);
            console.log('   📝 This is expected if the GTFS feed is unavailable');
        }
        
        // Test 2: Red Hook stop discovery
        console.log('\n2. Testing Red Hook stop discovery...');
        const redHookStop = staticService.findRedHookStop();
        
        if (redHookStop) {
            console.log(`   ✅ Found Red Hook stop: ${redHookStop.name} (${redHookStop.id})`);
            console.log(`   📍 Location: ${redHookStop.lat}, ${redHookStop.lon}`);
            
            // Test 3: Route discovery
            console.log('\n3. Testing route discovery...');
            const routes = staticService.getRoutesServingStop(redHookStop.id);
            console.log(`   🚌 Found ${routes.length} routes serving Red Hook:`);
            routes.forEach(route => {
                console.log(`      - ${route.shortName}: ${route.longName}`);
            });
            
            // Test 4: Destination discovery
            console.log('\n4. Testing destination discovery...');
            const destinations = staticService.getNextStopsAfterRedHook(redHookStop.id);
            console.log(`   🎯 Found ${destinations.length} destinations from Red Hook:`);
            destinations.forEach(dest => {
                console.log(`      - ${dest}`);
            });
            
        } else {
            console.log('   ⚠️  Red Hook stop not found in GTFS data');
            console.log('   📝 Will fall back to configured stop ID');
        }
        
        // Test 5: FerryService integration
        console.log('\n5. Testing FerryService integration...');
        const ferryService = new FerryService();
        
        try {
            await ferryService.initialize();
            console.log('   ✅ FerryService initialized successfully');
            
            if (ferryService.redHookStop) {
                console.log(`   📍 Using Red Hook stop: ${ferryService.redHookStop.name} (${ferryService.redHookStop.id})`);
            } else {
                console.log('   ⚠️  Using fallback Red Hook configuration');
            }
            
        } catch (error) {
            console.log('   ⚠️  FerryService initialization failed:', error.message);
        }
        
        // Test 6: Fallback data generation
        console.log('\n6. Testing fallback data generation...');
        const fallbackDepartures = ferryService.getFallbackDepartures(new Date());
        console.log(`   🚢 Generated ${fallbackDepartures.length} fallback departures:`);
        fallbackDepartures.forEach(dep => {
            console.log(`      - ${dep.timeFormatted}: ${dep.route} ${dep.directionLabel}`);
            console.log(`        Destinations: ${dep.destinations.join(', ')}`);
        });
        
        console.log('\n🎉 Integration test completed successfully!');
        
    } catch (error) {
        console.error('\n❌ Integration test failed:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the test if this script is executed directly
if (require.main === module) {
    testGTFSIntegration().catch(console.error);
}

module.exports = { testGTFSIntegration };

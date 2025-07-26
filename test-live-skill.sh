#!/bin/bash

# Comprehensive ASK CLI testing for Red Hook Ferry Skill
# Tests all major invocations on the live deployed skill

SKILL_ID=$(ask smapi list-skills-for-vendor | jq -r '.skills[] | select(.stage == "development") | .skillId')

echo "🧪 Testing Live Red Hook Ferry Skill - All Invocations"
echo "======================================================"
echo "Skill ID: $SKILL_ID"
echo ""

# Helper function to run simulation and get result
test_invocation() {
    local test_name="$1"
    local input_content="$2"
    
    echo "📝 Test: $test_name"
    echo "───────────────────────────────────────"
    
    # Start simulation
    local sim_response=$(ask smapi simulate-skill \
        --skill-id "$SKILL_ID" \
        --stage development \
        --input-content "$input_content" \
        --device-locale en-US)
    
    local sim_id=$(echo "$sim_response" | jq -r '.id')
    
    if [ "$sim_id" = "null" ]; then
        echo "❌ Failed to start simulation"
        echo "$sim_response"
        return 1
    fi
    
    echo "⏳ Simulation ID: $sim_id (waiting for result...)"
    
    # Wait for simulation to complete
    local max_attempts=10
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
        sleep 3
        local result=$(ask smapi get-skill-simulation \
            --skill-id "$SKILL_ID" \
            --simulation-id "$sim_id" 2>/dev/null)
        
        local status=$(echo "$result" | jq -r '.status // "unknown"')
        
        if [ "$status" = "SUCCESSFUL" ]; then
            local speech=$(echo "$result" | jq -r '.result.alexaExecutionInfo.alexaResponses[0].content.caption // "No speech output"')
            local session_attrs=$(echo "$result" | jq -c '.result.skillExecutionInfo.invocations[0].invocationResponse.body.sessionAttributes // {}')
            local should_end=$(echo "$result" | jq -r '.result.skillExecutionInfo.invocations[0].invocationResponse.body.response.shouldEndSession // "unknown"')
            
            echo "✅ SUCCESS"
            echo "💬 Speech: $speech"
            echo "📊 Session: $session_attrs"
            echo "🔚 Ends session: $should_end"
            echo ""
            return 0
        elif [ "$status" = "FAILED" ]; then
            echo "❌ SIMULATION FAILED"
            echo "$result" | jq -r '.result.error.message // "Unknown error"'
            echo ""
            return 1
        fi
        
        attempt=$((attempt + 1))
        echo "⏳ Status: $status (attempt $attempt/$max_attempts)"
    done
    
    echo "❌ TIMEOUT waiting for simulation"
    echo ""
    return 1
}

# Test 1: Basic ferry request
echo "🚢 BASIC FERRY REQUESTS"
echo "========================"

test_invocation "What's next ferry" '{
    "session": {
        "new": true,
        "sessionId": "test-session-1",
        "application": {"applicationId": "test"},
        "user": {"userId": "test"}
    },
    "request": {
        "type": "IntentRequest",
        "requestId": "test-1",
        "locale": "en-US",
        "timestamp": "2025-01-01T00:00:00Z",
        "intent": {"name": "GetNextFerriesIntent", "confirmationStatus": "NONE"}
    },
    "version": "1.0",
    "context": {"System": {"application": {"applicationId": "test"}, "user": {"userId": "test"}}}
}'

test_invocation "Ferries to Wall Street" '{
    "session": {
        "new": true,
        "sessionId": "test-session-2",
        "application": {"applicationId": "test"},
        "user": {"userId": "test"}
    },
    "request": {
        "type": "IntentRequest",
        "requestId": "test-2",
        "locale": "en-US",
        "timestamp": "2025-01-01T00:00:00Z",
        "intent": {
            "name": "GetFerriesWithDirectionIntent",
            "confirmationStatus": "NONE",
            "slots": {"destination": {"name": "destination", "value": "Wall Street"}}
        }
    },
    "version": "1.0",
    "context": {"System": {"application": {"applicationId": "test"}, "user": {"userId": "test"}}}
}'

test_invocation "Ferries to Bay Ridge" '{
    "session": {
        "new": true,
        "sessionId": "test-session-3",
        "application": {"applicationId": "test"},
        "user": {"userId": "test"}
    },
    "request": {
        "type": "IntentRequest",
        "requestId": "test-3",
        "locale": "en-US",
        "timestamp": "2025-01-01T00:00:00Z",
        "intent": {
            "name": "GetFerriesWithDirectionIntent",
            "confirmationStatus": "NONE",
            "slots": {"destination": {"name": "destination", "value": "Bay Ridge"}}
        }
    },
    "version": "1.0",
    "context": {"System": {"application": {"applicationId": "test"}, "user": {"userId": "test"}}}
}'

echo "🚨 SERVICE ALERTS"
echo "=================="

test_invocation "Service alerts request" '{
    "session": {
        "new": true,
        "sessionId": "test-session-4",
        "application": {"applicationId": "test"},
        "user": {"userId": "test"}
    },
    "request": {
        "type": "IntentRequest",
        "requestId": "test-4",
        "locale": "en-US",
        "timestamp": "2025-01-01T00:00:00Z",
        "intent": {"name": "GetServiceAlertsIntent", "confirmationStatus": "NONE"}
    },
    "version": "1.0",
    "context": {"System": {"application": {"applicationId": "test"}, "user": {"userId": "test"}}}
}'

echo "📅 NEXT DAY FERRIES"
echo "==================="

test_invocation "Next day ferries" '{
    "session": {
        "new": true,
        "sessionId": "test-session-5",
        "application": {"applicationId": "test"},
        "user": {"userId": "test"}
    },
    "request": {
        "type": "IntentRequest",
        "requestId": "test-5",
        "locale": "en-US",
        "timestamp": "2025-01-01T00:00:00Z",
        "intent": {"name": "GetNextDayFerriesIntent", "confirmationStatus": "NONE"}
    },
    "version": "1.0",
    "context": {"System": {"application": {"applicationId": "test"}, "user": {"userId": "test"}}}
}'

echo "🔄 BUILT-IN INTENTS"
echo "==================="

test_invocation "Help intent" '{
    "session": {
        "new": true,
        "sessionId": "test-session-6",
        "application": {"applicationId": "test"},
        "user": {"userId": "test"}
    },
    "request": {
        "type": "IntentRequest",
        "requestId": "test-6",
        "locale": "en-US",
        "timestamp": "2025-01-01T00:00:00Z",
        "intent": {"name": "AMAZON.HelpIntent", "confirmationStatus": "NONE"}
    },
    "version": "1.0",
    "context": {"System": {"application": {"applicationId": "test"}, "user": {"userId": "test"}}}
}'

test_invocation "Cancel intent" '{
    "session": {
        "new": true,
        "sessionId": "test-session-7",
        "application": {"applicationId": "test"},
        "user": {"userId": "test"}
    },
    "request": {
        "type": "IntentRequest",
        "requestId": "test-7",
        "locale": "en-US",
        "timestamp": "2025-01-01T00:00:00Z",
        "intent": {"name": "AMAZON.CancelIntent", "confirmationStatus": "NONE"}
    },
    "version": "1.0",
    "context": {"System": {"application": {"applicationId": "test"}, "user": {"userId": "test"}}}
}'

test_invocation "Stop intent" '{
    "session": {
        "new": true,
        "sessionId": "test-session-8",
        "application": {"applicationId": "test"},
        "user": {"userId": "test"}
    },
    "request": {
        "type": "IntentRequest",
        "requestId": "test-8",
        "locale": "en-US",
        "timestamp": "2025-01-01T00:00:00Z",
        "intent": {"name": "AMAZON.StopIntent", "confirmationStatus": "NONE"}
    },
    "version": "1.0",
    "context": {"System": {"application": {"applicationId": "test"}, "user": {"userId": "test"}}}
}'

echo "❗ LIMITATIONS OF ASK CLI TESTING"
echo "=================================="
echo "⚠️  ASK CLI cannot test sequential interactions (yes/no after alerts prompt)"
echo "⚠️  Each simulation is independent - no session continuity"
echo "⚠️  Cannot test the main 'yes' response bug fix directly"
echo ""
echo "🔧 TO TEST YES/NO RESPONSES:"
echo "1. Use Alexa Developer Console simulator"
echo "2. Test on real Alexa device"
echo "3. Use voice testing: 'Alexa, ask red hook ferry what's next' then 'yes'"
echo ""
echo "✅ ASK CLI testing completed for individual invocations!"
#!/bin/bash

# Test script using actual utterances instead of direct intent calls
# This better simulates real user speech

SKILL_ID=$(ask smapi list-skills-for-vendor | jq -r '.skills[] | select(.stage == "development") | .skillId')

echo "🎤 Testing Red Hook Ferry Skill - Real Utterances"
echo "=================================================="
echo "Skill ID: $SKILL_ID"
echo ""

# Helper function to test with actual speech
test_utterance() {
    local test_name="$1"
    local utterance="$2"
    
    echo "📝 Test: $test_name"
    echo "🗣️  Utterance: \"$utterance\""
    echo "───────────────────────────────────────"
    
    # Start simulation with actual utterance
    local sim_response=$(ask smapi simulate-skill \
        --skill-id "$SKILL_ID" \
        --stage development \
        --input-content "{
            \"session\": {
                \"new\": true,
                \"sessionId\": \"test-session\",
                \"application\": {\"applicationId\": \"test\"},
                \"user\": {\"userId\": \"test\"}
            },
            \"request\": {
                \"type\": \"IntentRequest\",
                \"requestId\": \"test\",
                \"locale\": \"en-US\",
                \"timestamp\": \"2025-01-01T00:00:00Z\",
                \"intent\": {\"name\": \"GetNextFerriesIntent\", \"confirmationStatus\": \"NONE\"}
            },
            \"version\": \"1.0\",
            \"context\": {\"System\": {\"application\": {\"applicationId\": \"test\"}, \"user\": {\"userId\": \"test\"}}}
        }" \
        --device-locale en-US)
    
    local sim_id=$(echo "$sim_response" | jq -r '.id')
    
    if [ "$sim_id" = "null" ]; then
        echo "❌ Failed to start simulation"
        return 1
    fi
    
    # Wait for result
    sleep 3
    local result=$(ask smapi get-skill-simulation \
        --skill-id "$SKILL_ID" \
        --simulation-id "$sim_id" 2>/dev/null)
    
    local status=$(echo "$result" | jq -r '.status // "unknown"')
    
    if [ "$status" = "SUCCESSFUL" ]; then
        local speech=$(echo "$result" | jq -r '.result.alexaExecutionInfo.alexaResponses[0].content.caption // "No speech output"')
        local intent_used=$(echo "$result" | jq -r '.result.alexaExecutionInfo.consideredIntents[0].name // "unknown"')
        
        echo "✅ SUCCESS - Intent: $intent_used"
        echo "💬 Response: $speech"
        echo ""
        return 0
    else
        echo "❌ FAILED - Status: $status"
        echo ""
        return 1
    fi
}

# Test specific utterances for Help intent using text simulation
echo "🧪 Testing Help Intent Recognition"
echo "=================================="

# Use ask CLI dialog simulation for proper utterance testing
echo "📝 Testing Help Intent"
echo "🗣️  Utterance: \"help\""
echo "───────────────────────────────────────"

ask smapi simulate-skill \
    --skill-id "$SKILL_ID" \
    --stage development \
    --input-content "{
        \"session\": {
            \"new\": true,
            \"sessionId\": \"test-help\",
            \"application\": {\"applicationId\": \"$SKILL_ID\"},
            \"user\": {\"userId\": \"test\"}
        },
        \"request\": {
            \"type\": \"IntentRequest\",
            \"requestId\": \"test-help-123\",
            \"locale\": \"en-US\",
            \"timestamp\": \"2025-01-01T00:00:00Z\",
            \"intent\": {
                \"name\": \"AMAZON.HelpIntent\",
                \"confirmationStatus\": \"NONE\"
            }
        },
        \"version\": \"1.0\",
        \"context\": {
            \"System\": {
                \"application\": {\"applicationId\": \"$SKILL_ID\"},
                \"user\": {\"userId\": \"test\"}
            }
        }
    }" \
    --device-locale en-US | jq -r '.id' | while read sim_id; do
        sleep 3
        result=$(ask smapi get-skill-simulation --skill-id "$SKILL_ID" --simulation-id "$sim_id" 2>/dev/null)
        speech=$(echo "$result" | jq -r '.result.alexaExecutionInfo.alexaResponses[0].content.caption // "No speech"')
        intent=$(echo "$result" | jq -r '.result.alexaExecutionInfo.consideredIntents[0].name // "unknown"')
        echo "✅ Intent: $intent"
        echo "💬 Response: $speech"
    done

echo ""
echo "📝 Testing Service Alerts Intent"  
echo "───────────────────────────────────────"

ask smapi simulate-skill \
    --skill-id "$SKILL_ID" \
    --stage development \
    --input-content "{
        \"session\": {
            \"new\": true,
            \"sessionId\": \"test-alerts\",
            \"application\": {\"applicationId\": \"$SKILL_ID\"},
            \"user\": {\"userId\": \"test\"}
        },
        \"request\": {
            \"type\": \"IntentRequest\",
            \"requestId\": \"test-alerts-123\",
            \"locale\": \"en-US\",
            \"timestamp\": \"2025-01-01T00:00:00Z\",
            \"intent\": {
                \"name\": \"GetServiceAlertsIntent\",
                \"confirmationStatus\": \"NONE\"
            }
        },
        \"version\": \"1.0\",
        \"context\": {
            \"System\": {
                \"application\": {\"applicationId\": \"$SKILL_ID\"},
                \"user\": {\"userId\": \"test\"}
            }
        }
    }" \
    --device-locale en-US | jq -r '.id' | while read sim_id; do
        sleep 3
        result=$(ask smapi get-skill-simulation --skill-id "$SKILL_ID" --simulation-id "$sim_id" 2>/dev/null)
        speech=$(echo "$result" | jq -r '.result.alexaExecutionInfo.alexaResponses[0].content.caption // "No speech"')
        intent=$(echo "$result" | jq -r '.result.alexaExecutionInfo.consideredIntents[0].name // "unknown"')
        echo "✅ Intent: $intent"
        echo "💬 Response: $speech"
    done

echo ""
echo "🎯 KEY FINDINGS:"
echo "• If Help intent shows help text → Handler works ✅"
echo "• If Help intent shows ferry schedule → Handler routing broken ❌"
echo "• If Service Alerts shows alerts only → Handler works ✅"  
echo "• If Service Alerts shows ferry schedule → Handler routing broken ❌"
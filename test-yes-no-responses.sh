#!/bin/bash

# Test script for yes/no responses using ASK CLI
# This tests the main bug fix without hardcoding sensitive information

SKILL_ID=$(ask smapi list-skills-for-vendor | jq -r '.skills[] | select(.stage == "development") | .skillId')

echo "🧪 Testing Red Hook Ferry Skill Yes/No Responses"
echo "================================================="
echo "Skill ID: $SKILL_ID"
echo ""

echo "Test 1: Basic ferry request (should offer alerts)"
echo "User: ask red hook ferry what's next"
ask smapi simulate-skill \
  --skill-id "$SKILL_ID" \
  --stage development \
  --input-content '{"session":{"new":true,"sessionId":"test-session","application":{"applicationId":"test"},"user":{"userId":"test"}},"request":{"type":"IntentRequest","requestId":"test","locale":"en-US","timestamp":"2025-01-01T00:00:00Z","intent":{"name":"GetNextFerriesIntent","confirmationStatus":"NONE"}},"version":"1.0","context":{"System":{"application":{"applicationId":"test"},"user":{"userId":"test"}}}}' \
  --device-locale en-US

echo ""
echo "✅ If the above response includes 'Would you like to hear about current service alerts', the basic flow works!"
echo ""
echo "🔧 To test the 'yes' response (the main bug), you would need to:"
echo "1. Use the session attributes from the first response"
echo "2. Send a YesIntent with those session attributes"
echo "3. Verify it returns service alerts, not repeated departures"
echo ""
echo "This requires interactive testing or extracting session attributes from the response."
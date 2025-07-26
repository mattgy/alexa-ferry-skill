#!/bin/bash

# Pre-deployment script to replace account ID placeholder
# This runs before ASK CLI deployment to inject the real AWS account ID

set -e

echo "🔧 Preparing skill manifest for deployment..."

# Get AWS account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

if [ -z "$AWS_ACCOUNT_ID" ]; then
    echo "❌ Unable to get AWS account ID. Make sure AWS CLI is configured."
    exit 1
fi

echo "📝 Found AWS Account ID: $AWS_ACCOUNT_ID"

# Create a temporary skill.json with the real account ID
sed "s/ACCOUNT_ID/$AWS_ACCOUNT_ID/g" skill-package/skill.json > skill-package/skill.json.tmp
mv skill-package/skill.json.tmp skill-package/skill.json

echo "✅ Skill manifest updated with real AWS account ID"
echo "🚀 Ready for ASK CLI deployment"
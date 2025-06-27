#!/bin/bash

# Red Hook Ferry Skill Deployment Script

set -e

echo "🚢 Deploying Red Hook Ferry Skill..."

# Check if required tools are installed
command -v npm >/dev/null 2>&1 || { echo "❌ npm is required but not installed. Aborting." >&2; exit 1; }

# Load environment variables if .env exists
if [ -f .env ]; then
    echo "📋 Loading environment variables from .env"
    export $(cat .env | grep -v '^#' | xargs)
fi

# Install all dependencies (including dev dependencies for testing)
echo "📦 Installing dependencies..."
npm install

# Run tests
echo "🧪 Running tests..."
npm test

# Install production dependencies only for deployment
echo "📦 Installing production dependencies..."
rm -rf node_modules
npm install --omit=dev

# Create deployment package
echo "📦 Creating deployment package..."
rm -f skill.zip
zip -r skill.zip . -x \
    "tests/*" \
    "coverage/*" \
    "node_modules/.cache/*" \
    "*.git*" \
    "*.env*" \
    "deploy.sh" \
    "README.md" \
    "test-integration.js"

# Check if AWS CLI is available and configured
if command -v aws >/dev/null 2>&1; then
    # Deploy to AWS Lambda (if function name is provided)
    if [ ! -z "$LAMBDA_FUNCTION_NAME" ]; then
        echo "🚀 Deploying to AWS Lambda: $LAMBDA_FUNCTION_NAME"
        aws lambda update-function-code \
            --function-name "$LAMBDA_FUNCTION_NAME" \
            --zip-file fileb://skill.zip \
            --region "${AWS_REGION:-us-east-1}"
        
        echo "✅ Deployment complete!"
        echo "📝 Don't forget to:"
        echo "   1. Update the Lambda ARN in skill.json"
        echo "   2. Deploy the interaction model in Alexa Developer Console"
        echo "   3. Test the skill in the Alexa Simulator"
    else
        echo "⚠️  LAMBDA_FUNCTION_NAME not set. Skipping AWS deployment."
        echo "📦 Deployment package created: skill.zip"
    fi
else
    echo "⚠️  AWS CLI not found. Skipping AWS deployment."
    echo "📦 Deployment package created: skill.zip"
fi

echo "📝 Manual deployment steps:"
echo "   1. Upload skill.zip to your Lambda function"
echo "   2. Update the Lambda ARN in skill.json"
echo "   3. Deploy the interaction model in Alexa Developer Console"
echo "   4. Test the skill in the Alexa Simulator"

echo "🎉 Done!"

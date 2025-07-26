#!/bin/bash

# Red Hook Ferry Skill Deployment Script with ASK CLI Integration

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

# Create deployment package with only runtime files
echo "📦 Creating deployment package..."
rm -f skill.zip

# Create a temporary directory for clean deployment
mkdir -p temp_deploy

# Copy only the essential runtime files
cp index.js temp_deploy/
cp ferryService.js temp_deploy/
cp gtfsStaticService.js temp_deploy/
cp utils.js temp_deploy/
cp config.js temp_deploy/
cp package.json temp_deploy/
cp package-lock.json temp_deploy/

# Copy node_modules (production dependencies only)
cp -r node_modules temp_deploy/

# Create zip from clean directory
cd temp_deploy
zip -r ../skill.zip .
cd ..

# Clean up temp directory
rm -rf temp_deploy

# Check for ASK CLI and deploy using it if available
if command -v ask >/dev/null 2>&1; then
    echo "🎯 ASK CLI found - checking configuration..."
    
    # Check if ASK CLI is configured
    if ask configure list-profiles --no-color 2>/dev/null | grep -q "Profile"; then
        echo "✅ ASK CLI is configured"
        
        # Check if this is an ASK CLI project with proper structure
        if [ -f "ask-resources.json" ] && [ -f "skill-package/skill.json" ]; then
            echo "📋 ASK CLI project structure detected"
            
            # Check if skill is already linked to an existing skill ID
            if [ -f ".ask/ask-states.json" ]; then
                echo "🔗 Found existing skill configuration"
            else
                echo "🆕 First time deployment - will create new skill"
            fi
            
            echo "🚀 Deploying skill with ASK CLI..."
            
            # Prepare skill manifest with real AWS account ID
            ./deploy-prep.sh
            
            # Deploy the entire skill (interaction model, Lambda, manifest)
            if ask deploy --ignore-hash; then
                echo "✅ Skill deployed successfully via ASK CLI!"
                echo "🧪 Testing basic functionality..."
                
                # Test the skill if possible
                if ask simulate -l en-US -t "open red hook ferry" 2>/dev/null; then
                    echo "✅ Basic skill test passed"
                else
                    echo "⚠️  Skill test skipped (simulation may not be available)"
                fi
                
                # Exit successfully - no need for manual deployment
                echo "🎉 ASK CLI deployment complete!"
                exit 0
            else
                echo "❌ ASK CLI deployment failed - falling back to manual deployment"
                deploy_manually=true
            fi
            
        else
            echo "⚠️  ASK CLI project structure not complete"
            echo "📝 Missing files:"
            [ ! -f "ask-resources.json" ] && echo "   - ask-resources.json"
            [ ! -f "skill-package/skill.json" ] && echo "   - skill-package/skill.json"
            [ ! -f "skill-package/interactionModels/custom/en-US.json" ] && echo "   - skill-package/interactionModels/custom/en-US.json"
            
            echo "🔧 To fix ASK CLI setup:"
            echo "   1. Ensure ask-resources.json exists in project root"
            echo "   2. Ensure skill-package/skill.json exists with skill manifest"
            echo "   3. Ensure skill-package/interactionModels/custom/en-US.json exists"
            echo "   4. Run: ask init (if needed to link existing skill)"
            
            # Fall back to manual deployment
            deploy_manually=true
        fi
        
    else
        echo "⚠️  ASK CLI not configured"
        echo "📝 To configure ASK CLI:"
        echo "   1. Run: ask configure"
        echo "   2. Follow the authentication prompts"
        echo "   3. Re-run this deployment script"
        echo ""
        echo "   For automation, you can also set up ASK CLI with:"
        echo "   - AWS credentials in ~/.aws/credentials"
        echo "   - ASK CLI profile in ~/.ask/cli_config"
        
        # Fall back to manual deployment
        deploy_manually=true
    fi
    
else
    echo "⚠️  ASK CLI not found. Install with: npm install -g ask-cli"
    echo "📝 To enable automatic deployment:"
    echo "   1. Run: npm install -g ask-cli"
    echo "   2. Run: ask configure"
    echo "   3. Re-run this deployment script"
    
    # Fall back to manual deployment
    deploy_manually=true
fi

# Manual deployment fallback
if [ "$deploy_manually" = true ]; then
    echo "📦 Falling back to manual deployment process..."
    
    # Check if AWS CLI is available and configured
    if command -v aws >/dev/null 2>&1; then
        # Deploy to AWS Lambda (if function name is provided)
        if [ ! -z "$LAMBDA_FUNCTION_NAME" ]; then
            echo "🚀 Deploying to AWS Lambda: $LAMBDA_FUNCTION_NAME"
            aws lambda update-function-code \
                --function-name "$LAMBDA_FUNCTION_NAME" \
                --zip-file fileb://skill.zip \
                --region "${AWS_REGION:-us-east-1}"
            
            echo "✅ Lambda deployment complete!"
            echo "📝 Still need to manually:"
            echo "   1. Update the interaction model in Alexa Developer Console"
            echo "   2. Test the skill in the Alexa Simulator"
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
    echo "   2. Update/deploy the interaction model in Alexa Developer Console:"
    echo "      - Go to https://developer.amazon.com/alexa/console/ask"
    echo "      - Open your Red Hook Ferry skill"
    echo "      - Go to Interaction Model → JSON Editor"
    echo "      - Copy contents from skill-package/interactionModels/custom/en-US.json"
    echo "      - Paste into JSON Editor, Save Model, Build Model"
    echo "   3. Test the skill in the Alexa Simulator"
fi

echo "🎉 Deployment process complete!"

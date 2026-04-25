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
    if [ -f "$HOME/.ask/cli_config" ] || ask configure list-profiles 2>/dev/null | grep -qi "default"; then
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
                if ask dialog --locale en-US --replay open\ red\ hook\ ferry 2>/dev/null | grep -q "Welcome"; then
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

    if [ ! -z "$LAMBDA_FUNCTION_NAME" ]; then
        echo "🚀 Deploying to AWS Lambda: $LAMBDA_FUNCTION_NAME"

        # Prefer boto3 via system Python (avoids broken Homebrew aws CLI / pyexpat issue)
        PYTHON_BIN=""
        for py in /usr/bin/python3.10 /usr/bin/python3 python3; do
            if $py -c "import boto3" 2>/dev/null; then
                PYTHON_BIN="$py"
                break
            fi
        done

        if [ ! -z "$PYTHON_BIN" ]; then
            echo "📦 Using $PYTHON_BIN + boto3 to upload..."
            $PYTHON_BIN - <<PYEOF
import boto3, sys, os

region   = os.environ.get("AWS_REGION", "us-east-1")
fn_name  = os.environ.get("LAMBDA_FUNCTION_NAME")
zip_path = os.path.join(os.path.dirname(os.path.abspath("$0")), "skill.zip")

with open(zip_path, "rb") as f:
    zip_bytes = f.read()

client = boto3.client("lambda", region_name=region)
try:
    resp = client.update_function_code(
        FunctionName=fn_name,
        ZipFile=zip_bytes,
        Publish=True
    )
    print(f"✅ Lambda updated: {resp['FunctionName']} v{resp['Version']}")
except Exception as e:
    print(f"❌ boto3 deploy failed: {e}", file=sys.stderr)
    sys.exit(1)
PYEOF
            if [ $? -eq 0 ]; then
                echo "✅ Lambda deployment complete!"
            else
                echo "❌ Deployment failed. Check AWS credentials (~/.aws/credentials or AWS_ACCESS_KEY_ID env var)."
                echo "📦 skill.zip is ready — you can upload it manually in the AWS Console."
            fi

        # Fall back to aws CLI if boto3 unavailable
        elif command -v aws >/dev/null 2>&1; then
            aws lambda update-function-code \
                --function-name "$LAMBDA_FUNCTION_NAME" \
                --zip-file fileb://skill.zip \
                --region "${AWS_REGION:-us-east-1}"
            echo "✅ Lambda deployment complete!"
        else
            echo "⚠️  Neither boto3 nor aws CLI available."
            echo "📦 Deployment package created: skill.zip — upload it manually."
        fi
    else
        echo "⚠️  LAMBDA_FUNCTION_NAME not set in .env. Skipping AWS deployment."
        echo "📦 Deployment package created: skill.zip"
    fi

    echo ""
    echo "📝 Manual upload alternative:"
    echo "   1. Go to https://console.aws.amazon.com/lambda"
    echo "   2. Open the '$LAMBDA_FUNCTION_NAME' function"
    echo "   3. Upload skill.zip via Code → Upload from → .zip file"
fi

echo "🎉 Deployment process complete!"

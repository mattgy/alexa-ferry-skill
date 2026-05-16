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

# Set NODE_PATH to include global modules so jest can find cheerio
GLOBAL_NPM_ROOT=$(npm root -g)
export NODE_PATH=".:./node_modules:$GLOBAL_NPM_ROOT"

# Ensure development environment has local dependencies for runtime
echo "📦 Ensuring production dependencies are present..."
npm install --omit=dev

# Run tests using global jest
echo "🧪 Running tests..."
if ! jest --env=node; then
    echo "❌ Tests failed. Aborting deployment."
    exit 1
fi

# Run linting using global eslint
echo "🧹 Running linting..."
if ! eslint *.js; then
    echo "⚠️ Linting warnings/errors found. Continuing deployment..."
fi

# Create a temporary directory for clean deployment
echo "📦 Creating clean deployment package..."
rm -rf temp_deploy
mkdir -p temp_deploy

# Copy runtime files to temp directory
cp index.js temp_deploy/
cp ferryService.js temp_deploy/
cp gtfsStaticService.js temp_deploy/
cp utils.js temp_deploy/
cp config.js temp_deploy/
cp package.json temp_deploy/
cp package-lock.json temp_deploy/
cp -r node_modules temp_deploy/

# Create zip from clean directory
cd temp_deploy
rm -f ../skill.zip
zip -r ../skill.zip .
cd ..

# Clean up temp directory
rm -rf temp_deploy

echo "✅ Deployment package skill.zip created successfully."

# Check for ASK CLI and deploy using it if available
ASK_BIN=""
if command -v ask >/dev/null 2>&1; then
    ASK_BIN="ask"
elif [ -f "./node_modules/.bin/ask" ]; then
    ASK_BIN="./node_modules/.bin/ask"
elif npx --yes ask --version >/dev/null 2>&1; then
    ASK_BIN="npx --yes ask"
fi

if [ ! -z "$ASK_BIN" ]; then
    echo "🎯 ASK CLI found ($ASK_BIN) - checking configuration..."
    
    # Check if ASK CLI is configured
    if [ -f "$HOME/.ask/cli_config" ] || $ASK_BIN configure list-profiles 2>/dev/null | grep -qi "default"; then
        echo "✅ ASK CLI is configured"
        
        # Check if this is an ASK CLI project with proper structure
        if [ -f "ask-resources.json" ] && [ -f "skill-package/skill.json" ]; then
            echo "📋 ASK CLI project structure detected"
            
            # Prepare skill manifest with real AWS account ID
            echo "🔧 Preparing manifest with real AWS Account ID..."
            AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
            
            # Use a more portable sed command
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' "s/ACCOUNT_ID/$AWS_ACCOUNT_ID/g" skill-package/skill.json
            else
                sed -i "s/ACCOUNT_ID/$AWS_ACCOUNT_ID/g" skill-package/skill.json
            fi
            
            echo "🚀 Deploying skill metadata with ASK CLI..."
            # Deploy only the skill metadata (interaction model, manifest)
            if $ASK_BIN deploy --target skill-metadata --ignore-hash; then
                echo "✅ Skill metadata deployed successfully via ASK CLI!"
                # Now proceed to manual Lambda deployment for the code
                deploy_manually=true
            else
                echo "❌ ASK CLI deployment failed - trying fallback"
                deploy_manually=true
            fi
        else
            echo "⚠️  ASK CLI project structure not complete"
            deploy_manually=true
        fi
    else
        echo "⚠️  ASK CLI not configured. Run 'ask configure' or 'npx ask configure'."
        deploy_manually=true
    fi
else
    echo "⚠️  ASK CLI not found. Install with: npm install -g ask-cli"
    deploy_manually=true
fi

# Manual or Code-only deployment
if [ "$deploy_manually" = true ]; then
    echo "📦 Proceeding with code deployment..."

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

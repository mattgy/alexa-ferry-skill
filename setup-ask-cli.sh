#!/bin/bash

# ASK CLI Setup Script for Red Hook Ferry Skill

echo "🚀 Setting up ASK CLI for Red Hook Ferry Skill"

# Check if ASK CLI is installed
if ! command -v ask >/dev/null 2>&1; then
    echo "📦 Installing ASK CLI..."
    npm install -g ask-cli
fi

echo "🔧 ASK CLI version: $(ask --version)"

# Check if configured
if ! { [ -f "$HOME/.ask/cli_config" ] || ask configure list-profiles 2>/dev/null | grep -qi "default"; }; then
    echo "⚙️  Configuring ASK CLI..."
    echo "📝 Please complete the browser authentication when prompted..."
    ask configure
else
    echo "✅ ASK CLI already configured"
fi

# Verify project structure
echo "🔍 Checking project structure..."

if [ ! -f "ask-resources.json" ]; then
    echo "❌ Missing ask-resources.json"
else
    echo "✅ ask-resources.json found"
fi

if [ ! -f "skill-package/skill.json" ]; then
    echo "❌ Missing skill-package/skill.json"
else
    echo "✅ skill-package/skill.json found"
fi

if [ ! -f "skill-package/interactionModels/custom/en-US.json" ]; then
    echo "❌ Missing skill-package/interactionModels/custom/en-US.json"
else
    echo "✅ skill-package/interactionModels/custom/en-US.json found"
fi

# Check if skill needs to be linked
if [ ! -f ".ask/ask-states.json" ]; then
    echo "🆕 No existing skill linked. You have two options:"
    echo ""
    echo "Option 1 - Link to existing skill (recommended):"
    echo "   ask init"
    echo "   (Follow prompts to link your existing Red Hook Ferry skill)"
    echo ""
    echo "Option 2 - Create new skill:"
    echo "   ask deploy"
    echo "   (This will create a brand new skill)"
    echo ""
    echo "💡 If you have an existing skill in the Alexa Developer Console,"
    echo "   use Option 1 to avoid creating duplicates."
else
    echo "🔗 Skill already linked to existing skill"
    echo "✅ Ready for deployment with: ./deploy.sh"
fi

echo ""
echo "🎯 Next steps:"
echo "1. If not done already, run: ask init (to link existing skill)"
echo "2. Run: ./deploy.sh (for full deployment)"
echo "3. Test your skill in the Alexa Developer Console"

echo "🎉 ASK CLI setup complete!"
#!/bin/bash

# Test OpenAI provider with tool calls

echo "Testing OpenAI provider tool calls..."
echo ""

# Set up test environment
export OPENAI_API_KEY="${OPENAI_API_KEY:-your-key-here}"

# Create a test script that sends commands
cat << 'EOF' | gemini --debug 2>&1 | grep -E "(provider|Model:|Tools provided:|tool call|ls|ERROR)"
/provider openai
list the current directory
EOF

echo ""
echo "Test complete."
#!/bin/bash

# Test OpenAI provider with tool calls

echo "Testing OpenAI provider..."
echo "========================="
echo ""

# Export API key if not already set
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-test}"

# Run gemini with test commands
cat << 'EOF' | gemini 2>&1 | grep -v "DEBUG\|BfsFileSearch" | head -100
/provider openai
/model gpt-4o
which model are you?
list the current directory
/exit
EOF

echo ""
echo "Test complete."
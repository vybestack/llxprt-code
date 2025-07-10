#!/bin/bash

# Test OpenAI provider functionality

echo "Testing OpenAI provider..."
echo ""

# Test commands
cat << 'EOF' | gemini 2>&1 | grep -v DEBUG | head -50
/provider openai
/model gpt-4o
which model are you using?
list the files in the current directory
/exit
EOF
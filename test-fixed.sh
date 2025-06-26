#!/bin/bash

echo "Testing fixed provider integration..."
echo ""

# Test with Gemini first
echo "=== Testing with Gemini ==="
echo -e "list the current directory\n/exit" | gemini 2>&1 | grep -E "(list_directory|Missing required|ERROR)" | head -5

echo ""
echo "=== Testing with OpenAI provider ==="
echo -e "/provider openai\nlist the current directory\n/exit" | gemini 2>&1 | grep -E "(Switched|list_directory|Missing required|ERROR)" | head -5
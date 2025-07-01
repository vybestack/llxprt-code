#!/bin/bash

# Test script for OpenAI provider with multiple tool calls

echo "Testing OpenAI provider with multiple tool calls..."
echo "================================================"

# Set up environment
export OPENAI_API_KEY=$(cat ~/.openai_key)
export DEBUG="*openai*,*gemini*"

# Test command that triggers multiple tool calls
echo -e "\n1. Testing search and read operations (multiple tools):"
echo -e '/provider openai\n/model gpt-4o\nai responses aren'\''t being themed correctly. If they were being applied the AI response would be green. presently it is a white color.' | npm run start

echo -e "\n\nTest completed. Check the output for any tool_call_id errors."
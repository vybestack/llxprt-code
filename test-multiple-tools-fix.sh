#!/bin/bash

# Test script to verify multiple tool calls work with OpenAI

echo "=== Testing Multiple Tool Calls Fix ==="
echo ""
echo "This test will:"
echo "1. Start the CLI with OpenAI provider"
echo "2. Send a query that triggers multiple tool calls"
echo "3. Check if the tool_call_id error occurs"
echo ""

# Set up environment
export OPENAI_API_KEY=$(cat ~/.openai_key 2>/dev/null || echo "")

if [ -z "$OPENAI_API_KEY" ]; then
    echo "Error: OpenAI API key not found in ~/.openai_key"
    exit 1
fi

# Create a test prompt that triggers multiple tools
TEST_PROMPT="Search for 'TODO' comments in the codebase and list all TypeScript files"

echo "Starting test..."
echo "Prompt: $TEST_PROMPT"
echo ""

# Run the command and capture output
OUTPUT=$(echo -e "/provider openai\n$TEST_PROMPT\n/exit" | npm start -- --model gpt-4o-mini --debug 2>&1)

# Check for the error
if echo "$OUTPUT" | grep -q "tool_call_id"; then
    echo "❌ FAILED: tool_call_id error still occurs!"
    echo ""
    echo "Error details:"
    echo "$OUTPUT" | grep -A5 -B5 "tool_call_id"
    
    # Also check for our debug messages
    echo ""
    echo "Debug messages:"
    echo "$OUTPUT" | grep -E "\[RESPONSE_DEBUG\]|\[TOOL_ID_DEBUG\]|\[CRITICAL\]|\[EMERGENCY\]"
else
    echo "✅ SUCCESS: No tool_call_id error found!"
    
    # Check if tools were actually called
    if echo "$OUTPUT" | grep -q "Processing tool response"; then
        echo "✓ Multiple tools were processed"
    fi
fi

echo ""
echo "Test complete."
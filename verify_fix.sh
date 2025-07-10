#!/bin/bash

# Test script for OpenAI provider with multiple tool calls

echo "Testing OpenAI provider with multiple tool calls..."
echo "================================================="

# Set up environment
export OPENAI_API_KEY=$(cat ~/.openai_key)
export DEBUG="*"

# Test command that triggers multiple tool calls
echo -e "/provider openai\n/model gpt-4o-mini\nList the files in the current directory and also search for the term 'OpenAIProvider' in the codebase" > test_prompt.txt

# Run the test
./node_modules/.bin/ts-node packages/cli/src/gemini.ts < test_prompt.txt > test_output.log 2>&1

echo "Test finished. Checking output..."

if grep -q "Missing parameter 'tool_call_id'" test_output.log; then
  echo "❌ FAIL: Found 'Missing parameter 'tool_call_id'' error in the output."
  grep -C 5 "Missing parameter 'tool_call_id'" test_output.log
else
  echo "✅ PASS: No 'Missing parameter 'tool_call_id'' error found."
fi

if grep -q "GaxiosError" test_output.log; then
    echo "⚠️ WARNING: Found 'GaxiosError' in the output. The test might be hitting the wrong provider."
fi

if grep -q "[OpenAIProvider]" test_output.log; then
    echo "✅ INFO: OpenAIProvider logs found."
else
    echo "❌ INFO: No OpenAIProvider logs found."
fi

echo "Full output log is in test_output.log"

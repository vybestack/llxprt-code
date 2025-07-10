#!/bin/bash

# Final test for OpenAI provider tool_call_id issue
echo "=== FINAL TEST: OpenAI Provider Multiple Tool Calls ==="
echo ""

# Set up environment
export OPENAI_API_KEY=$(cat ~/.openai_key)

# Create a simple test that pipes commands
(
  echo "/provider openai"
  sleep 2
  echo "ai responses aren't being themed correctly. If they were being applied the AI response would be green. presently it is a white color."
  sleep 30
) | npm run start 2>&1 | tee final-test-output.log &

TEST_PID=$!

# Monitor for errors
echo "Monitoring for tool_call_id errors..."
for i in {1..35}; do
  if grep -q "Missing parameter 'tool_call_id'" final-test-output.log 2>/dev/null; then
    echo -e "\n❌ FAIL: tool_call_id error detected!"
    kill $TEST_PID 2>/dev/null
    exit 1
  fi
  
  if grep -q "OpenAI API requires tool_call_id" final-test-output.log 2>/dev/null; then
    echo -e "\n❌ FAIL: Our error handler triggered!"
    kill $TEST_PID 2>/dev/null
    exit 1
  fi
  
  sleep 1
done

kill $TEST_PID 2>/dev/null

echo -e "\n✅ PASS: No tool_call_id error detected in 35 seconds!"
echo ""
echo "Checking debug output for tool IDs..."
grep -E "TOOL_ID_DEBUG|CRITICAL" final-test-output.log || echo "No debug output found"

rm -f final-test-output.log
exit 0
#!/bin/bash

# Integration test for OpenAI provider tool_call_id issue
# This reproduces the exact scenario where multiple tool calls fail

echo "=== OpenAI Provider Integration Test ==="
echo "Testing for tool_call_id error with multiple tool calls"
echo ""

# Set up environment
export OPENAI_API_KEY=$(cat ~/.openai_key)

# Create a test script that sends the commands and captures output
cat > test-openai-commands.txt << 'EOF'
/provider openai
ai responses aren't being themed correctly. If they were being applied the AI response would be green. presently it is a white color.
EOF

# Run the CLI with a timeout and capture output
echo "Starting test..."
timeout 30s npm run start < test-openai-commands.txt 2>&1 | tee test-openai-output.log &
TEST_PID=$!

# Monitor the output for the error
echo "Monitoring for tool_call_id error..."
START_TIME=$(date +%s)
ERROR_FOUND=false

while true; do
    if grep -q "Missing parameter 'tool_call_id'" test-openai-output.log 2>/dev/null; then
        ERROR_FOUND=true
        break
    fi
    
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    
    if [ $ELAPSED -gt 30 ]; then
        break
    fi
    
    # Check if process is still running
    if ! kill -0 $TEST_PID 2>/dev/null; then
        break
    fi
    
    sleep 0.5
done

# Kill the test process if still running
kill $TEST_PID 2>/dev/null

echo ""
echo "=== TEST RESULTS ==="
if [ "$ERROR_FOUND" = true ]; then
    echo "❌ FAIL: tool_call_id error detected!"
    echo ""
    echo "Error details:"
    grep -A2 -B2 "Missing parameter 'tool_call_id'" test-openai-output.log
    echo ""
    echo "This confirms the issue is NOT fixed."
    exit 1
else
    echo "✅ PASS: No tool_call_id error detected within 30 seconds"
    echo ""
    echo "The fix appears to be working correctly."
    exit 0
fi
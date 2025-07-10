#!/bin/bash

# Exact test matching the user's scenario
echo "=== Testing OpenAI Provider - Exact Reproduction ==="
echo "This test reproduces the exact command sequence that causes the error"
echo ""

# Set up environment
export OPENAI_API_KEY=$(cat ~/.openai_key)

# Create expect script to interact with CLI
cat > test-openai-expect.exp << 'EOF'
#!/usr/bin/expect -f

set timeout 30
spawn npm run start

# Wait for prompt
expect "> "

# Switch to OpenAI provider
send "/provider openai\r"
expect "Switched from gemini to openai"
expect "> "

# Send the exact test query
send "ai responses aren't being themed correctly. If they were being applied the AI response would be green. presently it is a white color.\r"

# Watch for the error
expect {
    "Missing parameter 'tool_call_id'" {
        puts "\n\n❌ ERROR DETECTED: tool_call_id missing!"
        exit 1
    }
    "OpenAI API requires tool_call_id" {
        puts "\n\n❌ ERROR DETECTED: Our error handler triggered!"
        exit 1
    }
    timeout {
        puts "\n\n✅ No tool_call_id error detected within 30 seconds"
        exit 0
    }
}
EOF

chmod +x test-openai-expect.exp

# Run the test
if command -v expect >/dev/null 2>&1; then
    ./test-openai-expect.exp
    RESULT=$?
else
    echo "expect not found, using alternative method..."
    
    # Alternative: Use a simple timeout approach
    (
        echo "/provider openai"
        sleep 2
        echo "ai responses aren't being themed correctly. If they were being applied the AI response would be green. presently it is a white color."
    ) | timeout 30s npm run start 2>&1 | tee test-output.log
    
    if grep -q "Missing parameter 'tool_call_id'" test-output.log; then
        echo -e "\n❌ ERROR DETECTED: tool_call_id missing!"
        RESULT=1
    elif grep -q "OpenAI API requires tool_call_id" test-output.log; then
        echo -e "\n❌ ERROR DETECTED: Our error handler triggered!"
        RESULT=1
    else
        echo -e "\n✅ No tool_call_id error detected"
        RESULT=0
    fi
fi

# Clean up
rm -f test-openai-expect.exp test-output.log

exit $RESULT
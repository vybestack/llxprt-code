#!/bin/bash

# Test tool calling functionality with different providers

echo "Testing tool calling with Gemini CLI..."
echo

# Test 1: Simple file listing
echo "Test 1: Listing files in current directory"
echo "list all files in the current directory" | npm run cli 2>&1 | tee test-tool-calling-output.log

# Check if ls tool was called
if grep -q "ls" test-tool-calling-output.log || grep -q "List" test-tool-calling-output.log; then
    echo "✓ Tool calling appears to be working"
else
    echo "✗ Tool calling might not be working - no ls tool detected"
fi

# Test 2: Try with a specific tool request
echo
echo "Test 2: Testing with explicit tool request"
echo "use the grep tool to search for 'function' in this directory" | npm run cli 2>&1 | tee -a test-tool-calling-output.log

# Check if grep tool was called
if grep -q "grep" test-tool-calling-output.log || grep -q "Grep" test-tool-calling-output.log; then
    echo "✓ Grep tool was called"
else
    echo "✗ Grep tool was not called"
fi

echo
echo "Test results saved to test-tool-calling-output.log"
echo "Please check the log file for detailed output"
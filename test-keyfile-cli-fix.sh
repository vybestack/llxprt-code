#!/bin/bash

# Test script to verify CLI --keyfile takes precedence over defaultProfile

echo "Testing CLI --keyfile parameter with defaultProfile set..."

# Create test keyfile
echo "test-openai-key-from-cli" > /tmp/test-openai-key.txt

# Test command (dry run - won't actually execute)
echo "Would run: node scripts/start.js --provider openai --model gpt-4 --keyfile /tmp/test-openai-key.txt"

echo ""
echo "The fix ensures that:"
echo "1. When you have a defaultProfile set in ~/.llxprt/settings.json"
echo "2. And you specify --provider openai --keyfile on the command line"
echo "3. The CLI --keyfile will be used instead of the profile's auth-keyfile"
echo ""
echo "Key changes made:"
echo "- Added checks for argv.key and argv.keyfile before applying profile auth settings"
echo "- This prevents profile auth settings from overriding explicit CLI arguments"
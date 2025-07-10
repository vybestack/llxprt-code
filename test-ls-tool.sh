#!/bin/bash

echo "Testing ls tool..."

# Test with gemini first
echo -e "list the current directory\n/exit" | gemini 2>&1 | grep -E "(Missing required|path|ERROR|✖)" | head -10
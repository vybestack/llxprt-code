#!/bin/bash

echo "Testing with more output..."

# Run with timeout and capture more output
(
  echo "list files in the current directory"
  sleep 3
  echo "/exit"
) | timeout 10 gemini 2>&1 | tail -50
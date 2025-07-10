#!/bin/bash

echo "Testing provider switch..."

# Run gemini and send commands
(
  echo "/provider openai"
  sleep 1
  echo "which model are you?"
  sleep 1
  echo "/exit"
) | gemini 2>&1 | grep -E "(Switched|model|ERROR|openai)" | head -20
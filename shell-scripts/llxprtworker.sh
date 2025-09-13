#!/bin/bash

# LLxprt worker launcher script
# Usage: ./llxprtworker.sh <reportname> <prompt>

REPORT_NAME="$1"
PROMPT="$2"

if [ -z "$REPORT_NAME" ] || [ -z "$PROMPT" ]; then
    echo "Usage: $0 <reportname> <prompt>"
    echo "Example: $0 toktrack-report 'Write a report about token tracking'"
    exit 1
fi

# Add instructions to the prompt
FULL_PROMPT="YOU MUST WRITE ./tmp/${REPORT_NAME}.md IMMEDIATELY on launch. WHEN FINISHED you must add FINISHED to the report. ${PROMPT}"

# Create tmp directory if it doesn't exist
mkdir -p ./tmp

# Capture start time
START_TIME=$(date +%s)
echo "Start time: $(date)" > ./tmp/worker-${REPORT_NAME}-start.txt

# Launch worker in background and redirect output
llxprt --yolo --profile-load cerebrasqwen3 --prompt "$FULL_PROMPT" > "./tmp/worker-${REPORT_NAME}.log" 2>&1 &
PID=$!

echo "Worker PID: $PID"

# Wait for completion with 30s check intervals, up to 15 minutes
MAX_WAIT=900  # 15 minutes in seconds
ELAPSED=0
CHECK_INTERVAL=30

while kill -0 $PID 2>/dev/null && [ $ELAPSED -lt $MAX_WAIT ]; do
    echo "Process $PID is still running. Waiting..."
    sleep $CHECK_INTERVAL
    ELAPSED=$((ELAPSED + CHECK_INTERVAL))
done

if kill -0 $PID 2>/dev/null; then
    echo "Maximum wait time reached. Killing process."
    kill $PID 2>/dev/null
    wait $PID 2>/dev/null
    echo "worker was terminated"
else
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    MINUTES=$((DURATION / 60))
    echo "worker finished in $MINUTES minutes"
fi
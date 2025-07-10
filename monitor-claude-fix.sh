#!/bin/bash

# Monitor script for Claude fixing tool schema issues
STATUS_FILE="/tmp/claude-fix-status.txt"
LOG_FILE="/tmp/claude-fix-log.txt"

echo "Starting Claude fix monitor at $(date)" > "$STATUS_FILE"
echo "STATUS: STARTED" >> "$STATUS_FILE"

# Check every 30 seconds for up to 10 minutes
for i in {1..20}; do
    if [ -f "$LOG_FILE" ]; then
        echo "Iteration $i: Claude log exists" >> "$STATUS_FILE"
        tail -n 20 "$LOG_FILE" >> "$STATUS_FILE"
    fi
    
    # Check if Claude process is still running
    if pgrep -f "claude.*fix.*schema" > /dev/null; then
        echo "$(date): Claude process still running" >> "$STATUS_FILE"
    else
        echo "$(date): Claude process not found" >> "$STATUS_FILE"
        if [ -f "$LOG_FILE" ] && grep -q "COMPLETED" "$LOG_FILE"; then
            echo "STATUS: COMPLETED" >> "$STATUS_FILE"
            break
        fi
    fi
    
    sleep 30
done

echo "Monitor finished at $(date)" >> "$STATUS_FILE"
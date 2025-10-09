#!/bin/bash
# Script to connect to the Oracle instance and automatically start or attach to a tmux session named 'remote_work'

echo "Connecting to Oracle Instance and managing tmux session 'remote_work'..."
# Use the -CC flag for iTerm2 integration with terminal reset
ssh ubuntu@170.9.234.179 -t 'stty sane; tmux -CC attach -t remote_work || tmux -CC new -s remote_work'
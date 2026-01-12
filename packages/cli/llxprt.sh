#!/usr/bin/env bash
# Shell wrapper for llxprt CLI that sanitizes NODE_OPTIONS before invoking node.
# This prevents warnings from --localstorage-file flags that may be set by IDEs.

if [ -n "$NODE_OPTIONS" ]; then
  # Remove --localstorage-file with optional value (but don't consume following flags starting with -)
  # Handles: --localstorage-file, --localstorage-file=value, --localstorage-file value
  NODE_OPTIONS=$(echo "$NODE_OPTIONS" | sed -E 's/(^|[[:space:]])--localstorage-file(=[^[:space:]]*|[[:space:]]+[^-][^[:space:]]*)?//g' | sed -E 's/[[:space:]]+/ /g' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
  export NODE_OPTIONS
fi

# Get the directory where this script is located
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

# Execute the main CLI entry point
exec node --no-deprecation "$SCRIPT_DIR/dist/index.js" "$@"

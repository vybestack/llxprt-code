#!/usr/bin/env bash
# Sanitize NODE_OPTIONS to remove --localstorage-file flags that may cause warnings.
# This must happen BEFORE node is invoked, since Node parses NODE_OPTIONS at startup.

if [ -n "$NODE_OPTIONS" ]; then
  # Remove --localstorage-file with optional value (but don't consume following flags starting with -)
  # Handles: --localstorage-file, --localstorage-file=value, --localstorage-file value
  SANITIZED=$(echo "$NODE_OPTIONS" | sed -E 's/(^|[[:space:]])--localstorage-file(=[^[:space:]]*|[[:space:]]+[^-][^[:space:]]*)?//g' | sed -E 's/[[:space:]]+/ /g' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
  export NODE_OPTIONS="$SANITIZED"
fi

# Execute the remaining arguments
exec "$@"

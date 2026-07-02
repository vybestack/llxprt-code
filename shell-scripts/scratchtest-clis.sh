#!/bin/bash

if ! command -v bun >/dev/null 2>&1; then
    echo "Error: bun is required but not installed." >&2
    exit 1
fi

bun scripts/start.ts --provider openai --baseurl "https://openrouter.ai/api/v1/" --model "qwen/qwen3-coder" --keyfile ~/.openrouter_key --prompt "scan the codebase and tell me how multi-provider communications are provided"

#!/bin/bash

node scripts/start.js --provider openai --baseurl "https://openrouter.ai/api/v1/" --model "qwen/qwen3-coder" --keyfile ~/.openrouter_key --prompt "scan the codebase and tell me how multi-provider communications are provided" 

#!/bin/bash
echo "Testing provider with debug output..."
echo -e "/provider openai\nwhich model are you?\n/exit" | gemini --debug 2>&1 | grep -E "(refreshAuth|USE_PROVIDER|ProviderContent|Switched|model)" | head -20
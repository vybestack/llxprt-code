#!/bin/bash
# Test provider commands automatically

echo "Testing multi-provider commands..."

# Create command file
cat > test-commands.txt << 'EOF'
/provider
/provider openai
/provider
/model
/models
/chat Hello, please respond with "Test successful" and nothing else
/provider gemini
/provider
/exit
EOF

# Run the test
node test-multi-provider.js < test-commands.txt | tee test-output.log

# Check results
echo ""
echo "=== Test Results ==="

# Check if provider listing works
if grep -q "Available providers:" test-output.log && grep -q "openai" test-output.log; then
  echo "✓ /provider lists available providers"
else
  echo "✗ /provider failed to list providers"
fi

# Check if provider switching works
if grep -q "Switched to openai provider" test-output.log; then
  echo "✓ /provider openai switches to OpenAI"
else
  echo "✗ /provider openai failed"
fi

# Check if model listing works
if grep -q "Found.*models:" test-output.log; then
  echo "✓ /models lists OpenAI models"
else
  echo "✗ /models failed"
fi

# Check if chat works
if grep -q "Test successful" test-output.log; then
  echo "✓ Chat response received from OpenAI"
else
  echo "✗ Chat failed"
fi

# Check if switching back to Gemini works
if grep -q "Switched to Gemini" test-output.log; then
  echo "✓ /provider gemini switches back"
else
  echo "✗ Switching back to Gemini failed"
fi

# Clean up
rm -f test-commands.txt test-output.log

echo ""
echo "Test complete!"
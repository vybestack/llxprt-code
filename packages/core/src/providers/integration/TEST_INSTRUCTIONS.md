# Multi-Provider Integration Test Instructions

## Prerequisites

1. Create `~/.openai_key` file with your OpenAI API key:

   ```bash
   echo "sk-your-api-key-here" > ~/.openai_key
   chmod 600 ~/.openai_key
   ```

2. Build the project:
   ```bash
   npm run build
   ```

## Running Automated Integration Tests

```bash
# Run all multi-provider integration tests
npm test -- packages/core/src/providers/integration/multi-provider.integration.test.ts

# Run with verbose output
npm test -- packages/core/src/providers/integration/multi-provider.integration.test.ts --reporter=verbose
```

### Expected Test Output

When successful, you should see output like:

```
✅ Found 48 OpenAI models
   Sample models: gpt-3.5-turbo, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106...

✅ GPT-3.5-turbo response: "Hello from OpenAI integration test"

✅ Streaming test received 7 chunks
   Response: "1
2
3
4
5"

✅ GPT-4 response: "4"

✅ Tool call received: get_weather
   Arguments: {"location":"San Francisco"}

✅ Content generator response: "Hello! How can I help you today?"

✅ Correctly caught error for invalid model: The model 'invalid-model-xyz' does not exist
```

## Manual Interactive Testing

Run the manual test script:

```bash
node packages/core/test-multi-provider.js
```

### Test Scenarios

1. **List providers**

   ```
   /provider
   ```

   Expected: Shows `gemini (active)` and `openai`

2. **Switch to OpenAI**

   ```
   /provider openai
   ```

   Expected: "✅ Switched to openai provider"

3. **List available models**

   ```
   /models
   ```

   Expected: List of OpenAI models (gpt-3.5-turbo, gpt-4, etc.)

4. **Send a chat message**

   ```
   /chat Hello, how are you?
   ```

   Expected: Response from OpenAI

5. **Test streaming**

   ```
   /stream Tell me a short joke
   ```

   Expected: Response streams character by character

6. **Switch models**

   ```
   /model gpt-4
   /chat What model are you?
   ```

   Expected: Confirms using GPT-4

7. **Switch back to Gemini**

   ```
   /provider gemini
   ```

   Expected: "✅ Switched to Gemini (default provider)"

8. **Error handling**
   ```
   /provider invalid
   /model invalid-model
   ```
   Expected: Appropriate error messages

## Example Session

```
🚀 Multi-Provider Manual Test Script
=====================================

📦 Registering OpenAI provider...
✅ OpenAI provider registered

Available commands:
  /provider          - List available providers
  /provider <name>   - Switch to provider (e.g., /provider openai)
  /provider gemini   - Switch back to Gemini (default)
  /model             - Show current model
  /model <name>      - Switch model (e.g., /model gpt-4)
  /models            - List available models
  /chat <message>    - Send a chat message
  /stream <message>  - Send a message and show streaming
  /help              - Show this help
  /exit              - Exit the program

Ready for testing! Type a command:

> /provider
Available providers:
  gemini (active)
  openai

> /provider openai
✅ Switched to openai provider

> /model
Current model: gpt-3.5-turbo

> /chat Hello!
Sending message...

Response:
Hello! How can I assist you today?

> /stream Count to 3
Streaming response...

1... 2... 3!

> /provider gemini
✅ Switched to Gemini (default provider)

> /exit
Goodbye! 👋
```

## Troubleshooting

1. **"No OpenAI API key found"**
   - Make sure `~/.openai_key` exists and contains valid API key
   - Check file permissions: `ls -la ~/.openai_key`

2. **"Connection error" in tests**
   - Check internet connection
   - Verify API key is valid
   - OpenAI API might be down

3. **"Model does not exist"**
   - Some models require specific API access
   - Try with `gpt-3.5-turbo` which is widely available

4. **Rate limiting**
   - If you get rate limit errors, wait a bit between requests
   - Consider using a different API key for testing

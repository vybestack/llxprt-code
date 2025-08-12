# Phase 12: End-to-End Integration Testing

## Objective

Comprehensive integration tests for tool format system.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Write end-to-end integration tests for tool format detection.

Create packages/core/test/integration/tool-format-e2e.spec.ts:

/**
 * @requirement REQ-003.1 REQ-002.1
 * @scenario GLM-4.5 complete API flow
 * @given GLM-4.5 model making API call with tools
 * @when Complete request/response cycle
 * @then Tools formatted correctly, response parsed properly
 */
test('e2e: GLM-4.5 API call with tools', async () => {
  const provider = new OpenAIProvider({
    model: 'glm-4.5',
    baseUrl: 'https://api.glm.ai/v1',
    apiKey: process.env.GLM_API_KEY || 'test-key'
  });
  
  const messages = [{
    role: 'user',
    content: 'Search for TypeScript tutorials'
  }];
  
  const tools = [{
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query']
      }
    }
  }];
  
  // Make API call
  const response = await provider.chat(messages, { tools });
  
  // Verify tool was called with Qwen format
  expect(response.tool_calls).toBeDefined();
  expect(response.tool_calls[0].function.name).toBe('web_search');
  
  // Execute tool
  const toolResult = { results: ['Tutorial 1', 'Tutorial 2'] };
  
  // Continue conversation with tool result
  const followUp = await provider.chat([
    ...messages,
    response,
    {
      role: 'tool',
      tool_call_id: response.tool_calls[0].id,
      content: JSON.stringify(toolResult)
    }
  ]);
  
  expect(followUp.content).toContain('Tutorial');
});

/**
 * @requirement REQ-003.2 REQ-001.2
 * @scenario Settings override for any model
 * @given GPT-4 with Qwen format override
 * @when Making tool-based API call
 * @then Uses Qwen format successfully
 */
test('e2e: format override via settings', async () => {
  const settingsService = new SettingsService(repository);
  
  // Set format override
  await settingsService.updateSettings('openai', {
    model: 'gpt-4',
    toolFormat: 'qwen'
  });
  
  const provider = new OpenAIProvider();
  provider.initialize(settingsService);
  
  const tools = [{
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Calculate math',
      parameters: {}
    }
  }];
  
  // Internal format should be Qwen
  const formatted = provider.formatToolsForAPI(tools);
  expect(formatted[0].name).toBe('calculate');
  expect(formatted[0].type).toBeUndefined();
});

/**
 * @requirement REQ-004.1 REQ-004.2
 * @scenario Mixed provider formats
 * @given Multiple providers with different formats
 * @when Each makes API calls
 * @then Each uses correct format
 */
test('e2e: multiple providers with different formats', async () => {
  const providers = [
    new OpenAIProvider({ model: 'gpt-4', apiKey: 'key1' }),
    new OpenAIProvider({ model: 'glm-4.5', apiKey: 'key2' }),
    new OpenAIProvider({ model: 'qwen3-coder-plus', apiKey: 'key3' })
  ];
  
  const tools = [{
    type: 'function',
    function: { name: 'test', description: 'Test', parameters: {} }
  }];
  
  const formats = providers.map(p => p.formatToolsForAPI(tools));
  
  // GPT-4 uses OpenAI format
  expect(formats[0][0].type).toBe('function');
  
  // GLM-4.5 uses Qwen format
  expect(formats[1][0].name).toBe('test');
  expect(formats[1][0].type).toBeUndefined();
  
  // Qwen uses Qwen format
  expect(formats[2][0].name).toBe('test');
  expect(formats[2][0].type).toBeUndefined();
});

/**
 * @requirement REQ-001.1 REQ-004.3
 * @scenario Settings migration
 * @given Old config without toolFormat
 * @when Migration runs
 * @then Correct formats auto-detected
 */
test('e2e: migrate existing configs', async () => {
  // Old config without toolFormat
  const oldConfig = {
    activeProvider: 'openai',
    providers: {
      openai: { model: 'gpt-4', apiKey: 'key1' },
      qwen: { model: 'qwen3-coder-plus', apiKey: 'key2' },
      glm: { model: 'glm-4.5', apiKey: 'key3' }
    }
  };
  
  await fs.writeFile(settingsPath, JSON.stringify(oldConfig));
  
  const settingsService = new SettingsService(repository);
  await settingsService.migrate();
  
  const migrated = settingsService.getSettings();
  
  // Auto-detected formats added
  expect(migrated.providers.openai.toolFormat).toBe('auto');
  expect(migrated.providers.qwen.toolFormat).toBe('auto');
  expect(migrated.providers.glm.toolFormat).toBe('auto');
  
  // GLM-4.5 correctly uses Qwen when auto
  const provider = new OpenAIProvider(migrated.providers.glm);
  const format = provider.getToolFormat();
  expect(format).toBe('qwen');
});

/**
 * @requirement REQ-002.3 REQ-002.4
 * @scenario Complex tool parameters
 * @given Tools with nested parameters
 * @when Formatted for different providers
 * @then Parameters preserved correctly
 */
test('e2e: complex parameter handling', async () => {
  const complexTool = {
    type: 'function',
    function: {
      name: 'createUser',
      description: 'Create a new user',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
              preferences: {
                type: 'object',
                properties: {
                  theme: { type: 'string', enum: ['light', 'dark'] },
                  notifications: { type: 'boolean' }
                }
              }
            },
            required: ['name', 'email']
          }
        },
        required: ['user']
      }
    }
  };
  
  const qwenProvider = new OpenAIProvider({ model: 'glm-4.5', apiKey: 'key' });
  const openaiProvider = new OpenAIProvider({ model: 'gpt-4', apiKey: 'key' });
  
  const qwenFormat = qwenProvider.formatToolsForAPI([complexTool]);
  const openaiFormat = openaiProvider.formatToolsForAPI([complexTool]);
  
  // Qwen format flattened but parameters preserved
  expect(qwenFormat[0].parameters.properties.user.properties.name.type).toBe('string');
  expect(qwenFormat[0].parameters.properties.user.required).toEqual(['name', 'email']);
  
  // OpenAI format unchanged
  expect(openaiFormat[0].function.parameters.properties.user).toBeDefined();
});

// Add more e2e tests for:
// - Performance under load
// - Concurrent format detection
// - Error handling in API calls
// - Caching behavior
// - Memory usage

Run all integration tests:
npm test packages/core/test/integration/

Output results to workers/phase-12.json
"
```

## Verification

```bash
# Run all integration tests
npm test packages/core/test/integration/

# Check coverage
npm test -- --coverage packages/core/test/integration/

# Performance test
npm run benchmark:tool-format

# Memory profile
node --inspect test-tool-format-memory.js
```
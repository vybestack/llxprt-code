# Phase 10: Provider Integration TDD

## Objective

Write behavioral tests for OpenAIProvider format integration.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Write behavioral tests for provider integration with format detection.

Create packages/core/test/providers/openai/provider-format-integration.spec.ts:

/**
 * @requirement REQ-003.1
 * @scenario GLM-4.5 uses Qwen format automatically
 * @given OpenAIProvider with GLM-4.5 model
 * @when Tools provided to API call
 * @then Tools formatted using Qwen strategy
 */
test('GLM-4.5 should use Qwen format for tools', async () => {
  const provider = new OpenAIProvider({
    model: 'glm-4.5',
    apiKey: 'test-key'
  });
  
  const tools = [{
    type: 'function',
    function: {
      name: 'search',
      description: 'Search',
      parameters: {}
    }
  }];
  
  const formatted = provider.formatToolsForAPI(tools);
  
  expect(formatted[0].name).toBe('search');
  expect(formatted[0].type).toBeUndefined(); // Qwen format has no type field
});

/**
 * @requirement REQ-003.2
 * @scenario Manual format override
 * @given GPT-4 with toolFormat='qwen'
 * @when Tools provided
 * @then Uses Qwen format despite GPT model
 */
test('should respect format override in settings', async () => {
  const provider = new OpenAIProvider({
    model: 'gpt-4',
    apiKey: 'test-key',
    toolFormat: 'qwen'
  });
  
  const tools = [{
    type: 'function',
    function: { name: 'test', description: 'Test', parameters: {} }
  }];
  
  const formatted = provider.formatToolsForAPI(tools);
  
  expect(formatted[0].name).toBe('test');
  expect(formatted[0].type).toBeUndefined(); // Using Qwen format
});

/**
 * @requirement REQ-004.1
 * @scenario Existing Qwen models unchanged
 * @given Qwen3-coder-plus model
 * @when API call with tools
 * @then Continues using Qwen format
 */
test('Qwen models should continue using Qwen format', async () => {
  const provider = new OpenAIProvider({
    model: 'qwen3-coder-plus',
    baseUrl: 'https://portal.qwen.ai/v1',
    apiKey: 'test-key'
  });
  
  const tools = [{
    type: 'function',
    function: { name: 'create', description: 'Create', parameters: {} }
  }];
  
  const formatted = provider.formatToolsForAPI(tools);
  
  expect(formatted[0].name).toBe('create');
  expect(formatted[0].type).toBeUndefined();
});

/**
 * @requirement REQ-004.2
 * @scenario OpenAI models unaffected
 * @given Standard GPT-4 without overrides
 * @when Tools provided
 * @then Uses standard OpenAI format
 */
test('OpenAI models should use OpenAI format by default', async () => {
  const provider = new OpenAIProvider({
    model: 'gpt-4',
    apiKey: 'test-key'
  });
  
  const tools = [{
    type: 'function',
    function: { name: 'get', description: 'Get', parameters: {} }
  }];
  
  const formatted = provider.formatToolsForAPI(tools);
  
  expect(formatted[0].type).toBe('function');
  expect(formatted[0].function.name).toBe('get');
});

/**
 * @requirement REQ-002.4
 * @scenario Parse responses based on format
 * @given GLM-4.5 response in Qwen format
 * @when parseToolCalls called
 * @then Correctly parses Qwen structure
 */
test('should parse tool calls based on detected format', async () => {
  const provider = new OpenAIProvider({
    model: 'glm-4.5',
    apiKey: 'test-key'
  });
  
  const qwenResponse = {
    tool_calls: [{
      id: 'call_abc',
      function: {
        name: 'search',
        arguments: '{"query": "test"}'
      }
    }]
  };
  
  const parsed = provider.parseToolCalls(qwenResponse);
  
  expect(parsed[0].id).toBe('call_abc');
  expect(parsed[0].type).toBe('function');
  expect(parsed[0].function.name).toBe('search');
});

/**
 * @requirement REQ-001.1
 * @scenario Format detection performance
 * @given Various models and settings
 * @when Format detection called 1000 times
 * @then Average time < 1ms
 */
test('format detection should be performant', () => {
  const provider = new OpenAIProvider({
    model: 'glm-4.5',
    apiKey: 'test-key'
  });
  
  const start = Date.now();
  for (let i = 0; i < 1000; i++) {
    provider.getToolFormat();
  }
  const avgTime = (Date.now() - start) / 1000;
  
  expect(avgTime).toBeLessThan(1);
});

// Add more tests for:
// - Complex tool parameters
// - Error handling in format detection
// - Caching of format strategy
// - Settings changes trigger re-detection
// - Invalid format in settings ignored

IMPORTANT:
- Test actual provider behavior
- Verify tool transformations
- Check performance requirements
"
```

## Verification

```bash
# Run tests
npm test provider-format-integration.spec.ts

# Check format transformations tested
grep -c "formatToolsForAPI\|parseToolCalls" provider-format-integration.spec.ts
# Should be 8+

# Verify performance test
grep "toBeLessThan(1)" provider-format-integration.spec.ts
```
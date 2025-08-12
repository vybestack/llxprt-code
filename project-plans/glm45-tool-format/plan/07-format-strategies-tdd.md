# Phase 7: Format Strategies TDD

## Objective

Write behavioral tests for format strategy implementations.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Write behavioral tests for format strategies.

Create packages/core/test/providers/openai/toolFormats/strategies.spec.ts:

/**
 * @requirement REQ-002.3
 * @scenario Transform OpenAI tools to Qwen format
 * @given OpenAI nested tool structure
 * @when QwenFormat.formatTools called
 * @then Returns flattened Qwen structure
 */
test('QwenFormat should flatten OpenAI tools', () => {
  const strategy = new QwenFormat();
  const openAITools = [{
    type: 'function',
    function: {
      name: 'search',
      description: 'Search for content',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        }
      }
    }
  }];
  
  const formatted = strategy.formatTools(openAITools);
  
  expect(formatted[0].name).toBe('search');
  expect(formatted[0].description).toBe('Search for content');
  expect(formatted[0].parameters.properties.query.type).toBe('string');
  expect(formatted[0].type).toBeUndefined(); // No nested type in Qwen
});

/**
 * @requirement REQ-002.4
 * @scenario Parse Qwen tool call response
 * @given Qwen-formatted tool call response
 * @when QwenFormat.parseToolCall called
 * @then Returns normalized tool calls
 */
test('QwenFormat should parse Qwen responses', () => {
  const strategy = new QwenFormat();
  const qwenResponse = {
    tool_calls: [{
      id: 'call_123',
      function: {
        name: 'search',
        arguments: '{"query": "test"}'
      }
    }]
  };
  
  const parsed = strategy.parseToolCall(qwenResponse);
  
  expect(parsed[0].id).toBe('call_123');
  expect(parsed[0].type).toBe('function');
  expect(parsed[0].function.name).toBe('search');
  expect(parsed[0].function.arguments).toBe('{"query": "test"}');
});

/**
 * @requirement REQ-002.3
 * @scenario OpenAI format passes through unchanged
 * @given OpenAI tool structure
 * @when OpenAIFormat.formatTools called
 * @then Returns unchanged structure
 */
test('OpenAIFormat should preserve OpenAI structure', () => {
  const strategy = new OpenAIFormat();
  const tools = [{
    type: 'function',
    function: {
      name: 'test',
      description: 'Test function',
      parameters: {}
    }
  }];
  
  const formatted = strategy.formatTools(tools);
  
  expect(formatted).toEqual(tools);
  expect(formatted[0].type).toBe('function');
});

/**
 * @requirement REQ-002.1
 * @scenario Handle multiple tools
 * @given Array of multiple tools
 * @when QwenFormat.formatTools called
 * @then All tools properly transformed
 */
test('QwenFormat should handle multiple tools', () => {
  const strategy = new QwenFormat();
  const tools = [
    {
      type: 'function',
      function: { name: 'search', description: 'Search', parameters: {} }
    },
    {
      type: 'function',
      function: { name: 'create', description: 'Create', parameters: {} }
    }
  ];
  
  const formatted = strategy.formatTools(tools);
  
  expect(formatted).toHaveLength(2);
  expect(formatted[0].name).toBe('search');
  expect(formatted[1].name).toBe('create');
});

/**
 * @requirement REQ-004.2
 * @scenario OpenAI models unaffected
 * @given Standard OpenAI response
 * @when OpenAIFormat.parseToolCall called
 * @then Parses correctly without changes
 */
test('OpenAIFormat should parse standard responses', () => {
  const strategy = new OpenAIFormat();
  const response = {
    tool_calls: [{
      id: 'call_456',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: '{"city": "NYC"}'
      }
    }]
  };
  
  const parsed = strategy.parseToolCall(response);
  
  expect(parsed[0].id).toBe('call_456');
  expect(parsed[0].function.name).toBe('get_weather');
});

/**
 * @requirement REQ-002.3
 * @scenario Handle empty tool arrays
 * @given Empty tool array
 * @when formatTools called
 * @then Returns empty array
 */
test('Strategies should handle empty tool arrays', () => {
  const qwen = new QwenFormat();
  const openai = new OpenAIFormat();
  
  expect(qwen.formatTools([])).toEqual([]);
  expect(openai.formatTools([])).toEqual([]);
});

/**
 * @requirement REQ-002.4
 * @scenario Format tool results
 * @given Tool execution result
 * @when formatToolResult called
 * @then Returns properly formatted result
 */
test('Strategies should format tool results', () => {
  const qwen = new QwenFormat();
  const result = { data: 'search results' };
  
  const formatted = qwen.formatToolResult(result);
  
  expect(formatted).toBeDefined();
  expect(typeof formatted).toBe('string');
});

// Add more tests for:
// - Complex nested parameters
// - Error responses
// - Missing fields handling
// - Invalid JSON in arguments
// - Performance within 2ms

IMPORTANT:
- Test actual transformations
- Check exact output structure
- No mock verification
"
```

## Verification

```bash
# Run tests
npm test strategies.spec.ts

# Check transformations tested
grep -c "formatTools\|parseToolCall" strategies.spec.ts
# Should be 10+

# Verify no mocks
grep "toHaveBeenCalled" strategies.spec.ts
[ $? -ne 0 ] || echo "FAIL: Mock verification"
```
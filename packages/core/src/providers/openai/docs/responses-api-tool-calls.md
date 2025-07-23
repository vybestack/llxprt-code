# OpenAI Responses API Tool Call Support

This document describes how tool calls are handled when using the OpenAI Responses API (e.g., with o3 models).

## Event Flow

The Responses API uses a different event structure than the Chat Completions API:

1. **`response.output_item.added`** - Signals the start of a new function call
   - Contains `item.id`, `item.call_id`, `item.name`
   - `item.type` must be `"function_call"`

2. **`response.function_call_arguments.delta`** - Streams function arguments
   - Contains `item_id` to match the function call
   - Contains `delta` with partial argument JSON

3. **`response.output_item.done`** - Signals function call completion
   - Contains the complete `item` with final `arguments`
   - Parser yields the complete tool call at this point

## Implementation Details

### State Management

The parser maintains a `Map` of in-progress function calls:

```typescript
const functionCalls = new Map<
  string,
  {
    id: string; // call_id or item.id
    name: string; // function name
    arguments: string; // accumulated JSON arguments
    output_index: number; // position in output array
  }
>();
```

### Event Processing

1. **On `response.output_item.added`**: Create new function call entry
2. **On `response.function_call_arguments.delta`**: Append to arguments
3. **On `response.output_item.done`**: Yield complete tool call and cleanup

### Output Format

Tool calls are yielded in the standard format expected by the rest of the system:

```typescript
{
  role: ContentGeneratorRole.ASSISTANT,
  content: '',
  tool_calls: [{
    id: string,
    type: 'function',
    function: {
      name: string,
      arguments: string  // JSON string
    }
  }]
}
```

## Example Event Sequence

```
// 1. Function call starts
{"type":"response.output_item.added","item":{"id":"fc_123","type":"function_call","call_id":"call_abc","name":"get_weather"}}

// 2. Arguments stream in
{"type":"response.function_call_arguments.delta","item_id":"fc_123","delta":"{\"location\":"}
{"type":"response.function_call_arguments.delta","item_id":"fc_123","delta":"\"San Francisco, CA\"}"}

// 3. Function call completes
{"type":"response.output_item.done","item":{"id":"fc_123","type":"function_call","arguments":"{\"location\":\"San Francisco, CA\"}","call_id":"call_abc","name":"get_weather"}}
```

## Edge Cases Handled

1. **No call_id**: Falls back to `item.id` if `call_id` is not provided
2. **Empty arguments**: Yields empty string for functions with no parameters
3. **Concurrent calls**: Tracks multiple function calls by their unique IDs
4. **Interleaved content**: Text deltas and tool calls can be mixed in the stream
5. **Final arguments**: Uses `item.arguments` from the done event as the source of truth

## Testing

See `parseResponsesStream.responsesToolCalls.test.ts` for comprehensive test coverage including:

- Basic tool call parsing
- Streaming argument assembly
- Multiple concurrent tool calls
- Empty arguments
- Interleaved content and tool calls
- Usage data handling
- Edge cases

# Text-Based Tool Call Parsing

This document describes the text-based tool call parsing system in the LLxprt Code, which enables support for models that output tool calls as formatted text rather than structured JSON.

## Overview

Many open-source and specialized models don't support OpenAI's structured tool calling format. Instead, they output tool calls as specially formatted text within their responses. The LLxprt Code automatically detects and parses these formats, converting them to the standard internal format for execution.

## Architecture

The system consists of two parallel paths for tool extraction:

1. **Structured Path**: For providers that return tool calls as JSON objects (OpenAI, Anthropic)
   - Provider → ToolFormatter → Standard format → Execution

2. **Text-Based Path**: For models that embed tool calls in text (Gemma, Hermes, DeepSeek, Llama)
   - Provider → TextToolCallParser → Standard format → Execution

Both paths produce the same `IMessage['tool_calls']` format, ensuring consistent tool execution regardless of the source.

## Supported Formats

### 1. Gemma Format (TOOL_REQUEST)

```
[TOOL_REQUEST]
list_directory {"path": "/home/user"}
[TOOL_REQUEST_END]
```

### 2. JSON Object with END_TOOL_REQUEST

```
{"name": "search", "arguments": {"query": "climate change"}}
[END_TOOL_REQUEST]
```

### 3. Hermes Format (tool_call tags)

```xml
<tool_call>
{"arguments": {"symbol": "TSLA"}, "name": "get_stock_fundamentals"}
</tool_call>
```

### 4. DeepSeek Format (Unicode tokens)

```
<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>get_weather
{"location": "San Francisco", "unit": "celsius"}
<｜tool▁call▁end｜>
```

### 5. Llama Formats

#### Pythonic Style (Llama 3.2):

```python
[get_user_info(user_id=7890, special='black')]
```

#### Function Tag Style:

```xml
<function=example_function>{"example_name": "example_value"}</function>
```

#### JSON Style (Llama 3.1):

```json
{ "name": "function_name", "parameters": { "arg": "value" } }
```

### 6. XML Formats

#### Claude-style:

```xml
<invoke name="get_weather">
<parameter name="location">San Francisco</parameter>
</invoke>
```

#### Generic XML:

```xml
<tool>
  <name>search</name>
  <arguments>
    <query>climate change</query>
  </arguments>
</tool>
```

### 7. Key-Value Format

```
✦ tool_call: list_directory for path /home/user ignore *.log
```

## Configuration

### Settings

Configure text-based tool parsing in your settings file:

```json
{
  "enableTextToolCallParsing": true,
  "textToolCallModels": ["custom-model-1", "custom-model-2"]
}
```

- `enableTextToolCallParsing`: Enable/disable text parsing globally (default: true)
- `textToolCallModels`: Additional models that require text parsing beyond the defaults

### Default Models

The following models automatically use text-based parsing:

- gemma-3-12b-it
- gemma-2-27b-it

### Auto-Detection

The system automatically detects the appropriate parser based on:

1. Model name (e.g., models containing "gemma", "hermes", "deepseek")
2. Base URL (for custom endpoints)
3. Manual override via `/toolformat` command

### Examples

#### Basic Configuration

```json
{
  "enableTextToolCallParsing": true,
  "textToolCallModels": ["llama-3.2", "mixtral-instruct"]
}
```

#### Using with OpenAI-Compatible Providers

```json
{
  "providers": [
    {
      "name": "openai",
      "apiKey": "$OPENAI_API_KEY",
      "baseURL": "https://api.deepseek.com/v1"
    }
  ],
  "textToolCallModels": ["deepseek-chat"]
}
```

#### Testing Tool Parsing

```bash
# Check current format
> /toolformat
Current tool format: auto-detected (gemma)

# Override to text format
> /toolformat text
Tool format set to: text

# Test with a tool call
> List all JavaScript files in the src directory
```

## Adding New Formats

To add support for a new text-based format:

1. **Add Pattern to TextToolCallParser**:

```typescript
// In TextToolCallParser.ts
private readonly patterns = [
  // ... existing patterns ...
  // Format X: Your new format
  /your-regex-pattern/gs,
];
```

2. **Update Parsing Logic**:

```typescript
if (pattern === this.patterns[X]) {
  // Custom parsing logic for your format
  const [fullMatch, toolName, args] = match;
  // Process and add to matches
}
```

3. **Add Tests**:

```typescript
it('should parse new format', () => {
  const content = 'Your format example';
  const result = parser.parse(content);
  expect(result.toolCalls).toHaveLength(1);
  // ... assertions
});
```

4. **Update Format Detection**:

- Add model names to default lists
- Update `requiresTextToolCallParsing()` logic

## Debugging

### Enable Debug Logging

Set environment variable:

```bash
export DEBUG=openai:*,parser:*
```

This will show:

- Parser attempts and matches
- Failed parsing attempts with error details
- Tool call extraction process
- Format detection logic

### Common Issues

1. **Tool calls not detected**:
   - Check if model is in `textToolCallModels` list
   - Verify the format matches a supported pattern
   - Look for debug logs showing parsing attempts
   - Try manually overriding with `/toolformat text`

2. **Malformed arguments**:
   - Parser logs failed JSON parsing attempts
   - Check for proper escaping of quotes in arguments
   - Verify JSON structure is valid
   - Common issue: nested quotes not escaped

3. **Partial tool calls**:
   - Ensure complete markers are present (opening and closing tags)
   - Check for truncated responses from the model
   - May need to increase max_tokens for the model

4. **Wrong format detected**:
   - Use `/toolformat` to check current format
   - Override with `/toolformat <format>` if needed
   - Check model name matches expected pattern

### Testing New Formats

1. Create a test file with sample output:

```bash
echo 'Your tool call format here' > test-format.txt
```

2. Run the parser test:

```bash
npm test -- --grep "YourFormat"
```

3. Check debug output:

```bash
DEBUG=parser:* npm test
```

### Troubleshooting Steps

1. **Verify Model Configuration**:

```bash
# Check current provider and format
/provider
/toolformat
```

2. **Test Tool Call Parsing**:

```bash
# Enable debug logging
export DEBUG=parser:*

# Try a simple tool call
> List the files in the current directory
```

3. **Check Parser Patterns**:
   - Look in `TextToolCallParser.ts` for supported patterns
   - Verify your model's format matches one of them
   - Add custom pattern if needed

4. **Common Fixes**:
   - Add model to `textToolCallModels` setting
   - Override format with `/toolformat text`
   - Update model name detection in provider
   - Ensure complete tool call markers in prompts

### Pattern Regex Explanations

1. **Gemma Format** (`[TOOL_REQUEST]`):
   - Matches: `[TOOL_REQUEST]\nfunction_name {args}\n[TOOL_REQUEST_END]`
   - Captures: function name and JSON arguments
   - Multiline with optional whitespace

2. **JSON with END_TOOL_REQUEST**:
   - Matches: `{"name": "func", "arguments": {...}}[END_TOOL_REQUEST]`
   - Supports optional line numbers (e.g., `1 {"name"...`)
   - Flexible whitespace handling

3. **Hermes XML Format**:
   - Matches: `<tool_call>{...}</tool_call>`
   - Extracts JSON from within XML tags
   - Handles nested XML properly

4. **DeepSeek Unicode Format**:
   - Matches: `<｜tool▁calls▁begin｜>` markers
   - Complex Unicode token handling
   - Preserves original formatting

## Performance Considerations

- Text parsing uses regex patterns, which is slower than structured JSON parsing
- Multiple patterns are tried sequentially until a match is found
- Large responses with many tool calls may impact performance
- Consider caching parsed results for repeated calls

## Security

- All parsed arguments go through JSON.parse() for validation
- Malformed JSON is logged but doesn't crash the parser
- No code execution happens during parsing
- Tool execution has its own security layer

## Future Improvements

1. **Unified Parser Interface**: Create a common interface for both structured and text parsers
2. **Pattern Optimization**: Combine similar patterns for better performance
3. **Streaming Support**: Parse tool calls as they stream in
4. **Format Auto-Detection**: Detect format from response content rather than model name
5. **Plugin System**: Allow external parsers for proprietary formats

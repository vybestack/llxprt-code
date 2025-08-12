# Phase 2: Pseudocode Development

## Objective

Create detailed pseudocode for tool format components.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Based on specification and analysis, create pseudocode for components.

### analysis/pseudocode/tool-format-detector.md

```
CLASS ToolFormatDetector
  PRIVATE modelPatterns: Map<RegExp, ToolFormat>
  
  METHOD constructor()
    INITIALIZE modelPatterns
      ADD /^qwen/i → 'qwen'
      ADD /^glm-4\.5/i → 'qwen'  // GLM-4.5 uses Qwen format
      ADD /^gpt/i → 'openai'
      ADD /^claude/i → 'openai'

  METHOD detectFormat(model: string, settings?: Settings): FormatResult
    // Check explicit setting first
    IF settings?.toolFormat AND settings.toolFormat != 'auto'
      RETURN {
        format: settings.toolFormat,
        source: 'explicit-setting',
        confidence: 1.0
      }
    
    // Check model patterns
    FOR EACH pattern IN modelPatterns
      IF pattern.test(model)
        RETURN {
          format: modelPatterns.get(pattern),
          source: 'model-pattern',
          confidence: 0.9
        }
    
    // Default to OpenAI
    RETURN {
      format: 'openai',
      source: 'default',
      confidence: 0.5
    }

  METHOD getStrategy(format: ToolFormat): IToolFormatStrategy
    SWITCH format
      CASE 'qwen': RETURN new QwenFormatStrategy()
      CASE 'openai': RETURN new OpenAIFormatStrategy()
      CASE 'gemini': RETURN new GeminiFormatStrategy()
      DEFAULT: RETURN new OpenAIFormatStrategy()
```

### analysis/pseudocode/format-strategies.md

```
INTERFACE IToolFormatStrategy
  METHOD formatTools(tools: OpenAITool[]): any[]
  METHOD parseToolCall(response: any): ToolCall[]
  METHOD formatToolResult(result: any): any

CLASS QwenFormatStrategy IMPLEMENTS IToolFormatStrategy
  METHOD formatTools(tools: OpenAITool[]): any[]
    RETURN tools.map(tool => {
      // Flatten OpenAI format to Qwen format
      IF tool.type == 'function'
        RETURN {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters
        }
    })

  METHOD parseToolCall(response: any): ToolCall[]
    // Parse Qwen-specific response format
    IF response.tool_calls
      RETURN response.tool_calls.map(call => {
        RETURN {
          id: call.id,
          type: 'function',
          function: {
            name: call.function.name,
            arguments: call.function.arguments
          }
        }
      })

CLASS OpenAIFormatStrategy IMPLEMENTS IToolFormatStrategy
  METHOD formatTools(tools: OpenAITool[]): any[]
    // OpenAI format is already correct
    RETURN tools

  METHOD parseToolCall(response: any): ToolCall[]
    // Standard OpenAI parsing
    RETURN response.tool_calls || []
```

### analysis/pseudocode/provider-integration.md

```
CLASS OpenAIProvider
  PRIVATE formatDetector: ToolFormatDetector
  PRIVATE formatStrategy: IToolFormatStrategy

  METHOD initialize(model: string, settings: Settings)
    DETECT format using formatDetector.detectFormat(model, settings)
    SET formatStrategy = formatDetector.getStrategy(format.detectedFormat)
    LOG format detection result for debugging

  METHOD callAPI(messages: Message[], tools?: Tool[])
    IF tools provided
      FORMAT tools using formatStrategy.formatTools(tools)
    
    SEND request to API with formatted tools
    
    PARSE response using formatStrategy.parseToolCall(response)
    
    RETURN normalized response
```

Do NOT write TypeScript, only pseudocode.
Include error handling in algorithms.
"
```

## Verification Checklist

- [ ] Detection algorithm clear
- [ ] Format transformation documented
- [ ] Strategy pattern properly defined
- [ ] Integration points identified
- [ ] No TypeScript code
# Feature Specification: GLM-4.5 Tool Format Detection

## Purpose

Fix GLM-4.5 model to use Qwen's tool format workarounds by making behavior driven by tool format setting rather than hardcoded model name detection, enabling proper tool handling for any model that requires specific formatting.

## Architectural Decisions

- **Pattern**: Strategy Pattern with Format Detectors
- **Technology Stack**: TypeScript 5.x, Node.js 20.x
- **Data Flow**: Tool format detection → Strategy selection → Format application
- **Integration Points**: OpenAI Provider, Tool formatting system, Model detection

## Project Structure

```
packages/core/src/
  providers/
    openai/
      toolFormats/
        types.ts           # Tool format type definitions
        ToolFormatDetector.ts  # Format detection logic
        ToolFormatStrategy.ts  # Strategy interface
        OpenAIFormat.ts    # Standard OpenAI format
        QwenFormat.ts      # Qwen/GLM format
        strategies.spec.ts # Format strategy tests
```

## Technical Environment
- **Type**: Core Library Component
- **Runtime**: Node.js 20.x
- **Dependencies**: Existing provider infrastructure

## Formal Requirements

[REQ-001] Tool Format Detection
  [REQ-001.1] Detect tool format from settings, not model name
  [REQ-001.2] Support explicit format override in settings
  [REQ-001.3] Auto-detect format for known models as fallback
  [REQ-001.4] Default to OpenAI format when unspecified

[REQ-002] Format Strategy Application
  [REQ-002.1] Apply Qwen format for GLM-4.5 models
  [REQ-002.2] Apply Qwen format when toolFormat='qwen' setting
  [REQ-002.3] Transform tool calls based on selected format
  [REQ-002.4] Handle format-specific response parsing

[REQ-003] Model Configuration
  [REQ-003.1] GLM-4.5 auto-configures to Qwen format
  [REQ-003.2] Allow manual format override via settings
  [REQ-003.3] Preserve existing Qwen model behavior
  [REQ-003.4] Support future model additions via config

[REQ-004] Backwards Compatibility
  [REQ-004.1] Existing Qwen models continue working
  [REQ-004.2] OpenAI models unaffected by changes
  [REQ-004.3] Settings migration for existing configs
  [REQ-004.4] No breaking changes to public API

## Data Schemas

```typescript
// Tool format configuration
const ToolFormatConfigSchema = z.object({
  format: z.enum(['auto', 'openai', 'qwen', 'gemini']),
  modelPatterns: z.array(z.object({
    pattern: z.string(), // Regex pattern
    format: z.enum(['openai', 'qwen', 'gemini'])
  })).optional()
});

// Tool format detection result
const FormatDetectionResultSchema = z.object({
  detectedFormat: z.enum(['openai', 'qwen', 'gemini']),
  source: z.enum(['explicit-setting', 'model-pattern', 'default']),
  confidence: z.number().min(0).max(1)
});

// Tool transformation
const ToolTransformSchema = z.object({
  original: z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      description: z.string(),
      parameters: z.record(z.unknown())
    })
  }),
  transformed: z.record(z.unknown()),
  format: z.enum(['openai', 'qwen', 'gemini'])
});
```

## Example Data

```json
{
  "glm45Detection": {
    "model": "glm-4.5",
    "settings": {},
    "result": {
      "detectedFormat": "qwen",
      "source": "model-pattern",
      "confidence": 1.0
    }
  },
  "explicitOverride": {
    "model": "gpt-4",
    "settings": {
      "toolFormat": "qwen"
    },
    "result": {
      "detectedFormat": "qwen",
      "source": "explicit-setting",
      "confidence": 1.0
    }
  },
  "toolTransformation": {
    "input": {
      "type": "function",
      "function": {
        "name": "search",
        "description": "Search for content",
        "parameters": {
          "type": "object",
          "properties": {
            "query": { "type": "string" }
          }
        }
      }
    },
    "qwenOutput": {
      "name": "search",
      "description": "Search for content",
      "parameters": {
        "type": "object",
        "properties": {
          "query": { "type": "string" }
        }
      }
    }
  }
}
```

## Constraints

- Must not break existing Qwen functionality
- Format detection must be deterministic
- Settings take precedence over auto-detection
- No performance degradation in tool handling
- Must support async format detection for future needs

## Performance Requirements

- Format detection: <1ms
- Tool transformation: <2ms per tool
- No additional API calls for format detection
- Memory overhead: <1MB for format strategies
# Feature Specification: Emoji Filter System

## Purpose

Provides configurable control over emoji usage in LLM outputs and tool calls to ensure professional, emoji-free code and interactions. Prevents emojis from being injected into source files while maintaining user flexibility.

## Architectural Decisions

- **Pattern**: Filter Pipeline with Strategy Pattern
- **Technology Stack**: TypeScript (strict mode), Unicode regex patterns
- **Data Flow**: Intercept at stream processing and tool execution points
- **Integration Points**: Provider streams, tool executor, settings service

## Project Structure

```
packages/core/src/
  filters/
    EmojiFilter.ts          # Main filter implementation
    emoji-patterns.ts       # Unicode patterns and conversions
    types.ts               # TypeScript interfaces
  filters/test/
    EmojiFilter.spec.ts     # Behavioral tests
    emoji-patterns.spec.ts  # Pattern tests

packages/cli/src/
  ui/hooks/
    useGeminiStream.ts     # Modified for stream filtering
  ui/commands/
    setCommand.ts          # Modified for emojifilter command
```

## Technical Environment

- **Type**: CLI Tool Enhancement
- **Runtime**: Node.js 20.x
- **Dependencies**: No new external dependencies (uses built-in regex)

## Integration Points (MANDATORY SECTION)

### Existing Code That Will Use This Feature

- `/packages/cli/src/ui/hooks/useGeminiStream.ts:816` - processGeminiStreamEvents will apply filter
- `/packages/core/src/core/nonInteractiveToolExecutor.ts:77` - Filter tool arguments before execution (file modification tools only)
- `/packages/core/src/tools/edit.ts:33` - applyReplacement will filter content
- `/packages/core/src/tools/write-file.ts:73` - WriteFileTool will filter content
- `/packages/core/src/tools/replace.ts` - Replace tool will filter strings

### Tool Filtering Strategy

- **File MODIFICATION tools**: Strict filtering (edit, write, replace)
- **SEARCH tools**: No filtering (grep, glob, shell, find, ls)
- **READ tools**: No filtering (read_file, read_many_files)
- **File PATHS**: Never filter (preserve emoji filenames)

### Existing Code To Be Replaced

- No existing emoji handling code exists - this is new functionality
- Will modify existing stream processing to add filtering
- Will modify tool execution to add parameter filtering

### User Access Points

- CLI: `/set emojifilter [mode]` command
- Config: `~/.llxprt/settings.json` for default mode
- Profile: `/profile save` and `/profile load` for persistence

### Migration Requirements

- No existing data migration needed (new feature)
- Settings.json schema will be extended (backward compatible)
- Default mode is 'auto' for new installations

## Formal Requirements

[REQ-001] Emoji Filtering
  [REQ-001.1] Filter emojis from LLM streaming responses
  [REQ-001.2] Filter emojis from tool call parameters
  [REQ-001.3] Support four modes: allowed, auto, warn, error
  [REQ-001.4] Convert useful emojis to text equivalents
  [REQ-001.5] Remove purely decorative emojis

[REQ-002] File Protection
  [REQ-002.1] Prevent emojis in edit_file operations
  [REQ-002.2] Prevent emojis in write_file operations
  [REQ-002.3] Prevent emojis in replace operations
  [REQ-002.4] Block file operations in error mode if emojis detected

[REQ-003] Configuration
  [REQ-003.1] Session-level configuration via /set command
  [REQ-003.2] Default configuration in settings.json
  [REQ-003.3] Profile support for saving configurations
  [REQ-003.4] Configuration hierarchy: Session > Profile > Default

[REQ-004] Feedback Mechanism
  [REQ-004.1] Silent filtering in auto mode
  [REQ-004.2] Post-execution feedback to LLM in warn mode
  [REQ-004.3] Block execution with error in error mode
  [REQ-004.4] Never filter user input

[REQ-005] Search Tool Exclusions
  [REQ-005.1] Shell/bash/exec tools must NOT be filtered (need to grep for emojis)
  [REQ-005.2] Search tools (grep, glob, ls, find) must NOT be filtered
  [REQ-005.3] Read tools must NOT filter content (preserve original)
  [REQ-005.4] File paths/names with emojis must be preserved in all tools

[REQ-INT-001] Integration Requirements
  [REQ-INT-001.1] Integrate with existing stream processing pipeline
  [REQ-INT-001.2] Integrate with tool execution pipeline
  [REQ-INT-001.3] Integrate with settings service
  [REQ-INT-001.4] Integrate with profile system

## Data Schemas

```typescript
// Filter configuration
const EmojiFilterConfigSchema = z.object({
  mode: z.enum(['allowed', 'auto', 'warn', 'error']),
  customConversions: z.record(z.string()).optional()
});

// Filter result
const FilterResultSchema = z.object({
  filtered: z.string().nullable(),
  emojiDetected: z.boolean(),
  error: z.string().optional(),
  blocked: z.boolean()
});

// Settings extension
const SettingsExtensionSchema = z.object({
  emojiFilter: EmojiFilterConfigSchema.optional()
});
```

## Example Data

```json
{
  "validConfig": {
    "mode": "warn",
    "customConversions": {}
  },
  "textWithEmojis": "✅ Task completed! 🎉",
  "filteredText": "[OK] Task completed!",
  "toolCallWithEmojis": {
    "name": "write_file",
    "args": {
      "file_path": "/src/test.ts",
      "content": "console.log('✅ Success!');"
    }
  },
  "filteredToolCall": {
    "name": "write_file",
    "args": {
      "file_path": "/src/test.ts",
      "content": "console.log('[OK] Success!');"
    }
  }
}
```

## What It Does NOT Filter

- Search tool parameters (grep, glob, find, ls)
- Shell commands (users need to search/replace emojis)
- File paths and filenames (even if they contain emojis)
- Read operations (file content must be preserved as-is)
- User input (never filtered)
- Tool outputs (only inputs are filtered)

## Emoji Conversion Mappings

```typescript
const EMOJI_CONVERSIONS = {
  // Status
  '✅': '[OK]',
  '✔️': '[OK]',
  '❌': '[FAIL]',
  '⚠️': 'WARNING:',
  
  // Information
  '💡': 'TIP:',
  '📝': 'NOTE:',
  '🔍': 'Searching:',
  '🚀': '[LAUNCH]',
  
  // Progress
  '🟢': '[READY]',
  '🟡': '[PENDING]',
  '🔴': '[ERROR]',
  
  // Remove entirely (decorative)
  '🎉': '',
  '😀': '',
  '👍': '',
  // ... full list in overview.md
};
```

## Constraints

- No external HTTP calls for emoji detection
- Regex patterns must be pre-compiled for performance
- Stream processing overhead must be <1ms per chunk
- Configuration changes take effect immediately
- File reads must never be filtered
- File paths with emojis must work correctly
- Search operations must support emoji patterns
- Shell commands must pass through unfiltered

## Performance Requirements

- Stream filtering: <1ms per chunk
- Tool parameter filtering: <1ms per call
- Pattern compilation: One-time at startup
- Memory usage: <10KB for patterns and mappings
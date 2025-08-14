# Emoji Filter Technical Overview

## Architecture Analysis

### System Integration Points

The emoji filter must integrate at three critical points in the llxprt-code architecture:

1. **Provider Response Stream Processing**
2. **Tool Execution Pipeline**
3. **Configuration Management**

## 1. Provider Response Stream Processing

### Current Architecture

The system uses a streaming architecture where provider responses flow through:

```
Provider → GeminiClient → useGeminiStream → UI Display
```

Key files involved:
- `packages/cli/src/ui/hooks/useGeminiStream.ts` - Main stream processing hook
- `packages/core/src/core/geminiClient.ts` - Client that handles provider communication
- `packages/core/src/providers/[provider]/Provider.ts` - Individual provider implementations

### Integration Point

The `processGeminiStreamEvents` function in `useGeminiStream.ts` (line 816) processes all streaming events. This is where we intercept and filter text content before display.

### Technical Approach

1. Create `EmojiFilter` class in `packages/core/src/filters/EmojiFilter.ts`
2. Instantiate filter with current configuration in `useGeminiStream`
3. Apply filter to `ContentEvent` text chunks before adding to history
4. Track if emojis were filtered for potential warning feedback

## 2. Tool Execution Pipeline - CRITICAL FOR CODE SAFETY

### Current Architecture

Tools are executed through a centralized pipeline:

```
LLM Request → ToolRegistry → Tool Validation → Tool Execution → Result Display
```

Key files:
- `packages/core/src/core/nonInteractiveToolExecutor.ts` - Non-interactive tool execution
- `packages/core/src/tools/tool-registry.ts` - Tool discovery and registration
- `packages/cli/src/ui/hooks/useReactToolScheduler.ts` - Interactive tool scheduling

### Integration Points

Three critical locations for filtering:

1. **File Modification Tools** (HIGHEST PRIORITY):
   - **`edit.ts`**: Filter `old_string` and `new_string` parameters
   - **`write-file.ts`**: Filter `content` parameter
   - **`replace.ts`**: Filter replacement strings
   - This prevents emojis from being injected into code files
   - In `error` mode, block tool execution entirely
   - In `warn` mode, execute with filtered params then notify LLM

2. **General Tool Input Filtering** (line 77 in `nonInteractiveToolExecutor.ts`):
   - Before `tool.buildAndExecute(toolCallRequest.args)`
   - Filter ALL tool arguments to remove/convert emojis
   - Special handling for file modification tools

3. **Tool Output Filtering** (line 131 in `nonInteractiveToolExecutor.ts`):
   - After tool execution, before `resultDisplay`
   - Filter the display output for user presentation
   - Does NOT affect actual file content written

### Technical Approach for File Safety

1. **Create specialized filtering for file tools:**
   ```typescript
   // In EmojiFilter class
   filterFileContent(content: string, mode: FilterMode): FilterResult {
     if (mode === 'error' && this.hasEmojis(content)) {
       return {
         filtered: null,
         error: 'Cannot write emojis to code files',
         blocked: true
       };
     }
     return {
       filtered: this.removeEmojis(content),
       error: null,
       blocked: false
     };
   }
   ```

2. **Hook into file modification tools:**
   - Intercept at parameter validation stage
   - Apply strict filtering to content being written
   - Return validation error in `error` mode

3. **Preserve file integrity:**
   - Never modify file reads (ReadFileTool output)
   - Only filter what's being written TO files
   - Maintain separate filtering for display vs file content

## 3. Configuration Management

### Current Architecture

Settings follow this hierarchy:

```
SettingsService (in-memory) → Config object → Components
```

Key files:
- `packages/core/src/settings/SettingsService.ts` - In-memory settings management
- `packages/core/src/config/config.ts` - Main configuration object
- `packages/cli/src/ui/commands/setCommand.ts` - `/set` command handler

### Integration Approach

1. **Settings Storage Structure:**
   ```typescript
   {
     "emojiFilter": {
       "mode": "auto" | "allowed" | "warn" | "error",
       "customConversions": {} // Future: user-defined conversions
     }
   }
   ```

2. **Configuration Flow:**
   - Default: Read from `settings.json` on startup
   - Session: `/set emojifilter [mode]` updates SettingsService
   - Profile: `/profile save` persists current settings

3. **Access Pattern:**
   ```typescript
   // In Config class
   getEmojiFilterMode(): string {
     const settingsService = this.getSettingsService();
     return settingsService.get('emojiFilter.mode') || 'auto';
   }
   ```

## File Changes Required

### New Files to Create

1. **`packages/core/src/filters/EmojiFilter.ts`**
   - Main filter implementation
   - Unicode range detection
   - Conversion mappings
   - Filter methods for text, tool args, and tool output

2. **`packages/core/src/filters/emoji-patterns.ts`**
   - Emoji regex patterns and ranges
   - Conversion mapping definitions
   - Unicode block definitions

3. **`packages/core/src/filters/types.ts`**
   - TypeScript interfaces for filter configuration
   - Filter mode enum
   - Conversion rule types

### Files to Modify

1. **`packages/cli/src/ui/hooks/useGeminiStream.ts`**
   - Add filter initialization
   - Apply filter in `processGeminiStreamEvents`
   - Handle `warn` mode system messages

2. **`packages/core/src/core/nonInteractiveToolExecutor.ts`**
   - Add filter for tool arguments
   - Add filter for tool output
   - Handle `error` mode blocking

3. **`packages/core/src/tools/edit.ts`** (CRITICAL)
   - Filter `old_string` and `new_string` before file modification
   - Block execution in `error` mode if emojis detected
   - Ensure no emojis written to files

4. **`packages/core/src/tools/write-file.ts`** (CRITICAL)
   - Filter `content` parameter before writing
   - Block execution in `error` mode if emojis detected
   - Protect codebase from emoji injection

5. **`packages/core/src/tools/replace.ts`** (CRITICAL)
   - Filter replacement strings
   - Same protection as edit.ts

6. **`packages/cli/src/ui/commands/setCommand.ts`**
   - Add `emojifilter` command handler
   - Validate mode values
   - Update SettingsService

7. **`packages/core/src/config/config.ts`**
   - Add `getEmojiFilterMode()` method
   - Add `setEmojiFilterMode()` method
   - Initialize filter configuration

8. **`packages/core/src/settings/types.ts`**
   - Add EmojiFilterSettings interface
   - Extend GlobalSettings type

## Technical Implementation Details

### Unicode Emoji Detection

Emojis span multiple Unicode blocks:
- Basic Latin supplements (U+2000-U+206F)
- Miscellaneous Symbols (U+2600-U+26FF)
- Emoticons (U+1F600-U+1F64F)
- Transport/Map Symbols (U+1F680-U+1F6FF)
- And many more...

Detection strategy:
1. Use comprehensive regex patterns for known emoji ranges
2. Check for emoji modifiers and sequences
3. Preserve functional characters (arrows, box drawing)

### Stream Processing

For streaming responses, maintain state across chunks:
```typescript
class StreamingEmojiFilter {
  private buffer: string = '';
  
  filterChunk(chunk: string): string {
    // Handle partial emoji sequences at chunk boundaries
    this.buffer += chunk;
    const { filtered, remainder } = this.processBuffer();
    this.buffer = remainder;
    return filtered;
  }
}
```

### Performance Considerations

1. **Regex Compilation**: Pre-compile all regex patterns on initialization
2. **Streaming Buffers**: Minimize buffer size for chunk processing
3. **Lazy Loading**: Only initialize filter when needed
4. **Caching**: Cache filtered results for repeated content

### Error Mode Implementation

In error mode, tool calls fail fast:
```typescript
if (mode === 'error' && hasEmojis(args)) {
  return {
    error: new Error('Emoji detected in tool arguments'),
    errorType: ToolErrorType.VALIDATION_ERROR,
    suggestion: 'Remove emojis from tool arguments and retry'
  };
}
```

### Warning Mode Implementation

For warn mode, provide feedback AFTER tool execution:
```typescript
// In tool executor, after successful execution
if (mode === 'warn' && emojiDetected) {
  // Return tool result with additional system message
  return {
    ...toolResult,
    systemFeedback: 'Emojis were detected and removed from your tool call. Please avoid using emojis in tool parameters.'
  };
}

// The system message gets injected into the conversation after the tool response
```

## Testing Strategy

### Unit Tests
- `EmojiFilter.test.ts` - Core filtering logic
- Test each mode independently
- Test edge cases (partial emojis, combined characters)

### Integration Tests
- Test with real provider streams
- Test tool execution pipeline
- Test configuration changes

### Files Needing Tests
1. `packages/core/src/filters/EmojiFilter.test.ts`
2. `packages/cli/src/ui/commands/setCommand.test.ts` (update)
3. `packages/core/src/core/nonInteractiveToolExecutor.test.ts` (update)

## Configuration Schema

### Settings.json Structure
```json
{
  "emojiFilter": {
    "mode": "auto",
    "customConversions": {
      "🔧": "[TOOL]",
      "📦": "[PACKAGE]"
    }
  }
}
```

### Profile Structure
```json
{
  "name": "professional",
  "settings": {
    "emojiFilter": {
      "mode": "error"
    }
  }
}
```

## Migration and Compatibility

1. **Default Behavior**: New installations default to `auto` mode
2. **Existing Users**: No breaking changes, feature is opt-in
3. **Profile Compatibility**: Existing profiles continue to work
4. **Settings Migration**: No migration needed, additive feature

## Performance Impact

Expected impact:
- **Stream Processing**: <1ms per chunk (regex is fast)
- **Tool Filtering**: <1ms per tool call
- **Memory**: ~10KB for compiled patterns and mappings
- **Overall**: Negligible impact on user experience

## Security Considerations

1. **No Code Execution**: Filter only processes strings, no eval()
2. **Input Validation**: Mode values are strictly validated
3. **Buffer Limits**: Streaming buffers have size limits
4. **No Network Calls**: All filtering is local

## Future Enhancements

1. **Custom Conversions**: User-defined emoji replacements
2. **Provider-Specific Modes**: Different modes per provider
3. **Contextual Filtering**: Different rules for code vs prose
4. **Emoji Metrics**: Track filtered emoji usage
5. **LLM Training**: Collect data to improve LLM behavior
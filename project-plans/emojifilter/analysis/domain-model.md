# Domain Analysis: Emoji Filter System

## Entity Relationships

### Core Entities

1. **EmojiFilter**
   - Singleton per session
   - Holds current configuration
   - Performs filtering operations
   - Tracks detection state

2. **FilterConfiguration**
   - Mode: allowed | auto | warn | error
   - Custom conversions map
   - Source: default | profile | session

3. **FilterResult**
   - Filtered text (or null if blocked)
   - Detection flag
   - Error message (if blocked)
   - System feedback (for warn mode)

4. **StreamProcessor**
   - Existing entity to be modified
   - Will hold EmojiFilter instance
   - Applies filter to chunks

5. **ToolExecutor**
   - Existing entity to be modified
   - Filters tool parameters
   - Handles blocking in error mode

## State Transitions

### Filter Mode States
```
ALLOWED -> AUTO -> WARN -> ERROR
   ^                           |
   |                           |
   +---------------------------+
```

### Filtering Process States
```
INPUT -> DETECT -> DECIDE -> FILTER -> OUTPUT
                     |
                     v
                   BLOCK (error mode only)
```

### Configuration Priority
```
DEFAULT -> PROFILE_LOADED -> SESSION_OVERRIDE
```

## Business Rules

### Detection Rules
1. Emojis are identified using Unicode ranges
2. Functional characters (arrows, bullets) are not emojis
3. Detection happens before any filtering
4. Detection state is tracked for feedback

### Filtering Rules
1. In ALLOWED mode: No filtering occurs
2. In AUTO mode: Silent conversion/removal
3. In WARN mode: Same as AUTO + feedback after execution
4. In ERROR mode: Block execution if emojis detected

### Conversion Rules
1. Useful emojis get text replacements
2. Decorative emojis are removed entirely
3. Custom conversions override defaults
4. Conversions are consistent across modes (except allowed)

### File Protection Rules
1. File modification tools get strictest filtering
2. Content being written is always filtered (except allowed mode)
3. File reads are never filtered
4. Error mode blocks file operations entirely

### Configuration Rules
1. Session config overrides all others
2. Profile config overrides default when loaded
3. Changes take effect immediately
4. Invalid modes rejected with error

## Edge Cases

### Stream Processing
1. Emoji split across chunk boundaries
2. Empty chunks
3. Malformed Unicode sequences
4. Very large chunks (>1MB)

### Tool Execution
1. Nested emojis in complex objects
2. Emojis in array elements
3. Emojis in object keys (not just values)
4. Circular references in parameters

### Configuration
1. Invalid mode values
2. Missing configuration
3. Corrupt settings file
4. Profile not found

### Unicode Edge Cases
1. Emoji modifiers (skin tones)
2. Combined emoji sequences
3. Zero-width joiners
4. Regional indicator symbols
5. Variation selectors

## Error Scenarios

### Configuration Errors
1. Invalid mode: Return error, keep current mode
2. Settings write failure: Log warning, continue with session config
3. Profile load failure: Fall back to default

### Filtering Errors
1. Regex compilation failure: Disable filtering, log error
2. Stack overflow in regex: Truncate input, log warning
3. Memory exhaustion: Reset filter, continue

### Tool Execution Errors
1. Block in error mode: Return structured error to LLM
2. Filter failure: Allow execution with warning
3. Timeout in filtering: Skip filtering, log warning

### Integration Errors
1. Settings service unavailable: Use in-memory config
2. Stream processor error: Pass through unfiltered
3. Tool executor error: Log and continue

## Performance Considerations

### Caching Strategy
1. Pre-compile all regex patterns at startup
2. Cache filter instance per session
3. Reuse conversion mappings

### Stream Buffering
1. Maintain small buffer for chunk boundaries
2. Flush buffer on stream end
3. Limit buffer size to prevent memory issues

### Optimization Points
1. Short-circuit on allowed mode
2. Check for common emojis first
3. Batch process tool parameters

## Security Considerations

1. No code execution in patterns
2. Regex patterns are DoS-resistant
3. Input size limits enforced
4. No external dependencies
5. Sanitize error messages

## Testing Strategies

### Unit Testing
1. Each emoji conversion
2. Mode transitions
3. Configuration precedence
4. Edge case handling

### Integration Testing
1. Stream processing with real providers
2. Tool execution with filtering
3. Configuration persistence
4. Profile loading

### Property-Based Testing
1. Any valid Unicode input
2. Random configuration changes
3. Concurrent filtering operations
4. Large input fuzzing
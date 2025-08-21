# Debug Logging System Domain Analysis

## Entity Relationships

### Core Entities

1. **DebugLogger**
   - Central logger instance per namespace
   - Wraps debug package functionality
   - Provides lazy evaluation
   - Manages output routing

2. **ConfigurationManager**
   - Manages settings hierarchy
   - Merges configurations from multiple sources
   - Handles ephemeral vs persistent settings
   - Notifies loggers of configuration changes

3. **FileOutput**
   - Handles file writing operations
   - Manages log rotation
   - Implements async I/O
   - Maintains file handles pool

4. **NamespaceFilter**
   - Evaluates namespace patterns
   - Manages wildcard matching
   - Caches compiled patterns
   - Determines logger enablement

## State Transitions

### Logger State
```
UNINITIALIZED → CONFIGURED → ENABLED/DISABLED → LOGGING → ROTATING → CLOSED
```

### Configuration State
```
DEFAULT → ENV_LOADED → USER_CONFIG_LOADED → PROJECT_CONFIG_LOADED → 
CLI_OVERRIDE → EPHEMERAL_CHANGE → PERSISTED
```

### File Output State
```
CLOSED → OPENING → READY → WRITING → ROTATING → CLOSING → CLOSED
```

## Business Rules

### Configuration Precedence
1. CLI flags override everything
2. Environment variables override config files
3. User config overrides project config
4. Project config overrides defaults
5. Ephemeral changes don't persist unless explicitly saved

### Namespace Matching
1. Exact matches have highest priority
2. Wildcards match hierarchically (llxprt:* matches llxprt:openai:tools)
3. Multiple patterns are OR'd together
4. Negative patterns (exclusions) override positive matches

### File Management
1. New file created daily or when size limit reached
2. Old files deleted after retention period
3. File writes are async and queued
4. Failed writes retry with exponential backoff
5. Graceful degradation to stderr on file system errors

### Performance Rules
1. Disabled loggers short-circuit immediately
2. Lazy evaluation functions only called if enabled
3. Namespace patterns compiled once and cached
4. String concatenation avoided when disabled
5. File writes batched for efficiency

## Edge Cases

### Configuration Edge Cases
- Circular config file references
- Invalid JSON in config files
- Missing config directories
- Permission denied on config files
- Conflicting namespace patterns
- Malformed namespace strings

### File Output Edge Cases  
- Disk full conditions
- File permission errors
- Directory doesn't exist
- Concurrent write attempts
- Log rotation during write
- Process termination during write
- Symbolic links in path
- Network file systems

### Runtime Edge Cases
- Configuration changes during logging
- Namespace changes mid-operation
- Memory pressure scenarios
- High-frequency logging
- Circular object references in log data
- Extremely long log messages
- Binary data in log content

## Error Scenarios

### Initialization Errors
- Debug package not found
- Invalid initial configuration
- File system not accessible
- Can't create output directory

### Runtime Errors
- File write failures
- Configuration reload failures
- Memory allocation failures
- Pattern compilation errors
- Async queue overflow

### Recovery Strategies
1. **File Write Failure**: Fall back to stderr
2. **Config Load Failure**: Use previous valid config
3. **Memory Pressure**: Drop old log entries
4. **Queue Overflow**: Apply backpressure
5. **Rotation Failure**: Continue writing to current file

## Security Considerations

### Sensitive Data
- API keys must be redacted
- Passwords must be masked
- Tokens must be filtered
- Personal information sanitized
- File paths normalized

### File Security
- Files created with 0600 permissions
- Directory created with 0700 permissions
- No following symbolic links
- Path traversal prevention
- Input sanitization for filenames

## Performance Characteristics

### Time Complexity
- Namespace check: O(1) with caching
- Pattern matching: O(n) where n = pattern segments
- File write: O(1) amortized with buffering
- Configuration merge: O(m) where m = config sources

### Space Complexity
- Logger instances: O(n) where n = unique namespaces
- Pattern cache: O(p) where p = unique patterns  
- Write buffer: O(b) configurable buffer size
- Configuration: O(1) single merged object

## Integration Touchpoints

### Provider Integration
- Each provider creates logger with specific namespace
- Providers check logger.enabled before expensive operations
- Tool calls logged with structured data
- Streaming chunks logged with sequence numbers
- Errors logged with full context

### CLI Integration
- Commands create loggers for their operations
- User input logged (with sanitization)
- Command execution tracked
- Performance metrics logged

### Service Integration
- Services log state transitions
- Memory operations logged
- Context switches tracked
- Tool scheduler decisions logged
# Debug Logging System Overview

## Current State

The codebase currently uses ad-hoc debug logging with no proper framework:
- `if (process.env.DEBUG) console.log(...)` scattered throughout
- All-or-nothing control (DEBUG=1 enables everything)
- No namespace filtering or log levels
- Inconsistent formatting across components
- String concatenation happens even when logging is disabled (performance impact)
- Difficult to debug specific issues without noise from unrelated components

## Why We Need Proper Logging

Unlike the original Gemini CLI (single provider, Google-controlled), LLxprt has unique requirements:
- **Multi-provider complexity** - Supporting many providers with different quirks
- **Active debugging** - Constantly investigating provider-specific issues
- **Community support** - Need users to provide detailed debug info
- **Complex interactions** - Tool calls, streaming, authentication flows across providers

## Recommended Solution: `debug` Package

The `debug` package is ideal for our needs:
- **Tiny footprint** (~6KB) - Won't bloat the CLI
- **Namespace-based filtering** - Enable specific components
- **Battle-tested** - Used by Express, Socket.io, and many others
- **Zero overhead when disabled** - No performance impact
- **Colored output** - Automatic color coding per namespace

### Example Namespace Control
```bash
DEBUG=llxprt:openai:* llxprt          # All OpenAI provider logs
DEBUG=llxprt:*:tools llxprt           # All tool-related logs
DEBUG=llxprt:gemini:*,llxprt:openai:streaming llxprt  # Mix and match
```

## Configuration Hierarchy

Debug configuration should be controllable at multiple levels (in priority order):

### 1. Command-line Flags (Highest Priority)
```bash
llxprt --debug="openai:*,gemini:tools"
```

### 2. Environment Variables
```bash
DEBUG="llxprt:*" llxprt
LLXPRT_DEBUG="openai:streaming" llxprt
```

### 3. User Configuration File
`~/.llxprt/settings.json`:
```json
{
  "debug": {
    "enabled": true,
    "namespaces": ["openai:*", "gemini:tools"],
    "level": "debug",
    "output": "stderr",
    "format": "pretty"
  }
}
```

### 4. Project Configuration
`.llxprt/config.json` in project root:
```json
{
  "debug": {
    "namespaces": ["*:tools", "*:auth"]
  }
}
```

### 5. Code Defaults (Lowest Priority)

## Advanced Configuration Features

### Namespace-Specific Settings
```json
{
  "debug": {
    "namespaces": {
      "openai:*": {
        "level": "trace",
        "includeTimestamp": true
      },
      "gemini:*": {
        "level": "error"
      },
      "*:tools": {
        "level": "debug",
        "maxDepth": 3,
        "truncate": 1000
      }
    }
  }
}
```

### Multiple Output Targets
```json
{
  "debug": {
    "outputs": [
      {
        "target": "file",
        "path": "~/.llxprt/logs/debug.log",
        "rotate": "daily",
        "namespaces": ["*:error", "*:warn"]
      },
      {
        "target": "console",
        "format": "pretty",
        "namespaces": ["openai:*"]
      }
    ]
  }
}
```

### Runtime Control
Users could dynamically control logging during a session:
```
/debug enable openai:*
/debug disable gemini:*
/debug level trace
/debug output file:debug.log
```

## Proposed Namespace Structure

Hierarchical namespaces for fine-grained control:

```
llxprt:openai:provider        # Main provider logic
llxprt:openai:streaming       # Streaming responses
llxprt:openai:tools           # Tool call handling
llxprt:openai:auth            # Authentication flow
llxprt:openai:errors          # Error handling

llxprt:gemini:provider
llxprt:gemini:streaming
llxprt:gemini:tools
llxprt:gemini:auth

llxprt:anthropic:provider
llxprt:anthropic:streaming
llxprt:anthropic:tools

llxprt:core:scheduler         # Tool scheduler
llxprt:core:memory            # Memory management
llxprt:core:context           # Context handling

llxprt:cli:commands           # CLI command processing
llxprt:cli:ui                 # UI rendering
```

## Settings Schema

```typescript
interface DebugSettings {
  enabled: boolean;
  namespaces: string[] | Record<string, NamespaceConfig>;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  format: 'pretty' | 'json' | 'compact';
  outputs: OutputConfig[];
  
  // Performance options
  lazyEvaluation: boolean;  // Don't evaluate log arguments unless enabled
  maxDepth: number;         // How deep to serialize objects
  truncate: number;         // Max string length
  
  // Privacy options
  redactPatterns: string[]; // Regex patterns to redact
  excludeKeys: string[];    // Object keys to never log (e.g., 'apiKey', 'token')
}

interface NamespaceConfig {
  level?: string;
  enabled?: boolean;
  includeTimestamp?: boolean;
  maxDepth?: number;
  truncate?: number;
}

interface OutputConfig {
  target: 'console' | 'file' | 'memory';
  path?: string;
  format?: 'pretty' | 'json' | 'compact';
  namespaces?: string[];
  rotate?: 'daily' | 'size' | 'never';
  maxSize?: string;  // e.g., "10MB"
}
```

## Benefits

### For Developers
- Save and share debug configurations
- Focus on specific issues without noise
- Different configs for different scenarios
- No need to modify code to add debug output

### For Users
- Enable debug output without restarting
- Provide detailed logs for bug reports
- Control verbosity per component
- Automatic log rotation and management

### For Support
- Ask users to enable specific namespaces
- Diagnose issues without code changes
- Capture detailed traces of specific flows
- Privacy controls for sensitive data

## Privacy and Security Considerations

- **Redaction patterns** - Automatically redact sensitive patterns (API keys, tokens)
- **Excluded keys** - Never log certain object properties
- **User control** - Users decide what gets logged
- **No default logging** - Opt-in only
- **Truncation** - Limit logged data size

## Performance Considerations

- **Zero overhead when disabled** - Use lazy evaluation
- **Namespace compilation** - Pre-compile patterns for fast matching
- **Selective serialization** - Only serialize what's needed
- **Memory limits** - Cap memory usage for in-memory logs
- **Async file writes** - Don't block on file I/O

## Migration Path

1. Keep existing `process.env.DEBUG` checks initially
2. Gradually replace with new logger calls
3. Maintain backward compatibility
4. Document namespace conventions
5. Provide migration guide for users

## Why Not Other Solutions?

- **Winston/Bunyan** - Too heavy for a CLI tool
- **Pino** - JSON-focused, not ideal for CLI output
- **Console.log** - No control, always evaluates arguments
- **Custom solution** - Maintenance burden, reinventing the wheel

The `debug` package with our configuration layer provides the perfect balance of simplicity, performance, and control for a CLI tool that needs sophisticated debugging capabilities.
# Driver Mode Design - Codex (Deepthinker) Proposal

## Overview

Driver Mode allows a parent agent to send stdin commands to LLxprt as if typed into the UI, while observing the normal rendered stdout UI. This enables automation, self-testing, and agent-to-agent control without requiring a structured protocol.

## Design Philosophy

1. **Minimal core**: Implement only what's needed for the feature to work
2. **Reuse existing infrastructure**: Leverage CommandService, TextBuffer, and InputPrompt
3. **No special protocol**: Human-readable UI output, no JSON events
4. **Clear multi-line rule**: Backslash continuation is simple and unambiguous

## Architecture

```
                    ┌──────────────────────────────────────┐
   stdin ──────────>│  useStdinDriver                      │
                    │    - readline (terminal: false)      │
                    │    - backslash continuation          │
                    │    - accumulate lines                │
                    │    - submit on non-continued line    │
                    └──────────────┬───────────────────────┘
                                   │ onSubmit(text)
                                   v
                    ┌──────────────────────────────────────┐
                    │  Existing Input Processing           │
                    │    - Slash command detection         │
                    │    - @include expansion              │
                    │    - Model invocation                │
                    └──────────────────────────────────────┘
                                   │
                                   v
                    ┌──────────────────────────────────────┐
   stdout <─────────│  Normal Ink UI Rendering             │
                    │    - Same output as interactive      │
                    └──────────────────────────────────────┘
```

## Implementation

### 1. Add --driver CLI Flag

**File**: `packages/cli/src/config/config.ts`

Add to CliArgs interface:
```typescript
driver?: boolean;
```

Add to yargs options:
```typescript
.option('driver', {
  type: 'boolean',
  description: 'Driver mode: accept commands from stdin, render UI to stdout',
})
```

### 2. Create useStdinDriver Hook

**File**: `packages/cli/src/ui/hooks/useStdinDriver.ts` (NEW)

```typescript
import { useEffect, useRef } from 'react';
import * as readline from 'readline';

interface StdinDriverConfig {
  enabled: boolean;
  onSubmit: (text: string) => void;
}

export function useStdinDriver({ enabled, onSubmit }: StdinDriverConfig): void {
  const buffer = useRef<string[]>([]);

  useEffect(() => {
    if (!enabled) return;

    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    const handleLine = (line: string): void => {
      if (line.endsWith('\\')) {
        // Continuation: strip backslash, accumulate
        buffer.current.push(line.slice(0, -1));
      } else {
        // Submit: join accumulated lines + current
        buffer.current.push(line);
        const fullInput = buffer.current.join('\n');
        buffer.current = [];
        onSubmit(fullInput);
      }
    };

    rl.on('line', handleLine);
    
    rl.on('close', () => {
      // Flush remaining buffer on stdin close
      if (buffer.current.length > 0) {
        onSubmit(buffer.current.join('\n'));
        buffer.current = [];
      }
    });

    return () => rl.close();
  }, [enabled, onSubmit]);
}
```

### 3. Integrate into App

**File**: `packages/cli/src/ui/AppContainer.tsx` (or appropriate container)

```typescript
import { useStdinDriver } from './hooks/useStdinDriver';

export function AppContainer({ driverMode, ...props }) {
  const handleSubmit = useCallback((text: string) => {
    // Same handler used by InputPrompt
    processUserInput(text);
  }, []);

  useStdinDriver({
    enabled: driverMode,
    onSubmit: handleSubmit,
  });

  // ... rest of component
}
```

### 4. Wire Flag in Entry Point

**File**: `packages/cli/src/gemini.tsx`

```typescript
const driverMode = argv.driver === true;

// Pass to UI initialization
await startInteractiveUI({
  ...config,
  driverMode,
});
```

### 5. Config Method (Optional)

**File**: `packages/core/src/Config.ts`

```typescript
private _driverMode = false;

setDriverMode(v: boolean): void {
  this._driverMode = v;
}

isDriverMode(): boolean {
  return this._driverMode;
}
```

## Multi-line Protocol

**Rule**: Line ending with `\` means "continue", line without means "submit".

```
# This is one submission:
Hello world

# This is one multi-line submission:
def hello():\
    print("world")

# This submits two things:
/help
/model list
```

**Edge case - literal backslash at end:**
```
Use double backslash: C:\\Users\\Name\\
```
Results in: `C:\Users\Name\`

## Key Design Decisions

### Why No DriverClient?

The DriverClient utility proposed in other designs is **out of scope** for the core feature:

1. **Separation of concerns**: The driver mode feature is about making LLxprt drivable, not about providing a client library
2. **Any language can drive**: Shell scripts, Python, Node.js, etc. can all pipe to stdin
3. **Reduces maintenance burden**: One less component to test and maintain
4. **Users can implement their own**: A simple spawn + readline is ~20 lines in any language

If a client is needed later, it can be added as a separate package or example.

### Why No JSON Mode?

1. **Issue requirement**: Explicitly states "see the UI output exactly as a human user would see it"
2. **Simplicity**: No need for structured parsing
3. **Debugging**: Human-readable output makes debugging easier
4. **Model-friendly**: LLMs are trained on text, not custom protocols

### Why Backslash Continuation?

1. **Familiar**: Same convention as shell, Makefiles, Python strings
2. **Unambiguous**: Clear rule, no special escape sequences needed
3. **Matches interactive**: Mirrors the Shift+Enter behavior in the UI

## ANSI Handling

The parent agent receives raw Ink output including ANSI escape codes. Options:

1. **Do nothing**: Many LLMs handle ANSI reasonably well
2. **Parent strips ANSI**: Simple regex in parent agent: `/\x1b\[[0-9;]*m/g`
3. **Future enhancement**: Add `--driver-clean` flag to strip ANSI at source

Recommendation: Do nothing in v1, let parent handle if needed.

## Synchronization

Parent must detect when LLxprt is ready for next command. Approaches:

1. **Wait for prompt character** (`>`) - Simple, usually works
2. **Wait for idle period** - No output for N ms
3. **Look for completion markers** - "Model response complete" etc.

This is the parent's responsibility, not the driver mode's.

## Testing Plan

### Unit Tests
```typescript
describe('useStdinDriver', () => {
  it('submits single line immediately', ...);
  it('accumulates lines with backslash continuation', ...);
  it('handles empty lines', ...);
  it('flushes buffer on stdin close', ...);
});
```

### Integration Tests
```bash
# Single command
echo "/help" | node scripts/start.js --driver --profile-load synthetic

# Multi-line
printf "Write a haiku about:\\\ncoding\\\nbugs" | node scripts/start.js --driver --profile-load synthetic

# Slash command then prompt
printf "/model list\nwrite hello world" | node scripts/start.js --driver --profile-load synthetic
```

### Self-driving Smoke Test
```typescript
// In test file
const child = spawn('node', ['scripts/start.js', '--driver', '--profile-load', 'synthetic']);
child.stdin.write('/help\n');
// Wait for output, verify help displayed
child.stdin.write('write a haiku\n');
// Wait for output, verify response
child.stdin.write('/quit\n');
```

## Files Changed

| File | Change |
|------|--------|
| `packages/cli/src/config/config.ts` | Add `--driver` flag |
| `packages/cli/src/ui/hooks/useStdinDriver.ts` | NEW - Core hook |
| `packages/cli/src/ui/AppContainer.tsx` | Integrate hook |
| `packages/cli/src/gemini.tsx` | Wire flag |
| `packages/core/src/Config.ts` | Optional: add methods |

## Platform Support

- **Linux**: [OK] Full support
- **macOS**: [OK] Full support  
- **Windows**: [ERROR] Not in scope (stdin pipe handling differs)

## Timeline

- Implementation: 2-3 days
- Testing: 1-2 days
- Documentation: 0.5 day
- **Total**: 3.5-5.5 days

## Summary

This design prioritizes simplicity and minimal surface area. The core feature is ~100 lines of new code plus wiring. No client library, no JSON mode, no Windows support - these can all be added later if needed. The goal is to ship something useful quickly that solves the stated problem.

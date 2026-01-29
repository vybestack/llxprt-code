# Driver Mode Design - Opus (Reviewer) Proposal

## Overview

Driver Mode enables an AI agent (or another LLxprt instance) to programmatically control the CLI by sending commands via stdin while observing the normal rendered UI on stdout.

## Design Principles

1. **Human-equivalent observation**: The driving agent sees exactly what a human would see
2. **Same command processing**: Stdin commands go through identical processing as interactive input
3. **Multi-line support**: Backslash continuation matches interactive behavior
4. **Self-testing capability**: LLxprt can drive/test another LLxprt instance

## Architecture

```
┌─────────────────┐     stdin      ┌─────────────────────────────────┐
│  Parent Agent   │ ─────────────> │  LLxprt (--driver mode)         │
│  (Claude/GPT/   │                │  ┌─────────────────────────────┐│
│   LLxprt/etc)   │ <───────────── │  │ useStdinDriver hook         ││
│                 │     stdout     │  │  - readline interface       ││
└─────────────────┘                │  │  - backslash continuation   ││
                                   │  │  - inject into TextBuffer   ││
                                   │  └─────────────────────────────┘│
                                   │  ┌─────────────────────────────┐│
                                   │  │ Normal Ink UI Rendering     ││
                                   │  │  - Same as interactive      ││
                                   │  └─────────────────────────────┘│
                                   └─────────────────────────────────┘
```

## Implementation Components

### 1. CLI Flag Addition

**File**: `packages/cli/src/config/config.ts`

```typescript
interface CliArgs {
  // ... existing args
  driver?: boolean;
}

// In yargs configuration:
.option('driver', {
  type: 'boolean',
  description: 'Enable driver mode for programmatic control via stdin',
  default: false,
})
```

### 2. Core Hook: useStdinDriver

**File**: `packages/cli/src/ui/hooks/useStdinDriver.ts` (NEW)

```typescript
import { useEffect, useRef } from 'react';
import * as readline from 'readline';

interface UseStdinDriverOptions {
  enabled: boolean;
  onSubmit: (text: string) => void;
  onLine?: (line: string) => void;
}

export function useStdinDriver({ enabled, onSubmit, onLine }: UseStdinDriverOptions) {
  const accumulatedLines = useRef<string[]>([]);
  const rlRef = useRef<readline.Interface | null>(null);

  useEffect(() => {
    if (!enabled) return;

    // Create readline interface on raw stdin
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false, // Important: not a TTY
    });
    rlRef.current = rl;

    rl.on('line', (line: string) => {
      onLine?.(line);

      // Check for backslash continuation
      if (line.endsWith('\\')) {
        // Remove trailing backslash, add line content with newline
        accumulatedLines.current.push(line.slice(0, -1));
      } else {
        // No continuation - submit accumulated + current line
        accumulatedLines.current.push(line);
        const fullText = accumulatedLines.current.join('\n');
        accumulatedLines.current = [];
        onSubmit(fullText);
      }
    });

    rl.on('close', () => {
      // stdin closed - could trigger /quit or graceful shutdown
      // Submit any remaining accumulated text
      if (accumulatedLines.current.length > 0) {
        const fullText = accumulatedLines.current.join('\n');
        accumulatedLines.current = [];
        onSubmit(fullText);
      }
    });

    return () => {
      rl.close();
      rlRef.current = null;
    };
  }, [enabled, onSubmit, onLine]);
}
```

### 3. Config Extension

**File**: `packages/core/src/Config.ts`

```typescript
class Config {
  private driverMode: boolean = false;

  isDriverMode(): boolean {
    return this.driverMode;
  }

  setDriverMode(enabled: boolean): void {
    this.driverMode = enabled;
  }
}
```

### 4. AppContainer Integration

**File**: `packages/cli/src/ui/AppContainer.tsx`

```typescript
import { useStdinDriver } from './hooks/useStdinDriver';

function AppContainer({ config, ...props }) {
  const [inputBuffer, setInputBuffer] = useState('');
  
  // Existing submit handler
  const handleSubmit = useCallback((text: string) => {
    // Process through command stack, slash commands, etc.
    processInput(text);
  }, [/* deps */]);

  // Driver mode hook - injects stdin into same flow
  useStdinDriver({
    enabled: config.isDriverMode(),
    onSubmit: handleSubmit,
  });

  // Rest of component...
}
```

### 5. Entry Point Wiring

**File**: `packages/cli/src/gemini.tsx`

```typescript
if (argv.driver) {
  config.setDriverMode(true);
}

// Still call startInteractiveUI - the hook handles stdin injection
await startInteractiveUI(config, ...);
```

### 6. DriverClient Utility (for parent agents)

**File**: `packages/cli/src/driver/DriverClient.ts` (NEW)

```typescript
import { spawn, ChildProcess } from 'child_process';

export class DriverClient {
  private child: ChildProcess | null = null;
  private outputBuffer: string[] = [];
  private maxBufferLines: number = 1000;

  async spawn(args: string[] = []): Promise<void> {
    this.child = spawn('node', ['scripts/start.js', '--driver', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      this.outputBuffer.push(...lines);
      // Trim buffer to max size
      if (this.outputBuffer.length > this.maxBufferLines) {
        this.outputBuffer = this.outputBuffer.slice(-this.maxBufferLines);
      }
    });

    this.child.stderr?.on('data', (chunk: Buffer) => {
      // Could log or handle errors
    });
  }

  sendCommand(command: string): void {
    if (!this.child?.stdin) throw new Error('Driver not spawned');
    this.child.stdin.write(command + '\n');
  }

  sendMultiline(lines: string[]): void {
    if (!this.child?.stdin) throw new Error('Driver not spawned');
    for (let i = 0; i < lines.length - 1; i++) {
      this.child.stdin.write(lines[i] + '\\\n');
    }
    this.child.stdin.write(lines[lines.length - 1] + '\n');
  }

  getRecentOutput(lineCount: number = 50): string[] {
    return this.outputBuffer.slice(-lineCount);
  }

  async waitForText(text: string, timeoutMs: number = 30000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const recent = this.outputBuffer.slice(-100).join('\n');
      if (recent.includes(text)) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  async waitForPrompt(timeoutMs: number = 30000): Promise<boolean> {
    // Wait for the ">" prompt indicating ready for input
    return this.waitForText('>', timeoutMs);
  }

  async close(): Promise<void> {
    this.sendCommand('/quit');
    await new Promise(r => setTimeout(r, 500));
    this.child?.kill();
    this.child = null;
  }
}
```

## Multi-line Input Protocol

**Backslash Continuation Rule:**
- Line ending with `\` → newline (continue accumulating)
- Line NOT ending with `\` → submit accumulated text

**Example:**
```
# Single line command
/help

# Multi-line prompt
Write a function that:\
- Takes two numbers\
- Returns their sum
```

Stdin receives:
```
/help
Write a function that:\
- Takes two numbers\
- Returns their sum
```

Processed as two submissions:
1. `/help`
2. `Write a function that:\n- Takes two numbers\n- Returns their sum`

## Timing and Synchronization

The parent agent must wait for command completion before sending the next command. Strategies:

1. **Wait for prompt**: Look for `>` character indicating ready state
2. **Wait for specific text**: Use `waitForText()` for expected output
3. **Fixed delay**: Simple but unreliable for long operations

## Edge Cases

1. **Literal backslash at EOL**: Use `\\` to get literal `\` at end of line
2. **Empty lines**: Accumulated and included in submission
3. **Stdin EOF**: Submit any accumulated text, then graceful shutdown
4. **Rapid input**: Queue-based processing prevents race conditions

## Security Considerations

- Driver mode inherits `--approval-mode` settings from CLI args
- No additional security bypass - tools still require confirmation if configured
- Parent agent is responsible for secure subprocess management

## Testing Strategy

1. **Unit tests**: `useStdinDriver` hook with mock stdin
2. **Integration tests**: 
   - `echo "/help" | node scripts/start.js --driver`
   - Multi-line input tests
3. **Self-driving test**: LLxprt drives LLxprt to verify end-to-end

## Platform Support

- **Mac/Linux**: Full support using readline on stdin pipe
- **Windows**: Not supported in initial implementation (can be added later with platform-specific handling)

## Estimated Timeline

- Phase 1 (MVP): 3-5 days
- Phase 2 (DriverClient): 2-3 days  
- Phase 3 (Polish/Testing): 2 days
- **Total**: 7-10 days

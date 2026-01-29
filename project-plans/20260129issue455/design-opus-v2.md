# Driver Mode Design - Opus v2 (Revised)

## Overview

Driver Mode allows a parent agent (or another LLxprt instance) to programmatically control LLxprt by sending commands via stdin while observing the normal rendered UI on stdout. This revision directly addresses the Codex critique concerns about stdin conflicts, incorrect file paths, input pipeline bypass, output synchronization brittleness, and multiline behavior divergence.

**Scope**: macOS/Linux only (Windows support out of scope).

---

## Critique Response Summary

| Concern | Resolution |
|---------|-----------|
| **Stdin/Ink conflict** | Disable Ink raw mode entirely in driver mode; use separate readline on cooked stdin |
| **Incorrect config location** | Use `packages/cli/src/config/config.ts` (CLI layer), not `packages/core/src/Config.ts` |
| **Input pipeline bypass** | Wire driver input through `handleUserInputSubmit` (same path as UI) |
| **Output synchronization brittle** | Use OSC markers for deterministic sync, not visual heuristics |
| **Multiline backslash protocol** | Align with paste behavior; document escape sequences |

---

## 1) Stdin / Ink Conflict Resolution

### Problem

Ink's `useStdin` hook (used in `KeypressContext.tsx` at line 623) calls `setRawMode(true)` on stdin and attaches a `'data'` listener. Adding a second readline interface creates contention. Additionally, raw mode cannot be enabled on non-TTY stdin (piped input), causing crashes.

### Solution: Mutually Exclusive Modes

**When `--driver` is enabled:**
1. **Skip Ink raw mode entirely** - pass a flag to prevent `KeypressContext` from calling `setRawMode(true)`
2. **Create a readline interface** on `process.stdin` in cooked (line) mode
3. **Ink UI still renders** but ignores keyboard input (read-only display mode)

**Key insight:** Driver mode is explicitly non-interactive. The parent agent controls input; the child displays output. There's no need for both input sources simultaneously.

### Implementation

**A) Add prop to disable Ink keyboard capture:**

```typescript
// packages/cli/src/ui/contexts/KeypressContext.tsx
export function KeypressProvider({
  children,
  config,
  debugKeystrokeLogging,
  inputEnabled = true,  // NEW PROP
}: {
  children: React.ReactNode;
  config?: Config;
  debugKeystrokeLogging?: boolean;
  inputEnabled?: boolean;  // NEW
}) {
  const { stdin, setRawMode } = useStdin();
  
  useEffect(() => {
    // Skip raw mode setup entirely if input is disabled
    if (!inputEnabled) return;
    
    const wasRaw = stdin.isRaw;
    if (wasRaw === false) {
      setRawMode(true);
    }
    // ... existing keyboard handling ...
  }, [inputEnabled, stdin, setRawMode, /* ... */]);
}
```

**B) New driver input hook:**

```typescript
// packages/cli/src/ui/hooks/useDriverInput.ts (NEW FILE)
import { useEffect, useRef } from 'react';
import * as readline from 'readline';

interface UseDriverInputOptions {
  enabled: boolean;
  onSubmit: (text: string) => void;
}

export function useDriverInput({ enabled, onSubmit }: UseDriverInputOptions) {
  const accumulatedLinesRef = useRef<string[]>([]);
  const onSubmitRef = useRef(onSubmit);
  
  // Keep callback ref stable
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  useEffect(() => {
    if (!enabled) return;
    
    // Check if stdin is a TTY - warn if so (unusual for driver mode)
    if (process.stdin.isTTY) {
      console.warn('[driver] Warning: stdin is a TTY. Driver mode works best with piped input.');
    }

    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,  // cooked mode
    });

    rl.on('line', (line: string) => {
      // Backslash continuation: line ending with unescaped \ continues
      if (line.endsWith('\\') && !line.endsWith('\\\\')) {
        accumulatedLinesRef.current.push(line.slice(0, -1));
      } else {
        // Handle escaped backslash at EOL
        const finalLine = line.endsWith('\\\\') 
          ? line.slice(0, -1)  // Remove one backslash, keep one
          : line;
        accumulatedLinesRef.current.push(finalLine);
        const fullText = accumulatedLinesRef.current.join('\n');
        accumulatedLinesRef.current = [];
        onSubmitRef.current(fullText);
      }
    });

    rl.on('close', () => {
      // stdin EOF - submit any remaining text
      if (accumulatedLinesRef.current.length > 0) {
        const fullText = accumulatedLinesRef.current.join('\n');
        accumulatedLinesRef.current = [];
        onSubmitRef.current(fullText);
      }
    });

    return () => rl.close();
  }, [enabled]);  // Note: onSubmit NOT in deps (use ref instead)
}
```

---

## 2) Correct Configuration File Paths

### Problem

The original design incorrectly referenced `packages/core/src/Config.ts` which doesn't exist. The config class is at `packages/core/src/config/config.ts` but CLI args are parsed in `packages/cli/src/config/config.ts`.

### Solution: Use CLI Layer for Driver Flag

| File | Purpose |
|------|---------|
| `packages/cli/src/config/config.ts` | Parse `--driver` CLI flag (yargs) |
| `packages/core/src/config/config.ts` | Store driver mode state on `Config` class |

**A) Add to CLI args interface:**

```typescript
// packages/cli/src/config/config.ts (around line 134)
export interface CliArgs {
  // ... existing args
  driver?: boolean;  // NEW
}
```

**B) Add to yargs configuration:**

```typescript
// packages/cli/src/config/config.ts (in parseArguments function, around line 360)
.option('driver', {
  type: 'boolean',
  description: 'Enable driver mode: accept stdin commands, output UI to stdout',
  default: false,
})
```

**C) Add to core Config class:**

```typescript
// packages/core/src/config/config.ts
export class Config {
  // ... existing fields
  private _driverMode: boolean = false;

  isDriverMode(): boolean {
    return this._driverMode;
  }

  setDriverMode(enabled: boolean): void {
    this._driverMode = enabled;
  }
}
```

---

## 3) Full Input Pipeline Integration

### Problem

The original design bypassed key processing steps: `useTodoPausePreserver`, `inputHistoryStore`, and slash command processing.

### Solution: Wire Through `handleUserInputSubmit`

The existing pipeline in `AppContainer.tsx` is:

```
User types → buffer.getText() → handleUserInputSubmit() 
  ↓
useTodoPausePreserver (clears todos unless paused)
  ↓
handleFinalSubmit (trims, adds to inputHistoryStore)
  ↓
submitQuery (slash command check → useGeminiStream)
```

**Driver mode MUST use the same entry point:** `handleUserInputSubmit`

```typescript
// packages/cli/src/ui/AppContainer.tsx

// Existing (line ~1610):
const { handleUserInputSubmit } = useTodoPausePreserver({
  controller: todoPauseController,
  updateTodos,
  handleFinalSubmit,
});

// NEW: Wire driver input to same handler
useDriverInput({
  enabled: config.isDriverMode(),
  onSubmit: handleUserInputSubmit,  // <-- Same function as UI
});
```

This ensures:
- [OK] Slash commands (`/help`, `/clear`, etc.) work
- [OK] Input history tracking works
- [OK] Todo pause preservation works
- [OK] Streaming/queue handling works
- [OK] All hooks execute in same order as interactive mode

---

## 4) Robust Output Synchronization

### Problem

Waiting for `>` prompt characters or line-splitting ANSI output is fragile:
- Ink redraws can split characters mid-stream
- ANSI sequences can appear anywhere
- Spinner animations create noise

### Solution: OSC (Operating System Command) Markers

OSC sequences are invisible to normal terminals but parseable by automation:

```
\x1b]9;LLXPRT_READY\x07     - Ready for input
\x1b]9;LLXPRT_BUSY\x07      - Processing started
\x1b]9;LLXPRT_DONE\x07      - Processing complete
\x1b]9;LLXPRT_PROMPT:<id>:<type>\x07  - Confirmation prompt
```

**A) Marker emission utility:**

```typescript
// packages/cli/src/ui/utils/driverMarkers.ts (NEW FILE)
const OSC_START = '\x1b]9;';
const OSC_END = '\x07';

export const DriverMarker = {
  READY: 'LLXPRT_READY',
  BUSY: 'LLXPRT_BUSY', 
  DONE: 'LLXPRT_DONE',
  PROMPT: 'LLXPRT_PROMPT',
} as const;

export function emitDriverMarker(
  marker: string,
  payload?: string,
  config?: { isDriverMode(): boolean }
): void {
  // Only emit in driver mode
  if (!config?.isDriverMode()) return;
  
  const content = payload ? `${marker}:${payload}` : marker;
  process.stdout.write(`${OSC_START}${content}${OSC_END}`);
}
```

**B) Integration points:**

```typescript
// When ready for input (AppContainer.tsx, after init):
emitDriverMarker(DriverMarker.READY, undefined, config);

// When submit starts (useGeminiStream.ts, submitQuery):
emitDriverMarker(DriverMarker.BUSY, undefined, config);

// When response completes (useGeminiStream.ts, after stream ends):
emitDriverMarker(DriverMarker.DONE, undefined, config);

// For tool confirmations (ToolApprovalUI or similar):
emitDriverMarker(DriverMarker.PROMPT, `${promptId}:confirm`, config);
```

---

## 5) Multiline Input Protocol

### Problem

The backslash continuation protocol wasn't fully specified, especially regarding:
- Literal backslashes at end of line
- Empty line handling
- Consistency with interactive paste behavior

### Solution: Explicit Protocol Definition

**Rules:**
1. Line ending with single `\` → continue accumulating (newline preserved)
2. Line ending with `\\` → literal backslash at EOL, then submit
3. Line NOT ending with `\` → submit accumulated + current line
4. Empty lines are preserved in accumulated content

**Examples:**

```bash
# Single line command
/help

# Result: "/help" submitted
```

```bash
# Multi-line prompt  
Write a function that:\
- Takes two numbers\
- Returns their sum

# Result: "Write a function that:\n- Takes two numbers\n- Returns their sum" submitted
```

```bash
# Literal backslash at EOL
The path is C:\\Users\\Name\\

# Result: "The path is C:\Users\Name\" submitted
```

```bash
# Preserved empty lines
First line\
\
Third line

# Result: "First line\n\nThird line" submitted
```

**Note on interactive equivalence:** In interactive mode, Shift+Enter creates newlines. The backslash protocol is the stdin equivalent. The key difference: interactive mode sees the full buffer before submit; driver mode accumulates line-by-line. This is acceptable because both result in the same final string being passed to `handleUserInputSubmit`.

---

## 6) Approval Mode / Tool Confirmation

### Problem

In suggest/confirm approval modes, tools prompt for y/n. How does a driver respond?

### Solution: OSC Prompt Markers + Response Protocol

**A) When a confirmation prompt appears:**

```typescript
emitDriverMarker(
  DriverMarker.PROMPT, 
  `${uuid}:confirm:${toolName}`, 
  config
);
```

**B) Driver responds via stdin:**

```
::respond <uuid> yes
::respond <uuid> no
::respond <uuid> always
```

The `::respond` prefix distinguishes prompt responses from regular input.

**C) Routing in useDriverInput:**

```typescript
rl.on('line', (line: string) => {
  if (line.startsWith('::respond ')) {
    const [_, id, response] = line.split(' ');
    handlePromptResponse(id, response);
    return;
  }
  // ... normal accumulation/submit logic
});
```

---

## 7) Entry Point Wiring

```typescript
// packages/cli/src/gemini.tsx (main entry point)

// After config is created and args parsed:
if (argv.driver) {
  config.setDriverMode(true);
}

// The UI still renders normally; driver hooks handle input
```

```typescript
// packages/cli/src/ui/App.tsx or AppWrapper rendering

<KeypressProvider
  config={config}
  debugKeystrokeLogging={settings.merged.debugKeystrokeLogging}
  inputEnabled={!config.isDriverMode()}  // Disable keyboard when driving
>
  {/* ... */}
</KeypressProvider>
```

---

## 8) DriverClient Utility (for testing/automation)

```typescript
// packages/cli/src/driver/DriverClient.ts (NEW FILE)
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export class DriverClient extends EventEmitter {
  private child: ChildProcess | null = null;
  private outputBuffer: string = '';
  
  async start(args: string[] = []): Promise<void> {
    this.child = spawn('node', ['scripts/start.js', '--driver', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      this.outputBuffer += text;
      this.parseMarkers(text);
    });
  }

  private parseMarkers(text: string): void {
    const markerRegex = /\x1b\]9;([^\x07]+)\x07/g;
    let match;
    while ((match = markerRegex.exec(text)) !== null) {
      const [marker, ...payload] = match[1].split(':');
      this.emit('marker', { marker, payload: payload.join(':') });
      
      if (marker === 'LLXPRT_READY') this.emit('ready');
      if (marker === 'LLXPRT_DONE') this.emit('done');
      if (marker === 'LLXPRT_PROMPT') this.emit('prompt', payload);
    }
  }

  send(text: string): void {
    if (!this.child?.stdin) throw new Error('Not started');
    this.child.stdin.write(text + '\n');
  }

  sendMultiline(lines: string[]): void {
    for (let i = 0; i < lines.length - 1; i++) {
      this.child?.stdin?.write(lines[i] + '\\\n');
    }
    this.child?.stdin?.write(lines[lines.length - 1] + '\n');
  }

  respondToPrompt(id: string, response: string): void {
    this.send(`::respond ${id} ${response}`);
  }

  async awaitReady(timeoutMs = 30000): Promise<void> {
    return this.awaitEvent('ready', timeoutMs);
  }

  async awaitDone(timeoutMs = 60000): Promise<void> {
    return this.awaitEvent('done', timeoutMs);
  }

  private awaitEvent(event: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
      this.once(event, () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  getOutput(): string {
    return this.outputBuffer;
  }

  async close(): Promise<void> {
    this.send('/quit');
    await new Promise(r => setTimeout(r, 500));
    this.child?.kill();
  }
}
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Parent Agent / Test Harness                                         │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  DriverClient                                                    ││
│  │  - spawn('llxprt --driver')                                     ││
│  │  - parse OSC markers                                            ││
│  │  - send(), awaitReady(), awaitDone()                            ││
│  └───────┬─────────────────────────────────────────────────────────┘│
└──────────│──────────────────────────────────────────────────────────┘
           │ stdin (text + ::respond commands)
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  LLxprt CLI (--driver mode)                                          │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  useDriverInput                                                 │ │
│  │  - readline.createInterface({ terminal: false })               │ │
│  │  - backslash continuation                                       │ │
│  │  - ::respond routing                                            │ │
│  └───────┬────────────────────────────────────────────────────────┘ │
│          │ onSubmit(text)                                            │
│          ▼                                                           │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  handleUserInputSubmit (same as UI!)                           │ │
│  │  ├─ useTodoPausePreserver                                      │ │
│  │  ├─ inputHistoryStore.addInput()                               │ │
│  │  └─ submitQuery()                                               │ │
│  │       ├─ slash command detection                                │ │
│  │       └─ useGeminiStream                                        │ │
│  └───────┬────────────────────────────────────────────────────────┘ │
│          │                                                           │
│          ▼                                                           │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Ink UI Rendering (read-only in driver mode)                   │ │
│  │  - KeypressProvider(inputEnabled=false)                        │ │
│  │  - Normal visual output + OSC markers                          │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
           │ stdout (ANSI UI + OSC markers)
           ▼
     Parent Agent parses output
```

---

## File Change Summary

| File | Change |
|------|--------|
| `packages/cli/src/config/config.ts` | Add `--driver` flag to yargs, update `CliArgs` interface |
| `packages/core/src/config/config.ts` | Add `_driverMode`, `isDriverMode()`, `setDriverMode()` to Config class |
| `packages/cli/src/ui/hooks/useDriverInput.ts` | **NEW** - Driver input hook with readline |
| `packages/cli/src/ui/utils/driverMarkers.ts` | **NEW** - OSC marker emission utilities |
| `packages/cli/src/ui/contexts/KeypressContext.tsx` | Add `inputEnabled` prop, skip raw mode when false |
| `packages/cli/src/ui/AppContainer.tsx` | Wire `useDriverInput` to `handleUserInputSubmit` |
| `packages/cli/src/gemini.tsx` | Set driver mode from argv |
| `packages/cli/src/driver/DriverClient.ts` | **NEW** - Test/automation helper |

---

## Testing Plan (TDD)

### Unit Tests

1. **useDriverInput hook:**
   - Single line submission
   - Backslash continuation (multi-line)
   - Escaped backslash at EOL
   - EOF handling
   - Callback stability (ref pattern)

2. **OSC marker parsing:**
   - DriverClient correctly extracts READY/BUSY/DONE/PROMPT
   - Markers don't interfere with visible output

3. **KeypressProvider inputEnabled:**
   - When false, no raw mode, no data listener

### Integration Tests

```typescript
// packages/cli/src/driver/DriverClient.test.ts
import { DriverClient } from './DriverClient.js';

describe('DriverClient', () => {
  it('should execute /help command', async () => {
    const driver = new DriverClient();
    await driver.start(['--profile-load', 'synthetic']);
    await driver.awaitReady();
    
    driver.send('/help');
    await driver.awaitDone();
    
    expect(driver.getOutput()).toContain('Available commands');
    await driver.close();
  });

  it('should handle multi-line prompt', async () => {
    const driver = new DriverClient();
    await driver.start(['--profile-load', 'synthetic']);
    await driver.awaitReady();
    
    driver.sendMultiline([
      'Write a haiku about:',
      'coding',
      'in the rain'
    ]);
    await driver.awaitDone();
    
    // Verify response was generated
    expect(driver.getOutput().length).toBeGreaterThan(100);
    await driver.close();
  });
});
```

### Manual Verification

```bash
# Basic command
echo "/help" | node scripts/start.js --driver --profile-load synthetic

# Multi-line
printf "Write about:\\\nthe moon" | node scripts/start.js --driver --profile-load synthetic

# Sequential commands
printf "/model list\nwrite hello world" | node scripts/start.js --driver --profile-load synthetic
```

---

## Open Questions Resolved

1. **Where to emit READY/BUSY/DONE?**
   - READY: After config init, in `AppContainer` `useEffect`
   - BUSY: Start of `submitQuery` in `useGeminiStream`
   - DONE: After stream completion in `useGeminiStream`

2. **Prompt ID format?**
   - UUID for uniqueness across concurrent prompts

3. **Should driver mode disable Ink input?**
   - Yes, always. Mixed mode adds complexity with no clear use case.

---

## Timeline Estimate

| Phase | Tasks | Days |
|-------|-------|------|
| 1 | CLI flag, Config methods, KeypressContext prop | 1 |
| 2 | useDriverInput hook, basic wiring | 2 |
| 3 | OSC markers, emit points | 1 |
| 4 | DriverClient utility | 1 |
| 5 | Testing, edge cases, documentation | 2 |
| **Total** | | **7 days** |

---

## Summary

This revised design:
- [OK] Avoids stdin/Ink conflict by disabling Ink keyboard when driving
- [OK] Uses correct file paths (`packages/cli/src/config/config.ts` for args)
- [OK] Routes driver input through `handleUserInputSubmit` (full pipeline)
- [OK] Uses OSC markers for deterministic synchronization
- [OK] Clearly specifies multiline backslash protocol with escape handling
- [OK] Keeps the implementation minimal while enabling comprehensive automation

# Driver Mode - Final Design (Issue 455)

## Core Philosophy

**The UI renders EXACTLY as it always does.** All decorations, ANSI codes, box drawing, spinners, prompts - everything stays the same. The driver (LLM or test harness) sees what a human sees and must parse real terminal output.

**No special protocols for prompts.** Approval prompts render normally. The driver sends "y" or "n" via stdin just like a human would type.

**Keep it simple.** No UUIDs, no `::respond` protocol, no prompt registry.

---

## Two Driver Modes

Driver mode supports two input styles:

| Mode | Flag | Use Case |
|------|------|----------|
| **Line Mode** | `--driver` | Complete lines via stdin for command execution |
| **Keystroke Mode** | `--driver --keystroke` | Individual key events for UI interaction |

**Line mode** is the default - each line from stdin is submitted as a complete user input. This is ideal for sending commands and prompts.

**Keystroke mode** sends raw key events to the UI, enabling testing of:
- Autocomplete (Tab, arrow keys, Enter to select)
- Scrolling (PageUp, PageDown, Home, End, arrow keys)
- Text editing (cursor movement, backspace, delete)

---

## What Changes

| Addition | Purpose |
|----------|---------|
| `--driver` flag | Enable driver mode (line input) |
| `--driver --keystroke` flag | Enable keystroke mode for UI testing |
| `--no-ansi` flag | Disable ANSI escape codes (default: ANSI on) |
| stdin line input | Accept commands from parent process |
| Zero-width Unicode markers | Invisible markers for automation timing |
| Disable Ink raw mode | Prevent stdin conflict |

## What Stays the Same

- All UI rendering (prompts, spinners, boxes, colors)
- Full input pipeline (slash commands, history, todo preservation)
- Approval prompts (render normally, user/driver types response)
- Error messages and formatting
- Everything a human would see

---

## Use Cases

### 1. LLMs Fixing UI Issues
An LLM needs to see the actual rendered UI to verify a fix worked:
```bash
echo "write a haiku" | node scripts/start.js --driver --no-ansi
```
The LLM can parse the plain text output and verify the fix.

### 2. Automated Testing
Tests that exercise real UI interactions:
```typescript
const driver = new DriverClient();
await driver.start(['--driver']);
await driver.awaitReady();
driver.send('/help');
await driver.awaitDone();
expect(driver.getOutput()).toContain('Available commands');
```

### 3. Agent-to-Agent Control
A parent LLxprt instance driving a child instance:
```bash
llxprt --driver << 'EOF'
Write a function that:
- Takes two numbers
- Returns their sum
EOF
```

---

## CLI Flags

### `--driver`
Enable driver mode (line input):
- Disable Ink keyboard capture (raw mode off)
- Accept input via stdin readline
- Emit zero-width Unicode sync markers

### `--keystroke`
Enable keystroke mode (requires `--driver`):
- Raw key events instead of line input
- Enables UI interaction testing (autocomplete, scroll)
- Keys sent as escape sequences or named keys

### `--no-ansi`
Disable ANSI escape sequences for plain text output:
- Default: ANSI codes enabled (colors, formatting)
- `--no-ansi`: Disable ANSI codes (plain text)

**Why?** LLMs may prefer `--no-ansi` for easier parsing.

---

## Stdin Input Protocol

### Basic Input
Each line from stdin is submitted as user input:
```bash
echo "/help" | node scripts/start.js --driver
```

### Multi-line Input
Backslash continuation for multi-line prompts:
```bash
printf "Write about:\\\nthe moon" | node scripts/start.js --driver
```

**Rules:**
- Line ending with `\` → continue (newline preserved)
- Line ending with `\\` → literal backslash, then submit
- Line without trailing `\` → submit

### Approval Prompts
The UI renders approval prompts normally. The driver responds via stdin:
```
Allow running: rm -rf ./temp
? (y/n): 
```
Driver sends `y` or `n` as a regular line - no special protocol needed.

---

## Keystroke Mode Input Protocol

Keystroke mode (`--driver --keystroke`) sends raw key events instead of complete lines.

### Key Sequences

The DriverClient maps key names to terminal escape sequences:

| Key | Escape Sequence | Description |
|-----|-----------------|-------------|
| `PageUp` | `\x1b[5~` | Scroll up one page |
| `PageDown` | `\x1b[6~` | Scroll down one page |
| `Home` | `\x1b[H` | Scroll to top |
| `End` | `\x1b[F` | Scroll to bottom |
| `ArrowUp` | `\x1b[A` | Move cursor/selection up |
| `ArrowDown` | `\x1b[B` | Move cursor/selection down |
| `ArrowRight` | `\x1b[C` | Move cursor right |
| `ArrowLeft` | `\x1b[D` | Move cursor left |
| `Tab` | `	` | Trigger autocomplete / cycle options |
| `Enter` | `` | Submit / select |
| `Escape` | `\x1b` | Cancel / close menu |
| `Backspace` | `\x7f` | Delete character before cursor |
| `Delete` | `\x1b[3~` | Delete character at cursor |
| `Ctrl+C` | `\x03` | Interrupt |
| `Ctrl+D` | `\x04` | EOF / exit |
| `Ctrl+L` | `\x0c` | Clear screen |

### Use Cases

**Autocomplete Testing:**
```typescript
// Type partial command
driver.sendText('/he');
await driver.awaitIdle(100);

// Trigger autocomplete
driver.sendKey('Tab');
await driver.awaitIdle(200);

// Navigate menu
driver.sendKey('ArrowDown');
driver.sendKey('ArrowDown');

// Select option
driver.sendKey('Enter');
```

**Scroll Testing:**
```typescript
// Generate long output
driver.sendText('/help');
driver.sendKey('Enter');
await driver.awaitDone();

// Test scroll navigation
driver.sendKey('PageDown');
await driver.awaitIdle(100);

driver.sendKey('End');
await driver.awaitIdle(100);

driver.sendKey('Home');
await driver.awaitIdle(100);
```

**Text Editing:**
```typescript
// Type some text
driver.sendText('hello world');
await driver.awaitIdle(50);

// Move cursor left 5 characters
for (let i = 0; i < 5; i++) {
  driver.sendKey('ArrowLeft');
}

// Delete 'world' and type 'there'
for (let i = 0; i < 5; i++) {
  driver.sendKey('Delete');
}
driver.sendText('there');
// Result: 'hello there'
```

### Implementation: useKeystrokeInput Hook

```typescript
// packages/cli/src/ui/hooks/useKeystrokeInput.ts
import { useEffect, useRef } from 'react';

interface UseKeystrokeInputOptions {
  enabled: boolean;
  onKey: (key: string, data: Buffer) => void;
}

export function useKeystrokeInput({ enabled, onKey }: UseKeystrokeInputOptions) {
  const onKeyRef = useRef(onKey);
  useEffect(() => { onKeyRef.current = onKey; }, [onKey]);

  useEffect(() => {
    if (!enabled) return;
    
    // Put stdin in raw mode to get individual keystrokes
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    
    const handler = (data: Buffer) => {
      const key = parseKeyFromBuffer(data);
      onKeyRef.current(key, data);
    };
    
    process.stdin.on('data', handler);
    
    return () => {
      process.stdin.off('data', handler);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
    };
  }, [enabled]);
}

function parseKeyFromBuffer(data: Buffer): string {
  const str = data.toString();
  
  // Map escape sequences back to key names
  const REVERSE_MAP: Record<string, string> = {
    '\x1b[5~': 'PageUp',
    '\x1b[6~': 'PageDown',
    '\x1b[H':  'Home',
    '\x1b[F':  'End',
    '\x1b[A':  'ArrowUp',
    '\x1b[B':  'ArrowDown',
    '\x1b[C':  'ArrowRight',
    '\x1b[D':  'ArrowLeft',
    '	':      'Tab',
    '':      'Enter',
    '\x1b':    'Escape',
    '\x7f':    'Backspace',
    '\x1b[3~': 'Delete',
    '\x03':    'Ctrl+C',
    '\x04':    'Ctrl+D',
  };
  
  return REVERSE_MAP[str] ?? str;
}
```

---

## Sync Markers (Zero-Width Unicode)

Instead of OSC sequences, we use zero-width Unicode characters that are visually invisible but parseable:

| Marker | Sequence | Purpose |
|--------|----------|---------|
| `READY` | `\u200B\u200B\u200B\u200B` | Ready for input (4× ZWSP) |
| `BUSY` | `\u200C\u200C\u200C\u200C` | Processing started (4× ZWNJ) |
| `DONE` | `\u200D\u200D\u200D\u200D` | Processing complete (4× ZWJ) |

**Why zero-width Unicode instead of OSC?**
- Survives piping through tools that strip ANSI codes
- Works with `--no-ansi` mode
- Invisible in terminals but searchable in output
- No terminal-specific escape sequence handling needed

**Only emitted when `--driver` is set.** The sequences appear after prompts (READY) and after responses (DONE).

### Marker Emission

```typescript
// In driverMarkers.ts
const MARKERS = {
  READY: '\u200B\u200B\u200B\u200B',  // Zero-Width Space ×4
  BUSY:  '\u200C\u200C\u200C\u200C',  // Zero-Width Non-Joiner ×4
  DONE:  '\u200D\u200D\u200D\u200D',  // Zero-Width Joiner ×4
};

export function emitDriverMarker(
  marker: 'READY' | 'BUSY' | 'DONE',
  config?: { isDriverMode(): boolean }
): void {
  if (!config?.isDriverMode()) return;
  process.stdout.write(MARKERS[marker]);
}
```

### Emission Points

| Marker | Location | Trigger |
|--------|----------|---------|
| `READY` | `AppContainer.tsx` | After initialization completes |
| `BUSY` | `submitQuery()` | When user input is submitted |
| `DONE` | Stream completion | When LLM response finishes |

---

## Implementation

### 1. CLI Config (`packages/cli/src/config/config.ts`)

Add to yargs:
```typescript
.option('driver', {
  type: 'boolean',
  description: 'Enable driver mode for stdin control',
  default: false,
})
.option('keystroke', {
  type: 'boolean',
  description: 'Enable keystroke mode (requires --driver)',
  default: false,
})
.option('no-ansi', {
  type: 'boolean', 
  description: 'Disable ANSI escape codes',
  default: false,
})
```

### 2. Core Config (`packages/core/src/config/config.ts`)

Add state:
```typescript
private _driverMode: boolean = false;
private _keystrokeMode: boolean = false;
private _noAnsi: boolean = false;

isDriverMode(): boolean { return this._driverMode; }
setDriverMode(enabled: boolean): void { this._driverMode = enabled; }

isKeystrokeMode(): boolean { return this._keystrokeMode; }
setKeystrokeMode(enabled: boolean): void { this._keystrokeMode = enabled; }

isNoAnsi(): boolean { return this._noAnsi; }
setNoAnsi(enabled: boolean): void { this._noAnsi = enabled; }
```

### 3. Driver Input Hook (`packages/cli/src/ui/hooks/useDriverInput.ts`)

New file:
```typescript
import { useEffect, useRef } from 'react';
import * as readline from 'readline';

interface UseDriverInputOptions {
  enabled: boolean;
  onSubmit: (text: string) => void;
}

export function useDriverInput({ enabled, onSubmit }: UseDriverInputOptions) {
  const accumulatedRef = useRef<string[]>([]);
  const onSubmitRef = useRef(onSubmit);
  
  useEffect(() => { onSubmitRef.current = onSubmit; }, [onSubmit]);

  useEffect(() => {
    if (!enabled) return;
    
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    rl.on('line', (line: string) => {
      if (line.endsWith('\\') && !line.endsWith('\\\\')) {
        accumulatedRef.current.push(line.slice(0, -1));
      } else {
        const finalLine = line.endsWith('\\\\') 
          ? line.slice(0, -1) 
          : line;
        accumulatedRef.current.push(finalLine);
        const text = accumulatedRef.current.join('\n');
        accumulatedRef.current = [];
        onSubmitRef.current(text);
      }
    });

    rl.on('close', () => {
      if (accumulatedRef.current.length > 0) {
        onSubmitRef.current(accumulatedRef.current.join('\n'));
        accumulatedRef.current = [];
      }
    });

    return () => rl.close();
  }, [enabled]);
}
```

### 4. Zero-Width Markers (`packages/cli/src/ui/utils/driverMarkers.ts`)

New file:
```typescript
const MARKERS = {
  READY: '\u200B\u200B\u200B\u200B',  // Zero-Width Space ×4
  BUSY:  '\u200C\u200C\u200C\u200C',  // Zero-Width Non-Joiner ×4
  DONE:  '\u200D\u200D\u200D\u200D',  // Zero-Width Joiner ×4
};

export function emitDriverMarker(
  marker: 'READY' | 'BUSY' | 'DONE',
  config?: { isDriverMode(): boolean }
): void {
  if (!config?.isDriverMode()) return;
  process.stdout.write(MARKERS[marker]);
}
```

### 5. KeypressContext Changes

Add `inputEnabled` prop to disable raw mode:
```typescript
export function KeypressProvider({
  children,
  inputEnabled = true,  // NEW
  // ... other props
}) {
  useEffect(() => {
    if (!inputEnabled) return;  // Skip raw mode setup
    // ... existing raw mode logic
  }, [inputEnabled, /* ... */]);
}
```

### 6. AppContainer Integration

Wire driver input to existing submit pipeline:
```typescript
// Use the SAME handler as interactive UI
const { handleUserInputSubmit } = useTodoPausePreserver({
  controller: todoPauseController,
  updateTodos,
  handleFinalSubmit,
});

// Driver mode uses the same entry point
useDriverInput({
  enabled: config.isDriverMode(),
  onSubmit: handleUserInputSubmit,
});
```

---

## DriverClient Utility

For tests and automation, supporting both line and keystroke modes:

```typescript
// packages/cli/src/driver/DriverClient.ts
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// Key name to escape sequence mapping
const KEY_SEQUENCES: Record<string, string> = {
  // Navigation
  'PageUp':    '\x1b[5~',
  'PageDown':  '\x1b[6~',
  'Home':      '\x1b[H',
  'End':       '\x1b[F',
  'ArrowUp':   '\x1b[A',
  'ArrowDown': '\x1b[B',
  'ArrowRight':'\x1b[C',
  'ArrowLeft': '\x1b[D',
  // Editing
  'Tab':       '\t',
  'Enter':     '\r',
  'Escape':    '\x1b',
  'Backspace': '\x7f',
  'Delete':    '\x1b[3~',
  // Ctrl combinations
  'Ctrl+C':    '\x03',
  'Ctrl+D':    '\x04',
  'Ctrl+L':    '\x0c',
};

// Zero-width Unicode markers
const MARKERS = {
  READY: '\u200B\u200B\u200B\u200B',
  BUSY:  '\u200C\u200C\u200C\u200C',
  DONE:  '\u200D\u200D\u200D\u200D',
};

export class DriverClient extends EventEmitter {
  private child: ChildProcess | null = null;
  private output = '';
  private keystrokeMode: boolean;

  constructor(options: { keystroke?: boolean } = {}) {
    super();
    this.keystrokeMode = options.keystroke ?? false;
  }

  async start(args: string[] = []): Promise<void> {
    const driverArgs = ['--driver'];
    if (this.keystrokeMode) {
      driverArgs.push('--keystroke');
    }
    
    this.child = spawn('node', ['scripts/start.js', ...driverArgs, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, COLUMNS: '120', LINES: '40' },
    });

    this.child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      this.output += text;
      this.parseMarkers(text);
    });
  }

  private parseMarkers(text: string): void {
    if (text.includes(MARKERS.READY)) this.emit('ready');
    if (text.includes(MARKERS.BUSY)) this.emit('busy');
    if (text.includes(MARKERS.DONE)) this.emit('done');
  }

  // Line mode: send a complete line
  sendLine(text: string): void {
    if (this.keystrokeMode) {
      throw new Error('Use sendText() and sendKey() in keystroke mode');
    }
    this.child?.stdin?.write(text + '\n');
  }

  // Keystroke mode: send raw text character by character
  sendText(text: string): void {
    if (!this.keystrokeMode) {
      throw new Error('Use sendLine() in line mode');
    }
    this.child?.stdin?.write(text);
  }

  // Keystroke mode: send a named key
  sendKey(key: keyof typeof KEY_SEQUENCES): void {
    if (!this.keystrokeMode) {
      throw new Error('Use sendLine() in line mode');
    }
    const seq = KEY_SEQUENCES[key];
    if (!seq) {
      throw new Error(`Unknown key: ${key}`);
    }
    this.child?.stdin?.write(seq);
  }

  // Keystroke mode: send raw escape sequence
  sendRaw(sequence: string): void {
    this.child?.stdin?.write(sequence);
  }

  // Wait for UI to stabilize after keystrokes
  async awaitIdle(ms = 100): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  awaitReady(timeout = 30000): Promise<void> {
    return this.awaitEvent('ready', timeout);
  }

  awaitDone(timeout = 60000): Promise<void> {
    return this.awaitEvent('done', timeout);
  }

  awaitBusy(timeout = 5000): Promise<void> {
    return this.awaitEvent('busy', timeout);
  }

  private awaitEvent(event: string, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout: ${event}`)), timeout);
      this.once(event, () => { clearTimeout(timer); resolve(); });
    });
  }

  getOutput(): string { return this.output; }
  
  clearOutput(): void { this.output = ''; }
  
  async close(): Promise<void> {
    if (this.keystrokeMode) {
      this.sendKey('Ctrl+D');
    } else {
      this.sendLine('/quit');
    }
    this.child?.kill();
  }
}
```

---

## File Summary

| File | Change |
|------|--------|
| `packages/cli/src/config/config.ts` | Add `--driver`, `--keystroke`, `--no-ansi` flags |
| `packages/core/src/config/config.ts` | Add driver/keystroke/noAnsi mode state |
| `packages/cli/src/ui/hooks/useDriverInput.ts` | **NEW** - stdin readline hook (line mode) |
| `packages/cli/src/ui/hooks/useKeystrokeInput.ts` | **NEW** - raw stdin handler (keystroke mode) |
| `packages/cli/src/ui/utils/driverMarkers.ts` | **NEW** - Zero-width Unicode marker emission |
| `packages/cli/src/ui/contexts/KeypressContext.tsx` | Add `inputEnabled` prop |
| `packages/cli/src/ui/AppContainer.tsx` | Wire useDriverInput/useKeystrokeInput, emit markers |
| `packages/cli/src/driver/DriverClient.ts` | **NEW** - Test helper with dual mode support |

---

## Testing

### Manual Verification
```bash
# Basic command (line mode)
echo "/help" | node scripts/start.js --driver --no-ansi --profile-load synthetic

# Multi-line
printf "Write about:\\\nthe moon" | node scripts/start.js --driver --profile-load synthetic

# Interactive approval (if applicable)
printf "create a file test.txt\ny\n" | node scripts/start.js --driver --profile-load synthetic
```

### Unit Tests
- `useDriverInput`: line submission, backslash continuation, EOF handling
- `useKeystrokeInput`: key event handling, escape sequence parsing
- Zero-width marker parsing in DriverClient
- `KeypressContext` with `inputEnabled=false`

### Integration Tests (Line Mode)
```typescript
it('executes /help command', async () => {
  const driver = new DriverClient();
  await driver.start(['--profile-load', 'synthetic']);
  await driver.awaitReady();
  driver.sendLine('/help');
  await driver.awaitDone();
  expect(driver.getOutput()).toContain('Available commands');
  await driver.close();
});
```

### Integration Tests (Keystroke Mode)
```typescript
it('scrolls through long content with PageDown', async () => {
  const driver = new DriverClient({ keystroke: true });
  await driver.start(['--profile-load', 'synthetic']);
  await driver.awaitReady();
  
  // Type a command that produces long output
  driver.sendText('/help');
  driver.sendKey('Enter');
  await driver.awaitDone();
  
  const outputBefore = driver.getOutput();
  driver.clearOutput();
  
  // Scroll down
  driver.sendKey('PageDown');
  await driver.awaitIdle(200);
  
  const outputAfter = driver.getOutput();
  // Verify scroll happened (output changed)
  expect(outputAfter).not.toBe('');
  
  await driver.close();
});

it('uses autocomplete with Tab and arrows', async () => {
  const driver = new DriverClient({ keystroke: true });
  await driver.start(['--profile-load', 'synthetic']);
  await driver.awaitReady();
  
  // Type partial command
  driver.sendText('/he');
  await driver.awaitIdle(100);
  
  // Trigger autocomplete
  driver.sendKey('Tab');
  await driver.awaitIdle(200);
  
  // Should show autocomplete menu with /help
  expect(driver.getOutput()).toContain('help');
  
  // Navigate and select
  driver.sendKey('ArrowDown');
  await driver.awaitIdle(50);
  driver.sendKey('Enter');
  await driver.awaitDone();
  
  expect(driver.getOutput()).toContain('Available commands');
  await driver.close();
});
```

---

## Timeline

| Phase | Work | Days |
|-------|------|------|
| 1 | CLI flags, Config changes | 0.5 |
| 2 | useDriverInput hook (line mode) | 1 |
| 3 | useKeystrokeInput hook (keystroke mode) | 1 |
| 4 | KeypressContext inputEnabled | 0.5 |
| 5 | Zero-width markers + emission points | 0.5 |
| 6 | Wire everything in AppContainer | 0.5 |
| 7 | DriverClient utility (dual mode) | 0.5 |
| 8 | Testing + edge cases | 1.5 |
| **Total** | | **6 days** |

---

## What We're NOT Doing (MVP)

- **No** JSON event protocol
- **No** UUID-based prompt tracking
- **No** `::respond` or special command prefixes
- **No** Prompt registry
- **No** stdinMux multiplexer (overkill - just disable Ink input)
- **No** Windows support (out of scope)
- **No** Any changes to how the UI renders

### Deferred to Post-MVP

These features require more complex handling and are deferred:

| Feature | Reason |
|---------|--------|
| Mouse wheel scrolling | Requires terminal mouse reporting mode |
| Mouse text selection and copy | Requires mouse tracking and clipboard integration |
| Scrollbar thumb dragging | Requires precise mouse coordinate handling |
| Variable terminal sizes | Current MVP uses fixed 120×40 |

---

## Summary

Driver mode is simple:
1. Add `--driver` flag (line mode) and `--driver --keystroke` (keystroke mode)
2. Disable Ink keyboard input
3. Accept stdin lines via readline (line mode) or raw key events (keystroke mode)
4. Route to existing input handlers
5. Add invisible zero-width Unicode markers for sync
6. Add `--ansi`/`--no-ansi` for output control
7. Default to 120 columns terminal width

The UI renders exactly as before. The driver sees what a human sees. Approval prompts work naturally - just send "y" or "n" via stdin.

**Line mode** is for sending complete commands and prompts.
**Keystroke mode** is for testing UI interactions like autocomplete, scrolling, and text editing.

---

## Appendix A: TTY Detection and Full UI Rendering in Driver Mode

### The Concern

When stdout is piped (not a TTY), Ink and other terminal libraries may behave differently:
- `process.stdout.isTTY` returns `undefined` when piped
- `process.stdout.columns` and `process.stdout.rows` are `undefined`
- Raw mode (`setRawMode`) may not be available on stdin

This could cause the UI to render differently than what a human sees, violating the core requirement that driver mode produces **identical output**.

### Current Ink Behavior (Non-TTY)

Based on code analysis of Ink v6.x:

1. **Terminal Width Fallback**: We override Ink's default to use 120 columns in driver mode:
   ```javascript
   // In driver mode, we set COLUMNS=120 via environment
   // This provides more realistic testing than the default 80
   const terminalWidth = this.options.stdout.columns || 120;
   ```

2. **No TTY-Specific Rendering Changes**: Ink does NOT disable features when stdout is not a TTY. The core rendering logic (Flexbox via Yoga, ANSI codes via chalk) operates identically.

3. **Debug Mode Behavior**: Ink's `debug: true` option causes each frame to be output without clearing previous frames - this is independent of TTY status.

4. **CI Detection**: Ink checks `is-in-ci` to modify some behavior, but this affects output batching, not the actual rendered content.

### Solution: Force TTY-Like Behavior in Driver Mode

To guarantee identical rendering regardless of stdout being a pipe:

#### 1. Set Environment Variables Before Render

```typescript
// In gemini.tsx or before render()
if (config.isDriverMode()) {
  // Force chalk/ANSI to respect our --ansi/--no-ansi flags
  if (config.getAnsiMode() === 'on') {
    process.env.FORCE_COLOR = '1';
  } else if (config.getAnsiMode() === 'off') {
    process.env.FORCE_COLOR = '0';
    process.env.NO_COLOR = '1';
  }
  // else 'auto' - leave environment as-is
}
```

#### 2. Provide Explicit Terminal Dimensions

When stdout is not a TTY, we must provide dimensions. Add to Ink render options:

```typescript
// In inkRenderOptions.ts
export const inkRenderOptions = (
  config: InkRenderOptionsConfig,
  settings: InkRenderOptionsSettings,
): RenderOptions => {
  const baseOptions = { /* existing options */ };
  
  // In driver mode with piped stdout, provide explicit dimensions
  if (config.isDriverMode?.() && !process.stdout.isTTY) {
    const driverWidth = config.getDriverTerminalWidth?.() ?? 120;
    const driverHeight = config.getDriverTerminalHeight?.() ?? 40;
    
    // Create a mock stdout stream that reports dimensions
    // OR rely on Ink's fallback behavior (80 columns)
  }
  
  return baseOptions;
};
```

**Note:** We default to 120 columns (not 80) as this provides a more realistic testing environment matching typical terminal widths. The DriverClient sets `COLUMNS=120` and `LINES=40` via environment variables.

#### 3. Raw Mode is NOT Required for Output

The `setRawMode` call is only needed for **input** handling. Since driver mode uses `readline` instead of Ink's raw mode input handling, this is not a rendering concern.

### Verification Checklist

Before shipping driver mode, verify these scenarios produce identical output:

| Scenario | Command | Expected |
|----------|---------|----------|
| TTY output | `node scripts/start.js --driver` (in terminal) | Full UI |
| Piped output | `node scripts/start.js --driver \| cat` | Identical to TTY |
| File output | `node scripts/start.js --driver > out.txt` | Identical to TTY |
| With ANSI | `node scripts/start.js --driver --ansi \| cat` | ANSI codes present |
| Without ANSI | `node scripts/start.js --driver --no-ansi` | Plain text |

### Why This Works

1. **Ink's rendering is stdout-agnostic**: The Yoga layout engine and React reconciliation don't check `isTTY`. They compute layout based on width (defaulting to 80).

2. **ANSI code emission is controllable**: Chalk respects `FORCE_COLOR` and `NO_COLOR` environment variables, which we control via `--ansi`/`--no-ansi`.

3. **The only TTY-dependent behavior is input**: Raw mode, cursor positioning during input, etc. - all handled by our `useDriverInput` replacement.

---

## Appendix B: DONE Marker on Error, Crash, and Early Exit

### The Problem

If the CLI crashes, encounters a fatal error, or exits early without emitting `DONE`, the driver will hang waiting for a marker that never arrives.

### Solution: Guaranteed DONE Emission

Emit `DONE` on **all** exit paths:

#### 1. Process Exit Handler

```typescript
// In gemini.tsx, after render()
if (config.isDriverMode()) {
  // Emit DONE on any exit
  process.on('exit', () => {
    emitDriverMarker('DONE', config);
  });
  
  // Also catch signals
  process.on('SIGINT', () => {
    emitDriverMarker('DONE', config);
    process.exit(130);
  });
  
  process.on('SIGTERM', () => {
    emitDriverMarker('DONE', config);
    process.exit(143);
  });
}
```

#### 2. Uncaught Exception Handler

```typescript
// In gemini.tsx
if (config.isDriverMode()) {
  process.on('uncaughtException', (err) => {
    console.error('Fatal error:', err.message);
    emitDriverMarker('DONE', config);
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    emitDriverMarker('DONE', config);
    process.exit(1);
  });
}
```

#### 3. Error Boundary Integration

```typescript
// In ErrorBoundary.tsx - enhance the existing error boundary
const handleError = (error: Error) => {
  if (config.isDriverMode()) {
    emitDriverMarker('DONE', config);
  }
  // ... existing error handling
};
```

#### 4. stdin EOF Handling

When stdin closes (EOF), emit DONE and exit gracefully:

```typescript
// In useDriverInput.ts
rl.on('close', () => {
  // Process any remaining input
  if (accumulatedRef.current.length > 0) {
    onSubmitRef.current(accumulatedRef.current.join('
'));
    accumulatedRef.current = [];
  }
  // Give time for final processing, then exit
  setTimeout(() => {
    emitDriverMarker('DONE', config);
    process.exit(0);
  }, 100);
});
```

### DONE Marker Guarantees

| Exit Condition | DONE Emitted? | Mechanism |
|---------------|---------------|-----------|
| Normal completion | Yes | Stream completion handler |
| `/quit` command | Yes | Normal app exit flow |
| Ctrl+C (SIGINT) | Yes | Signal handler |
| SIGTERM | Yes | Signal handler |
| Uncaught exception | Yes | Exception handler |
| Unhandled rejection | Yes | Rejection handler |
| stdin EOF | Yes | readline 'close' handler |
| React error boundary | Yes | ErrorBoundary onError |
| OOM / SIGKILL | No | Cannot be caught |

**Note:** SIGKILL and out-of-memory conditions cannot be caught by the process. The DriverClient should implement timeouts to handle these cases.

### DriverClient Timeout Handling

```typescript
// In DriverClient.ts - enhanced awaitEvent
private awaitEvent(event: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Also check if process exited
      if (this.child?.exitCode !== null) {
        resolve(); // Process exited, consider it done
      } else {
        reject(new Error(`Timeout waiting for ${event} after ${timeout}ms`));
      }
    }, timeout);
    
    this.once(event, () => { 
      clearTimeout(timer); 
      resolve(); 
    });
    
    // Also resolve on process exit
    this.child?.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
```

---

## Appendix C: Updated File Summary

| File | Change |
|------|--------|
| `packages/cli/src/config/config.ts` | Add `--driver`, `--keystroke`, `--no-ansi` flags |
| `packages/core/src/config/config.ts` | Add driver/keystroke/noAnsi mode state |
| `packages/cli/src/ui/hooks/useDriverInput.ts` | **NEW** - stdin readline hook with EOF handling (line mode) |
| `packages/cli/src/ui/hooks/useKeystrokeInput.ts` | **NEW** - raw stdin handler (keystroke mode) |
| `packages/cli/src/ui/utils/driverMarkers.ts` | **NEW** - Zero-width Unicode marker emission |
| `packages/cli/src/ui/contexts/KeypressContext.tsx` | Add `inputEnabled` prop |
| `packages/cli/src/ui/AppContainer.tsx` | Wire useDriverInput/useKeystrokeInput, emit markers |
| `packages/cli/src/gemini.tsx` | Add exit handlers for DONE marker |
| `packages/cli/src/ui/components/ErrorBoundary.tsx` | Emit DONE on error |
| `packages/cli/src/driver/DriverClient.ts` | **NEW** - Test helper with dual mode support |

---

## Appendix D: Key Sequences Reference

Complete mapping of key names to escape sequences for keystroke mode:

### Navigation Keys

| Key Name | Escape Sequence | Hex | Description |
|----------|-----------------|-----|-------------|
| `PageUp` | `\x1b[5~` | `1B 5B 35 7E` | Scroll up one page |
| `PageDown` | `\x1b[6~` | `1B 5B 36 7E` | Scroll down one page |
| `Home` | `\x1b[H` | `1B 5B 48` | Move to beginning |
| `End` | `\x1b[F` | `1B 5B 46` | Move to end |
| `ArrowUp` | `\x1b[A` | `1B 5B 41` | Move up |
| `ArrowDown` | `\x1b[B` | `1B 5B 42` | Move down |
| `ArrowRight` | `\x1b[C` | `1B 5B 43` | Move right |
| `ArrowLeft` | `\x1b[D` | `1B 5B 44` | Move left |

### Editing Keys

| Key Name | Escape Sequence | Hex | Description |
|----------|-----------------|-----|-------------|
| `Tab` | `	` | `09` | Tab / autocomplete |
| `Enter` | `` | `0D` | Submit / select |
| `Escape` | `\x1b` | `1B` | Cancel / close |
| `Backspace` | `\x7f` | `7F` | Delete before cursor |
| `Delete` | `\x1b[3~` | `1B 5B 33 7E` | Delete at cursor |

### Control Keys

| Key Name | Escape Sequence | Hex | Description |
|----------|-----------------|-----|-------------|
| `Ctrl+C` | `\x03` | `03` | Interrupt |
| `Ctrl+D` | `\x04` | `04` | EOF / exit |
| `Ctrl+L` | `\x0c` | `0C` | Clear screen |
| `Ctrl+A` | `\x01` | `01` | Start of line |
| `Ctrl+E` | `\x05` | `05` | End of line |
| `Ctrl+K` | `\x0b` | `0B` | Kill to end of line |
| `Ctrl+U` | `\x15` | `15` | Kill to start of line |

### Notes

- Escape sequences follow the ANSI/VT100 standard
- `\x1b` is the escape character (ESC, 0x1B)
- Arrow keys and function keys use CSI sequences (`ESC [`)
- These sequences are what terminals send when keys are pressed
- The DriverClient's `sendKey()` method handles the mapping automatically

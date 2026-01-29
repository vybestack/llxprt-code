# Driver Mode Usage Scenarios

This document outlines how an LLM (or test harness) uses driver mode to interact with LLxprt.

---

## Scenario 1: Write a Haiku and Verify It

### Goal
Have LLxprt write a haiku, then verify the output contains a haiku (3 lines, 5-7-5 syllables approximately).

### LLM's Perspective

The LLM spawns LLxprt in driver mode and interacts via stdin/stdout:

```
[LLM spawns process]
$ node scripts/start.js --driver --no-ansi --profile-load synthetic

[LLM waits, sees stdout]
LLxprt v1.2.3
Loading profile: synthetic
> 
OSC:LLXPRT_READY

[LLM parses: saw READY marker, prompt ">" visible - ready for input]
[LLM sends via stdin]
write me a haiku about coding

[LLM sees stdout]
OSC:LLXPRT_BUSY

I'll write a haiku about coding for you.

  Fingers on the keys
  Logic flows like morning mist
  Bug fixed, coffee cold

> 
OSC:LLXPRT_DONE

[LLM parses output]
- Saw DONE marker, response complete
- Found text between BUSY and DONE
- Text contains 3 lines of poetry
- Appears to be haiku format (short/long/short lines)
- VERIFIED: Haiku was written

[LLM sends via stdin]
/quit

[Process exits]
```

### What the LLM Does

1. **Spawn** LLxprt with `--driver --no-ansi`
2. **Wait for READY** marker (or `>` prompt)
3. **Send** the prompt via stdin
4. **Wait for DONE** marker
5. **Parse** the stdout text between BUSY and DONE
6. **Verify** the output matches expectations (has poem-like structure)
7. **Send** `/quit` to exit cleanly

---

## Scenario 2: Run a Shell Command and Approve It

### Goal
Ask LLxprt to run a shell command, see the approval prompt, approve it, verify it ran.

### LLM's Perspective

```
[LLM spawns process]
$ node scripts/start.js --driver --no-ansi --profile-load synthetic --approval-mode suggest

[stdout]
LLxprt v1.2.3
> 
OSC:LLXPRT_READY

[LLM sends via stdin]
list the files in /tmp

[stdout]
OSC:LLXPRT_BUSY

I'll list the files in /tmp for you.

Tool: run_shell_command
Command: ls -la /tmp
Description: List files in /tmp directory

Allow? [y/n/always]: 

[LLM parses: sees "Allow? [y/n/always]:" - this is an approval prompt]
[LLM decides to approve]
[LLM sends via stdin]
y

[stdout]
Running command...

total 48
drwxrwxrwt  12 root  wheel   384 Jan 29 14:22 .
drwxr-xr-x   6 root  wheel   192 Jan 15 09:00 ..
-rw-r--r--   1 user  wheel  1024 Jan 29 14:20 foo.txt
-rw-r--r--   1 user  wheel  2048 Jan 29 14:21 bar.log

Command completed successfully.

> 
OSC:LLXPRT_DONE

[LLM parses output]
- Saw approval prompt, sent "y"
- Saw command output (file listing)
- Saw "Command completed successfully"
- VERIFIED: Shell command ran and was approved
```

### What the LLM Does

1. **Spawn** with `--approval-mode suggest` to require confirmation
2. **Send** the request
3. **Parse** stdout looking for approval patterns (`Allow? [y/n/always]:`)
4. **Send** `y` or `n` via stdin (just like a human would type)
5. **Wait for DONE** marker
6. **Verify** command output appeared

### Key Insight
No special protocol! The LLM reads the human-readable prompt and responds with `y` or `n` - exactly what a human would do.

---

## Scenario 3: Create a Todo List with 3 Items and Verify

### Goal
Ask LLxprt to create a todo list, then verify the UI shows 3 items.

### LLM's Perspective

```
[LLM spawns process]
$ node scripts/start.js --driver --no-ansi --profile-load synthetic

[stdout]
LLxprt v1.2.3
> 
OSC:LLXPRT_READY

[LLM sends via stdin]
create a todo list for today with: buy groceries, call mom, finish report

[stdout]
OSC:LLXPRT_BUSY

I'll create a todo list for you.

Creating todos...

TODO LIST
---------
[ ] buy groceries
[ ] call mom  
[ ] finish report

3 items added to your todo list.

> 
OSC:LLXPRT_DONE

[LLM parses output]
- Found "TODO LIST" header
- Found 3 lines starting with "[ ]"
- Items match: "buy groceries", "call mom", "finish report"
- VERIFIED: 3 todo items created

[LLM can further verify by asking]
[LLM sends via stdin]
/todo

[stdout]
OSC:LLXPRT_BUSY

Current Todos:
1. [ ] buy groceries (pending)
2. [ ] call mom (pending)
3. [ ] finish report (pending)

> 
OSC:LLXPRT_DONE

[LLM parses]
- /todo command shows 3 pending items
- DOUBLE VERIFIED: Todo list persisted correctly
```

### What the LLM Does

1. **Send** natural language request to create todos
2. **Parse** the response for todo-like patterns (`[ ]` checkboxes, numbered lists)
3. **Optionally** run `/todo` slash command to verify persistence
4. **Count** items and verify against expected count

---

## Scenario 4: Unit Test Using Driver Mode

### Goal
Write an automated test that exercises the interactive UI via driver mode.

### Test File: `packages/cli/src/driver/DriverClient.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DriverClient } from './DriverClient.js';

describe('DriverClient Integration Tests', () => {
  let driver: DriverClient;

  beforeEach(async () => {
    driver = new DriverClient();
  });

  afterEach(async () => {
    await driver.close();
  });

  describe('Haiku Generation', () => {
    it('should write a haiku when asked', async () => {
      // Spawn LLxprt in driver mode
      await driver.start(['--no-ansi', '--profile-load', 'synthetic']);
      await driver.awaitReady();

      // Send the prompt
      driver.send('write me a haiku about testing');
      await driver.awaitDone();

      // Get the output and verify
      const output = driver.getOutput();
      
      // Should contain some poetic response
      expect(output).toContain('haiku');
      
      // Should have multiple lines (haiku has 3)
      const responseLines = output
        .split('\n')
        .filter(line => line.trim().length > 0 && !line.includes('>'));
      
      // At minimum, expect some multi-line poetic content
      expect(responseLines.length).toBeGreaterThan(2);
    });
  });

  describe('Shell Command Approval', () => {
    it('should prompt for approval and execute when approved', async () => {
      await driver.start([
        '--no-ansi',
        '--profile-load', 'synthetic',
        '--approval-mode', 'suggest'
      ]);
      await driver.awaitReady();

      // Ask to run a safe command
      driver.send('run echo "hello from test"');
      
      // Wait for the approval prompt to appear in output
      await driver.waitForText('Allow?', 5000);
      
      // Approve it
      driver.send('y');
      await driver.awaitDone();

      const output = driver.getOutput();
      
      // Should show the command ran
      expect(output).toContain('hello from test');
    });

    it('should not execute when rejected', async () => {
      await driver.start([
        '--no-ansi',
        '--profile-load', 'synthetic',
        '--approval-mode', 'suggest'
      ]);
      await driver.awaitReady();

      driver.send('run echo "should not appear"');
      await driver.waitForText('Allow?', 5000);
      
      // Reject it
      driver.send('n');
      await driver.awaitDone();

      const output = driver.getOutput();
      
      // Command output should NOT appear
      expect(output).not.toContain('should not appear');
      // Should show rejection message
      expect(output.toLowerCase()).toMatch(/denied|rejected|cancelled/);
    });
  });

  describe('Todo List Management', () => {
    it('should create todos and verify via /todo command', async () => {
      await driver.start(['--no-ansi', '--profile-load', 'synthetic']);
      await driver.awaitReady();

      // Create todos
      driver.send('create a todo list: item one, item two, item three');
      await driver.awaitDone();

      // Clear output buffer to check fresh response
      const createOutput = driver.getOutput();
      expect(createOutput).toMatch(/todo|item/i);

      // Verify with /todo command
      driver.send('/todo');
      await driver.awaitDone();

      const todoOutput = driver.getOutput();
      
      // Should show 3 items
      const itemMatches = todoOutput.match(/\[ \]/g) || [];
      expect(itemMatches.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Multi-line Input', () => {
    it('should handle backslash continuation', async () => {
      await driver.start(['--no-ansi', '--profile-load', 'synthetic']);
      await driver.awaitReady();

      // Send multi-line input using backslash continuation
      driver.sendMultiline([
        'Write a function that:',
        '- takes two numbers',
        '- returns their sum'
      ]);
      await driver.awaitDone();

      const output = driver.getOutput();
      
      // Should have understood the multi-line request
      expect(output).toMatch(/function|sum|add/i);
    });
  });

  describe('Slash Commands', () => {
    it('should execute /help command', async () => {
      await driver.start(['--no-ansi', '--profile-load', 'synthetic']);
      await driver.awaitReady();

      driver.send('/help');
      await driver.awaitDone();

      const output = driver.getOutput();
      expect(output).toContain('Available commands');
    });

    it('should execute /model command', async () => {
      await driver.start(['--no-ansi', '--profile-load', 'synthetic']);
      await driver.awaitReady();

      driver.send('/model');
      await driver.awaitDone();

      const output = driver.getOutput();
      expect(output).toMatch(/model|current/i);
    });
  });
});
```

### Enhanced DriverClient for Testing

```typescript
// packages/cli/src/driver/DriverClient.ts
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export class DriverClient extends EventEmitter {
  private child: ChildProcess | null = null;
  private output = '';
  private outputSinceLastCheck = '';

  async start(args: string[] = []): Promise<void> {
    this.child = spawn('node', ['scripts/start.js', '--driver', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
    });

    this.child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      this.output += text;
      this.outputSinceLastCheck += text;
      this.parseMarkers(text);
    });

    this.child.stderr?.on('data', (chunk: Buffer) => {
      // Optionally capture stderr
      console.error('[driver stderr]', chunk.toString());
    });

    this.child.on('exit', (code) => {
      this.emit('exit', code);
    });
  }

  private parseMarkers(text: string): void {
    if (text.includes('\x1b]9;LLXPRT_READY\x07')) this.emit('ready');
    if (text.includes('\x1b]9;LLXPRT_BUSY\x07')) this.emit('busy');
    if (text.includes('\x1b]9;LLXPRT_DONE\x07')) this.emit('done');
  }

  send(text: string): void {
    if (!this.child?.stdin) throw new Error('Driver not started');
    this.child.stdin.write(text + '\n');
  }

  sendMultiline(lines: string[]): void {
    if (!this.child?.stdin) throw new Error('Driver not started');
    for (let i = 0; i < lines.length - 1; i++) {
      this.child.stdin.write(lines[i] + '\\\n');
    }
    this.child.stdin.write(lines[lines.length - 1] + '\n');
  }

  awaitReady(timeout = 30000): Promise<void> {
    return this.awaitEvent('ready', timeout);
  }

  awaitDone(timeout = 60000): Promise<void> {
    return this.awaitEvent('done', timeout);
  }

  async waitForText(text: string, timeout = 10000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.output.includes(text)) return;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`Timeout waiting for text: "${text}"`);
  }

  private awaitEvent(event: string, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for ${event} after ${timeout}ms`));
      }, timeout);

      // Check if already received
      if (event === 'ready' && this.output.includes('LLXPRT_READY')) {
        clearTimeout(timer);
        resolve();
        return;
      }
      if (event === 'done' && this.outputSinceLastCheck.includes('LLXPRT_DONE')) {
        clearTimeout(timer);
        this.outputSinceLastCheck = '';
        resolve();
        return;
      }

      this.once(event, () => {
        clearTimeout(timer);
        if (event === 'done') this.outputSinceLastCheck = '';
        resolve();
      });

      // Also resolve on process exit
      this.child?.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  getOutput(): string {
    return this.output;
  }

  clearOutput(): void {
    this.output = '';
    this.outputSinceLastCheck = '';
  }

  async close(): Promise<void> {
    if (!this.child) return;
    
    try {
      this.send('/quit');
      // Give it a moment to exit gracefully
      await new Promise(r => setTimeout(r, 500));
    } catch {
      // Ignore errors during close
    }
    
    this.child.kill();
    this.child = null;
  }
}
```

---

## How It All Works Together

### The Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Test / LLM / Parent Agent                                       │
│                                                                  │
│  1. Spawn: node scripts/start.js --driver --no-ansi             │
│  2. Wait for: LLXPRT_READY marker                                │
│  3. Send via stdin: "write me a haiku"                          │
│  4. See in stdout: LLXPRT_BUSY marker                           │
│  5. See in stdout: [actual UI response with haiku]              │
│  6. See in stdout: LLXPRT_DONE marker                           │
│  7. Parse stdout text, verify haiku present                     │
│  8. Send via stdin: "/quit"                                     │
│  9. Process exits                                                │
└─────────────────────────────────────────────────────────────────┘
        │                                      ▲
        │ stdin                                │ stdout
        ▼                                      │
┌─────────────────────────────────────────────────────────────────┐
│  LLxprt (--driver mode)                                          │
│                                                                  │
│  - Ink UI renders normally (all decorations, boxes, etc.)       │
│  - stdin read via readline (not Ink keyboard)                   │
│  - Input routed through handleUserInputSubmit (same as UI)      │
│  - OSC markers emitted at READY/BUSY/DONE points                │
│  - Approval prompts render normally ("Allow? [y/n]:")           │
│  - Driver responds "y" or "n" via stdin like a human            │
└─────────────────────────────────────────────────────────────────┘
```

### Key Points

1. **No special protocol** - The LLM reads human-readable UI output
2. **Same UI** - Driver sees exactly what a human would see
3. **OSC markers are invisible** - Terminals ignore them, automation parses them
4. **Approval works naturally** - UI shows prompt, driver sends `y`/`n`
5. **Full pipeline** - Slash commands, todos, history all work

### Why This Approach Works for Testing

- **Real integration tests** - Exercises actual UI rendering
- **Catches UI bugs** - If output is wrong, test fails
- **Tests approval flows** - Can verify y/n/always behavior
- **Tests slash commands** - `/help`, `/todo`, `/model` all testable
- **Tests multi-line** - Backslash continuation works
- **Deterministic** - OSC markers provide reliable sync points

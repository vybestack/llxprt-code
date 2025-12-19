# Implementation Plan: 5dc7059b - InteractiveRun Class

## Summary of Upstream Changes

Upstream commit `5dc7059b` ("Refactor: Introduce InteractiveRun class (#10947)"):
- Adds `InteractiveRun` class to wrap PTY process interactions
- Provides clean API with methods: `expectText()`, `type()`, `kill()`, `expectExit()`
- Updates `TestRig.runInteractive()` to return `InteractiveRun` instance
- Migrates existing PTY tests to use the new wrapper class
- Eliminates manual PTY output accumulation and polling in individual tests

**Benefits:**
- Encapsulates PTY interaction patterns in reusable class
- Reduces code duplication across interactive tests
- Provides consistent timeout handling and error messages
- Makes tests more readable and maintainable

## IMPORTANT: Method Names

**This plan implements the FINAL method names from commit a73b8145:**
- Using `expectText()` instead of `waitForText()`
- Using `expectExit()` instead of `waitForExit()`

**Rationale:** Since we're implementing 5dc7059b fresh in llxprt (not migrating existing code), we can skip the intermediate `waitFor*` names and go directly to the final `expect*` names from a73b8145. This avoids unnecessary churn and a second rename commit.

## Implementation Steps

### Step 1: Add stripAnsi Dependency

**File:** `integration-tests/test-helper.ts`

Add import at the top:
```typescript
import stripAnsi from 'strip-ansi';
```

**Note:** The `strip-ansi` package is already a dependency in gemini-cli. We need to verify it's in llxprt-code's package.json or add it.

### Step 2: Extract poll() Function to Module Level

**File:** `integration-tests/test-helper.ts`

Move the `poll()` function from inside the `TestRig` class to module-level (after imports, before class definitions):

```typescript
export async function poll(
  predicate: () => boolean,
  timeout: number,
  interval: number,
): Promise<boolean> {
  const startTime = Date.now();
  let attempts = 0;
  while (Date.now() - startTime < timeout) {
    attempts++;
    const result = predicate();
    if (env['VERBOSE'] === 'true' && attempts % 5 === 0) {
      console.log(
        `Poll attempt ${attempts}: ${result ? 'success' : 'waiting...'}`,
      );
    }
    if (result) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  if (env['VERBOSE'] === 'true') {
    console.log(`Poll timed out after ${attempts} attempts`);
  }
  return false;
}
```

**Rationale:** The `InteractiveRun` class needs direct access to `poll()` but shouldn't depend on `TestRig` instance methods.

### Step 3: Extract getDefaultTimeout() Function

**File:** `integration-tests/test-helper.ts`

Add module-level function after imports:

```typescript
// Get timeout based on environment
function getDefaultTimeout() {
  if (env['CI']) return 60000; // 1 minute in CI
  if (env['LLXPRT_SANDBOX']) return 30000; // 30s in containers
  return 15000; // 15s locally
}
```

### Step 4: Create InteractiveRun Class

**File:** `integration-tests/test-helper.ts`

Add the complete `InteractiveRun` class before the `TestRig` class:

```typescript
export class InteractiveRun {
  ptyProcess: pty.IPty;
  public output = '';

  constructor(ptyProcess: pty.IPty) {
    this.ptyProcess = ptyProcess;
    ptyProcess.onData((data) => {
      this.output += data;
      if (env['KEEP_OUTPUT'] === 'true' || env['VERBOSE'] === 'true') {
        process.stdout.write(data);
      }
    });
  }

  // Note: Named expectText (not waitForText) to match upstream final state
  // This incorporates commit a73b8145 which renames waitFor* → expect*
  async expectText(text: string, timeout?: number) {
    if (!timeout) {
      timeout = getDefaultTimeout();
    }
    const found = await poll(
      () => stripAnsi(this.output).toLowerCase().includes(text.toLowerCase()),
      timeout,
      200,
    );
    expect(found, `Did not find expected text: "${text}"`).toBe(true);
  }

  // Simulates typing a string one character at a time to avoid paste detection.
  async type(text: string) {
    const delay = 5;
    for (const char of text) {
      this.ptyProcess.write(char);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  async kill() {
    this.ptyProcess.kill();
  }

  // Note: Named expectExit (not waitForExit) to match upstream final state
  // This incorporates commit a73b8145 which renames waitFor* → expect*
  expectExit(): Promise<number> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(`Test timed out: process did not exit within a minute.`),
          ),
        60000,
      );
      this.ptyProcess.onExit(({ exitCode }) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
  }
}
```

**Key Implementation Details:**

1. **Constructor:**
   - Takes `pty.IPty` instance
   - Automatically accumulates output in `this.output`
   - Optionally echoes to stdout if `KEEP_OUTPUT` or `VERBOSE` is set

2. **expectText(text, timeout?):**
   - Uses module-level `poll()` function
   - Strips ANSI codes using `stripAnsi()` before checking
   - Case-insensitive text matching
   - Uses `expect()` to provide clear error message on timeout
   - Default timeout from `getDefaultTimeout()`

3. **type(text):**
   - Async method that writes characters one at a time
   - 5ms delay between characters to avoid paste detection
   - Important for simulating real user input

4. **kill():**
   - Simple wrapper around `ptyProcess.kill()`
   - Async for consistency with other methods

5. **expectExit():**
   - Returns Promise<number> with exit code
   - 60-second timeout with clear error message
   - Uses `onExit` event from node-pty
   - Cleans up timeout when process exits

### Step 5: Update TestRig.runInteractive()

**File:** `integration-tests/test-helper.ts`

Replace the existing `runInteractive()` method in the `TestRig` class:

**BEFORE:**
```typescript
runInteractive(...args: string[]): {
  ptyProcess: pty.IPty;
  promise: Promise<{ exitCode: number; signal?: number; output: string }>;
} {
  const commandArgs = [this.bundlePath, '--yolo', ...args];
  const isWindows = os.platform() === 'win32';

  const options: pty.IPtyForkOptions = {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd: this.testDir!,
    env: Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined),
    ) as { [key: string]: string },
  };

  if (isWindows) {
    options.shell = process.env.COMSPEC || 'cmd.exe';
  }

  const ptyProcess = pty.spawn('node', commandArgs, options);

  let output = '';
  ptyProcess.onData((data) => {
    output += data;
    if (env.KEEP_OUTPUT === 'true' || env.VERBOSE === 'true') {
      process.stdout.write(data);
    }
  });

  const promise = new Promise<{
    exitCode: number;
    signal?: number;
    output: string;
  }>((resolve) => {
    ptyProcess.onExit(({ exitCode, signal }) => {
      resolve({ exitCode, signal, output });
    });
  });

  return { ptyProcess, promise };
}
```

**AFTER:**
```typescript
async runInteractive(...args: string[]): Promise<InteractiveRun> {
  const commandArgs = [this.bundlePath, '--yolo', ...args];
  const isWindows = os.platform() === 'win32';

  const options: pty.IPtyForkOptions = {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd: this.testDir!,
    env: Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined),
    ) as { [key: string]: string },
  };

  if (isWindows) {
    options.shell = process.env.COMSPEC || 'cmd.exe';
  }

  const ptyProcess = pty.spawn('node', commandArgs, options);

  const run = new InteractiveRun(ptyProcess);
  // Wait for the app to be ready (input prompt rendered).
  await run.expectText('Type your message', 30000);
  return run;
}
```

**Key Changes:**
1. Return type changes from `{ ptyProcess, promise }` to `Promise<InteractiveRun>`
2. Method becomes `async` to await readiness check
3. Creates `InteractiveRun` instance wrapping the PTY process
4. Waits for `Type your message` prompt before returning (ensures app is ready)
5. Removes manual output accumulation (now handled by `InteractiveRun`)
6. Removes manual promise construction (now handled by `InteractiveRun.expectExit()`)

### Step 6: Update ctrl-c-exit.test.ts

**File:** `integration-tests/ctrl-c-exit.test.ts`

Migrate test to use new `InteractiveRun` API:

**BEFORE:**
```typescript
it('should exit gracefully on second Ctrl+C', async () => {
  const rig = new TestRig();
  await rig.setup('should exit gracefully on second Ctrl+C');

  const { ptyProcess, promise } = rig.runInteractive();

  let output = '';
  ptyProcess.onData((data) => {
    output += data;
  });

  // Wait for the app to be ready by looking for the initial prompt text
  await rig.poll(() => output.includes('Type your message'), 5000, 100);

  // Send first Ctrl+C
  ptyProcess.write('\x03');

  // Wait for the exit prompt
  await rig.poll(
    () => output.includes('Press Ctrl+C again to exit'),
    1500,
    50,
  );

  if (os.platform() === 'win32') {
    ptyProcess.kill();
  } else {
    ptyProcess.write('\x03');
  }

  const timeout = new Promise((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            `Test timed out: process did not exit within a minute. Output: ${output}`,
          ),
        ),
      60000,
    ),
  );

  const result = await Promise.race([promise, timeout]);

  if (os.platform() === 'win32') {
    expect(
      result.exitCode,
      `Process exited with code ${result.exitCode}. Output: ${result.output}`,
    ).not.toBeNull();
  } else {
    expect(
      result.exitCode,
      `Process exited with code ${result.exitCode}. Output: ${result.output}`,
    ).toBe(0);

    const quittingMessage = 'Agent powering down. Goodbye!';
    const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
    expect(cleanOutput).toContain(quittingMessage);
  }
});
```

**AFTER:**
```typescript
it('should exit gracefully on second Ctrl+C', async () => {
  const rig = new TestRig();
  await rig.setup('should exit gracefully on second Ctrl+C');

  const run = await rig.runInteractive();

  // Send first Ctrl+C
  run.type('\x03');

  await run.expectText('Press Ctrl+C again to exit', 5000);

  if (os.platform() === 'win32') {
    // This is a workaround for node-pty/winpty on Windows.
    // Reliably sending a second Ctrl+C signal to a process that is already
    // handling the first one is not possible in the emulated pty environment.
    // The first signal is caught correctly (verified by the poll above),
    // which is the most critical part of the test on this platform.
    // To allow the test to pass, we forcefully kill the process,
    // simulating a successful exit. We accept that we cannot test the
    // graceful shutdown message on Windows in this automated context.
    run.kill();

    const exitCode = await run.expectExit();
    // On Windows, the exit code after ptyProcess.kill() can be unpredictable
    // (often 1), so we accept any non-null exit code as a pass condition,
    // focusing on the fact that the process did terminate.
    expect(exitCode, `Process exited with code ${exitCode}.`).not.toBeNull();
    return;
  }

  // Send second Ctrl+C
  run.type('\x03');

  const exitCode = await run.expectExit();
  expect(exitCode, `Process exited with code ${exitCode}.`).toBe(0);

  await run.expectText('Agent powering down. Goodbye!', 5000);
});
```

**Key Improvements:**
1. `runInteractive()` now returns `InteractiveRun` directly (already awaited)
2. No manual output accumulation needed - `run.output` is automatically populated
3. No manual polling - `run.expectText()` handles it with ANSI stripping
4. Use `run.type()` instead of `ptyProcess.write()` for consistency
5. Use `run.kill()` instead of `ptyProcess.kill()`
6. Use `run.expectExit()` with built-in timeout instead of manual Promise.race
7. Much cleaner, more readable code - focuses on test logic not infrastructure

### Step 7: Update Other Interactive Tests

Apply similar patterns to other tests using PTY:
- `integration-tests/context-compress-interactive.test.ts`
- `integration-tests/file-system-interactive.test.ts`
- Any other tests calling `runInteractive()`

**Pattern:**
```typescript
// OLD:
const { ptyProcess, promise } = rig.runInteractive(...args);
let output = '';
ptyProcess.onData((data) => { output += data; });
await rig.poll(() => output.includes('ready'), 5000, 100);
ptyProcess.write('some input\n');
// ... manual promise handling ...

// NEW:
const run = await rig.runInteractive(...args);
// Already waited for 'Type your message' prompt text
await run.expectText('some expected text');
await run.type('some input\n');
const exitCode = await run.expectExit();
```

### Step 8: Update TestRig.poll() Calls

Since `poll()` is now a module-level function, update all `TestRig` instance methods that call `this.poll()`:

**BEFORE:**
```typescript
await this.poll(predicate, timeout, interval);
```

**AFTER:**
```typescript
await poll(predicate, timeout, interval);
```

**Files to check:**
- All methods in `TestRig` class: `waitForTelemetryReady()`, `waitForTelemetryEvent()`, `waitForToolCall()`, `waitForAnyToolCall()`

### Step 9: Add Vitest Import

**File:** `integration-tests/test-helper.ts`

Add `expect` import at the top:
```typescript
import { expect } from 'vitest';
```

This is needed for `InteractiveRun.expectText()` to provide clear assertion messages.

## Files to Modify

| File | Change | Lines Changed |
|------|--------|---------------|
| `integration-tests/test-helper.ts` | Add stripAnsi import | +1 |
| `integration-tests/test-helper.ts` | Add vitest expect import | +1 |
| `integration-tests/test-helper.ts` | Extract getDefaultTimeout() to module level | ~10 |
| `integration-tests/test-helper.ts` | Extract poll() to module level | ~25 |
| `integration-tests/test-helper.ts` | Add InteractiveRun class | +50 |
| `integration-tests/test-helper.ts` | Update runInteractive() method | -20, +15 |
| `integration-tests/test-helper.ts` | Update poll() call sites in TestRig | ~4 locations |
| `integration-tests/ctrl-c-exit.test.ts` | Migrate to InteractiveRun API | -60, +30 |
| `integration-tests/context-compress-interactive.test.ts` | Migrate to InteractiveRun API | TBD |
| `integration-tests/file-system-interactive.test.ts` | Migrate to InteractiveRun API | TBD |
| `package.json` (if needed) | Add strip-ansi dependency | +1 |

## LLxprt-Specific Adaptations

### Environment Variable Names
- Replace `env['GEMINI_SANDBOX']` with `env['LLXPRT_SANDBOX']`
- Replace `gemini_cli.` event name prefixes with `llxprt_code.`
- Replace `'gemini'` command references with appropriate llxprt command

### Bundle Path
- Current: `join(__dirname, '..', 'bundle/gemini.js')`
- LLxprt: `join(__dirname, '..', 'bundle/llxprt.js')` (already correct)

### Settings Structure
- Gemini uses `security.auth.selectedType: 'gemini-api-key'`
- LLxprt uses `selectedAuthType: 'provider'` (already correct)

### Ready Text
- Gemini waits for: `'Type your message'`
- LLXPRT waits for: `'Type your message'`
  - The UI renders this text in the input placeholder, so it is a stable readiness marker.
  - This plan updates `ctrl-c-exit.test.ts` readiness to match.

## Dependencies Check

Verify `strip-ansi` is in package.json:
```bash
grep -i "strip-ansi" package.json
```

If not present, add:
```bash
npm install --save-dev strip-ansi
```

## Testing Strategy

1. **Unit Test Changes:**
   - Verify `poll()` still works as module-level function
   - Verify `InteractiveRun` constructor accumulates output
   - Verify `expectText()` strips ANSI and matches case-insensitively

2. **Integration Test Migration:**
   - Start with `ctrl-c-exit.test.ts` as reference implementation
   - Verify test still passes with new API
   - Apply same pattern to other interactive tests

3. **Regression Testing:**
   - All existing integration tests should still pass
   - Non-interactive tests unaffected by these changes

## Acceptance Criteria

- [ ] `strip-ansi` dependency added/verified
- [ ] `expect` from vitest imported in test-helper.ts
- [ ] `poll()` extracted to module level
- [ ] `getDefaultTimeout()` extracted to module level
- [ ] `InteractiveRun` class implemented with all methods:
  - [ ] Constructor with auto output accumulation
  - [ ] `expectText()` with stripAnsi and expect (NOT waitForText)
  - [ ] `type()` with character-by-character delay
  - [ ] `kill()` wrapper
  - [ ] `expectExit()` with 60s timeout (NOT waitForExit)
- [ ] `TestRig.runInteractive()` updated to:
  - [ ] Return `Promise<InteractiveRun>`
  - [ ] Wait for ready text before returning (using expectText)
- [ ] All `TestRig.poll()` calls updated to use module-level `poll()`
- [ ] `ctrl-c-exit.test.ts` migrated to new API
- [ ] Other interactive tests migrated
- [ ] All tests pass
- [ ] Code formatted and linted
- [ ] Commit a73b8145 marked as SKIPPED (names already final)

## Migration Priority

1. **High Priority (Core Infrastructure):**
   - test-helper.ts changes (Steps 1-5, 8-9)
   - ctrl-c-exit.test.ts migration (Step 6)

2. **Medium Priority (Other Tests):**
   - context-compress-interactive.test.ts
   - file-system-interactive.test.ts

3. **Low Priority (Cleanup):**
   - Remove any now-unused helper code
   - Update documentation/comments

## Notes

- The `InteractiveRun` class significantly reduces boilerplate in PTY tests
- ANSI stripping in `expectText()` is critical for reliable text matching
- Character-by-character typing in `type()` prevents paste detection
- Built-in timeout in `expectExit()` eliminates manual Promise.race patterns
- This refactor makes interactive tests much more maintainable and readable

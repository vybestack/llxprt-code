# Implementation Plan: a64bb433 - Simplify Auth in Interactive Tests

## Summary of Upstream Changes

Upstream commit `a64bb433` ("Simplify auth in interactive tests. (#10921)"):
- Refactors `runInteractive()` to return `Promise<pty.IPty>` instead of returning `{ ptyProcess, promise }` object
- Adds automatic "Type your message" wait inside `runInteractive()` so tests don't need to wait manually
- Removes `ensureReadyForInput()` method (no longer needed - functionality moved into `runInteractive()`)
- Changes `waitForText()` to throw assertion error instead of returning boolean
- Adds `security.auth.selectedType: 'gemini-api-key'` to test settings to prevent auth dialogs
- Simplifies all interactive test files by removing manual auth handling and ready-state polling

**Key Intent:** Make interactive tests behave like non-interactive tests with consistent auth configuration, eliminate manual polling for ready state, and use assertions instead of boolean returns for better test failures.

## Detailed Implementation Steps

### Step 1: Add Required Infrastructure to test-helper.ts

**File:** `integration-tests/test-helper.ts`

#### 1.1: Add import for stripAnsi utility
```typescript
import stripAnsi from 'strip-ansi';
import { expect } from 'vitest';
```

**Note:** Check if `strip-ansi` package is installed. If not, add to devDependencies.

#### 1.2: Add _interactiveOutput class property
Add to TestRig class near other properties:
```typescript
testDir: string | null;
testName?: string;
_lastRunStdout?: string;
_interactiveOutput: string = ''; // Add this line
```

#### 1.3: Add _getCommandAndArgs helper method
Add as private method in TestRig class (before `run()` method):
```typescript
private _getCommandAndArgs(extraInitialArgs: string[] = []): {
  command: string;
  initialArgs: string[];
} {
  // In LLxprt we always use bundled version (no npm release testing)
  const command = 'node';
  const initialArgs = [this.bundlePath, ...extraInitialArgs];
  return { command, initialArgs };
}
```

#### 1.4: Add waitForText method
Add as public method in TestRig class (after `readLastApiRequest()` method):
```typescript
async waitForText(text: string, timeout?: number) {
  if (!timeout) {
    timeout = this.getDefaultTimeout();
  }
  const found = await this.poll(
    () =>
      stripAnsi(this._interactiveOutput)
        .toLowerCase()
        .includes(text.toLowerCase()),
    timeout,
    200,
  );
  expect(found, `Did not find expected text: "${text}"`).toBe(true);
}
```

**Implementation notes:**
- Uses `_interactiveOutput` to check for text
- Strips ANSI codes for reliable matching
- Case-insensitive search
- Throws assertion error if text not found (doesn't return boolean)

### Step 2: Update runInteractive() Method

**File:** `integration-tests/test-helper.ts`

Replace the entire `runInteractive()` method (currently lines 964-1007) with:

```typescript
async runInteractive(...args: string[]): Promise<pty.IPty> {
  const { command, initialArgs } = this._getCommandAndArgs(['--yolo']);
  const commandArgs = [...initialArgs, ...args];
  const isWindows = os.platform() === 'win32';

  this._interactiveOutput = ''; // Reset output for the new run

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
    // node-pty on Windows requires a shell to be specified when using winpty.
    options.shell = process.env.COMSPEC || 'cmd.exe';
  }

  const executable = command === 'node' ? process.execPath : command;
  const ptyProcess = pty.spawn(executable, commandArgs, options);

  ptyProcess.onData((data) => {
    this._interactiveOutput += data;
    if (env.KEEP_OUTPUT === 'true' || env.VERBOSE === 'true') {
      process.stdout.write(data);
    }
  });

  // Wait for the app to be ready
  await this.waitForText('Type your message', 30000);

  return ptyProcess;
}
```

**Key changes:**
- Signature changes from `runInteractive(...args): { ptyProcess, promise }` to `async runInteractive(...args): Promise<pty.IPty>`
- Uses `_getCommandAndArgs()` helper for consistent command construction
- Initializes `_interactiveOutput = ''` at start
- Stores all PTY data in `_interactiveOutput` for `waitForText()` to use
- Automatically waits for "Type your message" prompt before returning
- Returns just the `ptyProcess`, not a `{ ptyProcess, promise }` object
- Uses `process.execPath` for node executable (more reliable than 'node' string)

### Step 3: Add Auth Configuration to Settings

**File:** `integration-tests/test-helper.ts`

In the `setup()` method, locate the settings object (around line 152-178) and add the `security` configuration:

```typescript
const settings = {
  telemetry: {
    enabled: true,
    target: 'local',
    otlpEndpoint: '',
    outfile: telemetryPath,
  },
  promptService: {
    // ... existing config
  },
  sandbox: env.LLXPRT_SANDBOX !== 'false' ? env.LLXPRT_SANDBOX : false,
  selectedAuthType: 'provider', // EXISTING - keep this
  provider: env.LLXPRT_DEFAULT_PROVIDER,
  debug: true,
  security: {  // ADD THIS BLOCK
    auth: {
      selectedType: 'provider', // Match LLxprt's provider-based auth
    },
  },
  ...options.settings,
};
```

**Note:** In upstream Gemini CLI they use `'gemini-api-key'`. In LLxprt we use `'provider'` to match our provider-based authentication system.

### Step 4: Update ctrl-c-exit.test.ts

**File:** `integration-tests/ctrl-c-exit.test.ts`

#### 4.1: Add import for pty types
```typescript
import * as pty from '@lydell/node-pty';
```

#### 4.2: Add waitForExit helper function
Add this function before the describe block (after imports):
```typescript
function waitForExit(ptyProcess: pty.IPty): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`Test timed out: process did not exit within a minute.`),
        ),
      60000,
    );
    ptyProcess.onExit(({ exitCode }) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
}
```

#### 4.3: Update the test implementation
Replace the entire test body (lines 13-93) with:

```typescript
it('should exit gracefully on second Ctrl+C', async () => {
  const rig = new TestRig();
  await rig.setup('should exit gracefully on second Ctrl+C');

  const ptyProcess = await rig.runInteractive();

  // Send first Ctrl+C
  ptyProcess.write('\x03');

  await rig.waitForText('Press Ctrl+C again to exit', 5000);

  if (os.platform() === 'win32') {
    // This is a workaround for node-pty/winpty on Windows.
    // Reliably sending a second Ctrl+C signal to a process that is already
    // handling the first one is not possible in the emulated pty environment.
    // The first signal is caught correctly (verified by the poll above),
    // which is the most critical part of the test on this platform.
    // To allow the test to pass, we forcefully kill the process,
    // simulating a successful exit. We accept that we cannot test the
    // graceful shutdown message on Windows in this automated context.
    ptyProcess.kill();

    const exitCode = await waitForExit(ptyProcess);
    // On Windows, the exit code after ptyProcess.kill() can be unpredictable
    // (often 1), so we accept any non-null exit code as a pass condition,
    // focusing on the fact that the process did terminate.
    expect(exitCode, `Process exited with code ${exitCode}.`).not.toBeNull();
    return;
  }

  // Send second Ctrl+C
  ptyProcess.write('\x03');

  const exitCode = await waitForExit(ptyProcess);
  expect(exitCode, `Process exited with code ${exitCode}.`).toBe(0);

  await rig.waitForText('Agent powering down. Goodbye!', 5000);
});
```

**Key changes:**
- Remove manual output tracking (now handled by `_interactiveOutput`)
- Remove manual polling for ready state (now automatic in `runInteractive()`)
- Use `await rig.runInteractive()` which returns just the `ptyProcess`
- Use `rig.waitForText()` instead of manual polling with `rig.poll()`
- `waitForText()` throws on timeout, so no need to check return value
- Simplified Windows handling logic
- Removed the `promise` object handling - use `waitForExit()` helper instead

### Step 5: Remove describe.skipIf from ctrl-c-exit.test.ts

**File:** `integration-tests/ctrl-c-exit.test.ts`

Change line 12 from:
```typescript
describe.skipIf(process.env.CI === 'true')('Ctrl+C exit', () => {
```

To:
```typescript
describe('Ctrl+C exit', () => {
```

**Reason:** The auth simplification makes these tests more reliable in CI, so upstream removed the CI skip condition.

## Files to Modify

| File | Lines | Change Summary |
|------|-------|----------------|
| `integration-tests/test-helper.ts` | 1-15 | Add imports for `stripAnsi` and `expect` from vitest |
| `integration-tests/test-helper.ts` | 120 | Add `_interactiveOutput: string = ''` property |
| `integration-tests/test-helper.ts` | ~250 | Add `_getCommandAndArgs()` private method |
| `integration-tests/test-helper.ts` | 152-178 | Add `security.auth.selectedType` to settings |
| `integration-tests/test-helper.ts` | ~810 | Add `waitForText()` method with assertions |
| `integration-tests/test-helper.ts` | 964-1007 | Replace `runInteractive()` with async version |
| `integration-tests/ctrl-c-exit.test.ts` | 8 | Add `import * as pty from '@lydell/node-pty'` |
| `integration-tests/ctrl-c-exit.test.ts` | 10-22 | Add `waitForExit()` helper function |
| `integration-tests/ctrl-c-exit.test.ts` | 12 | Remove `.skipIf(process.env.CI === 'true')` |
| `integration-tests/ctrl-c-exit.test.ts` | 13-93 | Replace entire test implementation |
| `package.json` | devDependencies | Add `strip-ansi` if not present |

## Files NOT Modified

The following files were modified in upstream but **do not exist in LLxprt:**
- `integration-tests/context-compress-interactive.test.ts` - NOT IN LLXPRT
- `integration-tests/file-system-interactive.test.ts` - NOT IN LLXPRT

These files don't need to be created or ported.

## Dependencies

Check if `strip-ansi` package is installed:
```bash
npm list strip-ansi
```

If not installed, add to devDependencies:
```bash
npm install --save-dev strip-ansi
```

## Testing Strategy

1. Run the updated ctrl-c-exit test:
   ```bash
   npm test -- ctrl-c-exit.test.ts
   ```

2. Verify interactive mode still works:
   ```bash
   node bundle/llxprt.js
   ```
   - Should start without auth dialog
   - Should show "Type your message" prompt

3. Run full integration test suite:
   ```bash
   npm test
   ```

## Acceptance Criteria

- [ ] `runInteractive()` returns `Promise<pty.IPty>` instead of object with `ptyProcess` and `promise`
- [ ] Interactive tests automatically wait for ready state (no manual polling needed)
- [ ] `waitForText()` throws assertion errors instead of returning boolean
- [ ] No auth dialogs appear during interactive tests
- [ ] `ctrl-c-exit.test.ts` passes both locally and in CI
- [ ] `_interactiveOutput` accumulates all PTY output for searching
- [ ] Settings include `security.auth.selectedType: 'provider'`
- [ ] All integration tests continue to pass

## Risk Assessment

**Low Risk:**
- Changes are isolated to test infrastructure
- No production code affected
- Improves test reliability by eliminating manual timing/polling
- Makes tests more declarative and easier to understand

**Potential Issues:**
- `strip-ansi` dependency might not be installed
- Timing differences in `waitForText()` might cause flakiness (mitigated by using 200ms polling interval)
- Windows PTY behavior might differ (already handled with platform-specific logic)

## Notes

- The upstream commit removes 148 lines and adds only 48 lines (net -100 lines) - a significant simplification
- In LLxprt, we use `'provider'` for auth type instead of `'gemini-api-key'` to match our auth system
- The `_getCommandAndArgs()` helper enables future npm release testing if needed
- Using assertions in `waitForText()` provides better error messages when tests fail

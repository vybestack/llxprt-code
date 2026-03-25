# REIMPLEMENT Playbook: 8a627d6 — fix(cli): safely handle /dev/tty access on macOS

## Upstream Change Summary

Upstream made `pickTty()` async with a 100ms timeout to handle cases where `/dev/tty` hangs (e.g., in sandboxed environments like macOS). The changes:

1. **`pickTty()` becomes async**: Returns `Promise<TtyTarget>` instead of `TtyTarget`
2. **Adds timeout mechanism**: 100ms safety timeout that falls back to stdio if `/dev/tty` doesn't respond
3. **Event-driven stream handling**: Waits for 'open' event before considering the stream usable, handles 'error' event for immediate failures
4. **Test updates**: Tests modified to emit 'open' event from mock streams to simulate real behavior

## LLxprt Current State

**File**: `packages/cli/src/ui/utils/commandUtils.ts`

LLxprt's `pickTty()` is **currently synchronous with no async timeout** — the upstream fix has NOT yet been applied. Verify before starting:

```typescript
const pickTty = (): TtyTarget => {
  if (process.platform !== 'win32') {
    try {
      const devTty = fs.createWriteStream('/dev/tty');
      devTty.on('error', () => {});
      return { stream: devTty, closeAfter: true };
    } catch {
      // fall through
    }
  }
  // fallback to stdio...
};
```

`copyToClipboard` calls `pickTty()` synchronously:
```typescript
const tty = pickTty();
```

> **Implementation note**: The synchronous approach is unsafe — `fs.createWriteStream('/dev/tty')` can hang indefinitely in sandboxed/SSH environments without ever emitting 'open' or 'error'. The fix below replaces this with an event-driven async approach with a 100ms timeout guard.

**Test file**: `packages/cli/src/ui/utils/commandUtils.test.ts`

Current test mock setup throws error for `/dev/tty` by default:
```typescript
mockFs.createWriteStream.mockImplementation(() => {
  throw new Error('ENOENT');
});
```

## Adaptation Plan

### File-by-File Changes

#### 1. `packages/cli/src/ui/utils/commandUtils.ts`

1. Extract the stdio fallback logic into a new helper function `getStdioTty()`:
   ```typescript
   const getStdioTty = (): TtyTarget => {
     if (process.stderr?.isTTY)
       return { stream: process.stderr, closeAfter: false };
     if (process.stdout?.isTTY)
       return { stream: process.stdout, closeAfter: false };
     return null;
   };
   ```

2. Convert `pickTty()` to async with timeout:
   ```typescript
   const pickTty = (): Promise<TtyTarget> =>
     new Promise((resolve) => {
       if (process.platform !== 'win32') {
         try {
           const devTty = fs.createWriteStream('/dev/tty');

           // Safety timeout: 100ms
           const timeout = setTimeout(() => {
             devTty.removeAllListeners('open');
             devTty.removeAllListeners('error');
             devTty.destroy();
             resolve(getStdioTty());
           }, 100);

           devTty.once('open', () => {
             clearTimeout(timeout);
             devTty.removeAllListeners('error');
             devTty.on('error', () => {});
             resolve({ stream: devTty, closeAfter: true });
           });

           devTty.once('error', () => {
             clearTimeout(timeout);
             devTty.removeAllListeners('open');
             resolve(getStdioTty());
           });
           return;
         } catch {
           // synchronous failure
         }
       }
       resolve(getStdioTty());
     });
   ```

3. Update `copyToClipboard` to await `pickTty()`:
   ```typescript
   const tty = await pickTty();
   ```

#### 2. `packages/cli/src/ui/utils/commandUtils.test.ts`

1. Add `constants: { W_OK: 2 }` to mockFs — **optional/no-op** unless an access-check is added nearby that actually reads `fs.constants.W_OK`; include it only if the implementation uses it
2. Add `removeAllListeners` to mock stream — the async `pickTty()` calls `devTty.removeAllListeners(...)` before destroying on timeout; without this the mock will throw:
   ```typescript
   removeAllListeners: jest.fn().mockReturnThis(),
   ```
3. Update default mock to emit 'open' event instead of throwing:
   ```typescript
   mockFs.createWriteStream.mockImplementation(() => {
     const tty = makeWritable({ isTTY: true });
     setTimeout(() => tty.emit('open'), 0);
     return tty;
   });
   ```
4. Update specific tests to emit 'open' or 'error' events as appropriate
5. Add new tests:
   - **Error fallback** (`EACCES` / permission denied): mock stream emits `'error'` synchronously or asynchronously; verify clipboard falls back to stdio TTY
   - **Hang/timeout fallback**: mock stream never emits `'open'` or `'error'`; use fake timers (`jest.useFakeTimers()`) and advance by 100ms; verify `destroy()` was called and clipboard falls back to stdio TTY

## Files to Read

- `packages/cli/src/ui/utils/commandUtils.ts`
- `packages/cli/src/ui/utils/commandUtils.test.ts`

## Files to Modify

- `packages/cli/src/ui/utils/commandUtils.ts`
- `packages/cli/src/ui/utils/commandUtils.test.ts`

## Specific Verification

1. Run existing tests: `npm run test -- packages/cli/src/ui/utils/commandUtils.test.ts`
2. All OSC-52 clipboard tests should pass
3. New timeout fallback tests should pass
4. Manual verification: Test clipboard in SSH session on macOS

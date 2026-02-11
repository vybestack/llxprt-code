# REIMPLEMENT: 9ebf3217 — Synchronous keyboard writes

## Upstream Summary

Replace `process.stdout.write()` with `fs.writeSync(process.stdout.fd, ...)` in `kittyProtocolDetector.ts` for keyboard mode detection/toggling. Wrap disable/enable functions in try/catch blocks.

## Why REIMPLEMENT

LLxprt's `kittyProtocolDetector.ts` is significantly restructured vs upstream:
- Different function names and structure
- No SGR mouse handling in some code paths
- Still uses `process.stdout.write` (not `fs.writeSync`)
- The file has diverged enough that a cherry-pick would fail

## What Upstream Changed

1. Add `import * as fs from 'node:fs'`
2. `detectAndEnableKittyProtocol()`: replace two separate `process.stdout.write()` calls with single `fs.writeSync(process.stdout.fd, '\x1b[?u\x1b[c')`
3. `disableAllProtocols()`: wrap in try/catch, replace `process.stdout.write` → `fs.writeSync`
4. `enableSupportedProtocol()`: wrap in try/catch, replace `process.stdout.write` → `fs.writeSync`

## Implementation Steps

1. **Read** current LLxprt `packages/cli/src/ui/utils/kittyProtocolDetector.ts`
2. **Add** `import * as fs from 'node:fs'` at top
3. **Find** all `process.stdout.write()` calls in the file
4. **Replace** each with `fs.writeSync(process.stdout.fd, ...)`:
   - In detection: combine queries into single write where possible
   - In disable functions: wrap in try/catch (ignore errors)
   - In enable functions: wrap in try/catch (ignore errors)
5. **Verify** no `process.stdout.write` calls remain in the file (all should be `fs.writeSync`)
6. **Check** test file if it exists and update mocks if needed

## Why fs.writeSync?

Synchronous writes are critical here because:
- Terminal escape sequences for keyboard mode detection must be sent atomically
- `process.stdout.write` is async and can be intercepted by the stdout protection layer (d1e35f86)
- `fs.writeSync` bypasses the Node.js stream layer entirely, writing directly to the fd

## Branding: N/A

## Verification

```bash
npm run lint && npm run typecheck
```

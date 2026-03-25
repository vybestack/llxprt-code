# REIMPLEMENT Playbook: ae19802 — Add timeout for shell-utils

## Upstream Change Summary

This commit adds a timeout to the bash command parsing in `shell-utils.ts` to prevent hangs. The changes:

1. Adds a `PARSE_TIMEOUT_MICROS` constant (1 second)
2. Updates `parseCommandTree()` to accept an optional timeout parameter
3. Uses `performance.now()` to track elapsed time
4. Passes a `progressCallback` to the tree-sitter parser that checks for timeout
5. Returns `null` and logs an error if parsing times out
6. Adds tests for the timeout behavior

**IMPORTANT NOTE**: LLxprt uses `shell-parser.ts` (NOT inline in shell-utils.ts) for tree-sitter parsing. The adaptation must be applied to `shell-parser.ts`.

**Files changed upstream:**
- `packages/core/src/utils/shell-utils.test.ts`
- `packages/core/src/utils/shell-utils.ts`

## LLxprt Current State

### Key Architectural Difference

**Upstream**: Tree-sitter parsing is inline in `shell-utils.ts`
**LLxprt**: Tree-sitter parsing is in a separate `shell-parser.ts` file

### `packages/core/src/utils/shell-parser.ts`

LLxprt has:
```typescript
export function parseShellCommand(command: string): Tree | null {
  if (!parser) {
    return null;
  }
  return parser.parse(command);
}
```

This function needs to be updated with timeout logic.

LLxprt's `shell-parser.ts` also has `parseCommandDetails()`, which calls `parser.parse(command)`
**directly** (not via `parseShellCommand()`). This means `parseCommandDetails()` is also
vulnerable to hanging on malicious input and **must** be updated to route through the
timeout-protected parsing path.

### Logger Reference — IMPORTANT

LLxprt's `shell-parser.ts` does NOT use a module-level `debugLogger` import from a shared
`debugLogger.js` module. Instead, it:

1. Imports `DebugLogger` **class** from `'../debug/DebugLogger.js'`
2. Creates its own instance: `const debugLogger = new DebugLogger('llxprt:shell-parser');`

Any timeout error logging must use this local `debugLogger` instance. Do NOT attempt to import
from `'./debugLogger.js'` — that path does not exist in this package.

### `packages/core/src/utils/shell-utils.ts`

LLxprt uses `shell-parser.ts` functions for parsing. Need to verify how it calls the parser.

## Adaptation Plan

### 1. Modify `packages/core/src/utils/shell-parser.ts`

Add timeout constant:
```typescript
const PARSE_TIMEOUT_MICROS = 1000 * 1000; // 1 second
```

Update `parseShellCommand()` function to include timeout:
```typescript
export function parseShellCommand(
  command: string,
  timeoutMicros: number = PARSE_TIMEOUT_MICROS,
): Tree | null {
  if (!parser || !command.trim()) {
    return null;
  }

  const deadline = performance.now() + timeoutMicros / 1000;
  let timedOut = false;

  try {
    const tree = parser.parse(command, null, {
      progressCallback: () => {
        if (performance.now() > deadline) {
          timedOut = true;
          return true as unknown as void; // Returning true cancels parsing
        }
      },
    });

    if (timedOut) {
      debugLogger.error('Bash command parsing timed out for command:', command);
      return null;
    }

    return tree;
  } catch {
    return null;
  }
}
```

### 2. Update `parseCommandDetails()` — REQUIRED

`parseCommandDetails()` in `shell-parser.ts` currently calls `parser.parse(command)` directly
and bypasses the timeout protection entirely. It **must** be updated to route through
`parseShellCommand()` instead:

```typescript
export function parseCommandDetails(
  command: string,
): CommandParseResult | null {
  if (!parser || !bashLanguage) {
    return null;
  }

  try {
    const tree = parseShellCommand(command);  // route through timeout-protected path
    if (!tree) {
      return { details: [], hasError: true };
    }
    // ... rest of function unchanged
  } catch {
    return null;
  }
}
```

### 3. Add Tests to `packages/core/src/utils/shell-parser.test.ts` (primary test file)

The primary test file is `packages/core/src/utils/shell-parser.test.ts`. Add timeout tests
there, NOT in `shell-utils.test.ts`.

Use `vi.spyOn(performance, 'now')` for deterministic timeout testing — this avoids brittle
tests that depend on actual parse complexity:

```typescript
it('should handle bash parser timeouts in parseShellCommand', async () => {
  await initializeParser();

  const nowSpy = vi.spyOn(performance, 'now');
  // First call sets the deadline, subsequent calls simulate time passing past it
  nowSpy.mockReturnValueOnce(0).mockReturnValue(2000000);

  const command = 'ls -la';
  const result = parseShellCommand(command);
  expect(result).toBeNull();

  nowSpy.mockRestore();
});

it('should handle bash parser timeouts in parseCommandDetails', async () => {
  await initializeParser();

  const nowSpy = vi.spyOn(performance, 'now');
  nowSpy.mockReturnValueOnce(0).mockReturnValue(2000000);

  const command = 'ls -la';
  const result = parseCommandDetails(command);
  // When parseShellCommand times out, parseCommandDetails returns hasError: true
  expect(result).toEqual({ details: [], hasError: true });

  nowSpy.mockRestore();
});
```

To verify `debugLogger.error` is called, spy on the `DebugLogger` prototype (since `shell-parser.ts`
creates its own instance — there is no shared singleton to mock):

```typescript
import { DebugLogger } from '../debug/DebugLogger.js';

const errorSpy = vi.spyOn(DebugLogger.prototype, 'error').mockImplementation(() => {});
// ... run test ...
expect(errorSpy).toHaveBeenCalledWith(
  'Bash command parsing timed out for command:',
  command,
);
errorSpy.mockRestore();
```

Do NOT mock `'./debugLogger.js'` — that module does not exist in `packages/core`.

## Files to Read

1. `packages/core/src/utils/shell-parser.ts`
2. `packages/core/src/utils/shell-utils.ts`
3. `packages/core/src/utils/shell-parser.test.ts`
4. `packages/core/src/debug/DebugLogger.ts` (understand the class interface for spying)

## Files to Modify

1. `packages/core/src/utils/shell-parser.ts` - Add timeout to `parseShellCommand()` and route
   `parseCommandDetails()` through the timeout-protected path
2. `packages/core/src/utils/shell-parser.test.ts` - Add timeout tests (primary test file)

## Specific Verification

Run the full verification suite:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

Additional checks:
- Shell command parsing works normally for typical commands
- A mocked-timeout test in `shell-parser.test.ts` passes, confirming timeout handling

## Notes

**CRITICAL**: LLxprt's architecture difference means the timeout must be applied to
`shell-parser.ts`, not `shell-utils.ts`. The upstream commit modifies `shell-utils.ts` directly,
but LLxprt has the parsing logic separated into `shell-parser.ts`.

**CRITICAL**: LLxprt's `shell-parser.ts` creates its own `DebugLogger` instance via
`new DebugLogger('llxprt:shell-parser')`. Tests must spy on `DebugLogger.prototype.error`
(not mock a non-existent `./debugLogger.js` module) to verify error logging.

**CRITICAL**: Both `parseShellCommand()` AND `parseCommandDetails()` call `parser.parse()`
and both must be protected. After the fix, `parseCommandDetails()` should call
`parseShellCommand()` rather than `parser.parse()` directly.

The timeout prevents denial-of-service from extremely complex shell commands that could cause
the tree-sitter parser to hang.

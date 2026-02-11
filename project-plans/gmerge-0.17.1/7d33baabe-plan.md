# Reimplementation Plan: Uninstall Multiple Extensions

**Upstream SHA**: `7d33baabe`
**Upstream subject**: feat: uninstall multiple extensions (#13016)

## Why Different from Upstream

Upstream's `handleUninstall()` uses `ExtensionManager.uninstallExtension()` class method. LLxprt uses the standalone `uninstallExtension()` function from `../../config/extension.js`. Mock patterns must follow the `vi.hoisted()` + `vi.mock()` style established in `install.test.ts`.

## Current State

- **`uninstall.ts`**: `handleUninstall(args: { name: string })` — calls `uninstallExtension(name, false)`, catches error → `console.error` + `process.exit(1)`
- **`uninstall.test.ts`**: 21 lines — single parser validation test (`should fail if no source is provided`), no `handleUninstall` unit tests, no mocks
- **`uninstallExtension` signature**: `async function uninstallExtension(extensionIdentifier: string, isUpdate: boolean, _cwd?: string): Promise<void>` — throws if extension not found

## Three Failure Classes

1. **Initialization failure**: Something goes wrong BEFORE the loop starts (e.g., `names` array is somehow invalid after parsing, or a required setup step fails). This should fail immediately with `console.error` + `process.exit(1)` — no loop attempted, no per-extension uninstall calls made.
2. **Per-extension failure**: `uninstallExtension()` throws for a specific name → collect error, continue to next extension, log all failures at end, `process.exit(1)`.
3. **All-failures**: Every extension fails → same behavior as partial (collect all, log all, `process.exit(1)`). No special case needed beyond the general "errors.length > 0" check.

## Backward Compatibility

Yargs `<names..>` with `array: true` accepts one or more positional args:
- `llxprt extensions uninstall my-ext` → `names = ['my-ext']` [OK]
- `llxprt extensions uninstall ext1 ext2 ext3` → `names = ['ext1', 'ext2', 'ext3']` [OK]

---

## Phase 1: RED — Write All Failing Tests

**File**: `packages/cli/src/commands/extensions/uninstall.test.ts`

Replace the entire file. Tests are written against the **target** API (`handleUninstall({ names: string[] })`) so they will fail against current code.

### Mock setup (follows `install.test.ts` pattern)

```typescript
import { describe, it, expect, vi, beforeEach, afterEach, type Mock, type MockInstance } from 'vitest';
import type * as extensionModule from '../../config/extension.js';
import yargs from 'yargs';

const mockUninstallExtension: Mock<typeof extensionModule.uninstallExtension> =
  vi.hoisted(() => vi.fn());

vi.mock('../../config/extension.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/extension.js')>();
  return {
    ...actual,
    uninstallExtension: mockUninstallExtension,
  };
});
```

### Test: parser validation

```typescript
describe('extensions uninstall command', () => {
  it('should fail if no name is provided', () => {
    const validationParser = yargs([])
      .command(uninstallCommand)
      .fail(false)
      .locale('en');
    expect(() => validationParser.parse('uninstall')).toThrow(
      'Not enough non-option arguments: got 0, need at least 1',
    );
  });
});
```

### Tests: `handleUninstall` behavior

```typescript
describe('handleUninstall', () => {
  let consoleLogSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let processExitSpy: MockInstance;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    mockUninstallExtension.mockClear();
    vi.clearAllMocks();
  });

  it('should uninstall a single extension', async () => {
    mockUninstallExtension.mockResolvedValue(undefined);
    await handleUninstall({ names: ['my-ext'] });
    expect(mockUninstallExtension).toHaveBeenCalledWith('my-ext', false);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "my-ext" successfully uninstalled.',
    );
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should uninstall multiple extensions', async () => {
    mockUninstallExtension.mockResolvedValue(undefined);
    await handleUninstall({ names: ['ext-a', 'ext-b', 'ext-c'] });
    expect(mockUninstallExtension).toHaveBeenCalledTimes(3);
    expect(mockUninstallExtension).toHaveBeenCalledWith('ext-a', false);
    expect(mockUninstallExtension).toHaveBeenCalledWith('ext-b', false);
    expect(mockUninstallExtension).toHaveBeenCalledWith('ext-c', false);
    expect(consoleLogSpy).toHaveBeenCalledTimes(3);
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should deduplicate extension names', async () => {
    mockUninstallExtension.mockResolvedValue(undefined);
    await handleUninstall({ names: ['ext-a', 'ext-b', 'ext-a'] });
    expect(mockUninstallExtension).toHaveBeenCalledTimes(2);
    expect(mockUninstallExtension).toHaveBeenCalledWith('ext-a', false);
    expect(mockUninstallExtension).toHaveBeenCalledWith('ext-b', false);
  });

  it('should continue after partial failure and exit with code 1', async () => {
    mockUninstallExtension
      .mockResolvedValueOnce(undefined)          // ext-a succeeds
      .mockRejectedValueOnce(new Error('not found'))  // ext-b fails
      .mockResolvedValueOnce(undefined);          // ext-c succeeds

    await handleUninstall({ names: ['ext-a', 'ext-b', 'ext-c'] });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "ext-a" successfully uninstalled.',
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "ext-c" successfully uninstalled.',
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to uninstall "ext-b": not found',
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should log all errors when every extension fails and exit with code 1', async () => {
    mockUninstallExtension
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('permission denied'));

    await handleUninstall({ names: ['ext-a', 'ext-b'] });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to uninstall "ext-a": not found',
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to uninstall "ext-b": permission denied',
    );
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle single-name backward compatibility', async () => {
    mockUninstallExtension.mockResolvedValue(undefined);
    await handleUninstall({ names: ['single-ext'] });
    expect(mockUninstallExtension).toHaveBeenCalledTimes(1);
    expect(mockUninstallExtension).toHaveBeenCalledWith('single-ext', false);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "single-ext" successfully uninstalled.',
    );
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should exit immediately if names array is empty after dedup', async () => {
    await handleUninstall({ names: [] as string[] });
    expect(mockUninstallExtension).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('No valid extension names'),
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
```

**Expected result**: All `handleUninstall` tests fail because current signature is `{ name: string }`, not `{ names: string[] }`.

---

## Phase 2: GREEN — Minimal Implementation to Pass Tests

**File**: `packages/cli/src/commands/extensions/uninstall.ts`

### Step 1: Change interface

```typescript
// Before:
interface UninstallArgs {
  name: string;
}

// After:
interface UninstallArgs {
  names: string[];
}
```

### Step 2: Rewrite `handleUninstall`

```typescript
export async function handleUninstall(args: UninstallArgs): Promise<void> {
  const uniqueNames = [...new Set(args.names)];

  // Initialization guard — fail fast before the loop if input is invalid
  if (uniqueNames.length === 0) {
    console.error('No valid extension names provided to uninstall.');
    process.exit(1);
    return; // unreachable, but satisfies TypeScript control-flow
  }

  const errors: Array<{ name: string; error: string }> = [];

  for (const name of uniqueNames) {
    try {
      await uninstallExtension(name, false);
      console.log(`Extension "${name}" successfully uninstalled.`);
    } catch (error) {
      errors.push({ name, error: (error as Error).message });
    }
  }

  if (errors.length > 0) {
    for (const { name, error } of errors) {
      console.error(`Failed to uninstall "${name}": ${error}`);
    }
    process.exit(1);
  }
}
```

### Step 3: Update command definition

```typescript
export const uninstallCommand: CommandModule = {
  command: 'uninstall <names..>',
  describe: 'Uninstalls one or more extensions.',
  builder: (yargs) =>
    yargs
      .positional('names', {
        describe: 'The names or source paths of the extensions to uninstall.',
        type: 'string',
        array: true,
      })
      .check((argv) => {
        if (!argv.names || argv.names.length === 0) {
          throw new Error(
            'Please include at least one extension name to uninstall.',
          );
        }
        return true;
      }),
  handler: async (argv) => {
    await handleUninstall({
      names: argv['names'] as string[],
    });
  },
};
```

**Expected result**: All tests pass.

---

## Phase 3: REFACTOR — Assess and Clean Up

Evaluate after GREEN:
- Is the `errors` accumulator pattern clear enough? (Likely yes — keep as-is.)
- Any duplicate logic worth extracting? (Unlikely for this scope.)
- If no improvement is needed, skip this phase.

---

## Verification

```bash
npm run test -- --filter uninstall
npm run lint && npm run typecheck
```

Manual smoke tests:
- `llxprt extensions uninstall single-ext` — single name still works
- `llxprt extensions uninstall ext1 ext2 ext3` — multi-name works
- `llxprt extensions uninstall` — fails with missing arg error

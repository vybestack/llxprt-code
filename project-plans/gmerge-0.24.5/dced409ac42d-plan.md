# Playbook: Add Folder Trust Support To Hooks

**Upstream SHA:** `dced409ac42d`
**Upstream Subject:** Add Folder Trust Support To Hooks (#15325)
**Upstream Stats:** 10 files, 188 insertions(+), 19 deletions(-)

## What Upstream Does

Moves `ConfigSource` enum from `hookRegistry.ts` to `types.ts`, adds it as an optional field to `CommandHookConfig`, and implements folder trust security checks in `hookRegistry` and `hookRunner`. When a folder is untrusted, project-level hooks are skipped entirely. `HookRunner` now requires `Config` in its constructor to perform secondary security validation, and `HookSystem` passes `config` to `HookRunner` during instantiation. Tests are updated across the hook system to reflect these changes.

## LLxprt Adaptation Strategy

LLxprt's `ConfigSource` enum is already in `packages/core/src/hooks/hookRegistry.ts` (verified at line 16). Unlike upstream which moved it to `types.ts`, LLxprt keeps it in `hookRegistry.ts` and exports it from `index.ts` (verified). The key changes needed are:

1. Add `source?: ConfigSource` field to `CommandHookConfig` in `types.ts`
2. Modify `HookRegistry.processHookDefinition` to set `hookConfig.source = source` when creating registry entries
3. Add `Config` parameter to `HookRunner` constructor
4. Update `HookRegistry.processHooksFromConfig` to check folder trust before loading project hooks
5. Add secondary security check in `HookRunner.executeCommandHook` to block project hooks in untrusted folders
6. Update `HookSystem` to pass `config` to `HookRunner` constructor
7. Update all test files to match new signatures

## LLxprt File Existence Map

| Upstream Path | LLxprt Equivalent | Status | Action |
|--------------|-------------------|--------|--------|
| `packages/core/src/hooks/types.ts` | `packages/core/src/hooks/types.ts` | [OK] EXISTS | PORT — Add `source?: ConfigSource` to `CommandHookConfig` |
| `packages/core/src/hooks/hookRegistry.ts` | `packages/core/src/hooks/hookRegistry.ts` | [OK] EXISTS | PORT — Add trust checks, set source field |
| `packages/core/src/hooks/hookRunner.ts` | `packages/core/src/hooks/hookRunner.ts` | [OK] EXISTS | PORT — Add Config parameter, secondary security check |
| `packages/core/src/hooks/hookSystem.ts` | `packages/core/src/hooks/hookSystem.ts` | [OK] EXISTS | PORT — Pass config to HookRunner |
| `packages/core/src/hooks/index.ts` | `packages/core/src/hooks/index.ts` | [OK] EXISTS | VERIFY — ConfigSource export (already exported) |
| `packages/core/src/hooks/__tests__/hookRegistry.test.ts` | `packages/core/src/hooks/hookRegistry.test.ts` | EXISTS | PORT to `packages/core/src/hooks/hookRegistry.test.ts` |
| `packages/core/src/hooks/__tests__/hookRunner.test.ts` | `packages/core/src/hooks/hookRunner.test.ts` | EXISTS | PORT to `packages/core/src/hooks/hookRunner.test.ts` |
| `packages/core/src/hooks/__tests__/hookPlanner.test.ts` | `packages/core/src/hooks/hookPlanner.test.ts` | EXISTS | PORT to `packages/core/src/hooks/hookPlanner.test.ts` |
| `packages/cli/src/config/trustedFolders.ts` | `packages/cli/src/config/trustedFolders.ts` | [OK] EXISTS | SKIP — Minor whitespace only |

**Note:** LLxprt test files are at `packages/core/src/hooks/*.test.ts` (root level), not in `__tests__/` subdirectory.

## Preflight Checks

Execute these commands before starting implementation to verify file existence:

```bash
# Verify core hook files exist
test -f packages/core/src/hooks/types.ts || echo "MISSING: types.ts"
test -f packages/core/src/hooks/hookRegistry.ts || echo "MISSING: hookRegistry.ts"
test -f packages/core/src/hooks/hookRunner.ts || echo "MISSING: hookRunner.ts"
test -f packages/core/src/hooks/hookSystem.ts || echo "MISSING: hookSystem.ts"
test -f packages/core/src/hooks/index.ts || echo "MISSING: index.ts"

# Verify ConfigSource enum exists in hookRegistry.ts
grep -n "enum ConfigSource" packages/core/src/hooks/hookRegistry.ts || echo "MISSING: ConfigSource enum"

# Verify ConfigSource is exported from index.ts
grep "export.*ConfigSource" packages/core/src/hooks/index.ts || echo "MISSING: ConfigSource export"

# Verify test files exist
test -f packages/core/src/hooks/hookRegistry.test.ts || echo "MISSING: hookRegistry.test.ts"
test -f packages/core/src/hooks/hookRunner.test.ts || echo "MISSING: hookRunner.test.ts"
test -f packages/core/src/hooks/hookPlanner.test.ts || echo "MISSING: hookPlanner.test.ts"

# Verify Config has isTrustedFolder method
grep -n "isTrustedFolder" packages/core/src/config/config.ts || echo "MISSING: Config.isTrustedFolder"

# Verify folder trust infrastructure exists
grep -n "getFolderTrust" packages/core/src/config/config.ts || echo "MISSING: Config.getFolderTrust"
```

**Expected Output:** All files should exist, no "MISSING" messages.

## Inter-Playbook Dependencies

### Provides to Downstream Playbooks

- **dced409ac42d → e6344a8c2478:** Adds `source` field and trust checks that are required for project hook warnings
- **dced409ac42d → ALL:** Establishes folder trust security infrastructure for all subsequent hook commits

### Consumes from Upstream

- **NONE** — This is the first commit in the hooks batch

### Contracts

1. **HookConfig.source field**: All downstream commits expect `CommandHookConfig` to have optional `source?: ConfigSource` field
2. **HookRunner Config parameter**: All downstream commits expect `new HookRunner(config)` constructor signature
3. **Registry trust checks**: Project hooks (ConfigSource.Project) are blocked when `config.isTrustedFolder()` returns false
4. **Secondary runner validation**: `HookRunner.executeCommandHook` performs additional trust validation before executing project hooks

## Files to Create/Modify

- **MODIFY** `packages/core/src/hooks/types.ts` — Add `source?: ConfigSource` to `CommandHookConfig`
- **MODIFY** `packages/core/src/hooks/hookRegistry.ts` — Set source on hooks, add trust check before loading project hooks
- **MODIFY** `packages/core/src/hooks/hookRunner.ts` — Accept Config in constructor, add secondary security check
- **MODIFY** `packages/core/src/hooks/hookSystem.ts` — Pass config to HookRunner constructor
- **VERIFY** `packages/core/src/hooks/index.ts` — ConfigSource export (should already exist)
- **MODIFY** `packages/core/src/hooks/hookRegistry.test.ts` — Update tests for new behavior
- **MODIFY** `packages/core/src/hooks/hookRunner.test.ts` — Update tests with Config parameter
- **MODIFY** `packages/core/src/hooks/hookPlanner.test.ts` — Update test mocks to include Config parameter

## Implementation Steps

### Step 1: Verify Current State

```bash
# Confirm ConfigSource location and export
grep -A 5 "enum ConfigSource" packages/core/src/hooks/hookRegistry.ts
grep "export.*ConfigSource" packages/core/src/hooks/index.ts
```

**Expected:** ConfigSource enum at hookRegistry.ts line 16, exported from index.ts line 27.

### Step 2: Update types.ts

**File:** `packages/core/src/hooks/types.ts`

**Location:** Add to `CommandHookConfig` interface (around line 25-35)

**Change:**
```typescript
export interface CommandHookConfig {
  type: HookType.Command;
  command: string;
  name?: string;
  description?: string;
  timeout?: number;
  source?: ConfigSource;  // ADD THIS LINE
}
```

**Import Required:**
```typescript
import { ConfigSource } from './hookRegistry.js';  // ADD at top of file
```

### Step 3: Update hookRegistry.ts

**File:** `packages/core/src/hooks/hookRegistry.ts`

**Change 1:** In `processHookDefinition` method (around line 170), add source assignment:

```typescript
private processHookDefinition(
  eventName: HookEventName,
  definition: HookDefinition,
  source: ConfigSource,
): void {
  // ... existing validation code ...
  
  for (const hookConfig of definition.hooks) {
    // ADD THIS LINE
    (hookConfig as any).source = source;
    
    this.entries.push({
      config: hookConfig,
      source: source,  // existing line
      eventName,
      matcher: definition.matcher,
      sequential: definition.sequential ?? false,
      enabled: true,
    });
  }
}
```

**Change 2:** In `processHooksFromConfig` method (around line 121), add trust check BEFORE processing project hooks:

```typescript
private processHooksFromConfig(): void {
  const configHooks = this.config.getHooks();
  
  // ADD THIS BLOCK
  // Skip project hooks if folder is not trusted
  if (!this.config.isTrustedFolder()) {
    debugLogger.log('Skipping project hooks - folder not trusted');
    // Still process extension hooks below
  } else {
    // Process project hooks only if trusted
    this.processHooksConfiguration(configHooks, ConfigSource.Project);
  }
  
  // Process extension hooks (always allowed)
  const extensions = this.config.getExtensions();
  for (const extension of extensions) {
    if (extension.hooks) {
      this.processHooksConfiguration(
        extension.hooks,
        ConfigSource.Extensions,
      );
    }
  }
}
```

### Step 4: Update hookRunner.ts

**File:** `packages/core/src/hooks/hookRunner.ts`

**Change 1:** Add Config field and update constructor (around line 15-25):

```typescript
import type { Config } from '../config/config.js';  // ADD import
import { ConfigSource } from './hookRegistry.js';    // ADD import

export class HookRunner {
  private readonly config: Config;  // ADD THIS LINE
  
  constructor(config: Config) {  // CHANGE: add config parameter
    this.config = config;  // ADD THIS LINE
  }
```

**Change 2:** In `executeCommandHook` method (around line 50-100), add security check BEFORE executing:

```typescript
private async executeCommandHook(
  hookConfig: HookConfig,
  eventName: HookEventName,
  input: HookInput,
): Promise<HookExecutionResult> {
  const startTime = Date.now();
  
  // ADD THIS BLOCK (before command execution)
  // Secondary security check - block project hooks in untrusted folders
  if (hookConfig.source === ConfigSource.Project && !this.config.isTrustedFolder()) {
    const errorMessage = 'Project hook blocked - folder not trusted';
    debugLogger.warn(errorMessage);
    return {
      hookConfig,
      eventName,
      success: false,
      error: new Error(errorMessage),
      duration: Date.now() - startTime,
    };
  }
  
  // ... existing command execution code ...
}
```

### Step 5: Update hookSystem.ts

**File:** `packages/core/src/hooks/hookSystem.ts`

**Location:** Constructor, around line 60

**Change:**
```typescript
constructor(
  config: Config,
  messageBus?: MessageBus,
  injectedDebugLogger?: DebugLogger,
) {
  this.config = config;
  this.messageBus = messageBus;
  this.injectedDebugLogger = injectedDebugLogger;
  
  this.registry = new HookRegistry(config);
  this.planner = new HookPlanner(this.registry);
  this.runner = new HookRunner(this.config);  // CHANGE: pass config
  this.aggregator = new HookAggregator();
}
```

### Step 6: Update Tests

**File:** `packages/core/src/hooks/hookRegistry.test.ts`

**Add mock for `isTrustedFolder`:**
```typescript
const mockConfig = {
  getHooks: vi.fn(() => ({})),
  getExtensions: vi.fn(() => []),
  isTrustedFolder: vi.fn(() => true),  // ADD THIS LINE
} as unknown as Config;
```

**Add test for untrusted folder blocking:**
```typescript
it('should skip project hooks when folder is not trusted', async () => {
  const mockConfig = {
    getHooks: vi.fn(() => ({
      BeforeTool: [
        {
          hooks: [{ type: HookType.Command, command: 'echo test', name: 'test-hook' }],
        },
      ],
    })),
    getExtensions: vi.fn(() => []),
    isTrustedFolder: vi.fn(() => false),  // untrusted
  } as unknown as Config;

  const registry = new HookRegistry(mockConfig);
  await registry.initialize();

  const hooks = registry.getHooksForEvent(HookEventName.BeforeTool);
  expect(hooks).toHaveLength(0);  // project hooks should be skipped
});
```

**File:** `packages/core/src/hooks/hookRunner.test.ts`

**Update all `new HookRunner()` instantiations:**
```typescript
const mockConfig = {
  isTrustedFolder: vi.fn(() => true),
} as unknown as Config;

const runner = new HookRunner(mockConfig);  // ADD config parameter
```

**Add test for secondary security check:**
```typescript
it('should block project hooks in untrusted folders during execution', async () => {
  const mockConfig = {
    isTrustedFolder: vi.fn(() => false),
  } as unknown as Config;

  const runner = new HookRunner(mockConfig);
  
  const hookConfig = {
    type: HookType.Command,
    command: 'echo test',
    source: ConfigSource.Project,
  };

  const result = await runner.execute([hookConfig], HookEventName.BeforeTool, {});
  
  expect(result.success).toBe(false);
  expect(result.error?.message).toContain('folder not trusted');
});
```

**File:** `packages/core/src/hooks/hookPlanner.test.ts`

**Update if test setup creates HookRunner instances** (check file first, may not need changes if planner doesn't instantiate runner).

## Deterministic Verification Commands

Execute after implementation:

```bash
# Type check
npm run typecheck

# Run hook system tests
npm run test -- packages/core/src/hooks/hookRegistry.test.ts
npm run test -- packages/core/src/hooks/hookRunner.test.ts
npm run test -- packages/core/src/hooks/hookPlanner.test.ts
npm run test -- packages/core/src/hooks/hookSystem.test.ts

# Verify new source field exists
grep -A 3 "interface CommandHookConfig" packages/core/src/hooks/types.ts | grep "source"

# Verify trust checks are in place
grep -n "isTrustedFolder" packages/core/src/hooks/hookRegistry.ts
grep -n "isTrustedFolder" packages/core/src/hooks/hookRunner.ts

# Verify HookRunner constructor signature changed
grep -n "constructor(config: Config)" packages/core/src/hooks/hookRunner.ts

# Verify HookSystem passes config to runner
grep -n "new HookRunner(this.config)" packages/core/src/hooks/hookSystem.ts
```

**Success Criteria:**
- All tests pass
- Type check passes
- grep commands find expected patterns
- No references to unmocked `Config` in tests

## Execution Notes

- **Batch group:** Hooks Phase 1 - Infrastructure & Security
- **Dependencies:** NONE (first in execution sequence)
- **Enables:** e6344a8c2478 (project hook warnings), all subsequent hook commits
- **Test coverage:** Unit tests for trust blocking at registry and runner levels
- **Breaking change:** HookRunner constructor signature changes (all call sites must pass Config)

## Risk Assessment

- **Risk:** Config parameter added to HookRunner constructor — all instantiation sites must be updated
- **Mitigation:** Only HookSystem creates HookRunner instances (verified in hookSystem.ts line 67)
- **Risk:** Tests may fail if isTrustedFolder not mocked
- **Mitigation:** Add isTrustedFolder mock to all Config test doubles
- **Risk:** ConfigSource import in types.ts creates circular dependency
- **Mitigation:** Import from hookRegistry.js (which already has no circular deps)

## Post-Implementation Checklist

- [ ] types.ts has `source?: ConfigSource` in CommandHookConfig
- [ ] hookRegistry.ts sets `hookConfig.source = source` in processHookDefinition
- [ ] hookRegistry.ts checks `isTrustedFolder()` before processing project hooks
- [ ] hookRunner.ts accepts Config in constructor
- [ ] hookRunner.ts has secondary trust check in executeCommandHook
- [ ] hookSystem.ts passes config to `new HookRunner()`
- [ ] All test files mock `isTrustedFolder` method
- [ ] npm run typecheck passes
- [ ] npm run test -- packages/core/src/hooks/ passes
- [ ] grep verifications all succeed

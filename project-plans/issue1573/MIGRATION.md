# Migration Guide

## Overview

This document describes how callers should update their code as the Config decomposition
progresses. Every phase preserves backward compatibility via re-exports, so no caller is
forced to change immediately. Changes are opt-in and incremental.

This is a **backward-compatible refactor**, not a behavior change. No domain redesign of
provider/client lifecycle, no full replacement of Config, no parameter-object redesign.

---

## Import Path Changes

### Types and Enums (Phase 1)

No changes required. Types move from `config.ts` to `configTypes.ts`, but re-exports
from `config.ts` and `config/index.ts` preserve all existing import paths.

```typescript
// These all continue to work unchanged:
import { ApprovalMode, type ConfigParameters } from '@vybestack/llxprt-code-core';
import { type TelemetrySettings } from '@vybestack/llxprt-code-core';
import { ApprovalMode } from '../../config/config.js';
```

### Consumer Interfaces (Phase 2)

New imports are available but not required:

```typescript
// New (opt-in):
import type { ToolHostConfig, RuntimeSessionConfig } from '@vybestack/llxprt-code-core';

// Or composable traits:
import type { WorkspacePathsConfig, FileFilteringConfig } from '@vybestack/llxprt-code-core';

// Old (still works):
import { Config } from '@vybestack/llxprt-code-core';
```

### Tool Registry (Phase 3)

No changes required. `Config.createToolRegistry()` still exists and works.

New opt-in import available:
```typescript
import { createToolRegistryFromConfig } from '@vybestack/llxprt-code-core';
```

### LSP Integration (Phase 4)

No changes required. `Config.initialize()` still handles LSP setup internally.

### Governance / MCP (Phase 5)

Callers that previously imported from CLI can now import from core:

```typescript
// Before (CLI-only):
import { READ_ONLY_TOOL_NAMES } from '../config/config.js';

// After (shared from core):
import { READ_ONLY_TOOL_NAMES } from '@vybestack/llxprt-code-core';
```

`createToolExclusionFilter()` stays in CLI — it composes the shared primitives with
CLI-specific session UX policy.

### Builder Functions (Phase 6a)

New imports available:
```typescript
import { buildTelemetrySettings, normalizeShellReplacement } from '@vybestack/llxprt-code-core';
```

`normalizeShellReplacement` is still importable from its previous location via re-export.

### Env Resolver (Phase 7)

New import available:
```typescript
import { resolveEnvConfig, type EnvConfig } from '@vybestack/llxprt-code-core';
```

### CLI parseArguments (Phase 8)

```typescript
// Before:
import { parseArguments, type CliArgs } from '../config/config.js';

// After (re-export preserves old path):
import { parseArguments, type CliArgs } from '../config/config.js';

// Or direct:
import { parseArguments, type CliArgs } from '../config/parseArguments.js';
```

---

## Deep Imports

Some callers import directly from `config.ts` rather than through barrel files:

```typescript
import { Config, ApprovalMode } from '../../config/config.js';
```

These continue to work because:
- Phase 1 adds re-exports: `export type { ... } from './configTypes.js'`
- Phase 6a adds re-export: `export { normalizeShellReplacement } from './configBuilders.js'`
- The `Config` class itself remains in `config.ts`

After migration, new code is encouraged to import through the barrel (`config/index.ts`)
or from the package entry point (`@vybestack/llxprt-code-core`), but deep imports are
not broken.

---

## Public Field Compatibility

The following **public fields** remain on Config instances throughout this refactoring:

| Field | Type | Status |
|-------|------|--------|
| `storage` | `Storage` | Remains as public field + new getter `getStorage()` |
| `truncateToolOutputThreshold` | `number` | Remains as public field + new getter |
| `truncateToolOutputLines` | `number` | Remains as public field + new getter |
| `enableToolOutputTruncation` | `boolean` | Remains as public field + new getter |

Both access patterns are valid:
```typescript
// Direct field access (still works):
config.storage.readFile(...)
config.truncateToolOutputThreshold

// Getter access (new, preferred for DI):
config.getStorage().readFile(...)
config.getTruncateToolOutputThreshold()
```

The getters are additive. Direct field access is not deprecated yet and will remain
stable for the duration of this refactoring. Future deprecation (if any) will be tracked
in a separate issue.

---

## Ad Hoc Bootstrap Metadata

CLI bootstrap attaches ad hoc properties to Config instances:
- `_bootstrapArgs`
- `_cliModelOverride`
- `_profileModelParams`
- `_cliModelParams`

These are preserved during this refactoring. They are accessed via type casts in CLI
code and are not part of the formal Config API. This refactoring does not formalize
or remove them — that is future work.

Tests that rely on these properties (e.g., `config.integration.test.ts`) will continue
to work unchanged.

---

## Internal Monorepo Packages

### a2a-server

`packages/a2a-server/src/config/config.ts` constructs `new Config(...)` directly.
All phases preserve the `Config` constructor and `ConfigParameters` interface, so
a2a-server continues to work unchanged.

### ui

`packages/ui/src/features/config/configSession.ts` constructs `new Config(...)` directly.
Same preservation guarantees apply.

### lsp

`packages/lsp` imports from `@vybestack/llxprt-code-core`. All re-exports are preserved.

### Scripts and integration tests

Any script that constructs `Config` directly or imports from `config.ts` continues to
work due to re-exports. No migration action needed.

---

## Test Migration

### No Widespread Rewrites

Existing tests continue to work because:
- `Config` constructor unchanged
- `Config.initialize()` method signature unchanged
- `makeFakeConfig()` in `test-utils/config.ts` unchanged
- All public methods/fields preserved

### Tests That Access Internal Fields

Some tests use `Object.defineProperty()` or type casts to override internal behavior:

```typescript
// This continues to work:
Object.defineProperty(config, 'contentGeneratorConfig', { ... });
```

Because Config's internal field names are preserved. Only the implementation of some
methods changes to delegate to extracted modules.

### Tests That Spy on Delegated Methods

Tests that spy on Config methods via `as any` or `jest.spyOn` will continue to work
for the **Config-level delegating methods**, which still exist. However, tests that
spy on **internal helpers** that were moved to extracted modules will need updating.

Likely affected test categories:
- **Spies on `createToolRegistry`** — Config method still exists and delegates;
  spying on Config works. But spies on internal registration helpers would need
  to target `toolRegistryFactory.ts`.
- **Spies on `registerMcpNavigationTools`** — same pattern; Config method delegates
  to `lspIntegration.ts`.
- **Spies on `initialize` internals** — Config.initialize() still exists; spies on
  it work. But assertions about exact internal call sequences may break if they
  checked helper method names that are now in `configInitializer.ts`.
- **Tests asserting exact class identity of created services** — these should continue
  to work since the same classes are instantiated.
- **Tests stubbing `this`-bound private behavior** — may break if the private method
  was extracted. The fix is to spy on the new module's export instead.

### Tests That Depend on Mutation Timing

Some tests may rely on when Config fields become available relative to constructor
vs `initialize()`. This refactoring preserves the exact same timing — builders run
during construction, orchestration runs during `initialize()`.

### Tests That Rely on Writable Internal Fields

Tests that mutate internal fields via `(config as any).someField = ...` continue
to work because the fields remain on the Config class. The extracted modules don't
own the state — Config does.

### Typed Helper Factory Pattern

For new tests, prefer typed factories over full `makeFakeConfig()`:

```typescript
import type { ToolHostConfig } from '@vybestack/llxprt-code-core';

function createTestToolConfig(overrides: Partial<ToolHostConfig> = {}): ToolHostConfig {
  return {
    getTargetDir: () => '/tmp/test',
    getProjectRoot: () => '/tmp/test',
    getWorkingDir: () => '/tmp/test',
    getWorkspaceContext: () => new WorkspaceContext('/tmp/test', []),
    getDebugMode: () => false,
    getOutputFormat: () => OutputFormat.TEXT,
    getFileService: () => mockFileService,
    getFileSystemService: () => mockFsService,
    getToolRegistry: () => mockToolRegistry,
    getApprovalMode: () => ApprovalMode.DEFAULT,
    isTrustedFolder: () => false,
    getStorage: () => mockStorage,
    ...overrides,
  } as ToolHostConfig;
}
```

This is optional — `makeFakeConfig()` continues to work for all existing patterns.

---

## Direct Constructor Compatibility

All `new Config(params)` call sites must continue to compile and behave identically:

| Package | File | Usage |
|---------|------|-------|
| core | test-utils/config.ts (`makeFakeConfig`) | `new Config({...})` |
| cli | config/config.ts (`loadCliConfig`) | `new Config({...})` |
| ui | features/config/configSession.ts | `new Config({...})` |
| a2a-server | config/config.ts | `new Config({...})` |
| integration tests | various | `new Config({...})` |

**Guarantees:**
- `ConfigParameters` interface is unchanged (no new required fields)
- Constructor defaulting behavior is unchanged
- Constructor side effects (telemetry, proxy, Storage, FileExclusions, runtime state
  creation) happen at the same time and in the same order
- `createAgentRuntimeStateFromConfig(this)` called identically

**After extraction:** Pure builder functions called by the constructor (Phase 6a) produce
the same values. The constructor still runs these side effects; the builders just move
where the computation is expressed.

---

## Breaking Changes

### Intended: None

Every phase is designed to be backward-compatible:
- Re-exports preserve all import paths
- Public API surface preserved
- Runtime behavior unchanged

### Realistic Risks

Despite the intent, some edge cases could surface:

1. **Tests with very precise mock shapes** — If a test mocks only the exact methods
   used and the delegating wrapper calls a new helper, the mock might need expansion.
   Mitigation: Phase-by-phase verification catches these.

2. **Serialization / JSON.stringify of Config** — If any code serializes a Config
   instance, extracted getter wrappers would add enumerable properties.
   Mitigation: Getters are methods, not enumerable properties.

3. **`instanceof` checks** — Extremely unlikely, but if code checks
   `config instanceof Config`, this continues to work since Config class remains.

4. **Private-method spying** — Tests that spy on private methods via `as any` may
   break if the private method was renamed or moved. Mitigation: Methods that delegate
   keep their original name, so spying on Config's methods still works. Only internal
   helper spies would need updating.

5. **Constructor timing assumptions** — If code depends on side effects happening
   during construction in a specific order relative to external code, builder extraction
   (Phase 6a) could subtly change timing. Mitigation: Builders are pure functions — they
   don't change when effects run, only where computation happens.

6. **Dynamic import mocking** — Tests that mock dynamic imports (e.g., LSP service client,
   MCP SDK) may need updated module paths after Phase 4 extraction. High-risk test files:
   - `config-lsp-integration.test.ts`
   - `config.test.ts` (tool registry sections)
   - `config.integration.test.ts` (bootstrap mutation sequencing)

7. **Naming collisions** — The UI package already exports `SessionConfig` in
   `packages/ui/src/features/config/llxprtAdapter.ts`. The core interface is named
   `RuntimeSessionConfig` to avoid confusion. Contributors should check for existing
   type names before introducing new exported interfaces.

---

## Import Cycle / Barrel Guidance for Contributors

### Rules

1. **Extracted config modules must import from direct file paths**, not from
   `config/index.ts` or `@vybestack/llxprt-code-core` barrels.
2. **Barrel files (`index.ts`) are for external consumers only.**
3. **Type-only imports** across module boundaries are always safe and preferred.
4. **Runtime imports** must follow the dependency direction rules in PLAN.md.

### Example

```typescript
// In toolRegistryFactory.ts:

// [OK] Good: direct file import
import type { ToolRegistryFactoryConfig } from './configInterfaces.js';
import { ToolRegistry } from '../tools/tool-registry.js';

// [ERROR] Bad: barrel import creates risk of cycles
import { ToolRegistry } from '../index.js';
import type { ToolHostConfig } from './index.js';
```

### Export Parity Verification

Before starting any phase, capture the current export surface:
```bash
grep '^export' packages/core/src/config/config.ts > /tmp/config-exports-before.txt
grep '^export' packages/core/src/config/index.ts >> /tmp/config-exports-before.txt
```

After each phase, diff against the captured baseline. The diff should show only additions
(new re-exports), never removals.

### Verification

After each phase, verify no runtime circular dependencies exist:
- `npm run build` succeeds
- `npm run typecheck` succeeds
- Optionally run `madge --circular packages/core/dist/config/` to detect cycles

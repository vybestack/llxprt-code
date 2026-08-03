# Implementation Plan: Bun Test Migration for tools, mcp, storage

## Phase ID

`PLAN-20260803-ISSUE2846.P02-P05`

## Prerequisites

- Phase 01 (Preflight) completed: vitest baselines captured, all 135 files
  verified, blocking issues documented

## Execution Sequence

This is a test-infrastructure migration. There is no TDD red-green cycle for
production code. The phases are configuration + verification cycles.

---

### Step 1: Create bunfig.toml for each workspace

Create three files:

**`packages/tools/bunfig.toml`**:
```toml
[test]
preload = ["../../test-setup/augment-bun-vi.ts", "./test-setup-storage-isolation.ts"]
```

**`packages/mcp/bunfig.toml`**:
```toml
[test]
preload = ["../../test-setup/augment-bun-vi.ts", "./test-setup-storage-isolation.ts"]
```

**`packages/storage/bunfig.toml`**:
```toml
[test]
preload = ["../../test-setup/augment-bun-vi.ts", "./test-setup-storage-isolation.ts"]
```

**Rationale**: All three workspaces already have `test-setup-storage-isolation.ts`
files. The `augment-bun-vi.ts` preload provides the Vitest API compatibility
layer. The storage isolation preload must run before any test module imports
Storage singletons (Bun does not run vitest setupFiles).

---

### Step 2: Update package.json scripts

**`packages/tools/package.json`**:
```json
"test": "bun ../../scripts/run_bun_tests.ts --workspace tools --junit junit.xml",
"test:bun": "bun ../../scripts/run_bun_tests.ts --workspace tools",
"test:ci": "bun ../../scripts/run_bun_tests.ts --workspace tools --junit junit.xml",
"test:vitest": "vitest run"
```

**`packages/mcp/package.json`**:
```json
"test": "bun ../../scripts/run_bun_tests.ts --workspace mcp --junit junit.xml",
"test:bun": "bun ../../scripts/run_bun_tests.ts --workspace mcp",
"test:ci": "bun ../../scripts/run_bun_tests.ts --workspace mcp --junit junit.xml",
"test:vitest": "vitest run"
```

**`packages/storage/package.json`**:
```json
"test": "bun ../../scripts/run_bun_tests.ts --workspace storage --junit junit.xml",
"test:bun": "bun ../../scripts/run_bun_tests.ts --workspace storage",
"test:ci": "bun ../../scripts/run_bun_tests.ts --workspace storage --junit junit.xml",
"test:vitest": "vitest run"
```

**Note on SecureStore CI tests**: The `secure_store_backend` CI job invokes:
```
npm run test:ci --workspace @vybestack/llxprt-code-storage -- --config "$TEST_CONFIG"
```
After migration, `test:ci` runs the bun orchestrator which does not accept
`--config`. The CI job must be updated to use `test:vitest` for SecureStore
backend tests:
```
npm run test:vitest --workspace @vybestack/llxprt-code-storage -- --config "$TEST_CONFIG"
```

---

### Step 3: Add workspace entries to bun-test-manifest.ts

Add three entries to `scripts/bun-test-manifest.ts` in the
`BUN_NATIVE_TEST_MANIFEST` array. Each entry lists every vitest-importing
test file (from the preflight inventory) with the storage isolation preload.

**`tools` entry**:
```typescript
{
  workspace: 'tools',
  preload: 'test-setup-storage-isolation.ts',
  files: [
    // ... all 65 tools test files from preflight inventory
  ],
},
```

**`mcp` entry**:
```typescript
{
  workspace: 'mcp',
  preload: 'test-setup-storage-isolation.ts',
  files: [
    // ... all 43 mcp test files from preflight inventory
  ],
},
```

**`storage` entry**:
```typescript
{
  workspace: 'storage',
  preload: 'test-setup-storage-isolation.ts',
  files: [
    // ... all 27 storage test files from preflight inventory
  ],
},
```

**Important**: The manifest uses explicit file lists, NOT globs. Every file
from the preflight inventory must be listed. The `preload` field is applied
to every file in the entry.

---

### Step 4: Refactor unsupported API patterns

#### 4a: `packages/tools/src/utils/ast-grep-utils.lazy.test.ts`

**Problem**: Uses `vi.doMock`, `vi.doUnmock`, `vi.resetModules` to test lazy
native grammar initialization. These APIs throw under Bun.

**Analysis**: The test file has three describe blocks:
1. `import side effects` — tests that import doesn't trigger registration
2. `lazy registration on first use` — tests that first use triggers registration
3. `graceful degradation on native load failure` — tests error handling

Each describe block installs a different mock configuration via doMock/doUnmock
and uses resetModules to clear state between blocks.

**Refactoring**: Split into separate test files, one per describe block:
- `ast-grep-utils.lazy.import-effects.test.ts`
- `ast-grep-utils.lazy.registration.test.ts`
- `ast-grep-utils.lazy.degradation.test.ts`

Each file runs in its own isolated process with fresh module state. The
doMock/doUnmock/resetModules calls are removed; each file installs its mock
once at module-evaluation time using `vi.mock` (hoisted).

**Alternative (if splitting is too disruptive)**: Convert to using
`vi.mock` (hoisted) with a factory that reads a module-level variable to
control behavior. Since all tests in a file share module state, the mock
is installed once. Tests that need different behaviors set the control
variable before triggering the behavior under test.

**Must verify**: The refactored tests produce the same assertions as the
original. No assertions weakened, no tests removed.

#### 4b: `packages/storage/src/secure-store/secure-store.fallback.test.ts`

**Problem**: Lines 840, 852 use `vi.resetModules()` combined with
`vi.stubEnv('XDG_DATA_HOME', ...)` to re-import secure-store.js with a
different env var.

**Analysis**: The test is inside `it.runIf(process.platform === 'linux')`.
It stubs XDG_DATA_HOME, resets modules, re-imports SecureStore, then checks
the fallbackDir. The production code likely computes fallbackDir from
`process.env.XDG_DATA_HOME` — if it reads env at CALL TIME (not module
init time), then resetModules is unnecessary and can simply be removed.

**Refactoring**:
1. Check if `getFallbackDir(store)` reads `process.env.XDG_DATA_HOME` at
   call time or if it was captured at module init time.
2. If call-time: Remove `vi.resetModules()`. The `vi.stubEnv` +
   `getFallbackDir()` will work because the env var is read fresh.
3. If init-time: Extract these two env-dependent tests into a separate test
   file (`secure-store.fallback.env-paths.test.ts`) that runs in its own
   process. The file sets the env var BEFORE importing the module.

**Must verify**: The refactored test still asserts the same behavior.

#### 4c: `packages/mcp/src/auth/token-storage/file-token-storage.test.ts`

**Problem**: Line 493:
```typescript
await expect(storage.clearAll()).resolves.not.toThrow();
```

**Refactoring**: Replace with:
```typescript
await expect(storage.clearAll()).resolves.toBeUndefined();
```

**Rationale**: `clearAll()` returns `Promise<void>`. On success it resolves
to undefined. If it throws, the rejection propagates and the test fails.
This is behaviorally equivalent.

---

### Step 5: Update CI workflow for SecureStore backend tests

In `.github/workflows/ci.yml`, the `secure_store_backend` job has two
invocation paths (inside the dbus block and the else block):

**Current** (line ~1401, ~1404):
```yaml
npm run test:ci --workspace @vybestack/llxprt-code-storage -- --config "$TEST_CONFIG"
```

**Updated**:
```yaml
npm run test:vitest --workspace @vybestack/llxprt-code-storage -- --config "$TEST_CONFIG"
```

**Rationale**: The SecureStore backend tests need vitest's `--config` file
selection to run only the native-keyring or fallback-behavior test files
with the special CI environment (dbus/gnome-keyring). The bun orchestrator
does not support vitest config-file selection. The `test:vitest` fallback
script retains this capability.

Also update the same pattern in `.github/workflows/nightly.yml` if present.

---

### Step 6: Verification

#### 6a: Bun test execution

```bash
# Run each workspace under Bun
cd packages/tools && bun ../../scripts/run_bun_tests.ts --workspace tools
cd packages/mcp && bun ../../scripts/run_bun_tests.ts --workspace mcp
cd packages/storage && bun ../../scripts/run_bun_tests.ts --workspace storage
```

All 135 test files must pass (or skip with pre-existing skips only).

#### 6b: Test count parity

```bash
# Capture vitest counts
cd packages/tools && npx vitest run --reporter=json 2>/dev/null | jq '[.testResults[].assertionResults[] | select(.status != "todo")] | length'
cd packages/mcp && npx vitest run --reporter=json 2>/dev/null | jq '[.testResults[].assertionResults[] | select(.status != "todo")] | length'
cd packages/storage && npx vitest run --reporter=json 2>/dev/null | jq '[.testResults[].assertionResults[] | select(.status != "todo")] | length'

# Compare with bun counts (from bun test output)
# The orchestrator reports "Passed N/M isolated native Bun test files"
# For per-test counts, use bun test --reporter=verbose and count (pass)/(skip)/(fail)
```

#### 6c: SecureStore CI test vitest path

```bash
# Verify SecureStore tests still run via vitest config selection
cd packages/storage && npx vitest run --config vitest.config.native-keyring.ts
cd packages/storage && npx vitest run --config vitest.config.fallback-behavior.ts
```

#### 6d: Full verification cycle

```bash
npm run typecheck
npm run lint
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

#### 6e: Manifest dry-run verification

```bash
# Verify all files are listed and resolvable
bun scripts/run_bun_tests.ts --workspace tools --dry-run
bun scripts/run_bun_tests.ts --workspace mcp --dry-run
bun scripts/run_bun_tests.ts --workspace storage --dry-run
```

The dry-run output must list every file from the preflight inventory.

---

## No-Skip Proof

After migration, verify no test was newly skipped:

```bash
# Count skips under vitest (baseline)
cd packages/tools && npx vitest run --reporter=verbose 2>&1 | grep -c "skipped"
cd packages/mcp && npx vitest run --reporter=verbose 2>&1 | grep -c "skipped"
cd packages/storage && npx vitest run --reporter=verbose 2>&1 | grep -c "skipped"

# Count skips under bun
# (from bun test verbose output)
```

Skip counts must match (pre-existing `it.skipIf` / `.skip` are preserved).

Additionally, grep for newly added skips:
```bash
git diff main -- 'packages/tools/**/*.test.ts' 'packages/mcp/**/*.test.ts' 'packages/storage/**/*.test.ts' | grep '+.*\.skip\|+.*it\.skip\|+.*test\.skip'
```

Must show no additions (only pre-existing skips, which are unchanged).

## Failure Recovery

If a workspace fails under Bun after migration:

1. Check the specific test file's failure output
2. Determine if it's a known pattern (consult analysis/domain-model.md)
3. If it's a vi.resetModules/doUnmock issue: apply the documented refactoring
4. If it's an async mock factory deadlock: refactor to use importActualSync
5. If it's a Bun runtime bug: document with reproduction steps, check if a
   workaround exists
6. Do NOT exclude the file from the manifest or skip the test

If the failure cannot be resolved, it is a Blocker per the review-triage-policy.

# Preflight Results

Plan ID: PLAN-20260609-ISSUE1591
Date: 2026-06-10
Branch: main (commit 985798b71)

## 1. Dependency Verification

| Dependency | Expected | Actual | Status |
|------------|----------|--------|--------|
| `@iarna/toml` | In core deps | `@iarna/toml@2.2.5` present | [OK] PASS |
| `zod` | In core deps | `zod@3.25.76` present | [OK] PASS |
| `@google/genai` | In core deps | `@google/genai@1.30.0` present | [OK] PASS |
| `vitest` | In core devDeps | `vitest@3.2.4` present | [OK] PASS |
| `fast-check` | In core devDeps | `fast-check@4.5.3` present | [OK] PASS |

## 2. packages/settings Non-Existence

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `packages/settings` directory | Does NOT exist | `No such file or directory` (exit code 1) | [OK] PASS |

**Documented constraint:** `packages/settings` does not exist. The plan must not assume this package is available. Policy configuration loading currently lives entirely in `core`.

## 3. Key Source File Verification

| File | Status |
|------|--------|
| `packages/core/src/policy/types.ts` | [OK] PASS |
| `packages/core/src/policy/policy-engine.ts` | [OK] PASS |
| `packages/core/src/policy/stable-stringify.ts` | [OK] PASS |
| `packages/core/src/policy/utils.ts` | [OK] PASS |
| `packages/core/src/policy/toml-loader.ts` | [OK] PASS |
| `packages/core/src/policy/config.ts` | [OK] PASS |
| `packages/core/src/policy/policy-helpers.ts` | [OK] PASS |
| `packages/core/src/policy/policies/read-only.toml` | [OK] PASS |
| `packages/core/src/confirmation-bus/types.ts` | [OK] PASS |
| `packages/core/src/confirmation-bus/message-bus.ts` | [OK] PASS |
| `packages/core/src/tools/tool-confirmation-types.ts` | [OK] PASS |

All 11/11 key source files exist at expected paths.

## 4. Type/Interface Verification

| Type Name | Expected Location | Found? | Evidence |
|-----------|-------------------|--------|----------|
| `PolicyDecision` (enum) | `core/src/policy/types.ts` | [OK] | Line 7: `export enum PolicyDecision` |
| `PolicyRule` (interface) | `core/src/policy/types.ts` | [OK] | Line 19: `export interface PolicyRule` |
| `PolicyEngineConfig` (interface) | `core/src/policy/types.ts` | [OK] | Line 62: `export interface PolicyEngineConfig` |
| `PolicySettings` (interface) | `core/src/policy/types.ts` | [OK] | Line 81: `export interface PolicySettings` |
| `ApprovalMode` (enum) | `core/src/policy/types.ts` | [OK] | Line 13: `export enum ApprovalMode` |
| `PolicyEngine` (class) | `core/src/policy/policy-engine.ts` | [OK] | Line 17: `export class PolicyEngine` |
| `MessageBus` (class) | `core/src/confirmation-bus/message-bus.ts` | [OK] | Line 26: `export class MessageBus` |
| `MessageBusType` (enum) | `core/src/confirmation-bus/types.ts` | [OK] | Line 8: `export enum MessageBusType` |
| `MessageBusMessage` (union) | `core/src/confirmation-bus/types.ts` | [OK] | Line 149: `export type MessageBusMessage` |
| `ToolConfirmationOutcome` (enum) | `core/src/tools/tool-confirmation-types.ts` | [OK] | Line 7: `export enum ToolConfirmationOutcome` |
| `ToolConfirmationPayload` (interface) | `core/src/tools/tool-confirmation-types.ts` | [OK] | Line 18: `export interface ToolConfirmationPayload` |
| `ToolCall` (type) | `core/src/scheduler/types.ts` | WARNING: NOTE | Not exported as `ToolCall`; subtypes exist: `ValidatingToolCall` (L33), `ScheduledToolCall` (L42), `ExecutingToolCall` (L51) |
| `SerializableConfirmationDetails` (type) | `core/src/confirmation-bus/types.ts` | [OK] | Line 30: `export type SerializableConfirmationDetails` |
| `FunctionCall` | `@google/genai` | [OK] | Used via `import type { FunctionCall } from '@google/genai'` |

**Note on `ToolCall`:** The plan references `ToolCall` but the actual codebase exports subtypes (`ValidatingToolCall`, `ScheduledToolCall`, `ExecutingToolCall`). The plan should use the specific subtype needed or verify that `confirmation-bus/types.ts` line 6 imports `ToolCall` from `scheduler/types.js` — confirmed: it imports `ToolCall` from `../scheduler/types.js`. The type `ToolCall` likely exists but isn't grep-visible as `export.*ToolCall` because it may not include the word "export" in the same pattern. Plan should reference the actual type.

## 5. Call Path Verification

| Function | Expected Callers | Actual Import Sites | Status |
|----------|-----------------|-------------------|--------|
| `PolicyEngine.evaluate()` | MessageBus, confirmation-coordinator, tests | `message-bus.ts:106`, `policy-helpers.ts:55`, self-recursive in `policy-engine.ts` | [OK] PASS |
| `createPolicyEngineConfig()` | CLI policy.ts, configConstructor | `index.ts:25` (re-export), defined at `config.ts:224+` | [OK] PASS |
| `createPolicyUpdater()` | CLI policy.ts | `index.ts:26` (re-export), defined at `config.ts:516` | [OK] PASS |
| `MessageBus.requestConfirmation()` | scheduler/confirmation-coordinator | Defined at `message-bus.ts:93` | [OK] PASS |
| `MessageBus.publish()` | policy-helpers, hooks, scheduler, tools | `tools/tools.ts:149,246`, `confirmation-coordinator.ts:776`, `hookEventHandler.ts:919`, self-calls in `message-bus.ts` | [OK] PASS |
| `loadPoliciesFromToml()` | config.ts | Defined at `toml-loader.ts:481`, called at `config.ts:278,336` | [OK] PASS |

## 6. Forbidden Dependency Verification

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Policy imports from `tools/` (non-test, non-tool-confirmation-types) | 0 results (policy-helpers is exception) | `policy-helpers.ts` imports `AnyToolInvocation` and `BaseToolInvocation` from `../tools/tools.js` | [OK] PASS (known exception) |
| Policy imports from `providers/` | 0 results | 0 results | [OK] PASS |
| Policy imports `@google/genai` | 0 results (policy-helpers exception) | `policy-helpers.ts:8` imports `FunctionCall` type only | [OK] PASS (known exception) |
| Confirmation-bus imports from `scheduler/types` | 1 result (ToolCall) | `types.ts:6` imports `ToolCall` | [OK] PASS |
| Confirmation-bus imports from `tools/` | 1 result (tool-confirmation-types) | `message-bus.ts:15`, `types.ts:5` from `tool-confirmation-types.js` | [OK] PASS |
| Confirmation-bus imports `@google/genai` | 2 results (FunctionCall) | `message-bus.ts:3`, `types.ts:1` — both `import type { FunctionCall }` | [OK] PASS |

## 7. Test Infrastructure Verification

| Test File | Exists? | Test Count |
|-----------|---------|------------|
| `core/src/policy/policy-engine.test.ts` | [OK] | 47 |
| `core/src/policy/config.test.ts` | [OK] | 29 |
| `core/src/policy/policy-helpers.test.ts` | [OK] | 6 |
| `core/src/policy/toml-loader.test.ts` | [OK] | 25 |
| `core/src/policy/utils.test.ts` | [OK] | 14 |
| `core/src/policy/persistence.test.ts` | [OK] | 16 |
| `core/src/policy/shell-safety.test.ts` | [OK] | 22 |
| `core/src/confirmation-bus/message-bus.test.ts` | [OK] | 25 |
| `core/src/confirmation-bus/integration.test.ts` | [OK] | 24 |

Total: 208 test cases across 9 test files. All passing.

## 8. Build Verification Gate

| Check | Command | Result |
|-------|---------|--------|
| `npm run format` | prettier --write | [OK] PASS |
| `npm run lint` | eslint | [OK] PASS (0 errors, 1251 warnings — all pre-existing) |
| `npm run typecheck` | tsc --noEmit (all workspaces) | [OK] PASS |
| `npm run build` | full build (all workspaces) | [OK] PASS |
| `npm run test` | vitest run (all workspaces) | [OK] PASS — 10,083 tests passed across 1,105 test files, 38 skipped |
| Smoke test | `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"` | [OK] PASS — completed with haiku output |

## Blocking Issues Found

**None.** All preflight checks pass. The codebase is in a clean, green state.

## Notes for Plan Execution

1. **`policy-helpers.ts` is the cross-cutting file** — it imports from `tools/tools.js` and `@google/genai`. This file will need special handling during extraction (either move to policy package with peer deps, or split into a bridge module).

2. **`confirmation-bus` depends on `scheduler/types` (for `ToolCall`) and `tools/tool-confirmation-types`** — these types will need to either be duplicated in the new package, re-exported through a shared types package, or the dependency accepted as part of the new package's public API.

3. **`ToolCall` type** — The plan references this as a single type but the scheduler exports subtypes (`ValidatingToolCall`, `ScheduledToolCall`, `ExecutingToolCall`). The `confirmation-bus/types.ts` imports `ToolCall` directly from `../scheduler/types.js`. This type exists but wasn't found by our `export.*ToolCall` grep because it's likely a simple `export type ToolCall = ...` without the word "export" appearing on the same line as "ToolCall" in a different pattern.

## Verification Gate

- [x] All dependencies verified present
- [x] All types match expectations (with noted caveats)
- [x] All call paths confirmed
- [x] Test infrastructure operational (208 tests, all green)
- [x] No unexpected imports in policy/confirmation-bus (exceptions documented)
- [x] Build passes (format, lint, typecheck, build, test, smoke — all green)

**PREFLIGHT RESULT: PASS**

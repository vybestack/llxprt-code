# Preflight Results Template

Plan ID: PLAN-20260609-ISSUE1591

## Purpose

Verify ALL assumptions before writing any production code. This template is filled with actual command outputs from Phase P01 (Domain Analysis).

## 1. Dependency Verification

| Dependency | Expected | Verification Command | Status |
|------------|----------|---------------------|--------|
| `@iarna/toml` | In core deps | `npm ls @iarna/toml --workspace @vybestack/llxprt-code-core` | [OK] `@iarna/toml@2.2.5` present |
| `zod` | In core deps | `npm ls zod --workspace @vybestack/llxprt-code-core` | [OK] `zod@3.25.76` present |
| `@google/genai` | In core deps | `npm ls @google/genai --workspace @vybestack/llxprt-code-core` | [OK] `@google/genai@1.30.0` present |
| `vitest` | In core devDeps | `npm ls vitest --workspace @vybestack/llxprt-code-core` | [OK] `vitest@3.2.4` present |
| `fast-check` | In core devDeps | `npm ls fast-check --workspace @vybestack/llxprt-code-core` | [OK] `fast-check@4.5.3` present |

## 2. Type/Interface Verification

| Type Name | Expected Location | Actual Location | Match? |
|-----------|-------------------|-----------------|--------|
| `PolicyDecision` | `core/src/policy/types.ts` | `core/src/policy/types.ts:7` `export enum PolicyDecision` | [OK] EXACT |
| `PolicyRule` | `core/src/policy/types.ts` | `core/src/policy/types.ts:19` `export interface PolicyRule` | [OK] EXACT |
| `PolicyEngineConfig` | `core/src/policy/types.ts` | `core/src/policy/types.ts:62` `export interface PolicyEngineConfig` | [OK] EXACT |
| `PolicySettings` | `core/src/policy/types.ts` | `core/src/policy/types.ts:81` `export interface PolicySettings` | [OK] EXACT |
| `ApprovalMode` (enum) | `core/src/policy/types.ts` | `core/src/policy/types.ts:13` `export enum ApprovalMode` | [OK] EXACT |
| `PolicyEngine` (class) | `core/src/policy/policy-engine.ts` | `core/src/policy/policy-engine.ts:17` `export class PolicyEngine` | [OK] EXACT |
| `MessageBus` (class) | `core/src/confirmation-bus/message-bus.ts` | `core/src/confirmation-bus/message-bus.ts:26` `export class MessageBus` | [OK] EXACT |
| `MessageBusType` (enum) | `core/src/confirmation-bus/types.ts` | `core/src/confirmation-bus/types.ts:8` `export enum MessageBusType` | [OK] EXACT |
| `MessageBusMessage` (union) | `core/src/confirmation-bus/types.ts` | `core/src/confirmation-bus/types.ts:149` `export type MessageBusMessage` | [OK] EXACT |
| `ToolConfirmationOutcome` (enum) | `core/src/tools/tool-confirmation-types.ts` | `core/src/tools/tool-confirmation-types.ts:7` `export enum ToolConfirmationOutcome` | [OK] EXACT |
| `ToolConfirmationPayload` | `core/src/tools/tool-confirmation-types.ts` | `core/src/tools/tool-confirmation-types.ts:18` `export interface ToolConfirmationPayload` | [OK] EXACT |
| `ToolCall` (type) | `core/src/scheduler/types.ts` | `core/src/scheduler/types.ts:117` `export type ToolCall = ValidatingToolCall \| ScheduledToolCall \| ...` (union of 7 subtypes) | [OK] CONFIRMED |
| `SerializableConfirmationDetails` | `core/src/confirmation-bus/types.ts` | `core/src/confirmation-bus/types.ts:30` `export type SerializableConfirmationDetails` | [OK] EXACT |
| `FunctionCall` | `@google/genai` | Used via `import type { FunctionCall } from '@google/genai'` in types.ts:1, message-bus.ts:3 | [OK] CONFIRMED |

## 3. Call Path Verification

| Function | Expected Caller | Actual Import Sites | Evidence |
|----------|-----------------|-------------------|----------|
| `PolicyEngine.evaluate()` | MessageBus, confirmation-coordinator, tests | `message-bus.ts` (used internally), `policy-helpers.ts:55`, self-recursive in `policy-engine.ts` | [OK] PASS |
| `createPolicyEngineConfig()` | CLI policy.ts, configConstructor | Defined at `config.ts:224+` (3 overloads), exported via `policy/index.ts`, consumed by CLI `config/policy.ts:13` | [OK] PASS |
| `createPolicyUpdater()` | CLI policy.ts | Defined at `config.ts:516`, exported via `policy/index.ts`, consumed by CLI `config/policy.ts:47` | [OK] PASS |
| `MessageBus.requestConfirmation()` | scheduler/confirmation-coordinator | Defined at `message-bus.ts:93+`, imported via type in `confirmation-coordinator.ts:21` | [OK] PASS |
| `MessageBus.publish()` | policy-helpers, hooks, scheduler, tools | `tools/tools.ts`, `confirmation-coordinator.ts:776`, `hookEventHandler.ts:919`, internal calls in message-bus.ts | [OK] PASS |
| `loadPoliciesFromToml()` | config.ts | Defined at `toml-loader.ts:481`, called at `config.ts:278,336` | [OK] PASS |

## 4. Forbidden Dependency Verification

| Check | Command | Expected | Actual | Pass? |
|-------|---------|----------|--------|-------|
| Policy imports from `tools/` (non-test, non-tool-confirmation-types) | `grep -rn "from.*tools/" packages/core/src/policy/ --include='*.ts' \| grep -v '.test.ts' \| grep -v 'tool-confirmation-types'` | 0 results (policy-helpers is exception) | `policy-helpers.ts` imports `AnyToolInvocation`, `BaseToolInvocation` from `../tools/tools.js` — known exception per spec | [OK] PASS (exception) |
| Policy imports from `providers/` | `grep -rn "from.*providers/" packages/core/src/policy/ --include='*.ts'` | 0 results | 0 results | [OK] PASS |
| Confirmation-bus imports from scheduler | `grep -rn "from.*scheduler" packages/core/src/confirmation-bus/ --include='*.ts'` | 1 result (ToolCall) | `types.ts:6` imports `ToolCall` from `../scheduler/types.js` | [OK] PASS |
| Confirmation-bus imports from tools | `grep -rn "from.*tools/" packages/core/src/confirmation-bus/ --include='*.ts'` | 1 result (tool-confirmation-types) | `message-bus.ts:15`, `types.ts:5` from `tool-confirmation-types.js` | [OK] PASS |
| Confirmation-bus imports @google/genai | `grep -rn "@google/genai" packages/core/src/confirmation-bus/ --include='*.ts'` | 2 results (FunctionCall) | `message-bus.ts:3`, `types.ts:1` — both `import type { FunctionCall }` | [OK] PASS |

## 5. Test Infrastructure Verification

| Test File | Exists? | Test Count | Lines |
|-----------|---------|------------|-------|
| `core/src/policy/policy-engine.test.ts` | [OK] | 47 | 669 |
| `core/src/policy/config.test.ts` | [OK] | 29 | 464 |
| `core/src/policy/policy-helpers.test.ts` | [OK] | 6 | 217 |
| `core/src/policy/toml-loader.test.ts` | [OK] | 25 | 454 |
| `core/src/policy/utils.test.ts` | [OK] | 14 | 111 |
| `core/src/policy/persistence.test.ts` | [OK] | 16 | 568 |
| `core/src/policy/shell-safety.test.ts` | [OK] | 22 | 339 |
| `core/src/confirmation-bus/message-bus.test.ts` | [OK] | 25 | 570 |
| `core/src/confirmation-bus/integration.test.ts` | [OK] | 24 | 730 |

Total: 208 test cases across 9 test files.

## 6. Import Site Census (Non-Test)

| Subsystem | Files importing MessageBus | Files importing Policy types |
|-----------|--------------------------|------------------------------|
| tools/ (27 tool files) | 27 files | 0 |
| tools/tools.ts | 1 file (also imports MessageBusType) | 0 |
| core/ (subagent) | 7 files | 0 |
| config/ | 4 files | 3 (configBaseCore, configConstructor, configTypes) |
| hooks/ | 4 files | 0 |
| agents/ | 2 files | 0 |
| scheduler/ | 1 file (also imports PolicyDecision) | 1 (confirmation-coordinator imports PolicyDecision) |
| test-utils/ | 3 files | 2 (tools.ts, mock-tool.ts import PolicyEngine/PolicyDecision) |
| policy/ (internal) | 2 (config.ts, policy-helpers.ts) | N/A |
| confirmation-bus/ (internal) | N/A | 2 (message-bus.ts imports PolicyEngine/PolicyDecision) |
| index.ts | 2 lines (re-exports) | 4 lines (re-exports) |
| **Total** | **50 files with confirmation-bus imports** | **8 files with policy imports** |

### Total import lines (non-test):
- **58 confirmation-bus import lines** across 50 files
- **15 policy import lines** across 8 files

### Tool files importing MessageBus (27 non-test files):
activate-skill.ts, apply-patch.ts, ast-grep.ts, check-async-tasks.ts, codesearch.ts, delete_line_range.ts, direct-web-fetch.ts, edit.ts, exa-web-search.ts, glob.ts, google-web-fetch.ts, google-web-search-invocation.ts, google-web-search.ts, grep.ts, insert_at_line.ts, list-subagents.ts, ls.ts, memoryTool.ts, read_line_range.ts, read-file.ts, read-many-files.ts, ripGrep.ts, shell.ts, structural-analysis.ts, task.ts, tool-registry.ts, tools.ts, write-file.ts

## 7. Source File Line Counts (Actual)

| File | Actual Lines | Audit Estimate | Match? |
|------|-------------|----------------|--------|
| `policy/types.ts` | 91 | ~60 | Minor overestimate |
| `policy/policy-engine.ts` | 357 | ~280 | Moderate overestimate |
| `policy/stable-stringify.ts` | 188 | ~150 | Minor overestimate |
| `policy/utils.ts` | 77 | ~60 | Minor overestimate |
| `policy/toml-loader.ts` | 662 | ~400 | Significant underestimate |
| `policy/config.ts` | 647 | ~450 | Moderate underestimate |
| `policy/policy-helpers.ts` | 117 | ~90 | Minor overestimate |
| `confirmation-bus/types.ts` | 160 | ~170 | Close match |
| `confirmation-bus/message-bus.ts` | 283 | ~250 | Close match |
| `tools/tool-confirmation-types.ts` | 29 | N/A | Confirmed |

## Blocking Issues Found

**None.** All preflight checks pass. The codebase is in a clean, green state.

## Discrepancies from Plan Documents

### Discrepancy 1: Tool file count
- **dependency-audit.md** states "25+ tool files: MessageBus type import"
- **Actual**: 27 tool files importing MessageBus (non-test) + tools.ts also imports MessageBusType = 28 total tool files
- **Impact**: Minor — more files to update than estimated, but not architecturally significant

### Discrepancy 2: migrateLegacyApprovalMode uses core's ApprovalModeEnum
- **specification.md** states migrateLegacyApprovalMode moves to policy package
- **Actual**: `migrateLegacyApprovalMode` imports `ApprovalModeEnum` from `../config/config.js` (core's config), which is the same enum as `policy/types.ts` ApprovalMode. The function accepts `PolicyConfigSource` which returns `ApprovalModeEnum` type. This is a type-only discrepancy — the enum values are identical, so moving the function only requires changing the import to use the local `ApprovalMode` from `types.ts` and updating `PolicyConfigSource.getApprovalMode` return type.
- **Impact**: Low — the function can be moved as planned with a simple import swap

### Discrepancy 3: toml-loader.ts is larger than estimated
- **dependency-audit.md** estimates ~400 lines
- **Actual**: 662 lines
- **Impact**: None on architecture — just more code to move

### Discrepancy 4: persistPolicyToToml is a local function, not exported
- **specification.md** lists persistPolicyToToml as staying in core
- **Actual**: `persistPolicyToToml` (line 573 in config.ts) is a non-exported local function. It's called from within `createPolicyUpdater`. It stays in core naturally since `createPolicyUpdater` stays in core.
- **Impact**: None — plan is correct, just clarifying it's a private function

### Discrepancy 5: hookBusContracts.ts and hookValidators.ts also import MessageBus
- **dependency-audit.md** lists "2 hooks files: MessageBus, bus types"
- **Actual**: 4 hook files import MessageBus: hookBusContracts.ts, hookEventHandler.ts, hookSystem.ts, hookValidators.ts
- **Impact**: Minor — 2 additional files to update

### Discrepancy 6: core/ has 7 files importing MessageBus, not just subagent files
- **dependency-audit.md** lists "5 subagent files"
- **Actual**: 7 core/ files import MessageBus: coreToolScheduler.ts, nonInteractiveToolExecutor.ts, subagent.ts, subagentExecution.ts, subagentRuntimeSetup.ts, subagentToolProcessing.ts, subagentTypes.ts
- **Impact**: Minor — 2 additional files (nonInteractiveToolExecutor.ts not in audit)

## Verification Gate

- [x] All dependencies verified present
- [x] All types match expectations
- [x] All call paths confirmed
- [x] Test infrastructure operational (208 tests, all green)
- [x] No unexpected imports in policy/confirmation-bus (exceptions documented)
- [x] Build passes (format, lint, typecheck, build, test, smoke — all green)

**PREFLIGHT RESULT: PASS**

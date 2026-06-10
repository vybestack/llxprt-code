# Plan: Extract `@vybestack/llxprt-code-policy` Package

Plan ID: **PLAN-20260609-ISSUE1591**
Issue: #1591
Generated: 2026-06-09 (revised — review-01, review-02, review-03, review-04, review-05 corrections applied)

## Summary

Extract `packages/core/src/policy` and `packages/core/src/confirmation-bus` into a standalone workspace package `@vybestack/llxprt-code-policy`. Policy has **zero** dependency on core, providers, tools, or CLI. All external type dependencies are replaced with policy-owned structural types. No `@google/genai`.

## Architectural Decisions (Fixed)

1. **Policy has ZERO dependency on core, providers, tools, CLI.** No `@vybestack/llxprt-code-core` in policy `package.json`. No `@google/genai`. No deep core imports. No `@vybestack/llxprt-code-telemetry`. All cross-boundary concerns are injected via interfaces.
2. **Policy-owned structural types** replace all external type dependencies: `PolicyFunctionCall` replaces `FunctionCall` from `@google/genai`, `PolicyToolCallState` replaces `ToolCall` from `scheduler/types`, `ConfirmationOutcome`/`ConfirmationPayload` replace `ToolConfirmationOutcome`/`ToolConfirmationPayload` from `tools/`. See exact shapes below.
3. **No `packages/settings` exists and none will be invented.** `createPolicyEngineConfig` and `createPolicyUpdater` stay in core. Paths injected via `PolicyPathResolver` interface. Logging injected via `PolicyLogger` interface. Implementation phases (P05, P07, P09) must not assume a settings package exists.
4. **`policy-helpers.ts` stays in core** (hard deps on tool invocation types, scheduler types).
5. **Core may import from policy package for re-exports and production use.** The direction `core → policy` is allowed. The reverse `policy → core` is forbidden.
6. **COPY-first extraction sequencing.** Source files are copied (not moved) into `packages/policy/src/` during P05/P07. Core originals remain untouched until P10d (Source Deletion & Cleanup), when they are replaced with thin re-export shims. At no point are core source files deleted before their re-export shims are in place.
7. **Shell utilities are COPIED** (not moved) — `SHELL_TOOL_NAMES`, `splitCommands`, `hasRedirection` only. Original stays in core.

## Package Boundary Rules (Single Source of Truth)

| Package | May Depend On | Must Not Depend On |
|---------|--------------|--------------------|
| `packages/policy` | `@iarna/toml`, `zod` (prod); `@types/node`, `fast-check`, `typescript`, `vitest` (dev) | `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code-tools`, `@vybestack/llxprt-code-cli`, `@google/genai`, `@vybestack/llxprt-code-telemetry` |
| `packages/core` | `@vybestack/llxprt-code-policy` (re-exports + production imports) | (none restricted) |
| `packages/cli` | `@vybestack/llxprt-code-policy`, `@vybestack/llxprt-code-core` | (none restricted) |

**Dependency direction**: `core → policy` (allowed). `policy → core` (forbidden). No circular deps.

## Policy Package Dependencies (Exact — Single Manifest)

```json
{
  "dependencies": {
    "@iarna/toml": "^2.2.5",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/node": "^24.2.1",
    "fast-check": "^4.2.0",
    "typescript": "^5.3.3",
    "vitest": "^3.1.1"
  }
}
```

- `@google/genai`: **NEVER** (not prod, not dev). Replaced by `PolicyFunctionCall`.
- `@vybestack/llxprt-code-core`: **NEVER**. All cross-boundary deps injected.
- `@vybestack/llxprt-code-telemetry`: **NEVER**. Logging injected via `PolicyLogger` interface.
- `@vybestack/llxprt-code-tools`: **NEVER**. Shell utilities copied, not imported.
- `@vybestack/llxprt-code-providers`: **NEVER**. No provider dependency chain.

## PolicyEngine Public API (Exact Surface)

### `packages/policy/src/index.ts` — source barrel

This file exports all local modules using relative paths. Every export is exact — no catch-alls, no `etc.`, no re-exports of entire modules via `export *`. Each named export is listed explicitly per source module:

```typescript
// packages/policy/src/index.ts — source barrel (exact per-module exports)
// @plan PLAN-20260609-ISSUE1591.P05
// @requirement REQ-005.1

// ─── From ./types.js ────────────────────────────────────────────────
export {
  PolicyDecision,
  ApprovalMode,
  DEFAULT_CORE_POLICIES_DIR,
  DEFAULT_POLICY_TIER,
  USER_POLICY_TIER,
  ADMIN_POLICY_TIER,
} from './types.js';

// ─── From ./policy-engine.js ────────────────────────────────────────
export { PolicyEngine } from './policy-engine.js';
export type {
  PolicyRule,
  PolicyEngineConfig,
  PolicySettings,
  PolicyConfigSource,
  PolicyPathResolver,
  PolicyLogger,
} from './policy-engine.js';

// ─── From ./stable-stringify.js ─────────────────────────────────────
export { stableStringify, stableParse } from './stable-stringify.js';

// ─── From ./utils.js ────────────────────────────────────────────────
export { escapeRegex, buildArgsPatterns } from './utils.js';

// ─── From ./toml-loader.js ──────────────────────────────────────────
export { loadPoliciesFromToml, loadPolicyFromToml, loadDefaultPolicies } from './toml-loader.js';

// ─── From ./config.js ───────────────────────────────────────────────
export {
  getPolicyDirectories,
  getPolicyTier,
  formatPolicyError,
  migrateLegacyApprovalMode,
} from './config.js';

// ─── From ./confirmation-bus/types.js ───────────────────────────────
export { ConfirmationOutcome, MessageBusType, MessageBus } from './confirmation-bus/types.js';
export type {
  PolicyFunctionCall,
  PolicyToolCallState,
  ConfirmationPayload,
  SerializableConfirmationDetails,
  PolicyLogger as ConfirmationPolicyLogger,
  MessageBusMessage,
  ToolConfirmationRequest,
  ToolConfirmationResponse,
  ToolPolicyRejection,
  ToolExecutionSuccess,
  ToolExecutionFailure,
  UpdatePolicy,
  BucketAuthConfirmationRequest,
  BucketAuthConfirmationResponse,
  HookExecutionRequest,
  HookExecutionResponse,
  ToolCallsUpdateMessage,
} from './confirmation-bus/types.js';

// ─── Backward-compat aliases ────────────────────────────────────────
export { ConfirmationOutcome as ToolConfirmationOutcome } from './confirmation-bus/types.js';
export type { ConfirmationPayload as ToolConfirmationPayload } from './confirmation-bus/types.js';
```

**Rules for the barrel:**
- Every export is a named export from a specific module — no `export * from` wildcard re-exports.
- `PolicyLogger` is exported from both `./policy-engine.js` (as the injected interface) and `./confirmation-bus/types.js` (as the bus-specific logger interface). Use `ConfirmationPolicyLogger` alias if both appear to avoid name collision.
- Backward-compat aliases (`ToolConfirmationOutcome`, `ToolConfirmationPayload`) are explicit re-exports with `as`.

### `packages/policy/index.ts` — root barrel

This file re-exports from the compiled `./src/index.js`:

```typescript
// packages/policy/index.ts — root barrel (re-exports from compiled src)
export * from './src/index.js';
```

**What stays in core (NOT in policy public API):**
- `createPolicyEngineConfig` — stays in `core/src/policy/config.ts` (Storage, coreEvents deps)
- `createPolicyUpdater` — stays in `core/src/policy/config.ts` (Storage, coreEvents deps)
- `persistPolicyToToml` — stays in `core/src/policy/config.ts`
- `policy-helpers.ts` — stays in core (tool/scheduler bridge functions)

## What Stays in Core vs. Moves

| File/Function | Destination | Strategy |
|---------------|-------------|----------|
| `types.ts` | policy | **COPY** to policy; core original kept as re-export shim until P10d |
| `policy-engine.ts` | policy | **COPY** to policy; core original kept as re-export shim until P10d |
| `stable-stringify.ts` | policy | **COPY** to policy; core original kept as re-export shim until P10d |
| `utils.ts` | policy | **COPY** to policy; core original kept as re-export shim until P10d |
| `toml-loader.ts` | policy | **COPY** to policy; core original kept as re-export shim until P10d |
| `policies/*.toml` | policy | **COPY** (original stays in core, deleted in P10d) |
| `shell-utils subset` | policy | **COPY** only `SHELL_TOOL_NAMES`, `splitCommands`, `hasRedirection` |
| `config.ts` (pure utilities) | policy | Split: pure functions copy to policy; orchestration stays |
| `config.ts` (orchestration) | core | KEEP: `createPolicyEngineConfig`, `createPolicyUpdater`, `persistPolicyToToml` |
| `policy-helpers.ts` | core | KEEP: hard tool/scheduler deps |
| `confirmation-bus/types.ts` | policy | **COPY** to policy; core original kept as re-export shim until P10d |
| `confirmation-bus/message-bus.ts` | policy | **COPY** to policy (injected logger); core original kept as re-export shim until P10d |
| `tool-confirmation-types.ts` | core | Becomes thin re-export shim in P09 |
| `policy/index.ts` | core | Becomes thin re-export barrel in P09 |
| `confirmation-bus/index.ts` | core | Becomes thin re-export barrel in P09 |

### Extraction Sequencing (COPY-first, delete-later)

Source files are **copied** into `packages/policy/src/` during P05/P07. Core originals remain intact until P10d (Source Deletion & Cleanup). This ensures:
- P05/P07 copies are verified independently without touching core.
- P09 integration wires core to consume from `@vybestack/llxprt-code-policy` via re-export shims.
- P10a/P10b/P10c test and consumer migration run against a working codebase.
- P10d deletes core originals only after all shims/tests/imports are green.
- At no point are core source files missing before their re-export shims are in place.

### Deep Core Import Backward-Compatibility Shim Strategy

After copying source files to the policy package, core maintains backward compatibility through thin re-export shims:

1. **Barrel re-exports** (P09): `policy/index.ts` and `confirmation-bus/index.ts` become re-export shims that `export * from '@vybestack/llxprt-code-policy'`, forwarding all exports. All existing `import { PolicyEngine } from '@vybestack/llxprt-code-core'` continue to resolve.

2. **Deep file re-exports** (P10d): When core originals are deleted, the files `core/src/policy/types.ts`, `core/src/policy/policy-engine.ts`, `core/src/confirmation-bus/types.ts`, etc. are **replaced with thin re-export shims** (not just deleted). Each shim file re-exports from `@vybestack/llxprt-code-policy`:
   ```typescript
   // packages/core/src/policy/types.ts — re-export shim
   // @plan PLAN-20260609-ISSUE1591.P10d — original types.ts deleted (moved to packages/policy/src/types.ts)
   export * from '@vybestack/llxprt-code-policy';
   ```
   This ensures direct relative imports like `import { PolicyDecision } from '../policy/types.js'` within core continue to resolve.

3. **No parallel copies** after P10d — the shim is a pure forwarding file with no duplicate logic.

Files that have no remaining callers after migration are deleted outright (no shim needed). Whether a file gets a shim or outright deletion is determined by a grep for direct relative imports to that file across all core source.

## Phases Overview

| Phase | ID | Title | Type |
|-------|-----|-------|------|
| 00 | P00 | Preflight Verification | Verification |
| 01 | P01 | Domain Analysis | Analysis |
| 01a | P01a | Domain Analysis Verification | Verification |
| 02 | P02 | Pseudocode Review | Design |
| 02a | P02a | Pseudocode Verification | Verification |
| 03 | P03 | Package Scaffold | Stub |
| 03a | P03a | Scaffold Verification | Verification |
| 03b | P03b | Skeleton Stub Exports | Stub |
| 04 | P04 | Policy Source — RED Tests | TDD Tests |
| 04a | P04a | Policy Source TDD Verification | Verification |
| 05 | P05 | Policy Source — GREEN Implementation | Implementation |
| 05a | P05a | Policy Source Impl Verification | Verification |
| 06 | P06 | Confirmation Bus — RED Tests | TDD Tests |
| 06a | P06a | Confirmation Bus TDD Verification | Verification |
| 07 | P07 | Confirmation Bus — GREEN Implementation | Implementation |
| 07a | P07a | Confirmation Bus Impl Verification | Verification |
| 08 | P08 | Core Integration — RED Tests | TDD Tests |
| 08a | P08a | Core Integration TDD Verification | Verification |
| 09 | P09 | Core Integration — GREEN Implementation | Implementation |
| 09a | P09a | Core Integration Impl Verification | Verification |
| 10 | P10 | Test Migration | Implementation |
| 10a | P10a | Test Migration Verification | Verification |
| 10a-V | P10a-V | Consumer & Boundary Verification | Verification |
| 10b-V | P10b-V | Boundary Scan (Manifest + Source) | Verification |
| 10d | P10d | Source Deletion & Cleanup | Implementation |
| 10d-V | P10d-V | Source Deletion Verification | Verification |
| 11 | P11 | Full Build & Test Suite | Verification |
| 11a | P11a | Final Review | Review |
| 11b | P11b | Package Build/Dist TOML Loading Verification | Verification |
| 12 | P12 | Smoke Test & Cleanup | Verification |
| 12a | P12-V | Smoke Test & Cleanup Verification | Verification |

**Total: 33 steps (22 phases + 11 verification gates)**

## Dependency Graph

```
P00 (preflight)
  → P01 (analysis) → P01a
    → P02 (pseudocode) → P02a
      → P03 (scaffold) → P03a
        → P03b (skeleton stubs)
          → P04 (policy source RED) → P04a
            → P05 (policy source GREEN) → P05a
              → P06 (confirm bus RED) → P06a
                → P07 (confirm bus GREEN) → P07a
                  → P08 (core integration RED) → P08a
                    → P09 (core integration GREEN) → P09a
                      → P10 (test migration) → P10a
                        → P10a-V (consumer & boundary verification)
                          → P10b-V (boundary scan)
                            → P10d (source deletion) → P10d-V
                              → P11 (full build/test) → P11a
                                → P11b (dist TOML verification)
                                  → P12 (smoke test) → P12-V
```

## TDD Cycle Structure (Fixed — No Skipping)

Every implementation area follows: **Stub (Skeleton) → RED Tests → GREEN Implementation → Verification**.

Skeleton stubs (P03b) create resolvable TypeScript files with correct signatures but deliberately wrong behavioral results. RED tests then import these stubs successfully but fail on **behavioral assertions** (wrong return values, missing enum values, empty arrays). GREEN replaces stubs with real implementations.

| Area | Stub | RED | GREEN | Verify |
|------|------|-----|-------|--------|
| Package scaffold | P03 | — | — | P03a |
| Skeleton stubs | P03b | — | — | (verified as part of P03b) |
| Policy source | P03b (skeletons) | P04 | P05 | P05a |
| Confirmation bus | P03b (skeletons) | P06 | P07 | P07a |
| Core integration | — | P08 | P09 | P09a |
| Test migration | — | — | P10 | P10a |
| Consumer verification | — | — | — | P10a-V (verification-only) |
| Source deletion | — | — | P10d | P10d-V |
| Boundary scans | — | — | — | P10b-V (verification-only) |

### RED Test Behavioral Requirements

RED tests must fail on **behavioral assertions**, not import-resolution failures:
- **P04/P06**: After P03b skeleton stubs are in place, imports resolve but return wrong values (null decisions, empty arrays, placeholder enum values). RED tests assert correct values and fail because skeletons are wrong.
- **P08**: `@vybestack/llxprt-code-policy` is a registered workspace package, so imports resolve. RED tests assert missing manifest dependency, missing re-export shims, or broken alias identity — and fail because core hasn't been wired yet.
- No mock theater. No `toThrow('NotYetImplemented')`. Tests are behavioral — they verify outputs, not structure.

### Consumer Migration (P10b/P10c — Revised)

**P10b and P10c are eliminated as separate RED/GREEN phases.** The review identified that consumer RED tests after P09/P10 are bogus: core re-export shims are already in place after P09, so CLI imports via core already work. There is no meaningful RED state for "CLI can import from core re-exports" because P09 already made that work.

Instead:
- **P10a-V** (Consumer & Boundary Verification): A single verification-only phase that confirms CLI can import policy types through core re-exports, backward-compat aliases are identity-equal, and no direct CLI → policy dependency is needed unless a behavioral gap is found. This runs after P10a test migration.
- **P10b-V** (Boundary Scan Verification): Explicit manifest and source boundary scans verifying `packages/policy` has no imports/dependencies on forbidden packages. See P10b-V phase file.

### Settings/Config Gap (Explicit)

`packages/settings` does **not** exist and none will be created as part of this plan. All policy configuration orchestration (`createPolicyEngineConfig`, `createPolicyUpdater`, `persistPolicyToToml`) remains in `packages/core/src/policy/config.ts`. The policy package accesses paths via the injected `PolicyPathResolver` interface and logging via the injected `PolicyLogger` interface. Implementation phases (P05, P07, P09) must not assume a settings package exists or will be created.

### CLI Migration Reconciliation

The specification states "no CLI changes required" for existing consumers. CLI currently imports policy types via core re-exports (`import { PolicyEngine } from '@vybestack/llxprt-code-core'`). The safe approach is:
- **CLI relies on core re-exports** for all policy types. No direct `@vybestack/llxprt-code-policy` dependency is added to CLI unless a behavioral test proves a direct import is needed.
- P10a-V verifies that CLI can import from `@vybestack/llxprt-code-core` and get the correct policy types via re-export. If all existing CLI imports resolve through core re-exports, no CLI `package.json` or import changes are required.
- Only add `@vybestack/llxprt-code-policy` as a direct CLI dependency if a behavioral test demonstrates that core re-exports alone are insufficient (e.g., tree-shaking, subpath exports, or a specific CLI feature that needs direct policy access).
- **P10b and P10c are removed** as separate RED/GREEN phases. Consumer migration is a verification-only gate (P10a-V) after test migration, since core re-export shims are already in place from P09.

### Policy-Owned Structural Type Shapes (Exact — From Current Source)

These interfaces are defined in `packages/policy/src/confirmation-bus/types.ts` to replace external dependencies. Shapes are derived from the current codebase:

**`PolicyFunctionCall`** (replaces `FunctionCall` from `@google/genai`):
```typescript
interface PolicyFunctionCall {
  /** The unique id of the function call. */
  id?: string;
  /** The function parameters and values in JSON object format. */
  args?: Record<string, unknown>;
  /** The name of the function to call. */
  name?: string;
}
```
Fields `partialArgs` and `willContinue` from the full `FunctionCall` are omitted because confirmation-bus only uses `name`, `args`, and `id`.

**`PolicyToolCallState`** (replaces `ToolCall` discriminated union from `scheduler/types`):
```typescript
interface PolicyToolCallState {
  status: string;
  request: {
    functionCall?: PolicyFunctionCall;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
```
This is a minimal structural type. The full `ToolCall` is a discriminated union of 7 variants (`ValidatingToolCall | ScheduledToolCall | ExecutingToolCall | SuccessfulToolCall | ErroredToolCall | CancelledToolCall | WaitingToolCall`), each with `status`, `request`, `tool`, `invocation`, and optional `outcome`. Policy only needs `status` and `request.functionCall`; all other fields are opaque to policy. Using a structural type avoids importing the full union.

**`ConfirmationOutcome`** (replaces `ToolConfirmationOutcome` from `tools/tool-confirmation-types`):
```typescript
enum ConfirmationOutcome {
  ProceedOnce = 'proceed_once',
  ProceedAlways = 'proceed_always',
  ProceedAlwaysAndSave = 'proceed_always_and_save',
  ProceedAlwaysServer = 'proceed_always_server',
  ProceedAlwaysTool = 'proceed_always_tool',
  ModifyWithEditor = 'modify_with_editor',
  SuggestEdit = 'suggest_edit',
  Cancel = 'cancel',
}
```
Exact 1:1 copy of the current `ToolConfirmationOutcome` enum values. Backward-compat alias `ToolConfirmationOutcome = ConfirmationOutcome` exported from core.

**`ConfirmationPayload`** (replaces `ToolConfirmationPayload` from `tools/tool-confirmation-types`):
```typescript
interface ConfirmationPayload {
  /** Override modifiedProposedContent for modifiable tools in inline modify flow. */
  newContent?: string;
  /** Override command text for shell-like tool confirmations. */
  editedCommand?: string;
}
```
Exact 1:1 copy of the current `ToolConfirmationPayload` interface. Backward-compat alias `ToolConfirmationPayload = ConfirmationPayload` exported from core.

## Success Criteria

- All REQ-001 through REQ-008 acceptance criteria met (see `specification.md`)
- Policy package has zero dependency on core, providers, tools, CLI
- No `@google/genai` in policy production code or dev deps
- All existing `@vybestack/llxprt-code-core` deep imports continue to work via re-export shims
- No circular dependencies (verified by package manifest and source import scans)
- No TODO/FIXME/HACK/STUB in policy production code

## Behavioral Validation Requirements

- TOML rule loading from new package source location (`packages/policy/src/policies/`) must produce identical rules to current loading from `packages/core/src/policy/policies/`.
- Built dist output (`packages/policy/dist/`) must load TOML policies from the correct relative path after TypeScript compilation.
- Explicit test: `loadDefaultPolicies()` from source and from dist must return the same rule count and priority values.
- Source+dist TOML load behavioral tests must verify exact rule counts and priority values.
- **P11b** provides concrete commands for building `packages/policy/dist` and proving `loadDefaultPolicies()` loads bundled TOML files from dist before final cleanup.

## Final Verification Gate (Mandatory — All 6 Commands)

The final verification gate runs exactly these six commands in sequence. No substitutions, no partial runs, no additional commands:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
```

ALL six must pass. No exceptions. This exact gate appears in P11, P11a, P12, and P12-V.

## Failure Recovery Guidance (Fixed — No Unsafe Commands)

If any phase fails:
1. **Identify the specific failure** — read the error output fully.
2. **Determine scope** — is it policy-only or does it affect core?
3. **Narrow fix** — fix only the failing component, do not re-run completed phases.
4. **Targeted revert** — use `git diff` to identify exact changes, then `git checkout -- <specific-file>` to revert only the affected file(s). Never use `rm -rf` or broad `git checkout -- packages/`.
5. **Re-verify** — run only the failing phase's verification, then the full verification gate.

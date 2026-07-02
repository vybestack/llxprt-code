# Import Inventory & Consumer Classification

Plan ID: PLAN-20260629-ISSUE2285
Artifact type: Pre-implementation analysis (evidence for preflight phases)

This document records the CURRENT state (HEAD) of every consumer of
`@vybestack/llxprt-code-agents`, the internals subpath, and deep agents source
## Preflight confirmation (authoritative — see preflight-results.md §2)

P01 preflight re-ran the import greps against the live source tree at HEAD and
CONFIRMED: "import-inventory.md section 2 is ACCURATE against the live grep.
No corrections needed." The four A2A compile-breakers (§2.2), the nine CLI
test compile-breakers (§2.3), the three internals-subpath consumers (all in
agents-internal tests), and the `app-service.js` subpath scope (§2.4) all
match the live grep. This inventory is the authoritative basis for P04
(consumer migration) and P05 (root depollution).

paths. It is the basis for the preflight inventory phase and the migration
phases. All evidence is from `grep` against the source tree at plan-creation
time.

## 1. Agents root barrel — current shape

`packages/agents/src/index.ts`:
```ts
export * from './internals.js';     // LOW-LEVEL internals (the leak)
export * from './api/index.js';     // curated public Agent API
export type { AgenticLoopMessage, ApprovalHandler } from './core/agenticLoop/types.js';
export type { CompressionResult } from '@vybestack/llxprt-code-core/core/compression/types.js';
export function createTaskToolRegistration(): TaskToolRegistration { ... }
```

After depollution, `export * from './internals.js'` is removed. The root keeps
only the curated public API plus any justified root-local compatibility exports.

## 2. Consumer classification

### 2.1 Production CLI (`packages/cli/src` production source)

Bare-root imports (all currently PUBLIC symbols — no migration needed):

| File | Symbols | Category |
|------|---------|----------|
| `nonInteractiveCli.ts` | `fromConfig`, type `Agent` | public |
| `nonInteractiveCliSupport.ts` | (public symbols) | public |
| `cliAgentBootstrap.ts` | `fromConfig`, type `Agent` | public |
| `cliSessionDispatch.tsx` | type `Agent` | public |
| `config/configBuilder.ts` | `createAgentRuntimeFactoryBindings` | public factory |
| `ui/hooks/geminiStream/contextLimit.ts` | `getTokenLimitForConfiguredContext` | public |
| `ui/hooks/geminiStream/toolCompletionHandler.ts` | `classifyCompletedTools` | public |
| `ui/hooks/geminiStream/useAgenticLoop.ts` | `createAgenticLoop`, types `AgenticLoopApprovalHandler`, `AgenticLoopEvent`, `AgenticLoopRunner` | public factory + types |
| `ui/utils/autoPromptGenerator.ts` | `createAgentClient` | public factory |
| `ui/hooks/useAutoAcceptIndicator.ts` | `ApprovalMode`, type `Agent` | public |
| `ui/commands/hooksCommand.ts` | type `HookInfo` | public |
| various UI files | type `Agent` | public |

**Result**: NO production CLI source imports internals-only names from the root
today. Production CLI is already clean; the boundary checker's
`PUBLIC_AGENT_SYMBOLS` is what currently guards this, but the actual production
imports already use only public symbols. Depollution will not break production
CLI imports.

### 2.2 Production A2A server (`packages/a2a-server/src`)

| File | Symbols | Kind | Migration |
|------|---------|------|-----------|
| `config/config.ts` | `AgentClient`, `CoreToolScheduler`, `createTaskToolRegistration` | value | **BREAKS** — migrate to `createAgentClient`, `createToolScheduler`, and `createTaskRegistration`/`createTaskToolRegistration` via internals subpath decision |
| `agent/task.ts` | `AgentClient` | value (constructed) | **BREAKS** — migrate to `createAgentClient` factory |
| `agent/task-runtime-helpers.ts` | `AgentClient` | type | **BREAKS** — migrate to `AgentClientContract` type from core, or internals subpath |
| `utils/testing_utils.ts` | `CoreToolScheduler` | type | **BREAKS** — migrate to `ToolSchedulerContract` type from core, or internals subpath |

### 2.3 Tests and test utilities (`packages/cli/src`)

| File | Symbols | Kind | Migration |
|------|---------|------|-----------|
| `integration-tests/test-utils.ts` | `AgentClient`, `CoreToolScheduler`, `createTaskToolRegistration` | value | **BREAKS** — migrate to internals subpath |
| `integration-tests/todo-continuation.integration.test.ts` | `AgentClient`, type `Turn` | value | **BREAKS** — migrate to internals subpath |
| `ui/hooks/useTodoContinuation.spec.ts` | `AgentClient as AgentClientClass` | value | **BREAKS** — migrate to internals subpath |
| `ui/hooks/useToolScheduler.test.ts` | type `CoreToolScheduler` | type | **BREAKS** — migrate to internals subpath |
| `ui/hooks/useToolScheduler.part2.test.ts` | type `CoreToolScheduler` | type | **BREAKS** — migrate to internals subpath |
| `ui/hooks/useToolScheduler.part3.test.ts` | type `CoreToolScheduler` | type | **BREAKS** — migrate to internals subpath |
| `ui/hooks/useToolScheduler.part4.test.ts` | type `CoreToolScheduler` | type | **BREAKS** — migrate to internals subpath |
| `ui/hooks/useToolScheduler.part5.test.ts` | type `CoreToolScheduler` | type | **BREAKS** — migrate to internals subpath |
| `ui/hooks/geminiStream/__tests__/useAgenticLoop.test.tsx` | `CoreToolScheduler` | value | **BREAKS** — migrate to internals subpath |

NOTE: `App.behavior.test.tsx`, `App.context.test.tsx`, `App.test.tsx`,
`App.components.test.tsx`, `App.dialogs.test.tsx` import `AgentClient` from
`@vybestack/llxprt-code-core` (NOT agents root), so they do NOT break from
agents depollution. The overview listed them as potential compile-breakers but
grep confirms the `AgentClient` in those files is the core re-export, which
itself traces to the agents internals via core's own barrel — this must be
verified in preflight (see preflight phase).

### 2.4 Other production packages

`packages/agents/src/app-service.ts` — the `./app-service.js` subpath is
orthogonal to the root internals leak and should NOT be changed unless preflight
identifies a direct requirement.

### 2.5 Intra-agents self-imports

Internal package code uses relative paths (e.g. `'./core/client.js'`), not the
package root specifier. No change needed.

### 2.6 Scripts/tooling

`scripts/check-cli-import-boundary.mjs` — `PUBLIC_AGENT_SYMBOLS` removed in the
boundary checker replacement phase.

## 3. Existing agents surface tests to update

- `packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts`:
  - Test A asserts `AgenticLoop` is a root export (will become a DENY).
  - Test B asserts `root.AgentClient === internals.AgentClient` (identity —
    must be removed and replaced with explicit root DENY assertion).
  - PROP tests assert `AgenticLoop`, `createTaskToolRegistration` as root keys.
- `packages/agents/src/api/__tests__/nonBreaking.exports.test.ts`:
  - Test B asserts `root.AgentClient === internals.AgentClient` (identity).
  - Test A does not assert internals leak.

These must be surgically updated, not mechanically inverted.

## 4. createTaskToolRegistration root-local compatibility decision

`createTaskToolRegistration` in `packages/agents/src/index.ts` delegates to
`createTaskRegistration` from `./api/runtimeFactories.js`. A2A
`config/config.ts` imports it from the root.

Decision options:
- (A) Keep `createTaskToolRegistration` as a curated root export (it is a
  public factory wrapper, not an internals leak). A2A keeps importing it from
  the root.
- (B) Migrate A2A to `createTaskRegistration` from the public API barrel and
  remove the root-local wrapper.

The plan's preflight phase must decide. Recommendation: (A) keep it as a
curated root export because it is app-glue (a named factory), not a low-level
internals symbol, and it is already in the curated public surface. The
API-surface guard snapshot must include it.

## 5. Disambiguation type exports

`packages/agents/src/index.ts` re-exports `AgenticLoopMessage`,
`ApprovalHandler`, `CompressionResult` as disambiguation types. After removing
`export * from './internals.js'`, the `export *` merge conflict that required
disambiguation may no longer exist. Preflight must check whether these are
already exported by `./api/index.js` (they are: `AgenticLoopMessage` and
`ApprovalHandler` appear in `api/index.ts`). `CompressionResult` is core-owned
and may still need explicit re-export if it is part of the public surface.

## 6. Generated dist policy

Evidence: `.gitignore` contains `dist`. `git ls-files packages/agents/dist`
returns nothing. Therefore `dist` is an UNTRACKED build artifact.

Policy: ignore `dist` during source inventory. Regenerate with `npm run build`.
Any API guard that reads emitted declarations must run against freshly
generated output, not stale `dist`.

### 6a. Build side effects (revision 3 — architect finding 20)

Running `npm run build --workspace @vybestack/llxprt-code-agents` (via
`scripts/build_package.js`) produces, beyond `dist/`, a cached incremental
graph at the path declared by the agents tsconfig:
`node_modules/.cache/tsbuildinfo/agents.tsbuildinfo`. Preflight (P01) MUST:

1. Confirm BOTH `dist` and `node_modules/.cache/tsbuildinfo/` are gitignored
   (so neither appears as a tracked change after a build).
2. Run `git status` before and after a build and record that no TRACKED file
   changes (only untracked/ignored artifacts are produced).
3. Record the chosen API-guard build mechanism (B1 isolated temp tsconfig, or
   B2 fresh shared dist) per `analysis/api-guard-mechanism.md` section 1. For
   B1, the temp tsconfig overrides `tsBuildInfoFile` to a temp path so the
   shared cache is not perturbed. For B2, acknowledge the shared-dist and
   shared-tsbuildinfo side effects explicitly.

This prevents a build from silently leaving modified tracked artifacts or
perturbing the shared incremental-build cache in a way that affects subsequent
`npm run typecheck`/`npm run build` results.

## 7. A2A fixture construction (revision 3 — architect finding 11)

**Architect review finding 7: `preflight-results.md` is the AUTHORORITATIVE
artifact for P04 fixture details (builder/API/stub-seam/dispatch-method).**
The evidence below is recorded in `analysis/preflight-results.md` (P01
section 3), NOT in this section. This section documents the REQUIREMENT;
`preflight-results.md` holds the ACTUAL recorded evidence.

P04 A2A behavior tests require a "real `AgentConfig`" fixture. The prior
revision left the exact builder/API unspecified, making the requirement
non-implementable. Preflight (P01) MUST record the exact, current builder(s)
used to construct a real `AgentConfig` for A2A tests IN
`analysis/preflight-results.md`, by grepping the existing
A2A test suite and config code for the constructor/builder in use today:

- Record the exact import path and function name for constructing an
  `AgentConfig` (e.g. a builder, factory, or literal with the required fields)
  as used in `packages/a2a-server/src` today.
- Record the exact `runtimeState`/runtime-context construction API used by
  A2A today (the object passed as the second argument to
  `createAgentClient`/`new AgentClient`).
- Record the exact stub model-provider seam and the exact dispatch method name.
- If no existing A2A test constructs a real `AgentConfig`, record the closest
  production construction site (`packages/a2a-server/src/config/config.ts`)
  and the exact builder it uses, so P04 can reuse it.

P04's fixture requirement references these recorded builders/APIs from
`preflight-results.md` by exact name and import path, rather than an
unspecified "real AgentConfig".

## 8. A2A behavior-equivalence assertion (revision 3 — architect finding 10)

P04's prior requirement that the factory and constructor produce "the SAME set
of own enumerable property keys" is brittle (own-enumerable-key equivalence
depends on internal field layout and breaks on legitimate lazy/private field
differences). Replace with PUBLIC behavioral equivalence: assert that the
factory-produced client and scheduler expose the SAME PUBLIC methods A2A
actually calls (e.g. the dispatch/send method, the schedule method) as real
functions, and that dispatching a representative task through the
factory-produced client yields a result of the expected shape (non-empty
content matching a stub model reply). Do NOT assert own-enumerable key-set
identity.

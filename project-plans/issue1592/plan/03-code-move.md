# Phase 03: Atomic Code Move + Consumer Migration

## Phase ID

`PLAN-20260610-ISSUE1592.P03`

## Prerequisites

- P02a PASS. Working tree clean and committed before starting (rollback point).

## Atomicity Requirement

Because backward-compatibility shims are FORBIDDEN, removing moved implementations from core's export surface necessarily breaks CLI/a2a-server imports until those consumers are updated. Therefore this phase performs the move AND the consumer import flips as ONE change set. Intermediate typecheck failures are expected DURING the phase; the phase is complete only when the entire workspace is green. Use frequent local commits as checkpoints, but do not consider any checkpoint "done" until the final battery passes.

## Requirements Implemented

### REQ-API-001: Public interface in agents; core export cleanup
### REQ-DEP-001: Dependency rules
### REQ-CLEAN-001 (partial): no leftovers/shims

(Full texts in specification.md — this phase is the mechanical execution of `analysis/move-map.md`, which is the binding file-by-file authority. Any deviation from the move map discovered mid-phase must be recorded in `.completed/P03.md` with evidence and the move map updated.)

## Implementation Tasks (ordered)

1. **turn.ts split** (do FIRST, in core): extract class `Turn` + its imports into a new module; keep `core/turn.ts` types-only (enum, event interfaces, ToolCall*Info, DEFAULT_AGENT_ID). Core internal imports of types keep working. Commit checkpoint.
2. **SubagentSchedulerFactory type relocation** into `core/subagentTypes.ts` (or equivalent staying module); retarget `index.ts` line 84 and `configBaseCore`/`toolRegistryFactory` imports. Commit checkpoint.
3. **git mv the move set** per move-map sections A, C, D, E, F (including the extracted Turn class module and co-located tests/`__snapshots__`/`__mocks__`/`__tests__` subdirs that belong to moved subjects).
4. **Rewrite imports inside moved files**:
   - `../<staying-module>` → `@vybestack/llxprt-code-core/<subpath>.js` (using exports map entries from P02; add missing entries as discovered — record each addition).
   - Intra-move-set imports stay relative within `packages/agents/src`.
   - `../index.js` core-barrel imports inside moved files (known sites include `core/coreToolScheduler.ts:7`, `core/nonInteractiveToolExecutor.ts:12`, `scheduler/status-transitions.ts:28-30`; enumerate ALL with grep) → resolve each symbol: if it stays in core, import via core subpath; if it moved, import the agents-internal module. NO importing the core root barrel from agents (hard scan in P03a). Decide once, apply uniformly, document.
   - **Moved tests importing providers** (`chatSession.issue1729.test.ts`, `chatSession.runtime.test.ts`, `chatSession.thinking-toolcalls.test.ts`): rewrite per move-map §H to structural fakes; agents must have NO providers dependency, including devDependencies.
   - **Provider test relocation**: move `OpenAIStreamProcessor.stopReason.test.ts` ChatSession-dependent coverage into agents per move-map §H.
5. **Core stayer import updates**: per reverse-dependency-map §1 resolution column (config files now import factory/contract types only; utils use contracts — these were done in P01; what remains is deleting now-dead imports and the moved-module export lines in `index.ts` per reverse-dep map §4).
6. **Contract modules**: the contract lives in a NEW staying module `core/clientContract.ts` (DECIDED — do not reuse the `core/client.ts` path, so scans can unambiguously distinguish contract imports from moved-implementation imports). `core/client.ts` moves to agents wholesale; the concrete class `implements AgentClientContract` imported from the core subpath. Core stayers/tests that only need the contract retarget to `core/clientContract.js`.
7. **agents/src/index.ts**: export public API per REQ-API-001.1.
8. **vi.mock / dynamic import fixes** across all packages per preflight item 12 list.
9. **Test relocation decisions** per move-map §H: each stayer test referencing moved classes either switches to structural fakes or moves; record the disposition list. Generate the COMPLETE audit list mechanically FIRST (before any move):
   ```bash
   grep -rln -E "AgentClient|ChatSession|CoreToolScheduler|SubAgentScope|SubagentOrchestrator|\bTaskTool\b|vi\.mock\(.*core/(client|chatSession|coreToolScheduler|subagent)" packages/core/src --include="*.test.ts" --include="*.spec.ts"
   ```
   Every hit gets an explicit disposition: MOVE (test exercises moved behavior) / STRUCTURAL FAKE (test only needs a client/scheduler-shaped object) / RETARGET TO CONTRACT / UNAFFECTED (type-only of staying module). Known large-blast-radius hits that MUST appear in the table: `config/config.test.ts` (imports AgentClient at ~29, mocks ../core/client.js at ~90), `utils/summarizer.test.ts` (~9/21/49), `tools/write-file.test.ts` (~25/34), `lsp/__tests__/system-integration.test.ts` (~81), `lsp/__tests__/e2e-lsp.test.ts` (~82), `hooks/hooks-caller-application.test.ts` (imports ToolCall/SuccessfulToolCall AND constructs concrete CoreToolScheduler — :34-35, ~220; DECIDED DISPOSITION: **MOVE to packages/agents** because it exercises the moved scheduler's hook-trigger behavior end-to-end — it cannot stay in core without a core→agents dependency; it keeps importing the staying `coreToolHookTriggers.ts` via core subpath), `telemetry/loggers.test.ts` (constructs AgentClient ~434), `telemetry/uiTelemetry.test.ts` (imports type-only `CompletedToolCall`/`ErroredToolCall`/`SuccessfulToolCall` from ../core/coreToolScheduler.js at ~17-21 → RETARGET TO CONTRACT: these scheduler result types belong in the staying `core/toolSchedulerContract.ts` so this stayer test retargets there). vi.mock path strings must be audited the same as imports. **BINDING**: the generated audit list is a hard gate — P03 FAILS if any hit lacks an explicit disposition row in the completion marker, and P03a must diff the pasted table against a freshly regenerated list (zero unaccounted hits). The named examples above are mandatory-presence checks, not the full inventory.
10. **core/src/index.test.ts** updated for the new export surface.
11. **Consumer migration (same change set)**: add `"@vybestack/llxprt-code-agents": "file:../agents"` to `packages/cli/package.json` and `packages/a2a-server/package.json` (deliberately deferred from P02 so the dependency lands with its first imports), run `npm install` to update the lockfile, then flip every CLI and a2a-server import of moved symbols to `@vybestack/llxprt-code-agents` (concrete classes: `AgentClient` construction in `autoPromptGenerator.ts` and `a2a-server/src/agent/task.ts:154`, factory wiring registrations, `executeToolCall`, ChatSession references, subagent classes). BOTH composition roots wire ALL THREE seams in their ConfigParameters: CLI (its Config construction sites) AND a2a-server (`createConfigParameters` in a2a-server/src/config/config.ts ~48 — a2a initializes Config at :44, so omitting `taskToolRegistration` there would silently disable TaskTool, per REQ-INV-003.2/.3). **TaskTool stage-2 flip (atomic here)**: DELETE the core-local `config/defaultTaskToolRegistration.ts` module (P01 stage-1 fallback) in the same change set that moves `tools/task.ts` — both roots now import `TaskTool` from `@vybestack/llxprt-code-agents` for their registration. After this phase core must contain ZERO references to the concrete TaskTool in any import form (covered by anti-shim scans below). Type-only imports of staying modules keep using core. Use the reverse-dep map §5 lists as the audit basis; P04 re-audits.
11b. **TypeScript resolution updates (same change set — imports won't typecheck without these)**:
   - `packages/cli/tsconfig.json`: mirror the providers precedent exactly — add `"@vybestack/llxprt-code-agents": ["../agents/index.ts"]` and `"@vybestack/llxprt-code-agents/*": ["../agents/src/*"]` to `paths` (lines ~12-22), add `../agents/index.ts` + `../agents/src/**/*.ts` (+json) to `include` (~25-41), add agents test globs to `exclude` (~45+).
   - `packages/a2a-server/tsconfig.json`: add agents to `references`/paths/include as its providers/core handling dictates (currently references only ../core at line ~30 — inspect how it resolves core and replicate for agents).
   - `packages/agents/tsconfig.json`: ensure its own paths/include resolve core sources the same way providers' tsconfig resolves core.
   - Audit any vitest config aliases referencing core paths that moved.
12. **Dependency completeness**: after import rewrites, generate the actual external-module list used by `packages/agents` (src AND tests) using the full-coverage extraction (same as the P03a gate — single AND double quotes, `export ... from`, dynamic `import()`, `require()`, `vi.mock()` paths):
   ```bash
   grep -rhoE "(from|import\(|require\(|vi\.mock\()\s*['"][^.'"][^'"]*['"]" packages/agents --include="*.ts" --include="*.tsx" | grep -oE "['"][^'"]+['"]" | sort -u
   ```
   and reconcile `packages/agents/package.json` dependencies against it — every non-core workspace dep and external lib must be declared with versions matching core's.
13. Run incremental `npm run typecheck` loops until green; then full battery.

## Verification Commands

```bash
# No moved implementation remains in core
ls packages/core/src/agents 2>/dev/null && echo FAIL || echo OK
test -f packages/core/src/core/subagent.ts && echo FAIL || echo OK
test -f packages/core/src/tools/task.ts && echo FAIL || echo OK
test -f packages/core/src/config/defaultTaskToolRegistration.ts && echo "FAIL: stage-1 default not deleted" || echo OK
grep -rnE "(from|import\(|require\(|vi\.mock\()\s*['"][^'"]*tools/task\.js['"]" packages/core/src --include="*.ts" && echo "FAIL: concrete TaskTool reference in core" || echo OK

# Dependency direction (covers tests too — REQ-CLEAN-001.1 says production OR test)
grep -rn "llxprt-code-agents" packages/core --include="*.ts" && echo FAIL || echo OK
grep -rn "llxprt-code-providers" packages/agents --include="*.ts" && echo FAIL || echo OK
grep -n "llxprt-code-providers" packages/agents/package.json && echo FAIL || echo OK

# No core root-barrel imports from agents (must use subpaths)
grep -rn "from '@vybestack/llxprt-code-core'" packages/agents/src --include="*.ts" && echo "AUDIT: root barrel imports" || echo OK

# Anti-shim
grep -rn "from '@vybestack/llxprt-code-agents'" packages/core && echo FAIL || echo OK

# FULL BATTERY (authoritative definition in 00-overview.md — all six items, no subsets)
npm run format && git diff --exit-code && npm run typecheck && npm run build && npm run test && npm run lint
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

## Success Criteria

Move map fully executed; full battery green; agents package tests pass in their new home; `git log --follow` shows history preserved for sampled moved files.

## Failure Recovery

`git reset --hard <pre-phase commit>`; fix the move map; re-execute.

## Completion Marker

`.completed/P03.md` with the full moved-file list (git status/diff stat), deviations, exports-map additions, and test relocation dispositions.

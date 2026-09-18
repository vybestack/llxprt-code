# Issue #3222: Agent API runtime assembly self-contained; delete provider-held agent factory registration

Branch: `issue3222`. Parent epic: #2619. Sibling owners: #2615 (Config slices E/F),
#2616 (ambient globals), #2635/#2637 (profiles/role runtimes), #2758 (provider
contribution seam, closed), #2320 (MessageBus seam, closed).

## Current state (verified on main @ 5bedbd238)

- `packages/cli/src/config/configBuilder.ts:40-43` builds
  `createAgentRuntimeFactoryBindings()` at module load and calls providers'
  `registerAgentRuntimeFactories(...)`; `buildConfig` also injects
  `agentClientFactory`, `toolSchedulerFactory`, `taskToolRegistration` into
  `new Config(...)`.
- `packages/providers/src/runtime/runtimeContextFactory.ts` holds the mutable
  module-global `agentRuntimeFactoryBindings`, exports register/reset, and
  `attachAgentRuntimeFactories` fires inside `resolveRuntimeConfig`, which also
  CONSTRUCTS a Config for callers that pass none (the subagent path).
- `packages/agents/src/api/createAgent.ts` supplies `agentClientFactory` and
  `toolSchedulerFactory` itself but NOT `taskToolRegistration` — TaskTool
  availability silently depends on the CLI having registered factories first.
- `packages/agents/src/core/subagentOrchestrator.ts:822` calls
  `createIsolatedRuntimeContext` WITHOUT a config — providers builds the
  subagent's Config and stamps CLI-registered agent factories onto it.
- `packages/agents/src/api/fromConfig.ts` requires the adopted Config to carry
  factories (CLI supplies them today via buildConfig).
- CLI foreground order (verified): buildConfig → preflight (no client) →
  `createForegroundAgent` → `fromConfig` (owns `config.initialize`) →
  recording/UI (may call `config.getAgentClient()` / `getOrCreateScheduler`).
- MCP host routing: `packages/mcp/src/host/hostServices.ts` still has the
  process-global registry; #2615 slice F has NOT landed (no E/F-ready evidence
  on #2615). Per this issue's own text, the global registry replacement and its
  deletion are owned by F and land "when their replacement lands".

## Acceptance criteria (shaped)

AC1 (characterization, Bun/bun:test, through public Agent API):
provider/model/auth activation; ONE shared bus across loop/scheduler/tools/
subagents; foreground vs isolated separation; shipped tool registration
(incl. TaskTool) from declarative config alone; child-runtime ownership +
disposal; caller-owned (fromConfig) vs agent-owned (createAgent) resources;
typed failure when runtime collaborators cannot be constructed.

AC2 (one agent-owned assembly): createAgent supplies ALL agent-owned factories
itself; internal assembly helpers are instance-owned inside agents (no
cross-package registration API); fromConfig installs agent-owned defaults on an
adopted Config when absent and never overrides caller-supplied ones (D2 adoption
seam preserved: adopted caller resources are not disposed).

AC3 (providers stop building agent graphs): `createIsolatedRuntimeContext`
requires a caller-supplied Config (typed error when missing); providers holds no
agent-owned factory in mutable state; subagent/compression runtimes build their
Config through the agent-owned assembly. #2320 bus invariant preserved.

AC4 (deletions): providers register/reset/attach + state + barrel re-exports
gone; CLI module-load registration and direct factory injection into Config
gone; agents `createAgentRuntimeFactoryBindings` gone; core
`AgentRuntimeFactoryBindings` contract gone; surface guards updated; mocks
updated; grep negative control clean.

AC5 (deterministic disposal): dispose idempotent; owned children before parent
collaborators; adopted caller resources untouched; createAgent failure path
cleans up the isolated runtime handle (currently leaks — no try/catch).

AC6: full verification cycle + smoke pass on the PR head.

OUT OF SCOPE (gated/owned elsewhere): MCP hostServices registry replacement and
two-host routing tests (#2615 F — not landed; `wireMcpHostServices` stays
as-is); profile semantics (#2635); role-runtime cutover (#2637); CLI or A2A as
composition root; any new global registry/service bag/bridge; Config residue
beyond the factory seams named above.

## Implementation phases

P1 Tests first (RED where behavior is missing):
- extend `createAgent.harness.behavior.test.ts`: no-CLI-import process →
  TaskTool registered via public tool surface.
- extend `fromConfig.behavior.test.ts`: adoption of a factory-less Config
  yields a working agent (client initialized through public readiness signal).
- extend `runtimeSeam.behavior.test.ts` / `agentMessageBus.behavior.test.ts`:
  subagent runtime construction via agent-owned path; same bus threads to child
  scheduling.
- new focused cases: typed error from `createIsolatedRuntimeContext` without
  config; createAgent activation failure cleans up runtime handle.
- extend `disposal.spec.ts` only if ordering/idempotency gaps exist for the new
  paths.

P2 Agent-owned assembly module `packages/agents/src/api/agentRuntimeAssembly.ts`
(instance-owned factories + `ensureAgentRuntimeFactories(config)` +
`buildIsolatedAgentConfig(...)` replicating the exact defaults
`resolveRuntimeConfig` used: managers under `Storage.getGlobalConfigDir()`,
model/debug/cwd fallbacks preserved). createAgent adds taskToolRegistration;
fromConfig ensures factories post-adoption.

P3 Providers: `config` required on `IsolatedRuntimeContextOptions`; delete
`resolveRuntimeConfig` + attach; subagentOrchestrator builds Config via the
agent-owned module; update every caller/test.

P4 Deletions per AC4 incl. `expected-root-surface.json`,
`publicSurface.nonbreaking.test.ts`, core contract, mocks in cli/zed tests.

P5 Disposal failure-path + ordering tests per AC5.

P6 Documented deferral of MCP host routing (gated on #2615 F).

## Verification

Per-phase: affected package bun tests + `npm run lint` + `npm run typecheck`.
Final: full `npm run test`, `npm run lint`, `npm run typecheck`, `npm run
format`, `npm run build`, smoke `bun scripts/start.ts --profile-load
zai-glm-flash "write me a haiku and nothing else"`.

## Review

typescriptexpert implements; deepthinker reviews (max 2 rounds); OCR per
workflow skill at final stage only if re-enabled — NOTE: Andrew suspended OCR
until further notice (2026-09-13 memory); do NOT run OCR unless he re-enables.

## Implementation + review status (2026-09-16)

Implementation complete in tree (subagent runs: tscoder-zai x2 + remediation).
Verified green before review: cli 755/755 files (9746 cases), agents 413/413,
providers 650/650, root typecheck 0 errors, root lint 0 errors (after fixing a
pre-existing main merge artifact: OpenAIStreamProcessor.ts max-lines 801->799
via single guard collapse; adjudicated bounded scope expansion for a green PR).

Regression found and fixed during verification: preflightAgentActivation ran
before fromConfig on the CLI path and required agentClientFactory (via
config.refreshAuth); main relied on CLI-injected factories. Fix: preflight now
installs agent-owned factories via ensureAgentRuntimeFactories (instance-owned).
Behavioral regression tests added (preflightAgentActivation.behavior.test.ts);
manual CLI repro verified to match main output.

Review (round 1, tscoder-zai adversarial; deepthinker/reviewer/architect all
provider rate-limited): NO BLOCKERS. 1 MAJOR + 4 MINOR, all classified
In-scope-Fix:
- F1 MAJOR: dead superseded-path residue — IsolatedRuntimeContextOptions still
  declares settingsService?/profileManager?/model?/debugMode?/workspaceDir?
  (read nowhere after resolveRuntimeConfig deletion) and callers still pass
  them (createAgent, fromConfig, subagentOrchestrator). Binding landing
  discipline requires removal in the same PR.
- F2 MINOR: fromConfig duplicates cleanupFailedRuntimeBootstrap as private
  cleanupFailedBootstrap; reuse the shared helper.
- F3 MINOR: subagentOrchestrator failure path lets cleanup error replace the
  original error; apply the shared AggregateError discipline.
- F4 MINOR: createAgent failure path never disposes the agent-owned Config
  after config.initialize; dispose owned Config on failure (aggregate errors).
- F5 MINOR: authRuntimeScope.test.ts Config fixture omits required model field
  (dir not covered by typecheck projects); add it.
Second-opinion review (tscoder-flash) running; findings to be folded into the
same remediation pass (stays review round 1).

## Final status (2026-09-16): READY FOR PR

Round-1 remediation applied (all six findings In-scope-Fix): F1 dead options
deleted from IsolatedRuntimeContextOptions + call sites (structural type pin
test); F4 createAgent failure path now disposes agent-owned Config (or full
facade dispose) via extended cleanupFailedRuntimeBootstrap, children-first,
original error preserved, AggregateError only on cleanup failure; F2 fromConfig
reuses shared helper; F3 orchestrator failure path uses shared helper (no error
masking); F5 test fixture model field; F6 lazy per-field factory install.
Round-2 verification review: 6/6 PASS, no regressions.

Full verification cycle from root, all green:
- npm run test (all workspaces incl. core 458/458, cli 755/755 files 9746
  cases, providers 650/650, agents 413/413) — the only "(fail)" log lines are
  intentional fixture files inside passing runner-classification tests.
- npm run lint (20 targets): 0 errors.
- npm run typecheck (build:types + workspaces + scripts + evals): 0 errors.
- prettier --check repo-wide: clean (4 of our files reformatted; cli suite
  re-run after: 755/755).
- npm run build: success (lazy-MCP registry coherence verified).
- Smoke: bun scripts/start.ts --profile-load zai-glm-flash haiku prompt ->
  valid haiku from glm-5.3-flash (stepfun-37 profile retired with the
  StepFun subscription cancellation).

Review agent note: deepthinker/reviewer/architect unavailable (provider rate
limits); adversarial review performed by tscoder-zai with tscoder-flash as
independent second opinion. Two review rounds total, per policy cap.

## Shipped (2026-09-16)

PR #3705 (branch issue3222): commit b70307228 (implementation, 60 files)
+ 19a67c4c9 (CodeRabbit triage: fixture Config disposal, mock settings
source, orchestrator failure-path ownedConfig). CI green on both commits
(39 pass / 0 fail / 3 expected skips, incl. CodeRabbit + LLxprt review).
All 3 CodeRabbit threads resolved with triage evidence (CR-3 success
paths rejected on HEAD parity — pre-existing, documented in-thread and
offered a follow-up issue). Merge awaiting explicit user approval per
standing policy.

## Post-review cleanup round (2026-09-17, in-PR per owner direction)

Four side effects flagged post-ship were cleaned up IN this PR (not deferred):
1. OpenAIStreamProcessor.ts: reverted the drive-by abort-guard collapse; the
   max-lines budget now comes from deduplicating the totalToolCalls closure
   that emitTerminalChunks passed twice (real dedup, behavior identical).
2. getAgentRuntimeStateSubscriptionCount removed from the core public barrel;
   the Config-disposal observability moved to an in-package core test
   (runtime/__tests__/AgentRuntimeState.configDispose.test.ts) with a real
   Config + real subscribing client; the agents-side test keeps its
   error-surface assertions.
3. Orchestrator now disposes the agent-owned isolated Config on ALL teardown
   paths (success, scope-creation failure, loader failure) children-first;
   previously only the bootstrap-failure path did (asymmetry: the isolated
   runtime treats the Config as caller-owned, so the orchestrator is its
   only disposer). Behavioral tests: subagentOrchestrator.isolatedConfigDispose
   .test.ts (real collaborators, subscription-handle probe) + spy-supplemented
   runtime test.
4. createAgent's 'no post-auth agent client' fail-fast characterized
   behaviorally (finalizeAgent.postAuthClient.behavior.test.ts): unreachable
   from createAgent (always injects a real factory), reachable from fromConfig
   via caller-supplied undefined-returning factory + authMode 'none' — real
   collaborators, no mocks.
Also: filed #3708 for the pre-branch createTaskToolRegistration() alias.
Verification: root typecheck 0 errors, root lint clean, full npm run test
green (core 459/459 on stable-tree rerun; one mid-run file-edit race during
the first pass), prettier/eslint clean on all touched files.

## Merge round (origin/main @ 6a2d23d0d, merge commit 9aa713102)

- Single content conflict: `packages/providers/src/openai/OpenAIStreamProcessor.ts` — both sides had the identical lint-cap dedup (ours `totalToolCalls`, main's #3492 `totalCalls`). Took main's side verbatim; file now byte-identical to origin/main.
- Post-merge test remediation:
  - 12 CLI integration failures ("Provider 'gemini' not found"): #3702 made gemini plugin-provided and checkout plugin discovery requires `plugins/<entry>/node_modules` to exist. Provisioned `plugins/google-gemini` locally via `bun install --omit=peer` (same as CI ci.yml:1154-1157); no tracked files changed. Retests 31/31 green; manual CLI repro matches main.
  - 3 disposal-test failures: gemini profile hit a MAIN-side gap — the isolated subagent registration path (`registerProvidersOntoManager` → `createProviderManager`) is builtins-only; nothing threads CLI startup's plugin contributions into it. Filed #3730; switched the test to `anthropic` / `claude-sonnet-4` (builtin) with rationale comment referencing #3730.
- Verification on merged tree: typecheck 0, lint 0, prettier clean, agents 412/412, CLI integration 31/31, core/providers green in full run, #2615 gate files untouched, six banned symbols grep clean.
- CI on 9aa713102: initial run had two flakes (agents-shard profiles-lock 10s timeout on slow runner; E2E replace "API Error: undefined is not a function" live-endpoint variance) — both passed on `gh run rerun --failed`; final: 40 pass / 0 fail / 3 skipped, CodeRabbit pass, no actionable threads.

## Internals-removal round (./internals.js escape hatch deleted)

Andrew's directive: no escape hatch, no allowlists, no backward-compat shims —
get rid of it in this PR. RED-FIRST protocol per his instruction: enforcement
tests written and proven failing BEFORE the removal.

### Enforcement (written first, red on the old tree: 7 fails as designed)

- New `packages/agents/src/api/__tests__/boundary.no-internals-subpath.test.ts`
  (7 tests): exports map has no `./internals.js`; `src/internals.ts` absent
  from disk; repo scan (packages/scripts/integration-tests/evals, skipping
  node_modules/dist/coverage/.git/junit reports, self-excluded) finds ZERO
  `llxprt-code-agents/internals` references; CLI imports of the agents package
  are root-or-declared-subpath only; dynamic `import('.../internals.js')`
  REJECTS at resolution.
- `boundary.adequacy.test.ts` / `boundary.spec.ts`: the two "TEST-ONLY meta
  category" carve-outs that PERMITTED internals are deleted; the rule is now
  absolute (any file, any form of reference).
- `scripts/tests/cli-import-boundary.test.ts`: deep-import fixtures switched
  from the real (now-dead) subpath to a synthetic undeclared subpath; the
  deep-import rule itself is unchanged.

### Removal and migration

- Deleted `packages/agents/src/internals.ts`; removed the `./internals.js`
  entry from `packages/agents/package.json` exports (`.`, `./app-service.js`,
  `./constants.js` remain). No aliases, no re-exports, no deprecation path.
- CLI consumers migrated to the intended root API (fromConfig adoption with a
  controlled transport provider; assertions via public AgentEvent):
  - `src/integration-tests/test-utils.ts`, `src/integration-tests/todo-continuation.integration.test.ts`
  - `src/ui/hooks/agentStream/__tests__/useSubmitQuery.providerIgnoreCancel.bun.tsx`
    (+ `fixtures/providerIgnoreCancel.fake.jsonl`); provider implements BOTH
    IProvider generateChatCompletion overloads; `QueuedSubmission` imported
    from its real home `../types.js`.
- `packages/agents/src/api/__tests__/helpers/buildCliStyleConfig.ts` moved to
  in-package relative imports (`../../core/client.js` etc.).
- Internals-pinning assertions deleted from `nonBreaking.exports.test.ts` /
  `publicSurface.nonbreaking.test.ts` (root-surface coverage kept).
- Docs updated where they presented the subpath as available:
  `docs/agent-api.md`, `dev-docs/agent-api.md`.

### Verification (all on the final tree)

- Enforcement: 33/0 across the 5 boundary/surface test files.
- Agents suite 413/413; CLI suite 755/755 files (9751 passed / 0 failed / 5
  skipped) via `bun run-bun-tests.ts`; scripts boundary test 42/0; root
  typecheck EXIT=0; package lint agents EXIT=0, cli EXIT=0; prettier clean.
- `rg 'llxprt-code-agents/internals'` over packages/scripts/integration-tests/
  evals/docs/dev-docs: zero references.
- NOT a regression (verified by stash-baseline): single-process
  `bun test <dir>` batch runs of agentStream (33 fails) and integration-tests
  (9 fails) fail IDENTICALLY on the pre-removal tree — a pre-existing property
  of batch invocation nobody uses; the repo runner isolates files and is green.

### Operational notes

- Two tscoder-zai subagent runs hit the 1800s task ceiling mid-mission; the
  remainder (last migrant, 3 type errors, sonarjs todo-tag comment fix) was
  finished across a third scoped run plus orchestration-side verification.
  Logs: `tmp/issue3222/internals-kill/` (phase1-red, phase2-boundary-green,
  verify/*, finish-*).

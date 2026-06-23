<!-- @plan:PLAN-20260621-COREAPIREMED.P00a @requirement:REQ-001..REQ-007,REQ-INT-001..004 -->
# Phase 00a: Preflight Verification

## Phase ID

`PLAN-20260621-COREAPIREMED.P00a`

## LLxprt Code Subagent: architect

## Purpose

Verify EVERY assumption this plan depends on against the actual post-merge source BEFORE any
implementation phase begins. If any check fails, STOP and update the plan first.

## Prerequisites

- Branch derived from `issue1594` (the merged #1594 base).
- Required reading: `specification.md`, `analysis/domain-model.md`, all `analysis/pseudocode/*.md`.

## Dependency Verification

Run and paste output:

```bash
npm ls zod                         # schema-first dependency (FromConfigOptions sessionId guard)
npm ls fast-check                  # property-based testing (≥30% requirement)
# Stryker is ALREADY a devDependency of packages/agents (added by #1594's quality gate). It MUST
# be present; absence is a regression, not an expected state.
grep -nE "@stryker-mutator/core" packages/agents/package.json   # expect "^9.6.1" (~line 55)
npm ls @stryker-mutator/core || { echo "FAIL: @stryker-mutator/core MISSING — expected installed per packages/agents/package.json; do NOT proceed, restore the devDependency."; exit 1; }
```

| Dependency | Expected | Status |
|---|---|---|
| zod | installed | [ ] |
| fast-check | installed | [ ] |
| @stryker-mutator/core | installed (declared in `packages/agents/package.json` `^9.6.1`; consumed by the P24 quality-gate mutation run) | [ ] |

## Type / Interface Verification

Run and confirm each MATCHES the plan's assumptions:

```bash
# C1: createAgent signature + sole Config construction
grep -n "export async function createAgent" packages/agents/src/api/createAgent.ts
grep -n "new Config(" packages/agents/src/api/createAgent.ts
grep -n "function finalizeAgent" packages/agents/src/api/createAgent.ts
grep -n "function assembleFacade" packages/agents/src/api/createAgent.ts
grep -n "resolveClient" packages/agents/src/api/createAgent.ts

# C1: AgentConfig has NO config field today
grep -n "config" packages/agents/src/api/config-types.ts | grep -iE "config\s*[?:]" | head

# C2: Agent interface omits settings/config accessors today
grep -nE "getEphemeralSetting|setEphemeralSetting|getEphemeralSettings|getConfig" packages/agents/src/api/agent.ts || echo "CONFIRMED ABSENT"

# C2: Config ephemeral methods exist (delegation target)
grep -nE "getEphemeralSetting\(|setEphemeralSetting\(|getEphemeralSettings\(" packages/core/src/config/configBase.ts

# H3: getCurrentSequenceModel stub
grep -n "getCurrentSequenceModel" packages/agents/src/api/agentImpl.ts
grep -n "getCurrentSequenceModel" packages/core/src/core/clientContract.ts
# NOTE: the concrete AgentClient class (with the private currentSequenceModel field) lives in the
# AGENTS package (exported via internals.ts:38 → './core/client.js'), NOT in core. core only owns
# the CONTRACT (clientContract.ts). Probe the real concrete client path:
grep -n "currentSequenceModel" packages/agents/src/core/client.ts

# H1 (CRIT-3): the AgentClient CLASS is on internals.js; the contract is core-owned and
# imported by agents at core/agenticLoop/types.ts:27; the curated API barrel lacks the contract.
grep -n "AgentClient\|PostTurnAction" packages/agents/src/internals.ts
grep -n "export type { AgentClientContract }" packages/core/src/core/clientContract.ts || true
grep -n "AgentClientContract" packages/core/src/core/clientContract.ts | head -1   # core-owned origin (expect ~:67)
grep -n "AgentClientContract" packages/agents/src/core/agenticLoop/types.ts        # agents import site (expect :27)
grep -n "AgentClientContract" packages/agents/src/api/index.ts || echo "CONFIRMED ABSENT from curated API barrel (api/index.ts)"
# The ROOT already re-exports BOTH barrels (so it transitively re-exposes the AgentClient CLASS today):
grep -nE "export \* from './internals.js'|export \* from './api/index.js'" packages/agents/src/index.ts

# H2/REQ-005 (CRIT-1): runtime context options accept config + messageBus, but DO NOT accept
# providerManager today, and the factory builds a ProviderManager UNCONDITIONALLY (the seam P03-P05
# must add `providerManager?` + `options.providerManager ?? new ProviderManager(...)`):
grep -nE "config\?|messageBus\?|runtimeId\?|settingsService\?" packages/providers/src/runtime/runtimeContextFactory.ts | head
grep -n "providerManager?:" packages/providers/src/runtime/runtimeContextFactory.ts && echo "UNEXPECTED: providerManager? already exists — revisit P03 scope" || echo "CONFIRMED ABSENT: no providerManager? option yet (P03 adds it)"
grep -n "new ProviderManager(" packages/providers/src/runtime/runtimeContextFactory.ts   # expect exactly ONE, unconditional (~:502)
grep -n "options.providerManager ??" packages/providers/src/runtime/runtimeContextFactory.ts && echo "UNEXPECTED: adoption seam already present" || echo "CONFIRMED ABSENT: no adoption seam yet (P05 adds it)"
grep -n "createIsolatedRuntimeContext" packages/providers/src/runtime/runtimeContextFactory.ts

# C1/CRIT-2: Config has NO getMessageBus() accessor (the shared bus must be passed in via
# FromConfigOptions.messageBus, NOT read off Config); confirm Config.getProviderManager() exists
# (the manager fromConfig adopts and forwards into the new providerManager? seam):
grep -n "getMessageBus" packages/core/src/config/config.ts packages/core/src/config/configBase.ts packages/core/src/config/configBaseCore.ts && echo "UNEXPECTED: getMessageBus accessor exists — revisit CRIT-2" || echo "CONFIRMED ABSENT: Config has no getMessageBus() accessor"
grep -n "getProviderManager" packages/core/src/config/configBaseCore.ts   # expect getProviderManager(): RuntimeProviderManager | undefined (~:265)

# CRIT-1 TYPE-PROVENANCE (records the two real types that drive the structural-interface decision):
#  (a) Config.getProviderManager() returns the CORE STRUCTURAL interface (NOT the concrete class):
grep -nE "getProviderManager\(\)\s*:\s*RuntimeProviderManager\s*\|\s*undefined" packages/core/src/config/configBaseCore.ts \
  && echo "CONFIRMED: Config.getProviderManager(): RuntimeProviderManager | undefined" \
  || { echo "FAIL(CRIT-1): getProviderManager() return type is not 'RuntimeProviderManager | undefined' — revisit the seam-option type"; exit 1; }
#  (b) The concrete providers class does NOT declare `implements RuntimeProviderManager` (so passing
#      the class where a concrete type is required would need an unsafe cast — which is why the P03-P05
#      seam option is typed as the STRUCTURAL interface, not the class):
grep -n "class ProviderManager implements" packages/providers/src/ProviderManager.ts   # expect 'implements IProviderManager' (NOT RuntimeProviderManager)
grep -nE "class ProviderManager implements [^{]*RuntimeProviderManager" packages/providers/src/ProviderManager.ts \
  && echo "NOTE: concrete class DOES declare implements RuntimeProviderManager (option could be either type)" \
  || echo "CONFIRMED: concrete ProviderManager does NOT declare 'implements RuntimeProviderManager' — seam option MUST be the structural interface to avoid an unsafe cast (CRIT-1)"
#  (c) The CLI activation bindings already type their manager param as the STRUCTURAL interface
#      (so widening the factory's internal manager types to RuntimeProviderManager matches them):
grep -n "manager: RuntimeProviderManager" packages/providers/src/runtime/runtimeLifecycle.ts          # registerCliProviderInfrastructure (~:91-92)
grep -n "manager: RuntimeProviderManager" packages/providers/src/composition/providerManagerInstance.ts  # configureProviderRuntimeFactories (~:173-176)
#  (d) Record that `RuntimeProviderManager` is NOT currently imported into runtimeContextFactory.ts
#      (verified empty on disk), so the P03 option-type widening MUST add a type-only import of it
#      (the probe below records which case actually holds):
grep -n "RuntimeProviderManager" packages/providers/src/runtime/runtimeContextFactory.ts || echo "NOTE: add a type-only import of RuntimeProviderManager in P03"

# C1 readiness signal (config-injection-seam.md lines 73-78): the conditional init/auth guards use
# the PUBLIC `config.getAgentClient()?.isInitialized()` readiness signal. Confirm there is NO public
# `Config.isInitialized()` (only the PRIVATE getAgentClientIfReady() + the client's isInitialized()),
# and that the public getAgentClient() accessor + the contract's isInitialized() both exist:
grep -nE "^\s*isInitialized\s*\(" packages/core/src/config/config.ts packages/core/src/config/configBase.ts packages/core/src/config/configBaseCore.ts && echo "UNEXPECTED: a public Config.isInitialized() exists — revisit the guards in config-injection-seam.md" || echo "CONFIRMED ABSENT: no public Config.isInitialized() (guards must use getAgentClient()?.isInitialized())"
grep -n "getAgentClient(): AgentClientContract" packages/core/src/config/configBaseCore.ts   # expect PUBLIC accessor (~:523)
grep -n "isInitialized" packages/core/src/core/clientContract.ts   # expect AgentClientContract.isInitialized(): boolean (the readiness method)
grep -n "getAgentClientIfReady" packages/core/src/config/config.ts   # expect PRIVATE helper (~:192) — NOT a public readiness API
```

| Assumption | Expected | Actual | Match? |
|---|---|---|---|
| `createAgent(rawConfig: AgentConfig)` only | yes | | [ ] |
| `new Config(` appears exactly once in createAgent.ts | yes | | [ ] |
| `finalizeAgent` + `assembleFacade` + `resolveClient` exist | yes | | [ ] |
| `AgentConfig` has no `config` field | yes | | [ ] |
| Agent interface lacks settings/config accessors | yes | | [ ] |
| `configBase.ts` exposes ephemeral get/set/getAll | yes | | [ ] |
| `agentImpl.getCurrentSequenceModel` returns null (stub) | yes | | [ ] |
| `clientContract.ts` declares `getCurrentSequenceModel` | yes | | [ ] |
| `internals.ts` exports `AgentClient`/`PostTurnAction` | yes | | [ ] |
| `AgentClientContract` is core-owned (`clientContract.ts`) + imported by agents (`agenticLoop/types.ts:27`) | yes | | [ ] |
| curated API barrel `api/index.ts` lacks `AgentClientContract` | yes | | [ ] |
| root `index.ts` re-exports BOTH barrels (`./internals.js` + `./api/index.js`) | yes | | [ ] |
| `IsolatedRuntimeContextOptions` has `config?` and `messageBus?` | yes | | [ ] |
| `IsolatedRuntimeContextOptions` does NOT yet have `providerManager?` | yes | | [ ] |
| `runtimeContextFactory.ts` builds `new ProviderManager(` exactly once, unconditionally | yes | | [ ] |
| `Config` has NO `getMessageBus()` accessor | yes | | [ ] |
| `Config.getProviderManager(): RuntimeProviderManager \| undefined` exists (`configBaseCore.ts`) | yes | | [ ] |
| CRIT-1: concrete `ProviderManager` does NOT declare `implements RuntimeProviderManager` (→ seam option MUST be the STRUCTURAL interface to avoid an unsafe cast) | yes | | [ ] |
| CRIT-1: CLI bindings already type their manager param `RuntimeProviderManager` (`runtimeLifecycle.ts`, `providerManagerInstance.ts`) — internal widening matches them | yes | | [ ] |
| CRIT-1: `RuntimeProviderManager` is NOT yet imported in `runtimeContextFactory.ts` (P03 MUST add a type-only import for the option type) | yes | | [ ] |
| `Config` has NO public `isInitialized()` (only PRIVATE `getAgentClientIfReady()` + client's `isInitialized()`) | yes | | [ ] |
| `Config.getAgentClient(): AgentClientContract` is PUBLIC (`configBaseCore.ts:523`) — the readiness signal `getAgentClient()?.isInitialized()` | yes | | [ ] |
| `AgentClientContract.isInitialized(): boolean` exists (`clientContract.ts`) | yes | | [ ] |

## Call Path Verification

```bash
# CLI drives turns via AgenticLoop, not agent.stream() (the C3 baseline). The construction is
# OBJECT-FORM (`new AgenticLoop({ agentClient, config, messageBus, interactiveMode, approvalHandler,
# displayCallbacks })`) at useAgenticLoop.ts:254 — NOT positional. Confirm the line + object form:
grep -rn "new AgenticLoop(" packages/cli/src --include="*.ts" | head
grep -n "new AgenticLoop({" packages/cli/src/ui/hooks/geminiStream/useAgenticLoop.ts   # expect ~:254 (object form)
grep -n "constructor(options: AgenticLoopOptions)" packages/agents/src/core/agenticLoop/AgenticLoop.ts  # expect ~:182
# agentClient origin: config.getAgentClient() threaded into the hook (the AgentClientContract source)
grep -n "config.getAgentClient()" packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts   # expect ~:331
grep -rn "agent.stream(\|agent.chat(" packages/cli/src --include="*.ts" | grep -v ".test.ts" | wc -l   # expect 0
# CLI builds Config via loadCliConfig (the C1 baseline)
grep -n "export async function loadCliConfig" packages/cli/src/config/config.ts
# CLI assembles provider runtime (the H2 baseline)
grep -n "prepareRuntimeForProfile\|createProviderManager" packages/cli/src/config/profileBootstrap.ts
# Ephemeral deep-import call-site magnitude (the C2 baseline)
grep -rn "getEphemeralSetting(" packages/cli/src packages/core/src --include="*.ts" | grep -v ".test.ts" | wc -l
grep -rn "setEphemeralSetting(" packages/cli/src packages/core/src --include="*.ts" | grep -v ".test.ts" | wc -l
```

| Path | Expected | Status |
|---|---|---|
| `new AgenticLoop({` (object form) present in cli at useAgenticLoop.ts:254 (reference drive) | yes | [ ] |
| `AgenticLoop` constructor is `constructor(options: AgenticLoopOptions)` (AgenticLoop.ts:182) | yes | [ ] |
| `config.getAgentClient()` threaded into the hook (useAppInput.ts:331) | yes | [ ] |
| `agent.stream(`/`agent.chat(` in cli | 0 | [ ] |
| `loadCliConfig` exists | yes | [ ] |
| `prepareRuntimeForProfile`/`createProviderManager` in profileBootstrap | yes | [ ] |
| ephemeral get/set call-site counts recorded | recorded | [ ] |

## Test Infrastructure Verification

```bash
ls packages/agents/src/api/__tests__/ | head
grep -rn "FakeProvider" packages/agents/src --include="*.ts" | head
npm run typecheck >/dev/null 2>&1 && echo "typecheck baseline OK" || echo "typecheck baseline BROKEN — fix before starting"
```

| Item | Expected | Status |
|---|---|---|
| `packages/agents/src/api/__tests__/` exists (#1594 harness) | yes | [ ] |
| `FakeProvider` available for JSONL fixtures | yes | [ ] |
| Baseline `npm run typecheck` clean | yes | [ ] |

## Single-File Test Invocation (MIN-3 — establish the EXACT vitest file-run command)

The `agents` package test script is `vitest run` (verified: `packages/agents/package.json` →
`"test": "vitest run"`); the root `npm test` fans out to `npm run test --workspaces --if-present`,
so `npm test -- <file>` from the root does NOT reliably pass a file filter through to vitest. Confirm
and ADOPT the repo-established single-file invocation so TDD/parity phases never fail for
command-format reasons:

```bash
# MIN-1: enable pipefail so a piped command's FAILURE is the pipeline status (tail cannot mask it).
set -o pipefail
grep -nE ""test"\s*:" packages/agents/package.json    # expect "vitest run"
# CCF-3 (command-portability — DO NOT revert to `npm test --workspace <pkg> -- run <path>`):
#   That form is a FALSE-RESULT HAZARD. Because the package `test` script is already `vitest run`,
#   the trailing `run` becomes a STRAY positional that vitest treats as a filename filter (it matches
#   unrelated *runtime* files), AND `npm --workspace` sets cwd to the package so a ROOT-RELATIVE path
#   matches nothing. Net effect: a RED gate can read EXIT 0 (stray `run` ran wrong files) or a GREEN
#   gate can read "No test files found"/EXIT 1 — both decouple the gate from the intended target.
#   The robust form below (`npx vitest run <root-relative path>` from repo ROOT) lets vitest
#   auto-discover the nearest package vitest.config.ts and resolve its relative setupFiles correctly,
#   so root-relative paths AND $SPEC/$T/$F/$SPECS/$DIR/${SEQ[@]} variables all work unchanged.
# CANONICAL single-file run for the agents package (use THIS form in every TDD/parity phase):
#   npx vitest run <relative-or-abs path to spec>
# Smoke-confirm the form resolves a known #1594 spec file (replace EXISTING with a real spec path):
EXISTING=$(ls packages/agents/src/api/__tests__/*.test.ts packages/agents/src/api/__tests__/*.spec.ts 2>/dev/null | head -1)
# Redirect to a log (no pipeline) so $? is the test's real status; tail the log for display only.
if [ -n "$EXISTING" ]; then
  npx vitest run "$EXISTING" > /tmp/p00a-canonical.log 2>&1
  CANON=$?
  tail -5 /tmp/p00a-canonical.log
  [ "$CANON" -eq 0 ] || { echo "FAIL: canonical single-file run form did not succeed on a known spec"; exit 1; }
fi
echo "CANONICAL: npx vitest run <file>"

# MIN-3: several impl-VERIFIER phases (P09a, P12a, P14a, P16a, P18a, P20) pass a DIRECTORY path
# (e.g. packages/agents/src/api/__tests__/) to the SAME `npx vitest run <path>` form to run the whole suite.
# Confirm `npx vitest run <dir>` accepts a directory path here (it does for vitest, which treats the
# argument as a path filter), so those phases never fail for command-format reasons. If this FAILS,
# the impl-verifier phases MUST switch to the package-level command (`npm test --workspace
# @vybestack/llxprt-code-agents`) instead.
# MIN-1: capture the REAL test status (no `... | tail && echo CONFIRMED || echo FAILED`, which would
# branch on tail's status and falsely report CONFIRMED on a failing run).
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p00a-dir-agents.log 2>&1
DIR_AGENTS=$?
tail -5 /tmp/p00a-dir-agents.log
if [ "$DIR_AGENTS" -eq 0 ]; then
  echo "DIRECTORY run form CONFIRMED: npx vitest run <dir>"
else
  echo "DIRECTORY run form FAILED — impl-verifier phases must use package-level command instead"
fi
# Providers equivalent (P05/P05a run the providers runtime dir):
npx vitest run packages/providers/src/runtime/ > /tmp/p00a-dir-providers.log 2>&1
DIR_PROVIDERS=$?
tail -5 /tmp/p00a-dir-providers.log
if [ "$DIR_PROVIDERS" -eq 0 ]; then
  echo "PROVIDERS DIRECTORY run form CONFIRMED"
else
  echo "PROVIDERS DIRECTORY run form FAILED — use package-level command instead"
fi
```

| Item | Expected | Status |
|---|---|---|
| `agents` package `test` script is `vitest run` | yes | [ ] |
| Canonical single-file form is `npx vitest run <file>` | recorded | [ ] |
| DIRECTORY run form `npx vitest run <dir>` works for agents + providers (MIN-3) | confirmed | [ ] |

> Every TDD/parity phase (P04, P06–P09, P11, P13, P15, P17, P19, P20, P21) MUST use the canonical
> single-file form above (`npx vitest run <file>`) instead
> of `npm test -- <file>`. The providers-package seam phases (P03–P05) use the equivalent providers
> workspace form: `npx vitest run <file>`.
>
> The impl-VERIFIER phases that run the WHOLE suite via a directory path (P09a, P12a, P14a, P16a,
> P18a, P20, plus P05/P05a for the providers runtime dir) rely on the DIRECTORY run form confirmed
> above (`npx vitest run <dir>`). That form is validated in THIS preflight; if the directory smoke-check
> FAILS, those phases MUST instead invoke the package-level command
> (`npm test --workspace @vybestack/llxprt-code-agents` / `... -code-providers`).

## Blocking Issues Found

[List any mismatch that requires plan modification BEFORE Phase 01.]

## Verification Gate

- [ ] All dependencies verified (zod, fast-check, vitest, AND @stryker-mutator/core all installed; Stryker absence is a BLOCKING regression — see `packages/agents/package.json`)
- [ ] All types match plan assumptions
- [ ] All call paths confirmed
- [ ] Test infrastructure ready
- [ ] Baseline typecheck clean

IF ANY CHECKBOX IS UNCHECKED: STOP and update the plan before proceeding.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P00a.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P00a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```


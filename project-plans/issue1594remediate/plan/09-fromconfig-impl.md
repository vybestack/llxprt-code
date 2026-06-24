<!-- @plan:PLAN-20260621-COREAPIREMED.P09 @requirement:REQ-001,REQ-005,REQ-INT-001 -->
# Phase 09: Config-Injection Seam — Implementation

## Phase ID

`PLAN-20260621-COREAPIREMED.P09`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 08a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P08a.md`
- Pseudocode: `analysis/pseudocode/config-injection-seam.md` (lines 10–78)
- Depends on the providers `providerManager?` adoption seam (P03–P05a): `fromConfig` passes the
  adopted manager into `createIsolatedRuntimeContext`. That seam MUST be merged before this phase.

## Requirements Implemented (Expanded)

### REQ-001 / REQ-001.1 / REQ-001.2 / REQ-001.3 / REQ-005 / REQ-INT-001

Implement `fromConfig` to make ALL Phase 08 tests pass, by adopting the supplied `Config`, building
ONE shared runtime context around it, conditionally initializing/authing, and finishing through the
SAME finalize path `createAgent` uses.

**Behavior**: see Phase 08 GIVEN/WHEN/THEN. Key guarantee: NO second `Config`, NO second
`SettingsService`/`ProviderManager`, NO duplicated finalize logic, caller-owned `Config` not
disposed.

## Implementation Tasks

### Files to Modify

- `packages/agents/src/api/createAgent.ts` (line numbers below are APPROXIMATE — anchor by
  symbol/grep, since earlier phases P06/P09 mutate this file)
  - EXTRACT the shared finalize path. The current `finalizeAgent` (anchor: `function finalizeAgent`,
    ~L210) + `assembleFacade` (anchor: `function assembleFacade`, ~L327) + the
    `resolveClient = () => config.getAgentClient()` closure (anchor by grep `resolveClient =`, ~L257)
    become the single shared finalize used by BOTH entries. Thread a
    `configOwnership: 'agent' | 'caller'` field into the dispose orchestration (default `'agent'` for
    createAgent — behavior unchanged).
  - createAgent continues to `new Config(params)` (anchor by grep `new Config(`, ~L128) — UNCHANGED
    behavior.
  - Reference pseudocode lines 50–62.
  - Markers: `@plan:PLAN-20260621-COREAPIREMED.P09`, `@requirement:REQ-001,REQ-006`.

- `packages/agents/src/api/fromConfig.ts`
  - Implement per pseudocode lines 10–49 and 63–78:
    - Line 11–13: reject null config; `FromConfigValidatableSchema.parse({ sessionId })`.
    - Line 14: `const config = options.config` (ADOPT).
    - Line 15: `runtimeId = options.sessionId ?? deriveRuntimeIdFromConfig(config) ?? generateRuntimeId()`.
    - Line 16: `settingsService = config.getSettingsService()`.
    - Line 17, 63–72: `resolveMessageBus(options.messageBus, config)` — adopt the caller-passed
      `MessageBus` (the NEW `FromConfigOptions.messageBus` field) when present, else build ONE from
      `config.getPolicyEngine()` exactly as createAgent does. NOTE: `Config` has NO `getMessageBus()`
      accessor (verified — only `initialize({messageBus?})` consumes one); therefore the SHARED bus
      MUST be supplied by the caller (#1595) via `FromConfigOptions.messageBus`, NOT read back off
      the Config. Never construct a second divergent bus when the caller supplies one.
    - Line 18: `adoptedManager = config.getProviderManager()` — the existing manager on the adopted
      Config (`Config.getProviderManager(): RuntimeProviderManager | undefined`, configBaseCore.ts:265).
    - Line 20–28: `createIsolatedRuntimeContext({ runtimeId, settingsService, config, messageBus,
      providerManager: adoptedManager, model, prepare: ctx =>
      registerProvidersOntoManager(ctx.providerManager, ctx, ctx.config) })` then
      `await handle.activate()`. Passing `providerManager` ADOPTS the Config's manager via the
      providers seam added in P03–P05, so NO second `ProviderManager` is constructed (REQ-001.2 /
      REQ-005.2). When `adoptedManager` is `undefined` (Config without a manager yet), the factory
      falls back to constructing one exactly as today (still single-manager for that runtime).
      TYPE-SAFETY (CRIT-1, verified): the P03–P05 seam types the `providerManager?` option as the
      STRUCTURAL core interface `RuntimeProviderManager`. Because `config.getProviderManager()` ALSO
      returns `RuntimeProviderManager | undefined` (configBaseCore.ts:265), `adoptedManager` is
      passed DIRECTLY into the option — NO bridge, NO narrowing helper, NO `as`, NO `any`. The types
      already match exactly (`RuntimeProviderManager | undefined` → `providerManager?:
      RuntimeProviderManager`); `undefined` simply triggers the factory's default construction. Do
      NOT cast `adoptedManager` and do NOT introduce any helper to "convert" it.
    - Line 30–35, 73–78: conditional `config.initialize`/`config.refreshAuth` guarded by
      `isConfigInitialized`/`hasPostAuthClient`.
    - Line 37–48: `return await finalizeAgent({ ..., configOwnership: 'caller' })`.
  - CRIT-2 (getConfig identity): `finalizeAgent` binds the ADOPTED `config` (line 14) as the facade's
    `deps.config`. The `getConfig()` member was DECLARED on the `Agent` interface in P06 (exactly
    once) with a NotYetImplemented STUB body; THIS phase replaces that stub in agentImpl.ts with the
    real `getConfig(): Config { return this.deps.config; }` (see the agentImpl.ts task below), so the
    agent's `getConfig()` returns the SAME external `Config` instance the caller supplied. This is
    what turns P07/EP1 (`agent.getConfig() === config`) and P08/T1 GREEN. Do NOT re-declare the
    interface member — it already exists from P06; only the IMPLEMENTATION lands here.
  - Markers: `@plan:PLAN-20260621-COREAPIREMED.P09`, `@requirement:REQ-001,REQ-005,REQ-INT-001`,
    `@pseudocode lines 10-78`.

- `packages/agents/src/api/agentImpl.ts` (CRIT-2: REAL `getConfig` impl + dispose orchestration)
  - REPLACE the `getConfig` NotYetImplemented STUB (added in P06) with the REAL identity impl:
    `getConfig(): Config { return this.deps.config; }` — return the live bound `Config` the facade
    already closes over (`this.deps.config`, already threaded by `finalizeAgent`). This is the GREEN
    behavior that turns P07/EP1 (`agent.getConfig() === config`) and P08/T1/T1b identity tests GREEN.
    Per pseudocode `analysis/pseudocode/config-injection-seam.md` line 14 (ADOPT config) + lines
    37–48 (finalizeAgent binds the adopted config as `deps.config`). Do NOT re-declare the interface
    member (it was declared exactly once at P06); only its IMPLEMENTATION moves here from the stub.
  - dispose orchestration lives in `AgentImpl.dispose()` at `agentImpl.ts:1185` — there is NO
    `dispose.ts` file; the ownership/teardown logic spans ~1185–1239.
  - Honor `configOwnership`: when `configOwnership === 'caller'`, do NOT dispose the adopted `Config`
    (skip the `await this.deps.config.dispose()` / `shutdownLspService()` teardown at ~1239–1244);
    and likewise do NOT dispose a caller-supplied `MessageBus`/`ProviderManager`. Tear down ONLY
    Agent-created resources (runtime handle via `this.deps.runtimeHandle.cleanup()` at ~1237,
    injected scheduler handles, bus subscriptions, hooks `detach()`, active-run controller abort).
    Thread `configOwnership` through `recordOwnership(...)` (createAgent.ts) into the `ownership`
    bundle so `AgentImpl.dispose()` can branch on it.
  - Markers + `@requirement:REQ-001.3`.

### Constraints (RULES.md)

- Do NOT modify Phase 08 tests.
- Follow pseudocode line-by-line; cite line numbers in `@pseudocode` markers.
- Strict TS: no `any`, no assertions, explicit returns.
- No TODO/FIXME/placeholder; no `console.*`.
- UPDATE existing files; no parallel versions.

## Verification Commands

```bash
set -e
# CCF-4 (MANDATORY FIRST): rebuild so the NEW public exports (fromConfig, and any P06+ additions) are
# visible through the BARE specifier `@vybestack/llxprt-code-agents`. The agents vitest alias rewrites
# only the bare-root entry; the entry's `export *` graph resolves via package.json -> ./dist/index.js,
# so a STALE pre-P06 dist makes `fromConfig` resolve to `undefined` and the P07 slice can NEVER go GREEN
# (it would fail `(0, fromConfig) is not a function` no matter how correct the body is). dist/ is
# gitignored → no source/git footprint. See execution-tracker.md CCF-4.
npm run build --workspace @vybestack/llxprt-code-agents
npx vitest run packages/agents/src/api/__tests__/fromConfig.behavior.test.ts
npm run typecheck
# Pseudocode citation present (BLOCKING)
grep -q "@pseudocode" packages/agents/src/api/fromConfig.ts || { echo "FAIL: MISSING @pseudocode"; exit 1; }
# fromConfig must NOT construct Config or a second SettingsService/MessageBus/ProviderManager (BLOCKING)
if grep -nE "new Config\(" packages/agents/src/api/fromConfig.ts; then echo "FAIL: constructs Config"; exit 1; fi
if grep -nE "new SettingsService\(" packages/agents/src/api/fromConfig.ts; then echo "FAIL: second SettingsService"; exit 1; fi
if grep -nE "new ProviderManager\(" packages/agents/src/api/fromConfig.ts; then echo "FAIL: second ProviderManager"; exit 1; fi
# fromConfig MUST adopt the Config's manager + caller bus into the runtime context (CRIT-1/CRIT-2)
grep -q "config.getProviderManager(" packages/agents/src/api/fromConfig.ts || { echo "FAIL: does not adopt config.getProviderManager()"; exit 1; }
grep -qE "providerManager:" packages/agents/src/api/fromConfig.ts || { echo "FAIL: providerManager not passed to runtime context"; exit 1; }
# CRIT-1 TYPE-SAFETY GATE (grep-enforced): the adoption path passes config.getProviderManager()
# into the providerManager? option with ZERO assertion. The option is RuntimeProviderManager and
# getProviderManager() returns RuntimeProviderManager | undefined, so NO cast is needed or allowed.
# (a) No `as`/`as any`/`as unknown`/non-null `!` applied to the adopted manager value.
NORM=$(tr -s '[:space:]' ' ' < packages/agents/src/api/fromConfig.ts)
if printf '%s' "$NORM" | grep -qE "getProviderManager\(\) (as |!)"; then echo "FAIL: assertion on config.getProviderManager() — must be a direct, assertion-free pass (CRIT-1)"; exit 1; fi
if printf '%s' "$NORM" | grep -qE "(adoptedManager|providerManager:) [^;,)]*\bas (any|ProviderManager|unknown)"; then echo "FAIL: unsafe cast on adopted manager (CRIT-1)"; exit 1; fi
# (b) No `: any` annotation introduced for the adopted manager.
if grep -nE "adoptedManager\s*:\s*any\b" packages/agents/src/api/fromConfig.ts; then echo "FAIL: adoptedManager typed any (CRIT-1)"; exit 1; fi
echo "PASS: CRIT-1 — fromConfig passes config.getProviderManager() into the RuntimeProviderManager option with no assertion/any."
# CRIT-2: getConfig real impl lands HERE (GREEN) — the P06 NotYetImplemented stub is replaced with
# the identity impl returning the bound Config. (BLOCKING)
grep -qE "getConfig\(\)\s*:\s*Config\s*\{\s*return this\.deps\.config" packages/agents/src/api/agentImpl.ts || { echo "FAIL: getConfig must now return this.deps.config (real impl at P09 — CRIT-2)"; exit 1; }
# The getConfig body must NO LONGER throw NotYetImplemented (the stub is replaced).
if grep -nE "getConfig\(\)\s*:\s*Config\s*\{[^}]*NotYetImplemented" packages/agents/src/api/agentImpl.ts; then echo "FAIL: getConfig still a NotYetImplemented stub — must be the real impl at P09 (CRIT-2)"; exit 1; fi
# Single-declaration invariant preserved: getConfig declared exactly once on the interface (P06).
if [ "$(grep -cE "getConfig\(\)\s*:\s*Config\s*;" packages/agents/src/api/agent.ts)" -ne 1 ]; then echo "FAIL: getConfig must remain declared exactly once on the Agent interface (CRIT-2)"; exit 1; fi
# CRIT-2: caller-supplied MessageBus is forwarded; Config.getMessageBus is NOT used (it does not exist)
if grep -nE "config\.getMessageBus" packages/agents/src/api/fromConfig.ts; then echo "FAIL: uses non-existent Config.getMessageBus()"; exit 1; fi
grep -qE "messageBus" packages/agents/src/api/fromConfig.ts || { echo "FAIL: messageBus not threaded"; exit 1; }
# CRIT-4: Shared finalize is reused (createAgent + fromConfig both call the SINGLE finalizeAgent
# helper) — exactly ONE createAgent-assembly code path (BLOCKING)
grep -q "finalizeAgent(" packages/agents/src/api/fromConfig.ts || { echo "FAIL: not reusing finalizeAgent"; exit 1; }
grep -q "finalizeAgent(" packages/agents/src/api/createAgent.ts || { echo "FAIL: createAgent lost finalize"; exit 1; }
# CRIT-4: fromConfig MUST NOT copy-paste the assembly/finalize sequence. The runtime-state build,
# loop construction, facade assembly, and SessionStart all live INSIDE finalizeAgent/assembleFacade
# (createAgent.ts steps 105-166); fromConfig must NOT call them directly (that would duplicate the
# path). It delegates the whole sequence through finalizeAgent.
for SYM in "assembleFacade(" "createAgentRuntimeState(" "rebuildLoop(" "triggerSessionStart("; do
  if grep -nE "$SYM" packages/agents/src/api/fromConfig.ts; then echo "FAIL: fromConfig duplicates assembly logic ($SYM) — delegate via finalizeAgent instead"; exit 1; fi
done
# CRIT-3: dispose orchestration lives in AgentImpl.dispose() (agentImpl.ts) — there is NO dispose.ts.
if [ -f packages/agents/src/api/dispose.ts ]; then echo "FAIL: dispose.ts must not exist — dispose lives in agentImpl.ts"; exit 1; fi
# Ownership branch must be honored in AgentImpl.dispose(): caller-owned Config is NOT disposed.
grep -qE "configOwnership" packages/agents/src/api/agentImpl.ts || { echo "FAIL: AgentImpl.dispose does not branch on configOwnership"; exit 1; }
# createAgent characterization still green (non-breaking)
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p09-char.log 2>&1; CHAR=$?
tail -15 /tmp/p09-char.log
[ "$CHAR" -eq 0 ] || { echo "FAIL: createAgent characterization suite not green"; exit 1; }

# CRIT-2 RED→GREEN: the early integration-first turn-parity slice (P07) was authored RED against the
# P06 stub. Implementing fromConfig (this phase) is what makes its core adopt + turn-drive parity
# reachable. It MUST now PASS — proving this implementation was driven by the integration-first test.
EARLY=packages/agents/src/api/__tests__/cli-turn-parity.early.spec.ts
test -f "$EARLY" || { echo "FAIL: early parity slice (P07) missing"; exit 1; }
npx vitest run "$EARLY" || { echo "FAIL: early turn-parity slice still RED after fromConfig impl — fromConfig is not yet adequate for #1595"; exit 1; }
# Frozen-test integrity: the early slice must NOT have been weakened to pass (content-hash vs P07 snapshot).
SNAP=project-plans/issue1594remediate/.completed/P07-frozen-hashes.txt
if [ -f "$SNAP" ]; then
  ACTUAL=$(shasum -a 256 "$EARLY" | awk '{print $1}')
  EXPECTED=$(grep -E "  $EARLY$" "$SNAP" | awk '{print $1}')
  if [ -n "$EXPECTED" ] && [ "$ACTUAL" != "$EXPECTED" ]; then echo "FAIL: early parity slice CONTENT changed since P07 — must not weaken the driver to pass"; exit 1; fi
fi
echo "Early turn-parity slice (P07) is GREEN — fromConfig implementation is driven by the integration-first contract."
```

### Deferred Implementation Detection (MANDATORY — scoped to CHANGED lines)

```bash
set -e
# Scan ONLY the lines this phase added/changed (git diff against HEAD), across the files it touches.
FILES="packages/agents/src/api/fromConfig.ts packages/agents/src/api/createAgent.ts packages/agents/src/api/agentImpl.ts"
ADDED=$(git diff HEAD -- $FILES | grep -E "^\+" | grep -v "^\+\+\+")
echo "$ADDED" | grep -nE "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP)" && { echo "FAIL: deferred marker on changed lines"; exit 1; } || true
echo "$ADDED" | grep -nE "(in a real|in production|ideally|for now|placeholder|not yet|will be)" && { echo "FAIL: placeholder language on changed lines"; exit 1; } || true
echo "$ADDED" | grep -nE "return null|return \{\}|return \[\]|return undefined" && echo "REVIEW: confirm not a fake impl on changed lines" || true
echo "Deferred-implementation scan (changed lines only) complete."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] All Phase 08 tests PASS.
- [ ] CRIT-2: `getConfig()` real impl lands here — the P06 NotYetImplemented stub in agentImpl.ts is
      replaced with `return this.deps.config` (non-throwing identity); interface declaration remains
      exactly once (P06). P07/EP1 + P08/T1 identity tests now GREEN.
- [ ] fromConfig adopts Config (no `new Config`, no second SettingsService/MessageBus/ProviderManager).
- [ ] fromConfig passes `providerManager: config.getProviderManager()` into the runtime context
      (REQ-001.2 / REQ-005.2) and threads the caller-supplied `messageBus` (REQ-001.2 CRIT-2).
- [ ] CRIT-1: the adopted manager is passed with ZERO assertion (no `as`/`as any`/`!` on
      `config.getProviderManager()`); types match because the option is `RuntimeProviderManager`
      (grep gate PASS).
- [ ] fromConfig does NOT reference the non-existent `Config.getMessageBus()`.
- [ ] createAgent + fromConfig BOTH call the single extracted `finalizeAgent`.
- [ ] `AgentImpl.dispose()` (agentImpl.ts:1185) honors `configOwnership`: caller-owned Config (and
      caller-supplied MessageBus/ProviderManager) NOT disposed; agent-owned Config disposed.
- [ ] createAgent behavior unchanged (characterization tests green).
- [ ] No deferred-implementation patterns on changed lines.

## Success Criteria

- fromConfig tests green; createAgent characterization green; typecheck clean; pseudocode cited.

## Failure Recovery

- `git checkout -- packages/agents/src/api/fromConfig.ts packages/agents/src/api/createAgent.ts`;
  re-implement strictly from pseudocode.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P09.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P09
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```


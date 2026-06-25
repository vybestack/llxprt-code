<!-- @plan:PLAN-20260622-COREAPIGAP.P09 @requirement:REQ-004 -->
# Phase 09: Hooks Administration (extend `agent.hooks`) — Behavioral TDD

## Phase ID

`PLAN-20260622-COREAPIGAP.P09`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 08a completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P08a.md`

## Requirements Implemented (Expanded)

### REQ-004: Hooks administration on `AgentHookControl`

**Full Text**: EXTEND the existing `AgentHookControl` (agent.ts:314-321) — keeping its existing
members (`onHookExecution`/`triggerSessionStart`/`triggerSessionEnd`/`clear`) EXACTLY as-is
(REQ-009 non-breaking) — with registry inspection + enable/disable administration:
- **REQ-004.1**: `listHooks(): readonly HookInfo[]` — snapshot of the live registry; undefined- AND
  uninitialised-safe (R-UNDEFINED-SAFE).
- **REQ-004.2**: `getDisabledHooks(): readonly string[]` — fresh copy of the Config disabled-set.
- **REQ-004.3**: `setDisabledHooks(names: readonly string[]): void` — write-through, round-trips with
  `getDisabledHooks` (R-HOOKS-ROUNDTRIP).
- **REQ-004.4**: `enable(name)` / `disable(name)` — idempotent convenience over the disabled-set.
- **REQ-004.5**: undefined/uninitialised hook system → `listHooks()` returns `[]`.

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN a plain agent (no hooks) → `listHooks()` is `[]` (system undefined or uninitialised).
- GIVEN `setDisabledHooks(["a","b"])` → `getDisabledHooks()` deep-equals `["a","b"]` (round-trip).
- GIVEN disabled `["a"]` + `disable("a")` → stays `["a"]` (idempotent); `disable("b")` → `["a","b"]`.
- GIVEN disabled `["a","b"]` + `enable("a")` → `["b"]`; `enable("zzz")` (absent) → unchanged.
- GIVEN an agent seeded with one real hook def, after `triggerSessionStart()` (initialises the
  registry) → `listHooks()` contains an entry whose `name`/`eventName`/`enabled` mirror it.

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/hookAdmin.behavior.test.ts`

  Drive REAL data through real Config (NO mock theater):

  1. **Disabled-set round-trip + enable/disable (T11)** — `buildAgent('plain-text.jsonl')`; call the
     public `agent.hooks.setDisabledHooks(...)` / `getDisabledHooks()` / `enable()` / `disable()`. These
     hit the REAL `Config.setDisabledHooks` (configBase.ts:132) + `getDisabledHooks` (config.ts:734).
  2. **Undefined-safe `listHooks()` (T12a)** — a plain agent with hooks disabled → `getHookSystem()`
     returns `undefined` → `agent.hooks.listHooks()` is `[]`. (No initialise call.)
  3. **Populated `listHooks()` (T12b)** — MUST use the BLESSED direct-construction precedent
     (`new HookControl(realDeps)`); the `buildAgent` harness path provably CANNOT populate the
     registry and is FORBIDDEN for this case. Proven reasons (verified against source):
       - The `AgentConfig`→`ConfigParameters` adapter maps only `hooks` (agentConfig.adapter.ts:175-176);
         it never maps `enableHooks`, and `config.enableHooks = params.enableHooks ?? false`
         (configConstructor.ts:474) ⇒ a harness agent's `getHookSystem()` returns `undefined`.
       - `triggerSessionStartHook` gates on `config.getEnableHooks()` FIRST and returns early
         (lifecycleHookTriggers.ts:47-50) ⇒ it never reaches `hookSystem.initialize()`, so the
         registry is never loaded. (`triggerSessionStart()` still emits a SYNTHETIC lifecycle pair
         to observers, so do NOT assert on that path for registry population — it would be vacuous.)
     - Proven recipe for T12b (`.behavior.test.ts` is T17-exempt → deep imports allowed):
       1. `import { Config } from '@vybestack/llxprt-code-core/config/config.js'`,
          `import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js'`,
          `import { HookEventName } from '@vybestack/llxprt-code-core/hooks/types.js'`,
          `import { HookControl } from '../control/hooks.js'`.
       2. Build a REAL Config with hooks ENABLED + a structurally-valid seeded def (mirror
          `fakeSessionHookDefinitions` shape; `isTrustedFolder()` defaults `true` via
          `this.trustedFolder ?? true` at config.ts:511 so the seeded `hooks` load):
          ```ts
          const config = new Config({
            cwd: '/tmp', targetDir: '/tmp', debugMode: false,
            sessionId: 'hooks-admin-test', model: 'gemini-2.0-flash',
            usageStatisticsEnabled: false,
            enableHooks: true,
            hooks: {
              [HookEventName.SessionStart]: [
                { hooks: [{ type: 'command' as never, command: 'true', name: 'fake-session-start' }] },
              ],
            },
          });
          ```
       3. Initialise the registry directly (use a guard, NOT a non-null `!` assertion):
          ```ts
          const system = config.getHookSystem();
          if (!system) throw new Error('expected hook system (enableHooks:true)');
          await system.initialize(); // loads the seeded hook; isInitialized() now true
          ```
       4. `const control = new HookControl({ config, messageBus: new MessageBus(), sessionId: () => 'hooks-admin-test', cwd: () => '/tmp' });`
       5. Assert `control.listHooks()` has length ≥ 1 and the entry's `name === 'fake-session-start'`,
          `eventName === HookEventName.SessionStart` (or its string value), and `enabled === true`.

  - Markers `@plan:PLAN-20260622-COREAPIGAP.P09`, `@requirement:REQ-004`.

### Required scenarios

```
T11   setDisabledHooks(["a","b"]) → getDisabledHooks() deep-equals ["a","b"]; mutating the returned
      array does NOT change a subsequent getDisabledHooks() (fresh copy)
T11b  enable/disable idempotency: from ["a"], disable("a") stays ["a"]; disable("b") → ["a","b"];
      enable("a") → ["b"]; enable("zzz") → unchanged
T12a  plain agent (hooks disabled) → agent.hooks.listHooks() === [] (does not throw)
T12b  agent seeded with one real hook def + triggerSessionStart() → listHooks() length ≥ 1 and the
      entry's name/eventName/enabled mirror the seeded hook
PROP  disabled-set round-trip: for a generated unique string[] (len 0..5), setDisabledHooks(arr) then
      getDisabledHooks() deep-equals arr; MIN-2 cases
PROP  enable∘disable inverse: for a generated name + base set, disable(name) then enable(name) yields a
      set WITHOUT name; and the returned arrays are always fresh copies; MIN-2 cases
```

### Constraints

- Assert real VALUES (array contents, length, key mirrors) — NEVER `toHaveBeenCalled`, NEVER `vi.fn()`.
- The existing `AgentHookControl` members MUST remain callable (do not assert their removal).
- ≥30% property-based (fast-check), MIN-2 distinct property cases.
- Prove the fresh-copy contract by mutating a returned array and re-reading (behavioral, not structure-only).
- Positive cases fail at RED because the new methods do not exist on `AgentHookControl` yet
  (missing-method TypeError = behavioral RED).

## Verification Commands

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/hookAdmin.behavior.test.ts
test -f "$F"

if grep -nE "toHaveBeenCalled" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "mockResolvedValue|mockReturnValue|vi\.spyOn|vi\.fn\(" "$F"; then echo "FAIL: mock theater (spy/stub)"; exit 1; fi
if grep -nE "not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi

# Round-trip + listHooks both exercised (BLOCKING).
grep -qE "setDisabledHooks" "$F" || { echo "FAIL: round-trip not exercised"; exit 1; }
grep -qE "listHooks" "$F" || { echo "FAIL: listHooks not exercised"; exit 1; }

# Property-based >= 30% (BLOCKING; MIN-2).
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '
  /(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 }
  /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } }
  END { print n+0 }' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
if [ "$TOTAL" -eq 0 ]; then echo "FAIL: no tests"; exit 1; fi
PCT=$(( PROP * 100 / TOTAL ))
echo "property CASES: $PROP / $TOTAL = ${PCT}%"
if [ "$PROP" -lt 2 ]; then echo "FAIL: <2 property cases"; exit 1; fi
if [ "$PCT" -lt 30 ]; then echo "FAIL: property ${PCT}% < 30%"; exit 1; fi

# RED-state enforcement.
set +e
npx vitest run "$F" > /tmp/p09_red.log 2>&1
STATUS=$?
set -e
tail -40 /tmp/p09_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: unexpectedly all-green before P10"; exit 1; fi
if grep -qiE "Cannot find module|SyntaxError|Failed to resolve import|ReferenceError" /tmp/p09_red.log; then
  echo "FAIL: RED is a module/compile error, not behavioral"; exit 1
fi
echo "RED confirmed behavioral (expected until P10)."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] T11/T11b drive the REAL Config disabled-set through the public `agent.hooks` surface.
- [ ] T12a undefined-safe; T12b populated snapshot mirrors a real seeded registry entry.
- [ ] Fresh-copy contract proven by mutate-then-reread.
- [ ] ≥30% property; MIN-2; no mock theater; no reverse tests; behavioral RED.

## Success Criteria

- Behavioral RED suite covering round-trip, idempotent enable/disable, undefined-safe + populated listHooks.

## Failure Recovery

- `git checkout -- "$F"`; rewrite.

## Deferred Implementation Detection (MANDATORY — scoped)

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/hookAdmin.behavior.test.ts
test -f "$F" || { echo "missing test"; exit 1; }
if grep -nE "(TODO|FIXME|HACK|XXX|TEMPORARY|WIP|placeholder|for now|in a real|coming soon)" "$F"; then echo "FAIL: deferred marker"; exit 1; fi
if grep -niE "toThrow\(.*NotYetImplemented|should (not )?be implemented" "$F"; then echo "FAIL: reverse pattern"; exit 1; fi
if grep -nE "\b(it|test|describe)\.skip\b|\bxit\b|\bxdescribe\b" "$F"; then echo "FAIL: skipped test"; exit 1; fi
echo "PASS: no deferred markers."
```

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P09.md`

```markdown
Phase: P09
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment]
```

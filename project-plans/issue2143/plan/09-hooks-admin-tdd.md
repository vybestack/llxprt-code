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
  3. **Populated `listHooks()` (T12b)** — `buildAgent('plain-text.jsonl', { hooks: <one real hook def> })`
     (mirror `fakeSessionHookDefinitions` shape in `helpers/fakeHook.ts`; ensure the enabling field is
     set so `getHookSystem()` is defined). Then `await agent.hooks.triggerSessionStart()` to initialise
     the registry (it calls `hookSystem.initialize()` → `registry.initialize()` which loads the seeded
     hooks). Then assert `agent.hooks.listHooks()` reflects the seeded entry (length ≥ 1; `name`/
     `eventName`/`enabled` mirror the registry entry). If the harness path does not enable hooks,
     fall back to the BLESSED direct-construction precedent (`new HookControl(realDeps)` — `.behavior.test.ts`
     is T17-exempt) over a real `Config` with hooks enabled+initialised.

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

<!-- @plan:PLAN-20260622-COREAPIGAP.P10a @requirement:REQ-004 -->
# Phase 10a: Hooks Administration — Pseudocode-Compliance Verification

## Phase ID

`PLAN-20260622-COREAPIGAP.P10a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 10 completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P10.md`

## Purpose

Independent gate. Confirm the P10 implementation matches `analysis/pseudocode/hooks-admin.md` line-by-line,
preserves the existing `AgentHookControl` surface (non-breaking), is delegate-only (no cache), is
undefined/uninitialised-safe, and that the P09 tests are genuinely behavioral (no mock theater, ≥30%
property, no reverse tests).

## Verification Commands

```bash
set -o pipefail
set -e
A=packages/agents/src/api/agent.ts
H=packages/agents/src/api/control/hooks.ts
F=packages/agents/src/api/__tests__/hookAdmin.behavior.test.ts

# 1. Target test + whole dir GREEN.
npx vitest run "$F" 2>&1 | tail -30
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p10a_all.log 2>&1 || { echo "FAIL: regressions"; tail -60 /tmp/p10a_all.log; exit 1; }

# 2. Project typecheck + lint clean.
npm run typecheck 2>&1 | tail -15
npm run lint 2>&1 | tail -15

# 3. Non-breaking: existing four members still declared on the interface.
for m in "onHookExecution" "triggerSessionStart" "triggerSessionEnd" "clear"; do
  grep -qE "$m" "$A" || { echo "FAIL: existing AgentHookControl member $m missing"; exit 1; }
done

# 4. Delegation + guards present; no cache.
grep -qE "getHookSystem\(\)" "$H" || { echo "FAIL: not delegating"; exit 1; }
grep -qE "isInitialized\(\)" "$H" || { echo "FAIL: missing init guard"; exit 1; }
if grep -nE "private .*(disabledHooks|hookCache|cachedHooks)\b" "$H"; then echo "FAIL: cached state"; exit 1; fi

# 5. Re-audit P09 tests are behavioral.
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue|vi\.fn\(|vi\.spyOn" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '/(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 } /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } } END { print n+0 }' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
PCT=$(( PROP * 100 / TOTAL ))
echo "property CASES: $PROP / $TOTAL = ${PCT}%"
[ "$PROP" -ge 2 ] && [ "$PCT" -ge 30 ] || { echo "FAIL: property gate"; exit 1; }

# 6. Deferred scan on changed lines.
for X in "$A" "$H"; do
  git diff HEAD -- "$X" | grep -E "^\+" | grep -vE "^\+\+\+" \
    | grep -nE "(TODO|FIXME|HACK|STUB|placeholder|for now|in a real)" \
    && { echo "FAIL: deferred marker in $X"; exit 1; } || true
done
echo "PASS: gates green."
```

### Line-by-Line Compliance Table (fill in, fold into marker)

| Pseudocode lines | Method | Implemented at (file:line) | Matches? |
| --- | --- | --- | --- |
| 1-19 | listHooks (undefined + isInitialized guards, project name/eventName/enabled/source) | hooks.ts:___ | |
| 30-32 | getDisabledHooks (fresh copy) | hooks.ts:___ | |
| 40-42 | setDisabledHooks (fresh-copy write-through) | hooks.ts:___ | |
| 50-54 | disable (idempotent short-circuit) | hooks.ts:___ | |
| 57-61 | enable (filter) | hooks.ts:___ | |

## Holistic Functionality Assessment (MANDATORY — into marker)

- **What was implemented**: five admin methods on `AgentHookControl`/`HookControl`.
- **Satisfies REQ-004?**: list/getDisabled/setDisabled/enable/disable present; existing members intact?
- **Data flow**: live `this.deps.config` every call; registry only after `isInitialized()`; fresh copies?
- **Risks**: any cache; any leak of the engine's internal arrays; any change to existing members.
- **Verdict**: PASS/FAIL with file:line evidence.

## Success Criteria

- All gates pass; compliance table complete; non-breaking confirmed; holistic verdict PASS.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P10a.md` including the completed compliance table + holistic
assessment.

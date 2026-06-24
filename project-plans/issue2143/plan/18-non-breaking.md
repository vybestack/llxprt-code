<!-- @plan:PLAN-20260622-COREAPIGAP.P18 @requirement:REQ-009 -->
# Phase 18: Non-Breaking Public-Surface Guard

## Phase ID

`PLAN-20260622-COREAPIGAP.P18`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 17a completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P17a.md`

## Requirements Implemented (Expanded)

### REQ-009: The whole plan is additive — no existing public export removed or changed

**Full Text**: After ALL of REQ-001..008 land, every #1594/#1594-remediate-era public export (root
barrel values, projected types, the `internals.js` value exports, the existing sub-controller method
signatures) MUST still be present with a COMPATIBLE shape. The surface may GROW; it may never SHRINK
or change an existing member's shape.
**Behavior**:
- GIVEN: the public surface as shipped before this plan (the characterization baseline)
- WHEN: this plan's additive members are present
- THEN: the prior export set is a strict SUBSET of the current export set, and each prior
  member's runtime kind (`function`/enum-value/object) and (where compile-checkable) type signature
  is unchanged
**Why This Matters**: #1595 and any other current consumer must not be broken by this prerequisite.
This phase is the explicit regression fence around "additive only".

## Background — verified current state

- Two characterization tests already exist and MUST stay green:
  - `__tests__/nonBreaking.exports.test.ts` (REQ-006-era runtime subset guard + internals identity).
  - `__tests__/publicSurface.nonbreaking.test.ts` (REQ-006-era dynamic enumeration + `createAgent`
    compile anchor + fast-check property over the #1594 key set).
- This phase EXTENDS `publicSurface.nonbreaking.test.ts` (do NOT recreate it, do NOT duplicate the
  existing assertions) by ADDING a NEW `describe('REQ-009 …')` block that fences THIS plan's surface:
  the new value enums, the new projected types (compile anchors), and the unchanged shape of the
  extended sub-controllers.

## Implementation Tasks

### Files to Modify

- `packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts` — ADD a new
  `describe('REQ-009 @plan:PLAN-20260622-COREAPIGAP.P18 — additive surface is non-breaking', …)`
  block (append; leave the existing `describe` untouched). It MUST:
  - **Prior-surface subset (runtime):** re-assert the full #1594-era load-bearing value set is still
    present as runtime keys of the dynamically-enumerated root (`createAgent`, `fromConfig`,
    `listProviders`, `listTools`, `mapLoopStream`, `mapStreamEvent`, `toConfigParameters`,
    `createTaskToolRegistration`, `AdapterError`, `AgenticLoop`), and each is `typeof 'function'`.
  - **internals identity unchanged:** `import * as internals from
    '@vybestack/llxprt-code-agents/internals.js';` then assert `typeof internals.AgentClient ===
    'function'`, `internals.PostTurnAction` is defined, and `root.AgentClient === internals.AgentClient`
    (binding identity preserved).
  - **New value enums are present (additive):** `root.ApprovalMode` and `root.PolicyDecision` are
    runtime objects whose members round-trip (`root.ApprovalMode.YOLO === 'yolo'`,
    `root.PolicyDecision.ASK_USER === 'ask_user'`). (This is the additive half: the surface GREW.)
  - **Compile anchors for new projected types (no runtime shrink):** add type-level `const`
    anchors that bind a value of the projected type to a local typed slot, then `void` it — exactly
    the existing `_createAgentShape` idiom. At minimum anchor `AgentTaskInfo`, `PolicyRuleView`,
    `ToolKeyStatus`, `HookInfo`, `AuthProviderDetail`, `McpDetailStatus`. Example:
    `type _TaskInfoShape = import('@vybestack/llxprt-code-agents').AgentTaskInfo; const _t: (x:
    _TaskInfoShape) => string = (x) => x.id; void _t;` (a removal/rename of the type, or dropping the
    `id` field, breaks `npm run typecheck`).
  - **Extended controller signatures unchanged (compile anchors):** bind the EXISTING method
    signatures that were extended-around (not changed), e.g. the existing `Agent.mcp.refresh` is still
    `(server?: string) => Promise<void>`; the existing `Agent.hooks.clear` is still `() => void`.
    Use the `_shape` const-anchor idiom so any accidental signature change to a prior member fails
    typecheck. (REQ-009's core promise: extending a controller did not alter its prior methods.)
  - **≥30% property-based, MIN-2 cases** — e.g. (1) property over the prior load-bearing key set:
    each sampled key is a live root key AND callable; (2) property over the new enum value sets: each
    sampled member is a non-empty string equal to `EnumObject[memberName]`.
  - NO mock theater, NO reverse tests, no `any` (the typed const-anchors are the opposite of `any`).

### Constraints

- Do NOT modify the production source in this phase — it is a TEST-ONLY regression fence. (If a real
  non-breaking VIOLATION is discovered here, STOP and reopen the owning component phase; do not patch
  it inside the test.)
- Do NOT delete or weaken any existing assertion in either non-breaking test.
- Keep `nonBreaking.exports.test.ts` as-is (it already passes); this phase only extends
  `publicSurface.nonbreaking.test.ts`.

## Verification Commands

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts

# 1. The new REQ-009 describe block exists and is additive (old block still there).
grep -qE "REQ-009 @plan:PLAN-20260622-COREAPIGAP.P18" "$F" || { echo "FAIL: new REQ-009 block missing"; exit 1; }
grep -qE "REQ-006 @plan:PLAN-20260621-COREAPIREMED.P21" "$F" || { echo "FAIL: existing REQ-006 block was removed"; exit 1; }

# 2. New enums + at least the named projected-type anchors are referenced.
for SYM in ApprovalMode PolicyDecision AgentTaskInfo PolicyRuleView ToolKeyStatus HookInfo AuthProviderDetail McpDetailStatus; do
  grep -qE "\b$SYM\b" "$F" || { echo "FAIL: $SYM not anchored in non-breaking test"; exit 1; }
done

# 3. Internals identity + prior subset still asserted.
grep -qE "root\.AgentClient.*internals\.AgentClient|internals\.AgentClient.*root\.AgentClient" "$F" || { echo "FAIL: internals identity anchor missing"; exit 1; }

# 4. Both non-breaking tests + whole dir GREEN; typecheck GREEN (compile anchors are load-bearing).
npx vitest run packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts 2>&1 | tail -25
npx vitest run packages/agents/src/api/__tests__/nonBreaking.exports.test.ts 2>&1 | tail -15
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p18_all.log 2>&1 || { echo "FAIL: regressions"; tail -60 /tmp/p18_all.log; exit 1; }
npm run typecheck 2>&1 | tail -15

# 5. Property gate (≥30%, MIN-2) over the WHOLE file (existing prop counts too; new ones add).
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '/(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 } /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } } END { print n+0 }' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
PCT=$(( PROP * 100 / TOTAL ))
echo "property CASES: $PROP / $TOTAL = ${PCT}%"
[ "$PROP" -ge 2 ] && [ "$PCT" -ge 30 ] || { echo "FAIL: property gate"; exit 1; }

# 6. No mock theater / reverse tests in the file.
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue|vi\.fn\(|vi\.spyOn" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "not\.toThrow\(\)|toThrow\('NotYetImplemented'\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi

# 7. No production source modified in this phase.
if git diff HEAD --name-only | grep -vE "__tests__|project-plans/" | grep -E "packages/agents/src/"; then
  echo "FAIL: P18 must not modify production source"; exit 1
fi
echo "PASS: P18 non-breaking guard green."
```

### Semantic Verification Checklist

- [ ] Existing REQ-006 characterization block untouched and green.
- [ ] New REQ-009 block fences: prior runtime subset, internals identity, new enum values, new
      projected-type compile anchors, extended-controller signature anchors.
- [ ] typecheck green (compile anchors actively guard prior + new shapes).
- [ ] ≥30% property; no mock theater / reverse tests; no production source touched.

## Success Criteria

- Both non-breaking tests green; new REQ-009 regression fence in place; typecheck green; additive
  surface proven (prior ⊂ current) and no prior member shape changed.

## Failure Recovery

- If a real non-breaking violation surfaces, STOP and reopen the owning component phase; never relax
  the fence. Otherwise `git checkout -- <file>` and re-extend.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P18.md`

```markdown
Phase: P18
Completed: YYYY-MM-DD HH:MM
Files Created: none
Files Modified: [publicSurface.nonbreaking.test.ts +N/-0]
Tests Added: [count in the new describe block]
Verification: [paste actual output]
Semantic Assessment: [one-line: additive surface fenced; prior ⊂ current; no shape change]
```

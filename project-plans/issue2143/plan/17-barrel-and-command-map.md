<!-- @plan:PLAN-20260622-COREAPIGAP.P17 @requirement:REQ-008,REQ-009 -->
# Phase 17: Public Barrel Re-Exports + `COMMAND_API_MAP` Rows

## Phase ID

`PLAN-20260622-COREAPIGAP.P17`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 16a completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P16a.md`
- Cite pseudocode: `analysis/pseudocode/barrel-exports.md`, `analysis/pseudocode/command-map.md`

## Requirements Implemented (Expanded)

### REQ-008: Public barrel re-exports + command-map registration

**Full Text**: The public agents barrel (`packages/agents/src/api/index.ts`) MUST surface, BY NAME,
the new VALUE enums (`PolicyDecision`, `ApprovalMode`) and every NEW projected public type so a
consumer (#1595) can import them from the public root `@vybestack/llxprt-code-agents` without a deep
import. `COMMAND_API_MAP` (`app-services/command-api-map.ts`) MUST register the six target slash
commands (`/approval-mode`, `/policies`, `/task`, `/hooks`, `/toolkey`, `/toolkeyfile`) as
`kind: 'runtime'` rows pointing at the real Agent-method paths added by REQ-001..007.
**Behavior**:
- GIVEN: a #1595 developer importing only `@vybestack/llxprt-code-agents`
- WHEN: they reference `ApprovalMode.YOLO`, `PolicyDecision.ASK_USER`, or a projected type
  (`AgentTaskInfo`, `PolicyRuleView`, `ToolKeyStatus`, …)
- THEN: every symbol resolves from the public root (enums as runtime VALUES, projected types as
  type-only) — no `@vybestack/llxprt-code-core/<path>` deep import is required
- AND: `COMMAND_API_MAP` documents how each of the six commands reaches its Agent target
**Why This Matters**: #1595's stated acceptance criterion is "no `getConfig()` escape hatch / no deep
import". A consumer that cannot even NAME `ApprovalMode` as a value, or cannot discover the
command→method mapping, is forced back to `-core`. This phase is the public-surface keystone.

### REQ-009 (this phase's slice): Non-breaking append-only

**Full Text**: Existing barrel exports and existing `COMMAND_API_MAP` rows keep their exact shape;
this phase ADDS lines only.
**Behavior**: GIVEN the current public surface, WHEN this phase lands, THEN every prior export/row is
byte-identical and still present (the prior set is a SUBSET of the new set).

## Background — verified current state (DO NOT re-derive; confirmed at authoring)

- `api/index.ts:12` is `export * from './agent.js';` (star, NOT `export type *`). The control
  interfaces and projected types defined in `agent.ts` therefore already surface by name through this
  star — EXCEPT the two enum VALUES, which are currently **type-only**:
  - `ApprovalMode` is re-exported `export type { ApprovalMode }` (`agent.ts:387`) and
    `export type { ApprovalMode, … }` (`config-types.ts:27`). So `root.ApprovalMode` is NOT a runtime
    value today.
  - `PolicyDecision` is NOT exported from the agents public surface at all today (only used
    internally at `confirmationForcing.ts:42`).
- Real enum shapes (for the RED test): `ApprovalMode { DEFAULT='default', AUTO_EDIT='autoEdit',
  YOLO='yolo' }` (`core/src/config/configTypes.ts:59`); `PolicyDecision { ALLOW='allow',
  DENY='deny', ASK_USER='ask_user' }` (`policy/src/types.ts:7`). Both re-exported as VALUES from the
  core barrel (`core/src/index.ts:17-18`).
- `COMMAND_API_MAP: readonly CommandApiMapping[]` (`command-api-map.ts:37`) currently ends with the
  `/quit` cli-local row; the six target commands are ABSENT (verified count 0 each).
- The boundary spec `app-service-boundary.spec.ts` enforces: no orphan kind, unique command names,
  REQUIRED_DURABLE subpath set present + classified `subpath`, every `subpath` row dynamically
  importable. It does NOT enforce completeness; `runtime` rows need no subpath import. Adding six
  `runtime` rows is therefore safe.

## Implementation Tasks (TDD within the phase: write the test, observe RED, then implement GREEN)

### Step 1 — Files to Create (the behavioral RED test FIRST)

- `packages/agents/src/api/__tests__/barrelAndCommandMap.behavior.test.ts` — marker
  `@plan:PLAN-20260622-COREAPIGAP.P17 @requirement:REQ-008`. T17-EXEMPT `.test.ts` (it imports the
  public root and the production map module by relative path — both permitted). It MUST:
  - Import the two enums AS VALUES from the public root:
    `import { ApprovalMode, PolicyDecision } from '@vybestack/llxprt-code-agents';` and assert their
    real members round-trip: `expect(ApprovalMode.YOLO).toBe('yolo')`,
    `expect(ApprovalMode.AUTO_EDIT).toBe('autoEdit')`, `expect(ApprovalMode.DEFAULT).toBe('default')`,
    `expect(PolicyDecision.ASK_USER).toBe('ask_user')`, `expect(PolicyDecision.ALLOW).toBe('allow')`,
    `expect(PolicyDecision.DENY).toBe('deny')`. (Importing a runtime VALUE that is currently
    type-only yields `undefined` at runtime → the `.toBe(...)` assertions FAIL behaviorally — an
    AssertionError, NOT a module-not-found error, because the star re-export means the NAME resolves,
    just as a type with no runtime binding. This is ACCEPTABLE RED.)
  - Assert the two enums are runtime keys of the namespace:
    `import * as root from '@vybestack/llxprt-code-agents';` then
    `expect(Object.prototype.hasOwnProperty.call(root, 'ApprovalMode')).toBe(true)` and the same for
    `'PolicyDecision'`. (Currently false → behavioral RED.)
  - Import the production map and assert the six rows by content:
    `import { COMMAND_API_MAP } from '../../app-services/command-api-map.js';`
    Build `const byCmd = new Map(COMMAND_API_MAP.map((e) => [e.command, e] as const));` and for each
    of the six expected `{ command, target }` pairs assert the row exists, `kind === 'runtime'`, and
    `target` equals the expected dotted path (table below). (Rows absent today → behavioral RED.)
  - Re-assert the map invariants still hold AFTER the rows (proves non-breaking + no orphan):
    every `e.kind` ∈ `{runtime, subpath, cli-local}`; command names unique
    (`new Set(names).size === names.length`).
  - **≥30% property-based (fast-check), MIN-2 distinct property cases**, e.g.:
    1. Property over `fc.constantFrom(...Object.values(ApprovalMode))`: each member is a non-empty
       lowercase string AND `ApprovalMode[key-for-value]` round-trips (value is a live enum member).
    2. Property over the six expected commands `fc.constantFrom('/approval-mode','/policies','/task',
       '/hooks','/toolkey','/toolkeyfile')`: each is present in `byCmd`, has `kind==='runtime'`, and a
       non-empty `target` that starts with `'agent.'`.
  - NO mock theater, NO reverse tests, NO `.skip`, no `any`.

Expected `{ command → target }` rows:

| command | kind | target |
|---|---|---|
| `/approval-mode` | runtime | `agent.setApprovalMode` |
| `/policies` | runtime | `agent.policy.getRules` |
| `/task` | runtime | `agent.tasks.list` |
| `/hooks` | runtime | `agent.hooks.listHooks` |
| `/toolkey` | runtime | `agent.tools.keys.save` |
| `/toolkeyfile` | runtime | `agent.tools.keys.setKeyFile` |

### Step 2 — Files to Modify (implement GREEN; cite pseudocode)

- `packages/agents/src/api/index.ts` — APPEND (do not touch existing lines):
  - `@pseudocode barrel-exports.md lines 1-4` (VALUE enums):
    `export { PolicyDecision, ApprovalMode } from '@vybestack/llxprt-code-core';`
  - `@pseudocode barrel-exports.md lines 5-9` (projected TYPES, type-only):
    `export type { PolicyRuleView, AgentTaskInfo, HookInfo, AuthProviderDetail, AuthBucketStatus,
    McpServerAuthStatus, McpDetailStatus, McpServerDetail, McpDetailsOptions, McpPromptInfo,
    McpResourceInfo, McpBlockedServer, ToolKeyInfo, ToolKeyStatus } from './agent.js';`
  - Add the `@plan`/`@requirement`/`@pseudocode` marker block referencing P17.
  - **Collision note (verify, do not guess):** the direct VALUE `export { ApprovalMode } from
    '...core'` deliberately SHADOWS the star-propagated `export type { ApprovalMode }` (an explicit
    named re-export wins over a `export *` re-export). After editing, RUN `npm run typecheck` and
    `npm run build`. If TS emits TS2308 ("already exported a member named 'ApprovalMode'"), the
    resolution is to KEEP the explicit value export as the authoritative one (it is the intended
    public shape) — do NOT remove the value export and do NOT delete the existing `config-types.ts`
    type re-export; if the collision is genuinely unresolvable by shadowing, re-export the value from
    a single explicit named export and confirm the type still resolves. Record the exact outcome in
    the completion marker. (Projected types are all NET-NEW names, so they cannot collide.)
- `packages/agents/src/app-services/command-api-map.ts` — APPEND the six rows after the last existing
  entry (the `/quit` block), citing `@pseudocode command-map.md lines 1-13`. Each row uses
  `kind: 'runtime'`, the `target` from the table above, and a one-line `note`. Add a P17 marker block
  to the file header comment (do not remove the existing P27 marker).

### Constraints

- APPEND-ONLY. Do not reorder, retype, or remove any existing export or map row (REQ-009).
- `verbatimModuleSyntax` is ON: enums → plain `export { … }`; projected interfaces → `export type
  { … }`. (Mixing them up yields TS1205 for the types or a runtime "not exported" for the enums.)
- The projected TYPES must already be DEFINED in `agent.ts` by P05/P07/P09/P11/P13/P15 (they are).
  If any name does not yet exist in `agent.ts`, that is a missing dependency from an earlier phase —
  STOP and fix the source phase; do NOT define the type here.
- Production code carries ONLY marker comments (N5) — no prose.

## Verification Commands

```bash
set -o pipefail
set -e
I=packages/agents/src/api/index.ts
M=packages/agents/src/app-services/command-api-map.ts
F=packages/agents/src/api/__tests__/barrelAndCommandMap.behavior.test.ts

test -f "$F"

# 1. VALUE enums exported (plain export, NOT `export type`), projected types as `export type`.
grep -qE "export \{ PolicyDecision, ApprovalMode \} from '@vybestack/llxprt-code-core'" "$I" \
  || { echo "FAIL: value enums not re-exported"; exit 1; }
# Guard against accidental `export type { … PolicyDecision …}` (would break enum-member use).
if grep -nE "export type \{[^}]*\b(PolicyDecision|ApprovalMode)\b[^}]*\} from '@vybestack/llxprt-code-core'" "$I"; then
  echo "FAIL: enums re-exported as type-only (must be VALUE export)"; exit 1
fi
for T in PolicyRuleView AgentTaskInfo HookInfo AuthProviderDetail AuthBucketStatus McpServerAuthStatus McpDetailStatus McpServerDetail McpDetailsOptions McpPromptInfo McpResourceInfo McpBlockedServer ToolKeyInfo ToolKeyStatus; do
  grep -qE "\b$T\b" "$I" || { echo "FAIL: projected type $T not surfaced from barrel"; exit 1; }
done
grep -qE "export type \{" "$I" || { echo "FAIL: no `export type` block for projected types"; exit 1; }

# 2. Existing barrel lines intact (non-breaking subset — spot-check the load-bearing ones).
for L in "export \* from './agent.js'" "export \{ createAgent \} from './createAgent.js'" "export \{ fromConfig \} from './fromConfig.js'" "export type \{ AgentClientContract \}"; do
  grep -qE "$L" "$I" || { echo "FAIL: existing barrel export missing: $L"; exit 1; }
done

# 3. Six runtime rows present with the right target + kind.
for ROW in "/approval-mode:agent.setApprovalMode" "/policies:agent.policy.getRules" "/task:agent.tasks.list" "/hooks:agent.hooks.listHooks" "/toolkey:agent.tools.keys.save" "/toolkeyfile:agent.tools.keys.setKeyFile"; do
  CMD="${ROW%%:*}"; TGT="${ROW#*:}"
  grep -qE "command: '$CMD'" "$M" || { echo "FAIL: command-map row missing: $CMD"; exit 1; }
  grep -qE "target: '$TGT'" "$M" || { echo "FAIL: command-map target missing: $TGT"; exit 1; }
done
# Each new command's row is kind 'runtime' (no accidental subpath/cli-local).
node -e "const {COMMAND_API_MAP}=require('./packages/agents/dist/src/app-services/command-api-map.js'); const want=['/approval-mode','/policies','/task','/hooks','/toolkey','/toolkeyfile']; const m=new Map(COMMAND_API_MAP.map(e=>[e.command,e])); for(const c of want){const e=m.get(c); if(!e){console.error('MISSING '+c);process.exit(1);} if(e.kind!=='runtime'){console.error('WRONG KIND '+c+' '+e.kind);process.exit(1);}} const names=COMMAND_API_MAP.map(e=>e.command); if(new Set(names).size!==names.length){console.error('DUP command');process.exit(1);} console.log('map invariants OK');" 2>/dev/null \
  || echo "(node dist check skipped until build; grep checks above are authoritative pre-build)"

# 4. Target test GREEN + boundary spec still GREEN + whole dir GREEN.
npx vitest run "$F" 2>&1 | tail -30
npx vitest run packages/agents/src/api/__tests__/app-service-boundary.spec.ts 2>&1 | tail -20
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p17_all.log 2>&1 || { echo "FAIL: regressions"; tail -60 /tmp/p17_all.log; exit 1; }

# 5. Build + typecheck (CRITICAL: catches the ApprovalMode value/type collision if any).
npm run typecheck 2>&1 | tail -15
npm run build 2>&1 | tail -15

# 6. Property gate on the new test (≥30%, MIN-2).
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '/(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 } /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } } END { print n+0 }' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
PCT=$(( PROP * 100 / TOTAL ))
echo "property CASES: $PROP / $TOTAL = ${PCT}%"
[ "$PROP" -ge 2 ] && [ "$PCT" -ge 30 ] || { echo "FAIL: property gate"; exit 1; }

# 7. No mock theater / reverse tests in the new test.
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue|vi\.fn\(|vi\.spyOn" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "not\.toThrow\(\)|toThrow\('NotYetImplemented'\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi

# 8. Deferred markers on changed lines only.
for X in "$I" "$M" "$F"; do
  git diff HEAD -- "$X" | grep -E "^\+" | grep -vE "^\+\+\+" \
    | grep -nE "(TODO|FIXME|HACK|STUB|XXX|placeholder|for now|in a real)" \
    && { echo "FAIL: deferred marker in $X"; exit 1; } || true
done
echo "PASS: P17 barrel + command-map green."
```

> RED capture (run BEFORE Step 2): `npx vitest run "$F" > /tmp/p17_red.log 2>&1` MUST exit non-zero,
> and `/tmp/p17_red.log` MUST NOT contain `Cannot find module|SyntaxError|Failed to resolve import`
> (the public-root NAMES resolve via the star re-export even when type-only; the failures must be
> AssertionErrors on the enum members + missing map rows). Paste this into the completion marker.

### Semantic Verification Checklist

- [ ] `ApprovalMode` + `PolicyDecision` importable as runtime VALUES from the public root; members
      round-trip.
- [ ] All 14 projected types surfaced `export type` from the barrel.
- [ ] Six `runtime` rows present, correct targets, unique, no orphan; REQUIRED_DURABLE subpath set
      untouched (boundary spec green).
- [ ] `npm run build` + `npm run typecheck` green (ApprovalMode value/type collision resolved by
      shadowing or recorded).
- [ ] Append-only: every prior export/row intact; whole `__tests__` dir green.

## Success Criteria

- Public root exposes the enums (values) + projected types (type-only); six command rows registered;
  build/typecheck green; non-breaking; new behavioral test green with ≥30% property.

## Failure Recovery

- `git checkout -- packages/agents/src/api/index.ts packages/agents/src/app-services/command-api-map.ts`
  and re-apply append-only; if a projected type name is missing from `agent.ts`, reopen the owning
  component phase (do NOT define it here).

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P17.md`

```markdown
Phase: P17
Completed: YYYY-MM-DD HH:MM
Files Created: [barrelAndCommandMap.behavior.test.ts with line count]
Files Modified: [api/index.ts +N/-0, app-services/command-api-map.ts +N/-0]
Tests Added: [count]
RED evidence: [paste /tmp/p17_red.log tail proving behavioral (non-module) failure]
ApprovalMode collision outcome: [shadowed cleanly | resolved how]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line: barrel + map now let #1595 name every new symbol from the public root]
```

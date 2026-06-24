<!-- @plan:PLAN-20260622-COREAPIGAP.P18a @requirement:REQ-009 -->
# Phase 18a: Non-Breaking Guard — Verification

## Phase ID

`PLAN-20260622-COREAPIGAP.P18a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 18 completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P18.md`

## Purpose

Independent gate on the additive-only promise. Confirm the regression fence actually CATCHES a
removal/shape-change (not a vacuous test), that the existing #1594-era characterization is preserved,
and that the new enum values + projected-type compile anchors are real (typecheck-load-bearing).

CRITICAL — where compile anchors MUST live: the workspace `packages/agents/tsconfig.json` `exclude`
drops `**/*.test.ts` and `**/*.spec.ts`, so `npm run typecheck` (tsc --noEmit) NEVER compiles a
`.test.ts`; vitest also strips types at runtime. Therefore the projected-type + extended-controller
compile anchors live in a sibling `additiveSurface.types.ts` (NO `.test`/`.spec` infix) under
`__tests__/` — typecheck-VISIBLE, build-EXCLUDED (tsconfig.build.json excludes `src/**/__tests__/**`),
and vitest-IGNORED. The runtime subset/identity/enum assertions stay in the `.test.ts`. This phase
PROVES the `.types.ts` anchors are actually in the typecheck file set and are load-bearing.

## Verification Commands

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts
TYPES=packages/agents/src/api/__tests__/additiveSurface.types.ts

# 1. Existing characterization preserved; new REQ-009 block present.
grep -qE "REQ-006 @plan:PLAN-20260621-COREAPIREMED.P21" "$F" || { echo "FAIL: existing REQ-006 block removed"; exit 1; }
grep -qE "REQ-009 @plan:PLAN-20260622-COREAPIGAP.P18" "$F" || { echo "FAIL: REQ-009 block missing"; exit 1; }

# 2. Compile anchors MUST live in a typecheck-VISIBLE file (NOT a .test.ts, which tsconfig excludes).
test -f "$TYPES" || { echo "FAIL: additiveSurface.types.ts missing — compile anchors would be vacuous"; exit 1; }
case "$TYPES" in *.test.ts|*.spec.ts) echo "FAIL: anchor file is a .test.ts/.spec.ts (excluded from typecheck)"; exit 1;; esac
( cd packages/agents && npx tsc --noEmit --listFilesOnly 2>/dev/null | grep -q "additiveSurface.types.ts" ) \
  || { echo "FAIL: additiveSurface.types.ts is NOT in the typecheck file set (vacuous fence)"; exit 1; }

# 2b. Prove the anchors are LOAD-BEARING: break the AgentTaskInfo field-access anchor in the .types.ts,
#     confirm typecheck FAILS on THAT file, then restore + confirm green again.
cp "$TYPES" /tmp/p18a_backup.ts
grep -qE "AgentTaskInfo" "$TYPES" || { echo "FAIL: AgentTaskInfo anchor missing in .types.ts"; exit 1; }
perl -0pi -e "s/(_TaskInfoShape\) => string = \(x\) => x\.)id/\${1}__nope_field__/g" "$TYPES" || true
grep -qE "__nope_field__" "$TYPES" || { echo "FAIL: probe did not mutate the anchor (exact form drifted)"; cp /tmp/p18a_backup.ts "$TYPES"; exit 1; }
if npm run typecheck > /tmp/p18a_probe.log 2>&1; then
  echo "FAIL: fence is vacuous — typecheck passed with a bogus AgentTaskInfo field"; cp /tmp/p18a_backup.ts "$TYPES"; exit 1
fi
grep -qE "additiveSurface\.types\.ts|TS2339|__nope_field__" /tmp/p18a_probe.log \
  || { echo "FAIL: typecheck failed but not on the expected anchor"; cp /tmp/p18a_backup.ts "$TYPES"; exit 1; }
echo "fence is load-bearing: bogus projected-type field broke typecheck as expected"
# Restore + confirm green again.
cp /tmp/p18a_backup.ts "$TYPES"
grep -qE "__nope_field__" "$TYPES" && { echo "FAIL: restore left bogus field behind"; exit 1; } || true
npm run typecheck 2>&1 | tail -10

# 3. Built-artifact subset proof: prior #1594 keys ⊂ current built barrel keys.
#    The package "." export resolves to dist/index.js (package.json main: dist/index.js); the
#    internals subpath ('./internals.js') resolves to dist/src/internals.js (package.json exports).
#    Use those EXACT paths — the prior dist/src/api/index.js was an internal 38-key sub-barrel.
npm run build 2>&1 | tail -8
node -e "
const root = require('./packages/agents/dist/index.js');
const prior = ['createAgent','fromConfig','listProviders','listTools','mapLoopStream','mapStreamEvent','toConfigParameters','createTaskToolRegistration','AdapterError','AgenticLoop'];
const keys = new Set(Object.keys(root));
const missing = prior.filter(k => !keys.has(k));
if (missing.length) { console.error('SHRANK: missing prior keys '+JSON.stringify(missing)); process.exit(1); }
for (const k of prior) { if (typeof root[k] !== 'function') { console.error('prior key not function: '+k); process.exit(1); } }
const internals = require('./packages/agents/dist/src/internals.js');
if (typeof internals.AgentClient !== 'function') { console.error('internals.AgentClient lost'); process.exit(1); }
if (root.AgentClient !== internals.AgentClient) { console.error('AgentClient identity changed'); process.exit(1); }
console.log('built-artifact subset + identity preserved (root keys='+keys.size+')');
"

# 4. Both non-breaking tests + whole dir GREEN.
npx vitest run packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts 2>&1 | tail -20
npx vitest run packages/agents/src/api/__tests__/nonBreaking.exports.test.ts 2>&1 | tail -12
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p18a_all.log 2>&1 || { echo "FAIL: regressions"; tail -60 /tmp/p18a_all.log; exit 1; }

# 5. Discipline + no-production-change.
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue|vi\.fn\(|vi\.spyOn|not\.toThrow\(\)" "$F"; then echo "FAIL: discipline"; exit 1; fi
if git diff HEAD --name-only | grep -vE "__tests__|project-plans/" | grep -E "packages/agents/src/"; then echo "FAIL: production source changed in P18"; exit 1; fi

# 6. Property gate (runtime assertions live in the .test.ts).
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '/(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 } /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } } END { print n+0 }' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
PCT=$(( PROP * 100 / TOTAL ))
echo "property CASES: $PROP / $TOTAL = ${PCT}%"
[ "$PROP" -ge 2 ] && [ "$PCT" -ge 30 ] || { echo "FAIL: property gate"; exit 1; }
echo "PASS: P18a gates green."
```

## Holistic Assessment (MANDATORY — into marker)

- **Anchors typecheck-visible**: `additiveSurface.types.ts` is in the `tsc --listFilesOnly` set (a
  `.test.ts` would NOT be — that was the prior vacuous-fence failure). Evidence (grep of listFilesOnly).
- **Fence is non-vacuous**: the mutation probe (bogus projected-type field in the `.types.ts`) broke
  typecheck and was restored — the compile anchors really guard the new types. Evidence
  (`/tmp/p18a_probe.log` tail showing TS2339 on additiveSurface.types.ts).
- **No shrink**: built-artifact node check against the REAL package root (`dist/index.js`) + internals
  (`dist/src/internals.js`) proves prior #1594 keys ⊂ current + AgentClient identity preserved.
  Evidence (node output, root keys count).
- **Existing characterization intact**: REQ-006 block preserved; both non-breaking tests green.
- **Additive proven**: new enum values present; prior member shapes unchanged.
- **Verdict**: PASS/FAIL with evidence.

## Success Criteria

- Anchor file proven typecheck-visible AND load-bearing; no shrink; both tests + dir green; verdict PASS.

## Failure Recovery

- If the `.types.ts` is not in the typecheck set or the probe shows the fence is vacuous, reopen P18 to
  relocate/repair the anchor; if a real shrink is found, reopen the owning component phase.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P18a.md` (include listFilesOnly + probe + node evidence + verdict).

```markdown
Phase: P18a
Completed: YYYY-MM-DD HH:MM
Files Created: none
Files Modified: none (verification only; probe restored)
Verification: [paste actual output incl. listFilesOnly grep + probe + node subset check]
Holistic Assessment: [PASS/FAIL with evidence]
```

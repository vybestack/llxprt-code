<!-- @plan:PLAN-20260622-COREAPIGAP.P17a @requirement:REQ-008,REQ-009 -->
# Phase 17a: Barrel + `COMMAND_API_MAP` — Verification

## Phase ID

`PLAN-20260622-COREAPIGAP.P17a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 17 completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P17.md`

## Purpose

Independent gate. Confirm the public barrel surfaces the two enums as runtime VALUES and all
projected types as type-only (value-vs-type correctness under `verbatimModuleSyntax`), that the six
`COMMAND_API_MAP` rows are valid `runtime` rows pointing at REAL Agent-method paths, that the change
is strictly append-only (REQ-009 non-breaking), and that the P17 test is genuinely behavioral
(real public-root import, real production map, ≥30% property, no mock theater / reverse tests).

## Verification Commands

```bash
set -o pipefail
set -e
I=packages/agents/src/api/index.ts
M=packages/agents/src/app-services/command-api-map.ts
F=packages/agents/src/api/__tests__/barrelAndCommandMap.behavior.test.ts

# 1. Value-vs-type correctness in the barrel.
grep -qE "export \{ PolicyDecision, ApprovalMode \} from '@vybestack/llxprt-code-core'" "$I" \
  || { echo "FAIL: enums not VALUE-exported"; exit 1; }
if grep -nE "export type \{[^}]*\b(PolicyDecision|ApprovalMode)\b" "$I"; then echo "FAIL: enums type-only"; exit 1; fi
grep -qE "export type \{[^}]*\bToolKeyStatus\b" "$I" || { echo "FAIL: projected types not type-only block"; exit 1; }

# 2. Append-only diff: NO existing line removed (deletions touching prior exports/rows are forbidden).
#    Allow ONLY added lines + a marker-comment block; assert zero removed export/row lines.
if git diff HEAD -- "$I" | grep -E "^-" | grep -vE "^---" | grep -E "export|from '"; then
  echo "FAIL: an existing barrel export line was removed/changed"; exit 1
fi
if git diff HEAD -- "$M" | grep -E "^-" | grep -vE "^---" | grep -E "command:|target:|kind:"; then
  echo "FAIL: an existing command-map row line was removed/changed"; exit 1
fi
echo "append-only confirmed for barrel + map"

# 3. Build the package, then verify the BUILT barrel actually ships the enums as runtime values and
#    the six rows resolve from the compiled artifact (the real consumer surface).
npm run build 2>&1 | tail -10
node -e "
const root = require('./packages/agents/dist/src/api/index.js');
for (const k of ['ApprovalMode','PolicyDecision']) {
  if (!Object.prototype.hasOwnProperty.call(root,k)) { console.error('MISSING runtime value '+k); process.exit(1); }
}
if (root.ApprovalMode.YOLO !== 'yolo' || root.ApprovalMode.AUTO_EDIT !== 'autoEdit' || root.ApprovalMode.DEFAULT !== 'default') { console.error('ApprovalMode members wrong'); process.exit(1); }
if (root.PolicyDecision.ASK_USER !== 'ask_user' || root.PolicyDecision.ALLOW !== 'allow' || root.PolicyDecision.DENY !== 'deny') { console.error('PolicyDecision members wrong'); process.exit(1); }
console.log('built barrel exposes enum VALUES OK');
"
node -e "
const { COMMAND_API_MAP } = require('./packages/agents/dist/src/app-services/command-api-map.js');
const want = { '/approval-mode':'agent.setApprovalMode', '/policies':'agent.policy.getRules', '/task':'agent.tasks.list', '/hooks':'agent.hooks.listHooks', '/toolkey':'agent.tools.keys.save', '/toolkeyfile':'agent.tools.keys.setKeyFile' };
const m = new Map(COMMAND_API_MAP.map(e => [e.command, e]));
for (const [c,t] of Object.entries(want)) { const e=m.get(c); if(!e){console.error('MISSING '+c);process.exit(1);} if(e.kind!=='runtime'){console.error('WRONG KIND '+c);process.exit(1);} if(e.target!==t){console.error('WRONG TARGET '+c+' '+e.target);process.exit(1);} }
const names = COMMAND_API_MAP.map(e=>e.command);
if (new Set(names).size !== names.length) { console.error('DUP command'); process.exit(1); }
const valid = new Set(['runtime','subpath','cli-local']);
if (COMMAND_API_MAP.some(e=>!valid.has(e.kind))) { console.error('orphan kind'); process.exit(1); }
console.log('built map: six runtime rows + invariants OK');
"

# 4. Each target dotted-path is backed by a REAL Agent method/controller (string-grep the source).
grep -qE "setApprovalMode" packages/agents/src/api/agent.ts || { echo "FAIL: agent.setApprovalMode missing"; exit 1; }
grep -qE "policy: AgentPolicyControl|readonly policy" packages/agents/src/api/agent.ts || { echo "FAIL: agent.policy missing"; exit 1; }
grep -qE "tasks: AgentTasksControl|readonly tasks" packages/agents/src/api/agent.ts || { echo "FAIL: agent.tasks missing"; exit 1; }
grep -qE "listHooks" packages/agents/src/api/agent.ts || { echo "FAIL: agent.hooks.listHooks missing"; exit 1; }
grep -qE "keys: AgentToolKeyControl|readonly keys" packages/agents/src/api/agent.ts || { echo "FAIL: agent.tools.keys missing"; exit 1; }

# 5. Full dir + boundary spec + typecheck green.
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p17a_all.log 2>&1 || { echo "FAIL: regressions"; tail -60 /tmp/p17a_all.log; exit 1; }
npm run typecheck 2>&1 | tail -15

# 6. Re-audit P17 test discipline.
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue|vi\.fn\(|vi\.spyOn" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi
grep -qE "from '@vybestack/llxprt-code-agents'" "$F" || { echo "FAIL: test must import the PUBLIC ROOT (proves no deep import needed)"; exit 1; }
grep -qE "ApprovalMode\.YOLO|ApprovalMode\.AUTO_EDIT" "$F" || { echo "FAIL: test must assert real enum members"; exit 1; }
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '/(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 } /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } } END { print n+0 }' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
PCT=$(( PROP * 100 / TOTAL ))
echo "property CASES: $PROP / $TOTAL = ${PCT}%"
[ "$PROP" -ge 2 ] && [ "$PCT" -ge 30 ] || { echo "FAIL: property gate"; exit 1; }
echo "PASS: P17a gates green."
```

## Holistic Assessment (MANDATORY — into marker)

- **Value-vs-type**: enums VALUE-exported, projected types type-only — confirmed against the BUILT
  artifact (not just source grep), so a consumer `import { ApprovalMode } from
  '@vybestack/llxprt-code-agents'` truly gets a runtime enum. Evidence (node output).
- **Map adequacy**: the six `runtime` rows point at the REAL methods this plan added; #1595 can read
  the command→method mapping from the public app-service map. Evidence (built-map node output).
- **Non-breaking (REQ-009)**: append-only diff proven (no removed export/row line); boundary spec +
  whole dir green.
- **ApprovalMode collision**: confirm the P17 marker recorded the typecheck/build outcome; verify no
  TS2308 in the build log.
- **Test discipline**: behavioral (public-root import, real members, real production map), ≥30%
  property, no mock theater / reverse tests.
- **Verdict**: PASS/FAIL with file:line + node-output evidence.

## Success Criteria

- All gates pass; built artifact ships enum values + six runtime rows; append-only; holistic verdict
  PASS.

## Failure Recovery

- Reopen P17 for the specific defect (value/type form, missing row/target, removed line, collision);
  do not weaken the verification.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P17a.md` (include the node-output evidence + holistic
verdict).

```markdown
Phase: P17a
Completed: YYYY-MM-DD HH:MM
Files Created: none
Files Modified: none (verification only)
Verification: [paste actual output incl. both node checks]
Holistic Assessment: [PASS/FAIL with evidence]
```

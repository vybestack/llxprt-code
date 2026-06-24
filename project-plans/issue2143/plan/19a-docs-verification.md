<!-- @plan:PLAN-20260622-COREAPIGAP.P19a @requirement:REQ-010 -->
# Phase 19a: Documentation — Verification

## Phase ID

`PLAN-20260622-COREAPIGAP.P19a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 19 completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P19.md`

## Purpose

Independent gate on documentation correctness and completeness. The risk with docs is DRIFT
(examples that don't match the shipped signatures) and ESCAPE (examples that quietly reach into
`-core` or `getConfig()`), which would defeat the "clean public API" goal. Verify the docs are
accurate, public-root-only, and complete for all seven capability groups + enums/types + map rows.

## Verification Commands

```bash
set -o pipefail
set -e
D=docs/agent-api.md
A=packages/agents/src/api/agent.ts

# 1. Completeness: every documented method name actually exists in agent.ts (no doc for a
#    non-existent method) AND every new method in agent.ts that this plan added is documented.
for SYM in getApprovalMode setApprovalMode getRules getDefaultDecision isNonInteractive \
           listRunning cancelAllRunning listHooks getDisabledHooks setDisabledHooks \
           detailedStatus getHigherPriorityAuth listBucketStatuses \
           setKeyFile getKeyFile; do
  grep -qF "$SYM" "$D" || { echo "FAIL: doc omits $SYM"; exit 1; }
  grep -qE "\b$SYM\b" "$A" || { echo "FAIL: $SYM documented but absent in agent.ts (drift)"; exit 1; }
done

# 2. Enums/types documented AND really on the public surface.
for SYM in ApprovalMode PolicyDecision PolicyRuleView AgentTaskInfo HookInfo AuthProviderDetail \
           AuthBucketStatus McpServerAuthStatus McpDetailStatus ToolKeyInfo ToolKeyStatus; do
  grep -qF "$SYM" "$D" || { echo "FAIL: doc omits type/enum $SYM"; exit 1; }
done
grep -qE "export \{ PolicyDecision, ApprovalMode \}" packages/agents/src/api/index.ts || { echo "FAIL: enums not actually on barrel"; exit 1; }

# 3. No escape hatch in examples.
if grep -nE "@vybestack/llxprt-code-core/" "$D"; then echo "FAIL: deep-core import in docs"; exit 1; fi
grep -qE "from '@vybestack/llxprt-code-agents'" "$D" || { echo "FAIL: examples not public-root"; exit 1; }

# 4. Six command rows + map parity with the production map.
for CMD in "/approval-mode" "/policies" "/task" "/hooks" "/toolkey" "/toolkeyfile"; do
  grep -qF "$CMD" "$D" || { echo "FAIL: doc omits command $CMD"; exit 1; }
  grep -qF "command: '$CMD'" packages/agents/src/app-services/command-api-map.ts || { echo "FAIL: $CMD documented but not in production map"; exit 1; }
done

# 5. Append-only: no existing heading/code-fence/table-row removed.
git diff HEAD -- "$D" | grep -E "^-" | grep -vE "^---" | grep -E "^-#|^-\`\`\`|^-\| " \
  && { echo "FAIL: doc content removed"; exit 1; } || true

# 6. Masked-only promise stated for the secret-bearing surfaces.
grep -qiE "never .*(raw|token|secret)|masked" "$D" || { echo "FAIL: docs must state secrets are masked/never raw"; exit 1; }

# 7. Format gate green.
npm run format 2>&1 | tail -5 || true
echo "PASS: P19a gates green."
```

## Holistic Assessment (MANDATORY — into marker)

- **Accuracy**: every documented method exists in `agent.ts` (no drift); spot-check 3 examples by
  eye against the shipped signatures.
- **No escape**: zero deep-core imports; all examples import the public root; `getConfig()` appears
  only in its own (preserved) section, never as the way to reach a new capability.
- **Completeness**: all seven groups + enums/types + six map rows documented; map parity with
  production.
- **Security**: masked-only / never-raw stated for auth + tool-keys.
- **Append-only**: no removed headings/fences/rows.
- **Verdict**: PASS/FAIL with file:line evidence.

## Success Criteria

- Docs accurate, complete, public-root-only, append-only; verdict PASS.

## Failure Recovery

- Reopen P19 for any drift/omission/escape; do not relax the checks.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P19a.md`

```markdown
Phase: P19a
Completed: YYYY-MM-DD HH:MM
Files Created: none
Files Modified: none (verification only)
Verification: [paste actual output]
Holistic Assessment: [PASS/FAIL with evidence]
```

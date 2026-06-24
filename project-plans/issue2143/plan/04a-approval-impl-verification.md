<!-- @plan:PLAN-20260622-COREAPIGAP.P04a @requirement:REQ-001 -->
# Phase 04a: Approval Mode Implementation Verification (Pseudocode-Compliance Gate)

## Phase ID

`PLAN-20260622-COREAPIGAP.P04a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 04 completed
- Verification: `test -f project-plans/issue2143/.completed/P04.md`

## Pseudocode-Compliance Verification (MANDATORY)

Compare the new `getApprovalMode` / `setApprovalMode` against
`analysis/pseudocode/approval-mode.md` (lines 1-4 and 10-17). This `a` phase ALSO re-audits the
Phase 03 test suite for behavioral discipline (no mock theater, ≥30% property, no reverse tests,
public-root-only).

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/agent.approvalMode.behavior.test.ts

# 1. The component suite is GREEN.
npx vitest run "$F"

# 2. The whole agents api suite still passes (no regression).
npx vitest run packages/agents/src/api/__tests__/

# 3. Type + lint clean.
npm run typecheck
npm run lint

# 4. Delegation present, no try/catch around the set (BLOCKING).
grep -qE "config\.getApprovalMode\(\)" packages/agents/src/api/agentImpl.ts || { echo "FAIL: not delegating getApprovalMode"; exit 1; }
grep -qE "config\.setApprovalMode\(mode\)" packages/agents/src/api/agentImpl.ts || { echo "FAIL: not delegating setApprovalMode"; exit 1; }
if awk '/setApprovalMode\(mode: ApprovalMode\): void \{/{f=1} f{print} /^\s*\}/{if(f)exit}' packages/agents/src/api/agentImpl.ts | grep -qE "\btry\b|\bcatch\b"; then
  echo "FAIL: setApprovalMode wraps try/catch"; exit 1
fi

# 5. No cached approval field (BLOCKING — must read live).
if grep -nE "this\.(approvalMode|_approvalMode|cachedApprovalMode)\s*=" packages/agents/src/api/agentImpl.ts; then
  echo "FAIL: approval mode appears cached in an instance field"; exit 1
fi

# 6. Re-audit the test suite (BLOCKING).
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue|vi\.spyOn|vi\.fn\(" "$F"; then echo "FAIL: mock theater in test"; exit 1; fi
if grep -nE "not\.toThrow\(\)" "$F"; then echo "FAIL: bare reverse test"; exit 1; fi
# T2 must assert the SPECIFIC untrusted message (genuine contract, not a missing-method accident).
grep -qE "Cannot enable privileged approval modes in an untrusted folder" "$F" || { echo "FAIL: T2 does not assert the real untrusted-folder message"; exit 1; }
# Public-root-only (no deep/internal imports).
if grep -nE "from ['\"]@vybestack/llxprt-code-(core|providers|policy|tools|mcp)/" "$F"; then echo "FAIL: deep import in test"; exit 1; fi
if grep -nE "from ['\"]\.\./(control|agentImpl)" "$F"; then echo "FAIL: internal import in test"; exit 1; fi

# 7. Deferred-impl scan, scoped to CHANGED lines (MIN-3), BLOCKING.
for FILE in packages/agents/src/api/agentImpl.ts packages/agents/src/api/agent.ts; do
  if git diff HEAD -- "$FILE" | grep -E "^\+" | grep -vE "^\+\+\+" | grep -nE "(TODO|FIXME|HACK|STUB|XXX|placeholder|for now|in a real)"; then
    echo "FAIL: deferred-implementation marker in changed lines of $FILE"; exit 1
  fi
done
echo "PASS: pseudocode-compliance + test-discipline checks."
```

### Line-by-Line Compliance Table

| Pseudocode lines | Implemented at | Matches? |
|---|---|---|
| 1-4 getApprovalMode live read | | [ ] |
| 10-17 setApprovalMode direct delegate (no try/catch, no normalize) | | [ ] |

### Semantic Verification Checklist

- [ ] Behavior decision table holds (trusted DEFAULT/AUTO_EDIT/YOLO set+read; untrusted non-DEFAULT throws).
- [ ] No caching (R-DELEGATE); live read each call.
- [ ] Untrusted throw propagates unchanged (R-APPROVAL-THROW) — verified via real `folderTrust` flag, not a spy.
- [ ] Test suite is behavioral, ≥30% property-based, public-root-only; lint + typecheck clean; full api suite green.

## Holistic Functionality Assessment (MANDATORY — into marker)

Write into the marker:
- **What was implemented?** (the two top-level Agent methods + interface decls)
- **Satisfies REQ-001/.1/.2?** (cite evidence)
- **Data flow** (Agent method → this.deps.config → Config → live value / propagated throw)
- **Risks** (e.g. any accidental catch, any cache, any test mock theater)
- **Verdict** (PASS/FAIL with the key grounding evidence)

## Success Criteria

- Compliance table complete; assessment written; suites + lint + typecheck green.

## Failure Recovery

- Return to Phase 04 (impl) or Phase 03 (tests); do not proceed to Phase 05.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P04a.md` (include assessment).

```markdown
Phase: P04a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence]
```

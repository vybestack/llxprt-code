<!-- @plan:PLAN-20260621-COREAPIREMED.P21a @requirement:REQ-006,REQ-INT-004 -->
# Phase 21a: Boundary + Non-Breaking Verification

## Phase ID

`PLAN-20260621-COREAPIREMED.P21a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 21 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P21.md`

## Verification Goal

Independently confirm the remediation is purely additive (REQ-006) and that the entire remediated
surface + harness is reachable with public imports only (REQ-INT-004).

## Verification Commands

```bash
set -e
set -o pipefail   # MIN-1: a piped test/typecheck FAILURE must propagate (not be masked by tail)
npx vitest run packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts packages/agents/src/api/__tests__/boundary.adequacy.test.ts 2>&1 | tail -30
npm run typecheck
npm run build
# Compare current public exports vs the #1594 baseline (git): nothing removed/renamed (BLOCKING).
# Additive-only (REQ-006): a removed/changed `export` line in either barrel is a breaking change.
git fetch origin >/dev/null 2>&1 || true
# CCF-10: the remediation RELOCATED low-level exports out of the pre-existing
# `index.ts` into the NEW `internals.ts` (api/index.ts and internals.ts are
# ABSENT on origin/main; only index.ts existed). A per-file `git diff | grep
# "^-export"` therefore MIS-reads every relocated line as a "removal" even
# though it reappears verbatim in another barrel and the PUBLIC surface lost
# nothing. The correct additive-only invariant is a UNION-SUPERSET test: every
# baseline (#1594) export LINE from the root barrel must still be present
# SOMEWHERE in the current union of the three barrels (a moved line is fine; a
# vanished line is breaking).
git show origin/main:packages/agents/src/index.ts \
  | grep -E "^[[:space:]]*export" | sed -E 's/^[[:space:]]+//' | sort -u > /tmp/p21a_base_exports.txt
cat packages/agents/src/index.ts packages/agents/src/internals.ts packages/agents/src/api/index.ts \
  | grep -E "^[[:space:]]*export" | sed -E 's/^[[:space:]]+//' | sort -u > /tmp/p21a_cur_exports.txt
MISSING=$(comm -23 /tmp/p21a_base_exports.txt /tmp/p21a_cur_exports.txt)
if [ -n "$MISSING" ]; then
  echo "FAIL: baseline export line(s) absent from current barrel union (non-additive):"; echo "$MISSING"; exit 1
fi
echo "no export removals — current barrel union is a SUPERSET of the #1594 baseline (additive-only confirmed)"
# No deep imports introduced by this plan (REQ-INT-004, BLOCKING)
if grep -rnE "from '[^']*(/src/|core/src|providers/src)" packages/agents/src/api/__tests__/ | grep -vE "node_modules"; then
  echo "FAIL: deep import introduced in test surface"; exit 1
fi
```

### Semantic Verification Checklist

- [ ] Diff against baseline shows only ADDED export lines (no removals/renames/retypes).
- [ ] `createAgent(AgentConfig)` signature byte-compatible with #1594.
- [ ] `fromConfig` separate export; `AgentClientContract` added TYPE-ONLY on the curated
      `api/index.ts` barrel (reachable from root transitively via `export * from './api/index.js'`);
      `AgentClient` class still only on `./internals.js`.
- [ ] Boundary test passes for the WHOLE remediated set (not a single file).
- [ ] `npm run build` succeeds (dist exports resolve).

## Holistic Functionality Assessment (MANDATORY — into marker)

### Is the change additive-only (evidence from the export diff)? ### Can #1595 reach every needed
symbol via public imports? ### Verdict

## Success Criteria

- Non-breaking + boundary proven with evidence; build green.

## Failure Recovery

- Return to Phase 21; restore any removed export additively; eliminate any deep import.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P21a.md` (include assessment + export diff).

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P21a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```


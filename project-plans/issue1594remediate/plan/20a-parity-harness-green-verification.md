<!-- @plan:PLAN-20260621-COREAPIREMED.P20a @requirement:REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004 -->
# Phase 20a: Parity Harness Green Verification (Semantic + Adequacy Gate)

## Phase ID

`PLAN-20260621-COREAPIREMED.P20a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 20 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P20.md`

## Adequacy Gate (MANDATORY)

This gate certifies the public surface is ADEQUATE for #1595. Compare against
`analysis/pseudocode/cli-integration-adapter.md` lines 10–84.

```bash
set -e
# Harness tests unmodified since P19 — verified by CONTENT HASH against the P19 characterization snapshot, NOT by
# `git log`/`git diff` (the parity files are uncommitted during normal execution, so VCS-based guards
# mis-fire). Re-verify every recorded hash.
SNAP=project-plans/issue1594remediate/.completed/P19-frozen-hashes.txt
test -f "$SNAP" || { echo "FAIL: missing P19 frozen-hash snapshot ($SNAP)"; exit 1; }
grep -E "  packages/agents/src/api/__tests__/" "$SNAP" | while read -r EXPECTED FILE; do
  test -f "$FILE" || { echo "FAIL: frozen test file removed: $FILE"; exit 1; }
  ACTUAL=$(shasum -a 256 "$FILE" | awk '{print $1}')
  if [ "$ACTUAL" != "$EXPECTED" ]; then echo "FAIL: frozen parity test CONTENT changed since P19: $FILE"; exit 1; fi
done
echo "Frozen parity tests verified unchanged (content-hash match against P19 snapshot)."
npx vitest run packages/agents/src/api/__tests__/
npm run typecheck
npm run lint
# Boundary: no deep imports anywhere in the parity files (BLOCKING)
if grep -rnE "from '[^']*(/src/|core/src|providers/src)" packages/agents/src/api/__tests__/cli-turn-parity.spec.ts packages/agents/src/api/__tests__/config-injection.spec.ts packages/agents/src/api/__tests__/settings-surface.spec.ts; then
  echo "FAIL: deep import in parity harness"; exit 1
fi
# No mock theater (BLOCKING)
if grep -rnE "mockResolvedValue|mockReturnValue|toHaveBeenCalled" packages/agents/src/api/__tests__/cli-turn-parity.spec.ts; then
  echo "FAIL: mock theater in parity harness"; exit 1
fi
```

### Line-by-Line Compliance Table

| Pseudocode lines | Verified at | Matches? |
|---|---|---|
| 10–16 adopt + stream done | config-injection.spec.ts | [ ] |
| 20–25 runtime reuse | config-injection.spec.ts | [ ] |
| 30–34 ownership contrast | config-injection.spec.ts | [ ] |
| 40–51 turn-drive parity | cli-turn-parity.spec.ts | [ ] |
| 60–68 settings parity | settings-surface.spec.ts | [ ] |
| 70–77 property tests | parity + settings | [ ] |
| 80–84 boundary scan | cli-turn-parity.spec.ts | [ ] |

### Semantic Verification Checklist

- [ ] Path A ≡ Path B on public projection; exactly one terminal done each.
- [ ] Settings normalization + invalid-throw parity with real Config.
- [ ] Ownership contrast (fromConfig leaves Config usable; createAgent disposes its own).
- [ ] Boundary scan green; no mock theater; ≥30% property-based.
- [ ] No CLI production source modified; no harness test weakened.

## Holistic Functionality Assessment (MANDATORY — into marker)

### Is the surface adequate for #1595? Demonstrate by tracing one full parity turn (input → tool call → result → single done) through the PUBLIC API only. ### What deep import would #1595 still need, if any? (If any, FAIL and specify the missing seam.) ### Verdict

## Success Criteria

- Adequacy gate passes; compliance table complete; assessment proves #1595 can drive turns + settings
  + client typing through the public surface with zero deep imports.

## Failure Recovery

- Return to Phase 20 (or earlier seam phase) and close the specific missing seam; do not weaken the
  harness.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P20a.md` (include assessment).

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P20a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```


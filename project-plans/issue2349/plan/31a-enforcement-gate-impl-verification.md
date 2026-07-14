# Phase 31a: Enforcement gate IMPL — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P31a`

## Prerequisites
- Required: Phase 31 completed.

Follow `plan/verification-template.md`. Specifics:

## Requirements Implemented (Expanded)
_Verification phase — the requirement blocks below are expressed as gate-level GIVEN/WHEN/THEN that VERIFY the sibling impl phase (full GIVEN/WHEN/THEN, Major 1)._

### REQ-012.1 (full fail-mode gate green on the neutral tree; red on reintroduction)
- **GIVEN:** the P31 gate with all checks (a)-(h) in fail-mode (`--enforce-imports` flipped into the default run), the populated allow-list, and the finalized `--by-file`.
- **WHEN:** `npm run lint:agents-neutral-gate` and `npm test` on the P30 suites run over the neutralized tree.
- **THEN:** all P30 tests pass; the gate exits 0 on the clean tree (only allow-listed hits) and exits non-zero on every P30 reintroduction fixture, naming file+AST context; `--count` prints the bounded-floor integer (== allow-listed hit count). FAIL if a P30 fixture is undetected, a false-positive fires, or the gate cannot reach exit 0 without loosening.

### REQ-012.2 (allow-list authoritative by AST-context; bare file path rejected)
- **GIVEN:** the finalized allow-list matcher and the G3 + `hookWireAdapter.ts` AST-context entries.
- **WHEN:** the verifier runs the fixture where a re-introduced telemetry `toGeminiContents` appears in `streamRequestHelpers.ts` (which HAS a G3 entry) and a generic wire read appears in `hookWireAdapter.ts` OUTSIDE a named function.
- **THEN:** both STILL fail the gate (the file-level presence of an entry does NOT exempt them); an inline `// gate-exempt` comment with no entry also still fails. FAIL if a bare file path is accepted as an exemption key.

### REQ-012.3 (test gate green) + M2 (npm scripts + CI wiring)
- **GIVEN:** `scripts/agents-neutral-test-gate.ts` implemented, the two root `package.json` scripts, and the `.github/workflows/ci.yml` steps.
- **WHEN:** `npm run lint:agents-neutral-test-gate` runs and the verifier greps `package.json`/`ci.yml`.
- **THEN:** the test gate exits 0 on the migrated suite; both `lint:agents-neutral-gate`/`-test-gate` scripts exist and are CI-wired; `npm run lint:eslint-guard` confirms NO lint/complexity loosening and no suppression directive. FAIL on any missing script/CI step or any loosening.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

Run the CONCRETE commands copied from the sibling impl phase (`31-enforcement-gate-impl.md` Verification Commands, Major 2 round 8); PASTE each command's output + exit code into the marker. Do NOT accept checklist prose in lieu of these:
```bash
npm test -- scripts/__tests__/agentsNeutralGate.test.ts scripts/__tests__/agentsNeutralTestGate.test.ts   # ALL pass on the neutral tree
npm run lint:agents-neutral-gate        # run via npm script EXACTLY as CI does -> exit 0
npm run lint:agents-neutral-test-gate   # exit 0
npx tsx scripts/agents-neutral-gate.ts --count   # prints the bounded-floor integer (== allow-listed hit count)
# ---- P31a Major-2 CONCRETE fixtures (run as actual commands, NOT prose) ----
# (1) Allow-list is AST-context, NOT file-level: a re-introduced telemetry toGeminiContents in streamRequestHelpers.ts
#     (which HAS a G3 entry) STILL fails; a generic wire read in hookWireAdapter.ts OUTSIDE a named function STILL fails:
if npx tsx scripts/agents-neutral-gate.ts --files scripts/__tests__/fixtures/reintroduced-blocking-compat.ts; then echo "FAIL: reintroduced Google-shaped helper not flagged (allow-list slot reuse)"; exit 1; fi
# (2) fake-inline-comment: adding a bare `// gate-exempt` to a real hit fixture MUST still fail (inline grants nothing, OQ-17):
tmpf=$(mktemp /tmp/inline-exempt-XXXX.ts); printf '// gate-exempt
import { Content } from "@google/genai";
' > "$tmpf"
if npx tsx scripts/agents-neutral-gate.ts --files "$tmpf"; then echo "FAIL: inline // gate-exempt comment granted an exemption (must grant NOTHING, OQ-17)"; rm -f "$tmpf"; exit 1; fi
rm -f "$tmpf"
# (3) bare-file-path allow-list key MUST be rejected by the matcher (AST-context pattern required):
grep -nE "AST-context|enclosing function|justification" dev-docs/agents-neutral-gate-allowlist.md   # every entry carries an AST-context pattern, not a bare file path
# (4) G3 AST-context entry keyed on context, not bare file path:
grep -nE "streamRequestHelpers|AST-context|enclosing function|file-level" dev-docs/agents-neutral-gate-allowlist.md
# (5) both npm scripts present + CI-wired:
grep -nE '"lint:agents-neutral-(gate|test-gate)"' package.json
grep -nE 'lint:agents-neutral-(gate|test-gate)' .github/workflows/ci.yml
npm run lint:eslint-guard   # exit 0 — NO lint/complexity loosening, no suppression directive added anywhere
npm run typecheck
```
Required pasted output: the `npm test` PASS on the neutral tree, the two `lint:agents-neutral-*` exit-0 results, the `--count` bounded-floor integer, and all three reintroduction/inline-comment/bare-path FAIL-path proofs. FAIL if a P30 fixture is undetected, a false-positive fires, a bare file path is accepted as an exemption key, an inline comment grants an exemption, or the gate cannot reach exit 0 without loosening. Also confirm REQ-007.3 core-owned `ServerUsageMetadataEvent` scope limitation is documented (agents gate cannot enforce it; the CONCRETE P19 core check — production-dead + live-path-neutral — carries that enforcement).

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
PLAN.md §7: run the gate against a deliberately-reintroduced synthetic response and confirm it fails; against the clean tree and confirm it passes. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P31a.md`.

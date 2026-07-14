# Phase 29a: Enforcement gate STUB — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P29a`

## Prerequisites
- Required: Phase 29 completed.

Follow `plan/verification-template.md`. STUB specifics:

## Requirements Implemented (Expanded)
_Verification phase — the requirement blocks below are expressed as gate-level GIVEN/WHEN/THEN that VERIFY the sibling impl phase (full GIVEN/WHEN/THEN, Major 1)._

### REQ-012.1 (surface + Critical-2 non-regression): full check surface compiles; P02-real checks preserved
- **GIVEN:** the P02 skeleton extended by P29 with `checkD`/`checkG-barrel`/`checkH` stub signatures returning `[]`, the P02-real `checkA/B/C/E` + `checkF`/`checkG-call` + `--count`/`--by-file` PRESERVED.
- **WHEN:** the verifier runs `--dry-run`/`--count`, the Critical-2 regression guard (no `return []` in checkA/B/C/E), and `--enforce-imports` against the six P02 fixtures.
- **THEN:** the script compiles and runs; `--count` prints the P02 AST-context integer (not 0); `--enforce-imports` STILL exits non-zero on each negative fixture and 0 on the clean/safe-neutral fixtures; ONLY `checkD`/`checkG-barrel`/`checkH` (and the `checkF`/`checkG-call` HARD-FAIL gate) remain stubbed. FAIL if any P02-real check regressed to `[]` or stopped failing on the negatives.

### REQ-012.2 (allow-list artifact skeleton)
- **GIVEN:** `dev-docs/agents-neutral-gate-allowlist.md` with the file+AST-context+justification format spec.
- **WHEN:** the verifier inspects the artifact format.
- **THEN:** the format requires an AST-context pattern (not a bare file path) and states inline `// gate-exempt` grants nothing (OQ-17). FAIL if the format permits a bare file-level exemption key.

### REQ-012.3 (test-gate skeleton)
- **GIVEN:** the new `scripts/agents-neutral-test-gate.ts` skeleton.
- **WHEN:** the verifier runs it.
- **THEN:** it compiles and runs without crashing; no check asserts `NotYetImplemented`. FAIL if it does not compile/run.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
Run the CONCRETE commands copied from the sibling impl phase (`29-enforcement-gate-stub.md` Verification Commands, Major 2 round 8); PASTE each command's output + exit code into the marker. Do NOT accept checklist prose in lieu of these:
```bash
npx tsx scripts/agents-neutral-gate.ts --dry-run 2>&1 | head        # runs, exit 0 (skeleton)
npx tsx scripts/agents-neutral-gate.ts --count 2>&1 | head          # prints the P02 AST-context integer (NOT 0)
test -f dev-docs/agents-neutral-gate-allowlist.md                   # exit 0
test -f scripts/agents-neutral-test-gate.ts                         # exit 0
grep -nE "checkA|checkB|checkC|checkD|checkE|checkG|checkH" scripts/agents-neutral-gate.ts   # all signatures present
# ---- CRITICAL 2 regression guard: checkA/B/C/E must NOT be re-stubbed to `return []` ----
for fn in checkA_rawGenaiImports checkB_bannedSymbols checkC_contractAliases checkE_enumRedeclarations; do
  if awk "/function $fn|const $fn/{f=1} f&&/return \[\]/{found=1} f&&/^}/{f=0} END{exit found?0:1}" scripts/agents-neutral-gate.ts; then
    echo "FAIL(Critical 2): $fn was regressed to a return [] stub"; exit 1; fi
done
# ---- CRITICAL 2: --enforce-imports STILL red on each P02 negative fixture, green on clean ----
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports scripts/__tests__/fixtures/raw-genai-import.ts;  then echo "FAIL(Critical 2): checkA regressed"; exit 1; fi
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports scripts/__tests__/fixtures/banned-symbol.ts;     then echo "FAIL(Critical 2): checkB regressed"; exit 1; fi
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports scripts/__tests__/fixtures/contract-alias.ts;    then echo "FAIL(Critical 2): checkC regressed"; exit 1; fi
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports scripts/__tests__/fixtures/finishreason-enum.ts; then echo "FAIL(Critical 2): checkE regressed"; exit 1; fi
if ! npx tsx scripts/agents-neutral-gate.ts --enforce-imports scripts/__tests__/fixtures/clean-neutral.ts;   then echo "FAIL(Critical 2): clean fixture now flagged"; exit 1; fi
echo "PASS(Critical 2): P02-real checkA/B/C/E preserved"
# ---- ONLY the deferred checks may be stubs at P29 ----
grep -nE "checkD_roundtripSymbols|checkG_barrelImports|checkH_usageKeys" scripts/agents-neutral-gate.ts   # present (stubbed until P31)
# ---- Allow-list format (file + AST-context pattern + justification; inline comments grant nothing, OQ-17) ----
grep -nE "AST-context|enclosing function|justification|file-level" dev-docs/agents-neutral-gate-allowlist.md   # format requires AST-context, not a bare file path
npm run lint:eslint-guard   # exit 0 (no loosening/suppression)
```
Required pasted output: the `--count` integer (non-zero), the `PASS(Critical 2)` line, all six `--enforce-imports` fixture results, and the deferred-stub grep hits. FAIL if any P02-real check regressed, any command's exit code differs, or the allow-list format permits a bare file-level exemption key.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
Confirm the gate SURFACE is correct and AST-based (not grep). Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P29a.md`.

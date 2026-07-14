# Phase 0.6: Analysis + Pseudocode Immutability Verification (Minor 1)

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P0.6`

> **File↔ID mapping (Minor 1):** This file is `00b-...` and its Phase ID is `P0.6` — mirroring `00a-...` = `P0.5`.
> Runs AFTER P0.5 (preflight) and BEFORE P01. Sequence: 0.5 → 0.6 → 01 … 33 (contiguous, no gaps).

## Purpose
The canonical PLAN.md Phase 01 (analysis) and Phase 02 (pseudocode) for this feature were completed
**OUT-OF-BAND** and are represented by `analysis/domain-model.md` and the nine `analysis/pseudocode/*.md`
files (NOT executable phases). The **P01/P02 phase SLOTS in this plan are REUSED** for two provisioning
gates (P01 = core mutation tooling; P02 = AST-gate skeleton). This phase EXISTS so that no coordinator
concludes the canonical analysis/pseudocode were skipped: it verifies those artifacts are present,
immutable, line-numbered, contract-first, code-free, and cited by the implementation phases that depend
on them. This is a verification/gate phase — it writes NO production code.

## Prerequisites
- Required: Phase 0.5 (preflight) completed and PASS.
- Verification: `test -f project-plans/issue2349/.completed/P0.5.md`
- Expected files from previous phase: `project-plans/issue2349/.completed/P0.5.md` (preflight evidence + any line-number drift updates).
- Preflight verification: Phase 0.5 completed.
- Read `analysis/domain-model.md` + all nine `analysis/pseudocode/*.md`.

## Requirements Implemented (Expanded)

### REQ-PF-003: Out-of-band analysis + pseudocode are present, contract-first, line-numbered, code-free, cited, and frozen
**Full Text**: The out-of-band `analysis/domain-model.md` + nine `analysis/pseudocode/*.md` artifacts (representing the canonical PLAN.md P01/P02 done out-of-band) MUST be verified present, contract-first (PLAN.md §2 mandatory sections), line-numbered, code-free, cited by every pseudocode-mapped implementation phase, and content-hashed (frozen) — so the P01/P02 slot reuse is never mistaken for skipping analysis/pseudocode and so no impl phase runs on missing/edited pseudocode.
**Behavior**:
- GIVEN: analysis + pseudocode were authored out-of-band and later phases cite them via `@pseudocode lines X-Y`.
- WHEN: this phase runs checks A-F below.
- THEN: every artifact is present/contract-first/line-numbered/code-free, every pseudocode-mapped impl phase cites `@pseudocode` lines, and SHA-256 hashes are recorded so any later unrecorded edit to a frozen artifact is caught by re-hashing.
**Why This Matters**: PLAN.md's anti-fraud discipline requires pseudocode to be the blueprint implementation follows line-by-line; a missing, un-numbered, or silently-edited pseudocode file breaks traceability and lets an implementer ignore the blueprint.

### REQ-PF-004: The @pseudocode-presence check covers the FULL mechanically-derived set of pseudocode-mapped impl phases (Critical 2)
**Full Text**: The set of implementation phases that MUST carry `@pseudocode` markers is derived MECHANICALLY from the execution-tracker's phase→pseudocode mapping (the "Pseudocode" column of `kind = impl` rows), NOT a hard-coded subset that can drift; every derived phase MUST contain a `@pseudocode` citation.
**Behavior**:
- GIVEN: `execution-tracker.md` maps each `impl` phase to a pseudocode file in its "Pseudocode" column.
- WHEN: check E derives that set mechanically and greps each derived phase file for `@pseudocode`.
- THEN: every pseudocode-mapped impl phase cites `@pseudocode`; a mapped impl phase with no citation FAILS this phase.
**Why This Matters**: a hard-coded subset silently drifts out of sync when phases are added/renumbered; deriving the set from the tracker guarantees the check never lets a new pseudocode-mapped phase escape the marker requirement.

## Implementation Tasks

> This is a verification/gate phase. Its "tasks" are checks A-F. Run each; paste FRESH output into `.completed/P0.6.md`.

### A. The analysis + all nine pseudocode files EXIST
```bash
test -f project-plans/issue2349/analysis/domain-model.md
ls -1 project-plans/issue2349/analysis/pseudocode/ | sort
# EXPECTED exactly these nine:
#   clientcontract-neutralization.md, directmessageprocessor-neutral.md, enforcement-gate.md,
#   hooktoolrestrictions-neutral.md, messageconverter-neutralization.md, neutral-gap-types.md,
#   stream-processor-neutral.md, turnprocessor-turn-wrap.md, usage-metadata-boundary.md
test "$(ls -1 project-plans/issue2349/analysis/pseudocode/*.md | wc -l | tr -d ' ')" = "9"
```

### B. Every pseudocode file is CONTRACT-FIRST (PLAN.md §2 mandatory sections)
```bash
for f in project-plans/issue2349/analysis/pseudocode/*.md; do
  echo "== $f =="
  grep -qi "Interface Contracts" "$f" && echo "  has Interface Contracts" || echo "  MISSING Interface Contracts"
  grep -qiE "Integration Points|INPUTS|OUTPUTS|DEPENDENCIES" "$f" && echo "  has Integration Points/IO" || echo "  MISSING Integration Points"
  grep -qiE "Anti-Pattern|DO NOT|\[ERROR\]" "$f" && echo "  has Anti-Pattern warnings" || echo "  MISSING Anti-Pattern warnings"
done
```
- EXPECTED: every file reports all three present. A file missing any section FAILS this phase.

### C. Every pseudocode file is LINE-NUMBERED (impl phases cite `@pseudocode lines X-Y`)
```bash
for f in project-plans/issue2349/analysis/pseudocode/*.md; do
  n=$(grep -cE "^[[:space:]]*[0-9]+:" "$f")
  echo "$f numbered-lines=$n"
done
```
- EXPECTED: each file has a numbered algorithm block (`NN: STEP`). Zero numbered lines FAILS.

### D. Pseudocode is CODE-FREE (algorithmic, not TypeScript)
```bash
# Heuristic: no import statements / no `export function ... {` real TS bodies outside fenced contract type sketches.
grep -rnE "^\s*import .* from '|^\s*export (async )?function .*\{\s*$" project-plans/issue2349/analysis/pseudocode/*.md
# EXPECTED: no real TS import/impl lines (contract TYPE sketches in ``` blocks are allowed; executable bodies are not).
```
- EXPECTED: no executable TypeScript bodies. Interface/type sketches in contract blocks are permitted; a full method BODY in TS is not.

### E. Every pseudocode-mapped impl phase CITES `@pseudocode` — set DERIVED MECHANICALLY from the tracker (Critical 2 / REQ-PF-004)
```bash
# Derive the FULL set of pseudocode-mapped impl phases from execution-tracker.md — do NOT hard-code it.
# A row qualifies when Kind == "impl" AND its Pseudocode column is not "—".
# execution-tracker.md rows are pipe-delimited: | Phase | ID | Kind | Purpose | Pseudocode | Status | Verified | Semantic? |
TRACKER=project-plans/issue2349/plan/execution-tracker.md
# With awk -F'|' and the leading '|', fields are: $2=Phase, $3=ID, $4=Kind, $5=Purpose, $6=Pseudocode.
MAPPED_PHASES=$(awk -F'|' '
  /^\| *[0-9]/ {
    kind=$4; gsub(/^ +| +$/,"",kind);
    pseudo=$6; gsub(/^ +| +$/,"",pseudo);
    id=$3; gsub(/^ +| +$/,"",id);          # e.g. P07
    if (kind=="impl" && pseudo!="" && pseudo!="—") {
      num=id; sub(/^P/,"",num);            # e.g. 07
      print num;
    }
  }' "$TRACKER" | sort -u)
echo "MECHANICALLY-DERIVED pseudocode-mapped impl phases: $MAPPED_PHASES"
# EXPECTED (cross-check, MUST equal the derived set — if the tracker changes, this list follows automatically):
#   05 07 08 09 11 13 15 17 19 21 31
# Now assert EACH derived phase file contains a @pseudocode citation:
MISSING=""
for num in $MAPPED_PHASES; do
  f=$(ls project-plans/issue2349/plan/${num}-*.md 2>/dev/null | grep -v -- '-verification.md' | head -1)
  if [ -z "$f" ]; then echo "  P${num}: PHASE FILE NOT FOUND"; MISSING="$MISSING P${num}"; continue; fi
  if grep -q "@pseudocode" "$f"; then echo "  P${num} ($f): cites @pseudocode"; else echo "  P${num} ($f): MISSING @pseudocode"; MISSING="$MISSING P${num}"; fi
done
[ -z "$MISSING" ] && echo "all mapped impl phases cite @pseudocode" || echo "FAIL: missing @pseudocode in:$MISSING"
```
- EXPECTED: the derived set equals `05 07 08 09 11 13 15 17 19 21 31` (P02/P29 are the AST-gate skeleton/stub slots and are covered by P31's `@pseudocode` when they extend the same script; the enforcement-gate pseudocode is cited by P31). EVERY derived phase MUST print "cites @pseudocode". A mapped impl phase with no `@pseudocode` citation FAILS this phase. Because the set is derived from the tracker, adding/renumbering a pseudocode-mapped impl phase later automatically extends this check — no hard-coded list to drift (REQ-PF-004).

### F. Immutability record (freeze evidence)
```bash
# Record a content hash of each artifact so later phases can prove the analysis/pseudocode were NOT edited
# mid-migration (they are INPUTS, frozen after P0.6).
shasum -a 256 project-plans/issue2349/analysis/domain-model.md project-plans/issue2349/analysis/pseudocode/*.md
```
- The FRESH hashes are pasted into `.completed/P0.6.md`. Any later phase that needs to change a pseudocode
  file (e.g. the P0.5 note that `neutral-gap-types.md` lines 70-82 may be updated after the DTO decision,
  or a documented drift fix) MUST record the change + new hash in its own marker; an UNRECORDED change to a
  frozen artifact is a process violation caught by re-hashing here.

## Verification Commands
```bash
# Re-run checks A-F and confirm the marker captured them.
test -f project-plans/issue2349/.completed/P0.6.md || echo "FAIL: P0.6 marker missing"
grep -qE "numbered-lines=" project-plans/issue2349/.completed/P0.6.md || echo "FAIL: marker lacks line-number evidence (check C)"
grep -qE "cites @pseudocode|MISSING @pseudocode" project-plans/issue2349/.completed/P0.6.md || echo "FAIL: marker lacks the derived @pseudocode-presence evidence (check E)"
grep -qE "[0-9a-f]{64}" project-plans/issue2349/.completed/P0.6.md || echo "FAIL: marker lacks SHA-256 freeze hashes (check F)"
```

## Success Criteria
- All nine pseudocode files + domain-model present, contract-first, line-numbered, code-free.
- Every MECHANICALLY-DERIVED pseudocode-mapped impl phase (from the tracker) cites its pseudocode `@pseudocode` lines (REQ-PF-004) — the derived set is recorded in the marker so drift is impossible.
- Content hashes recorded in `.completed/P0.6.md` (immutability baseline).
- The P01/P02 slot-reuse is explicitly documented (this phase's Purpose) so no coordinator believes canonical analysis/pseudocode were skipped.

## Failure Recovery
- Missing/!contract-first/!numbered artifact → STOP; the analysis/pseudocode must be corrected (out-of-band, by the analysis author) before any production phase; re-run P0.6.
- Impl phase missing a `@pseudocode` citation (per the mechanically-derived set in check E) → update that phase file to cite the correct lines before it runs; do NOT edit the derivation to exclude it.
- Frozen artifact hash mismatch later → the artifact was edited without recording; STOP and reconcile (record the change + new hash, or revert).
- NEVER proceed to Phase 01 until P0.6 is green.

## Phase Completion Marker
Create: `project-plans/issue2349/.completed/P0.6.md` containing the FRESH pasted output of A-F (incl. the mechanically-derived phase list from E and the SHA-256 hashes from F), not prose restatements.

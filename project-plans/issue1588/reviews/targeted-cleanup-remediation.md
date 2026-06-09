# Targeted Cleanup Remediation: Boundary Script Invocation, Stale Wording, and Adapter Description Consistency

## Summary

This remediation addresses three blocking issues identified by the targeted cleanup verification. No production source code was modified — only plan artifacts under `project-plans/issue1588/`.

## Issues Addressed

### 1. `scripts/check-settings-boundary.js` not invoked in P08/P09/P10 plan execution commands

**Problem**: The boundary verification script (`scripts/check-settings-boundary.js`) is the authoritative enforcement mechanism per `analysis/boundary-verification-script.md`, but P08/P09/P10 verification phases did not actually invoke it. They relied solely on inline grep/rg snippets that could drift from the script's logic.

**Resolution**: Added explicit `node scripts/check-settings-boundary.js` invocations as the primary enforcement step in the verification commands section of each affected file. Inline scans are now explicitly documented as supplemental. Each invocation includes the appropriate `--phase` flag where applicable (e.g., `--phase post-p09` for P09/P09a/P10/P10a).

**Files modified**:
- `plan/08-consumer-migration-impl.md` — Added authoritative boundary check call before supplemental inline scans in Verification Commands.
- `plan/08a-consumer-migration-impl-verification.md` — Added authoritative boundary check call before supplemental inline scans.
- `plan/09-cleanup-no-shims.md` — Added authoritative boundary check call with `--phase post-p09` before supplemental inline scans.
- `plan/09a-cleanup-no-shims-verification.md` — Added authoritative boundary check call with `--phase post-p09` before supplemental inline scans.
- `plan/10-full-verification.md` — Added authoritative boundary check call with `--phase post-p09` before supplemental inline scans.
- `plan/10a-final-semantic-review.md` — Added authoritative boundary check call with `--phase post-p09` before supplemental inline scans.

### 2. Execution tracker stale P03b blast-radius wording

**Problem**: `execution-tracker.md` phase table still described P03b as "Minimal Adapter/Config Wiring (with Blast-Radius Gate)" and P03c as "Minimal adapter wiring verification". These descriptions reference the old blast-radius gate concept that was removed in the targeted cleanup (the P03b adapter is now transparent/no-op, not a throwing blast-radius gate).

**Resolution**: Updated P03b description to "Transparent No-Op Adapter and Config Wiring (no production code changes)" and P03c to "Transparent no-op adapter verification", consistent with the P03b plan revision that removed the blast-radius gate and clarified the adapter as a compile-only transparent pass-through.

**Files modified**:
- `execution-tracker.md` — P03b and P03c phase descriptions updated.

### 3. P05a stale "NotYetImplemented stub" wording for P03b adapter

**Problem**: `plan/05a-settings-package-impl-verification.md` still described the P03b adapter as a "NotYetImplemented stub" and stated that the P04b test "throws NotYetImplemented". This contradicts the targeted cleanup resolution, which established that the P03b adapter is a transparent no-op (pass-through), not a throwing stub. The P04b test targets the adapter contract directly regardless.

**Resolution**: Updated the P05a note and checklist item to consistently describe the P03b adapter as "a transparent no-op" and explain that the pass gate deferral is because the adapter has no behavioral wiring yet (producing false-positive/results rather than testing genuine settings behavior through the adapter path).

**Files modified**:
- `plan/05a-settings-package-impl-verification.md` — Replaced "NotYetImplemented stub" / "throws NotYetImplemented" / "false-negative" wording with "transparent no-op" / "no behavioral wiring yet" / "false-positive or false-negative" wording.
# Revision 05: Addressing Review-05

Review: `project-plans/issue1588/reviews/review-05.md`
Verdict: FAIL → Revised for re-review

## Material Issues Addressed

### M1: P04b/P05a/P06a/P08 sequencing inconsistency

**Problem**: P04b vertical-slice tests that require consumer migration were being used as pass gates before P08.

**Fix**: The plan already deferred provider/CLI vertical-slice tests to P07 (from revision-04). This revision makes the timeline fully explicit:
- Updated `plan/00-overview.md` P04b pass gates description to specify core-only tests are pass gates in P05a/P06a, while provider/CLI tests from P07 are pass gates in P08a only.
- Updated `analysis/phase-verification-matrix.md` P04b row to say "FOR CORE ONLY" and "provider/CLI integration tests do NOT exist yet (deferred to P07)".
- Updated P05a row to say "core" integration test rerun and "provider/CLI tests still deferred to P07".
- Updated P06a row to say "core" integration test rerun.
- Updated P08a row to specify core (from P04b) and provider/CLI (from P07) pass gates separately.
- Updated `execution-tracker.md` to reflect core-only P04b and provider/CLI in P07.

**Files changed**: `plan/00-overview.md`, `analysis/phase-verification-matrix.md`, `execution-tracker.md`

### M2: CLI workspace-relative test command paths

**Problem**: Review asserted CLI test commands used `packages/cli/src/__tests__/settings-integration` under `--workspace @vybestack/llxprt-code`.

**Finding**: All CLI workspace test commands in the plan ALREADY use workspace-relative paths (`src/__tests__/settings-integration`). The `packages/cli/src/__tests__/settings-integration` references in the plan are file *location* paths on disk (not command arguments), which is correct.

**Fix**: No command path changes needed. Added explicit verification in `analysis/phase-verification-matrix.md` P04b row that test commands use workspace-relative paths (`src/__tests__/settings-integration`, not `packages/core/src/...`).

**Files changed**: `analysis/phase-verification-matrix.md`

### M3: CLI Vitest root/subpath aliases for settings

**Problem**: P03b did not specify CLI vitest alias entries with sufficient detail.

**Fix**: Updated `plan/03b-minimal-adapter-wiring.md` to:
- Specify CLI vitest config must have settings root AND subpath alias entries.
- Include CLI alias verification command confirming settings resolves to source, not stale dist.
- Updated semantic verification checklist to require CLI vitest alias entries and verification.

Updated `analysis/package-metadata-constraints.md` to specify exact CLI vitest alias entries and when they must be added (P03b).

Updated `analysis/phase-verification-matrix.md` P03b row to require CLI vitest alias verification.

**Files changed**: `plan/03b-minimal-adapter-wiring.md`, `analysis/package-metadata-constraints.md`, `analysis/phase-verification-matrix.md`

### M4: Lifecycle wording — settingsRuntimeAdapter sole owner

**Problem**: Some checklist language implied runtime context activation/clearing calls settings helpers, contradicting the single-owner adapter design.

**Fix**: Rewrote lifecycle wording in:
- `plan/06-core-integration-stub.md`: Clarified `settingsRuntimeAdapter.ts` is sole owner that calls BOTH runtime-context helpers AND settings singleton helpers. `providerRuntimeContext.ts` manages context state only and stays settings-agnostic.
- `analysis/final-architecture.md`: Updated single-owner resolution to say `providerRuntimeContext.ts` manages context state only (does NOT call settings functions). `settingsRuntimeAdapter.ts` calls both.
- `analysis/integration-contract.md`: Updated IC-02 to say context functions manage state only; adapter handles settings sync.
- `analysis/phase-verification-matrix.md` P06a row: Added lifecycle wording verification requirement.

**Files changed**: `plan/06-core-integration-stub.md`, `analysis/final-architecture.md`, `analysis/integration-contract.md`, `analysis/phase-verification-matrix.md`

### M5: Expected-failing TDD output assertions

**Problem**: P04b TDD verification did not clearly capture/inspect expected failures to prove they are behavioral (not module resolution).

**Fix**: Enhanced expected-failure output assertions in:
- `plan/04b-vertical-slice-integration-tdd.md`: Added exit code capture, explicit "NO module resolution errors" and "behavioral failures ARE present" assertions with clear guidance to return to P03b if module resolution errors appear.
- `plan/04b-vertical-slice-integration-tdd-verification.md`: Added "settings" to behavioral grep pattern, added "expected TDD red" annotation.
- `analysis/phase-verification-matrix.md` P04b row: Added expected-failure output assertion requirements.

**Files changed**: `plan/04b-vertical-slice-integration-tdd.md`, `plan/04b-vertical-slice-integration-tdd-verification.md`, `analysis/phase-verification-matrix.md`

### M6: Call-site migration matrix marked as lifecycle-only; full import inventory

**Problem**: Call-site matrix could mislead implementers into thinking it was the full migration inventory.

**Fix**: Updated `analysis/call-site-migration-matrix.md`:
- Made scope heading more prominent with WARNING emphasis.
- Added "Why This Distinction Matters" section explaining the 68-site lifecycle matrix vs. the much larger full import surface.
- Added concrete scan commands for the full import inventory (root-barrel, deep-path, type, mock, dynamic, per-workspace).
- Updated `plan/00-overview.md` import inventory refresh note to clarify the call-site matrix is lifecycle-only.
- Updated `execution-tracker.md` to require full import inventory before P08 and matrix marked as lifecycle-only.

**Files changed**: `analysis/call-site-migration-matrix.md`, `plan/00-overview.md`, `execution-tracker.md`

### M7: TypeScript/Vitest path alias standardization

**Problem**: P03 had inconsistent tsconfig path alias targets — core used `../settings/index.ts` but providers used `../settings/src`.

**Fix**: Standardized to one strategy matching package entrypoint behavior:
- Root alias resolves to `../settings/index.ts` (source entrypoint file).
- Subpath alias resolves to `../settings/src/*`.
- This matches core's self-reference convention (`"@vybestack/llxprt-code-core": ["./index.ts"]`).

Updated in:
- `plan/03b-minimal-adapter-wiring.md`: Added "Standardized TypeScript Path Alias Strategy" section. Updated all three package alias entries to use `index.ts`. Updated verification commands to verify root alias resolves to `index.ts`.
- `analysis/package-metadata-constraints.md`: Updated providers, core, and CLI tsconfig alias sections with standardized entries and explicit justification.
- `plan/00-overview.md`: Added TypeScript/Vitest path alias strategy to key behavioral contracts.
- `execution-tracker.md`: Added standardized alias strategy marker.

**Files changed**: `plan/03b-minimal-adapter-wiring.md`, `analysis/package-metadata-constraints.md`, `plan/00-overview.md`, `execution-tracker.md`

### M8: Root build ordering/project orchestration

**Problem**: Plan did not verify that settings builds before consumers importing it.

**Fix**:
- `plan/03-decoupling-stub.md`: Added section "6a. Root Build Ordering Verification" with explicit commands to verify settings builds independently and root build succeeds.
- `analysis/package-metadata-constraints.md`: Added "Root Build Ordering Verification" section with commands to verify build ordering, check root build script, and scan for hard-coded package lists.
- `plan/03b-minimal-adapter-wiring.md`: Added build ordering check to verification commands.
- `plan/00-overview.md`: Added build ordering to key behavioral contracts.
- `execution-tracker.md`: Added root build ordering marker.

**Files changed**: `plan/03-decoupling-stub.md`, `analysis/package-metadata-constraints.md`, `plan/03b-minimal-adapter-wiring.md`, `plan/00-overview.md`, `execution-tracker.md`

## Pedantic Issues Addressed

### P1: Empty test directories not tracked by git

**Fix**: Updated `plan/03-decoupling-stub.md` to say directories are created only when test files are added in P04. Do NOT use `.gitkeep`. Updated `analysis/phase-verification-matrix.md` P03 row.

**Files changed**: `plan/03-decoupling-stub.md`, `analysis/phase-verification-matrix.md`

### P2: rg glob style `--glob '*.ts(x)?'`

**Fix**: Replaced all occurrences of `--glob '*.ts(x)?'` with `--glob '*.ts' --glob '*.tsx'` throughout plan and analysis files. This is more explicit and guaranteed to work across ripgrep versions.

**Files changed**: `plan/05a-settings-package-impl-verification.md`, `plan/05-settings-package-impl.md`, `analysis/phase-verification-matrix.md`, `analysis/package-metadata-constraints.md`

### P3: Zero-match rg commands exit nonzero

**Fix**: Added `|| true` suffix to rg commands that are expected to return zero matches in scripted phase execution. This prevents false-negative phase failures when grep returns exit code 1 for no matches.

**Files changed**: `plan/03b-minimal-adapter-wiring.md`, `plan/04b-vertical-slice-integration-tdd-verification.md`, `plan/05-settings-package-impl.md`, `analysis/phase-verification-matrix.md`, `analysis/dependency-audit.md`, `analysis/anti-shim-policy.md`

### P4: Explicit P03b/P04b ordering

**Fix**: The execution model in `plan/00-overview.md` already states "Execute phases sequentially." The sequencing design decision table in `plan/04b-vertical-slice-integration-tdd.md` makes the P03b→P04b ordering explicit. No additional changes needed beyond what was already present.

### P5: Built runtime import verification after full root build

**Fix**: Updated `plan/05a-settings-package-impl-verification.md` to run `npm run build` (full root build) BEFORE the ESM dynamic import verification. Updated `analysis/phase-verification-matrix.md` P05 and P05a rows to specify "must run AFTER full `npm run build` from root, not only settings package build".

**Files changed**: `plan/05a-settings-package-impl-verification.md`, `analysis/phase-verification-matrix.md`

### P6: Real temp filesystem tests for profile/storage

**Fix**: Updated `plan/05-settings-package-impl.md` semantic checklist to explicitly require "real temp filesystem directories and environment overrides (e.g., `os.tmpdir()`, `HOME` override), not mock-only filesystem tests." Updated `analysis/phase-verification-matrix.md` P05 row.

**Files changed**: `plan/05-settings-package-impl.md`, `analysis/phase-verification-matrix.md`

### P7: Format git status/diffs recording

**Fix**: Updated `plan/10-full-verification.md` to include `git status --short` and `git diff --stat` commands after `npm run format`. Updated semantic checklist to require recording format result. Updated `analysis/phase-verification-matrix.md` P10 row. Updated `analysis/pseudocode/verification.md` to add step 20a. Updated `execution-tracker.md`.

**Files changed**: `plan/10-full-verification.md`, `analysis/phase-verification-matrix.md`, `analysis/pseudocode/verification.md`, `execution-tracker.md`

## Summary of Files Modified

| File | Issues Addressed |
|------|-----------------|
| `plan/00-overview.md` | M1, M6, M7, M8 |
| `plan/03-decoupling-stub.md` | P1, M8 |
| `plan/03b-minimal-adapter-wiring.md` | M3, M7, M8, P2, P3 |
| `plan/04b-vertical-slice-integration-tdd.md` | M5 |
| `plan/04b-vertical-slice-integration-tdd-verification.md` | M5, P2, P3 |
| `plan/05-settings-package-impl.md` | P2, P3, P6 |
| `plan/05a-settings-package-impl-verification.md` | M8, P2, P5 |
| `plan/06-core-integration-stub.md` | M4 |
| `plan/10-full-verification.md` | P7 |
| `analysis/call-site-migration-matrix.md` | M6 |
| `analysis/final-architecture.md` | M4 |
| `analysis/integration-contract.md` | M4 |
| `analysis/phase-verification-matrix.md` | M1, M2, M3, M5, M7, M8, P1, P2, P3, P5, P6, P7 |
| `analysis/package-metadata-constraints.md` | M3, M7, M8, P2 |
| `analysis/dependency-audit.md` | P3 |
| `analysis/anti-shim-policy.md` | P3 |
| `analysis/pseudocode/verification.md` | P6, P7 |
| `execution-tracker.md` | M1, M6, M7, M8, P7 |

# Phase 09 Remediation: Move-Map Defects and Validation Strengthening

**Phase ID**: PLAN-20260603-ISSUE1584.P09 (remediation)
**Requirement**: REQ-PKG-001
**Completed**: 2026-06-05

## P09a Verification Failures

P09a verification identified three defects in the P09 artifacts:

1. **Duplicate row number 198 in move map**: The openai-responses section ended at entry 198, and the openai-vercel section also started at entry 198, creating a duplicate. This meant the total row numbers spanned 1–250 with 198 appearing twice and 251 missing.

2. **Incorrect destination for entry 148**: Source path `packages/core/src/providers/openai/schemaConverter.issue1844.test.ts` was mapped to `packages/providers/src/openai/schemaSchemaConverter.issue1844.test.ts` (note erroneous `Schema` inserted before `Converter`). The correct deterministic destination is `packages/providers/src/openai/schemaConverter.issue1844.test.ts`.

3. **Insufficient move-map validation tests**: The original `move-map-validation.test.ts` performed only substring-based coverage checks. It could not detect duplicate row numbers, missing row numbers, or incorrect destination path transformations because it relied on `includes()` rather than parsing the markdown table structure.

## Fixes Applied

### Fix 1: Duplicate Row Number 198 / Missing Row 251

**File**: `project-plans/issue1584/analysis/provider-move-map-detailed.md`

- Entry 198 appeared twice: once for `openai-responses/__tests__/OpenAIResponsesProvider.toolIdNormalization.test.ts` (correct) and once for `openai-vercel/OpenAIVercelProvider.ts` (incorrect duplicate).
- Renumbered all entries from the second 198 (openai-vercel section) through the end of the table by adding +1 to each row number.
- Result: entry 198 is unique (openai-responses `toolIdNormalization`), entries 199–216 cover openai-vercel, and the final entry is 251 (`utils/userMemory.ts`).
- Verified with `python3`: 251 unique row numbers, no duplicates, no gaps in 1..251.

### Fix 2: Incorrect Destination for Entry 148

**File**: `project-plans/issue1584/analysis/provider-move-map-detailed.md`

- Changed destination from `packages/providers/src/openai/schemaSchemaConverter.issue1844.test.ts` to `packages/providers/src/openai/schemaConverter.issue1844.test.ts`.
- The source file is `schemaConverter.issue1844.test.ts`, so the deterministic transform (strip `packages/core/src/providers/`, prepend `packages/providers/src/`) must preserve the filename exactly.
- Verified with `python3`: all 251 destination paths are now the deterministic transform of their source paths.

### Fix 3: Strengthened Move-Map Validation Tests

**File**: `packages/providers/src/move-map-validation.test.ts`

Added two new test cases and enhanced one existing test:

1. **`move map row numbers are unique and sequential 1..251`** — Parses all markdown table rows using a regex (`MOVE_MAP_ROW_REGEX`), extracts row numbers, verifies:
   - Total count = 251
   - All row numbers are unique (no duplicate like the original 198)
   - Row numbers are exactly the set {1, 2, …, 251} (no gaps, no missing 251)

2. **`move map destinations are deterministic transforms of source paths`** — Parses all rows, computes expected destination by replacing `packages/core/src/providers/` with `packages/providers/src/` in each source path, and asserts every destination matches. This catches errors like `schemaSchemaConverter` where the destination deviated from the source filename.

3. **Enhanced `move map covers every inventory file`** — Changed from substring-based (`includes()`) check to parsing table rows and matching by exact source path. This eliminates false positives where a partial substring match could obscure a missing entry.

Also added:
- `MOVE_MAP_ROW_REGEX` constant for structured table row parsing
- `parseMoveMapRows()` helper function
- `@plan:PLAN-20260603-ISSUE1584.P09` / `@requirement:REQ-PKG-001` markers on new tests
- ESLint suppression for regex safety (bounded pattern, no catastrophic backtracking risk)
- `toStrictEqual()` per lint rule preference

Test count increased from 18 to 20.

## Verification Outputs

### Provider Tests (49 passing: 20 move-map-validation + 29 package-boundary)
```
> @vybestack/llxprt-code-providers@0.10.0 test
> vitest run

 [OK] src/move-map-validation.test.ts (20 tests) 41ms
 [OK] src/package-boundary.test.ts (29 tests) 47ms

 Test Files  2 passed (2)
      Tests  49 passed (49)
   Duration  203ms
```

### Provider Typecheck
```
> @vybestack/llxprt-code-providers@0.10.0 typecheck
> tsc --noEmit
(exit 0)
```

### Provider Build
```
> @vybestack/llxprt-code-providers@0.10.0 build
> node ../../scripts/build_package.js
Successfully copied files.
(exit 0)
```

### Provider Lint
```
> @vybestack/llxprt-code-providers@0.10.0 lint
> eslint . --ext .ts,.tsx
(exit 0, no errors)
```

### Core Typecheck (regression)
```
> @vybestack/llxprt-code-core@0.10.0 typecheck
> tsc --noEmit
(exit 0)
```

### Format (idempotent)
```
> npm run format
(exit 0, formatted files)
```

### Move Map Integrity Verification
```python
# Row number check: 251 unique row numbers, 1..251, no duplicates, no gaps
# Destination transform check: all 251 destinations match deterministic rule
# Entry 148 check: destination is now `schemaConverter.issue1844.test.ts` (correct)
# No `schemaSchemaConverter` found in move map
```

## Semantic Assessment

This remediation corrects data integrity defects in the P09 planning artifacts. No provider files were moved, no CLI imports were updated, and no core re-exports were changed. The providers package still exports an empty scaffold. The move map now has exactly 251 unique sequential row numbers (1–251) with deterministic destinations, and the validation tests can programmatically catch duplicates, gaps, and destination mismatches.

**Why this matters**: The move map is the authoritative reference for P11 file migration. A duplicate row number or incorrect destination would cause files to be mis-routed during migration. The strengthened tests will fail-fast on any future edits to the move map that introduce such defects.

**No behavioral changes**: No production code was modified. Only the markdown planning document and a test file were changed.

## No-Shim Assessment

- No compatibility wrapper files were introduced
- No `V2`/`Compat`/`New`/`Copy` suffixed types exist (verified by existing test)
- No core re-export shims from providers package (pre-migration state preserved)
- The providers package exports only an empty scaffold `src/index.ts`
- The `move-map-validation.test.ts` changes are test-only (migration readiness guards)
- Core's existing provider files remain untouched in `packages/core/src/providers/`
- No core → providers production dependency created

## P09 Remediation Code Markers

- `packages/providers/src/move-map-validation.test.ts` — `@plan:PLAN-20260603-ISSUE1584.P09`, `@requirement:REQ-PKG-001` (20 test markers, including 2 new + 1 enhanced)

## .llxprt Provenance

- Phase executed by LLxprt Code (glm-5.1) in accordance with `project-plans/issue1584/plan/09-provider-move-stub.md`
- Analysis documents referenced: `analysis/provider-move-map-detailed.md`, `analysis/provider-move-map.md`, `analysis/provider-file-inventory.txt`
- No `.llxprt/` directory was modified or deleted
- Generated build/test artifacts left in place per project conventions
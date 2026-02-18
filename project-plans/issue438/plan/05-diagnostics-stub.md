# Phase 05: Diagnostics Formatting Stub

## Phase ID
`PLAN-20250212-LSP.P05`

## Prerequisites
- Required: Phase 04a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P04" packages/lsp/src/service/language-map.ts`
- Expected files: Complete language-map.ts implementation
- Preflight verification: Phase 00a completed

## Requirements Implemented (Expanded)

This stub phase creates the skeleton for diagnostic formatting functions. No behavior yet.

### REQ-FMT-010 through REQ-FMT-090 (stub scaffolding)
**Full Text**: Diagnostic formatting requirements covering line format, XML tags, ordering, escaping, caps, severity filtering, deduplication, 0→1 based conversion, and deterministic ordering.

**CRITICAL DESIGN NOTE (REQ-FMT-068)**: The cap ordering logic (severity filter → per-file cap → total multi-file line cap, overflow suffix excluded from total) MUST be implemented as a single pure function in `diagnostics.ts` — specifically within `formatMultiFileDiagnostics()`. This logic MUST NOT be duplicated in the write tool or any other consumer. The write tool (P32) and edit tool (P31) MUST call this shared function rather than reimplementing the cap logic inline. This is enforced to prevent cap ordering bugs from divergent implementations.

**Behavior** (not yet implemented — stubs only):
- GIVEN: Raw LSP diagnostics
- WHEN: Formatting functions are called
- THEN: Stubs throw NotYetImplemented or return empty values

## Implementation Tasks

### Files to Modify

- `packages/lsp/src/service/diagnostics.ts`
  - MODIFY: Replace minimal stub with typed function signatures
  - MUST include: `@plan:PLAN-20250212-LSP.P05`
  - Export functions matching pseudocode diagnostics.md:
    - `escapeXml(text: string): string` — returns '' (stub)
    - `mapSeverity(lspSeverity: number): string` — returns '' (stub)
    - `normalizeLspDiagnostic(raw, file, workspaceRoot): Diagnostic` — throws NotYetImplemented
    - `deduplicateDiagnostics(diagnostics): Diagnostic[]` — returns [] (stub)
    - `filterBySeverity(diagnostics, severities): Diagnostic[]` — returns [] (stub)
    - `formatDiagnosticLine(diagnostic): string` — returns '' (stub)
    - `formatSingleFileDiagnostics(file, diagnostics, config): string` — returns '' (stub)
    - `formatMultiFileDiagnostics(writtenFile, allDiagnostics, config): string` — returns '' (stub)
  - All function signatures MUST have correct TypeScript types (no `any`)
  - Maximum 100 lines total

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P05
 * @pseudocode diagnostics.md lines 01-120
 */
```

## Verification Commands

### Automated Checks

```bash
# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P05" packages/lsp/ | wc -l
# Expected: 1+

# TypeScript compiles
cd packages/lsp && bunx tsc --noEmit
# Expected: Success

# Under 100 lines
wc -l packages/lsp/src/service/diagnostics.ts
# Expected: <= 100

# No TODO comments
grep -rn "TODO" packages/lsp/src/service/diagnostics.ts
# Expected: No output

# Exports exist
grep -c "export function" packages/lsp/src/service/diagnostics.ts
# Expected: 8
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Stubs may throw NotYetImplemented or return empty — that's expected for stub phase.
# But no TODO/FIXME/HACK comments should exist:
grep -rn -E "(TODO|FIXME|HACK|XXX|WIP)" packages/lsp/src/service/diagnostics.ts
# Expected: No matches

# No cop-out comments:
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/lsp/src/service/diagnostics.ts
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/lsp/src/service/diagnostics.ts | grep -v ".test.ts"
# Expected: For stub phases, empty returns ARE expected (stubs return empty/throw NotYetImplemented by design).
# This check is for awareness — confirms stubs are minimal. In the impl phase (P07/P08), these should be gone.
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do all function signatures match pseudocode?** — Compare each signature with diagnostics.md lines 01-120
   - [ ] escapeXml, mapSeverity, normalizeLspDiagnostic, deduplicateDiagnostics
   - [ ] filterBySeverity, formatDiagnosticLine, formatSingleFileDiagnostics, formatMultiFileDiagnostics
2. **Are return types correct?** — No `any`, proper types for every parameter and return
   - [ ] Verified no `any` types via grep
3. **Does it compile?** — TypeScript --noEmit passes
   - [ ] Confirmed
4. **Are stubs minimal?** — Under 100 lines, no implementation logic
   - [ ] Line count verified
5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] Full implementation is deferred to the impl phase (P07/P08) — this is by design
   - [ ] [List any unexpected gaps]

#### Feature Actually Works

```bash
# Stub phase — verify stubs compile and are importable:
cd packages/lsp && bunx tsc --noEmit
# Expected: Clean compilation, no errors
```

#### Integration Points Verified
- [ ] diagnostics.ts exports all 8 functions (verified by grep for `export function`)
- [ ] Types used (Diagnostic, LspConfig) match types.ts definitions
- [ ] Functions can be imported by test files (compilation check)

#### Lifecycle Verified
- [ ] All functions are pure (no state, no constructors, no cleanup needed)
- [ ] No async operations in stubs (no unresolved promises)

#### Edge Cases Verified
- [ ] Not applicable for stub phase — edge cases tested in P07/P08

## Success Criteria
- 8 exported functions with correct signatures
- Compiles with strict TypeScript
- Under 100 lines
- No TODO comments
- All function signatures match pseudocode diagnostics.md

## Failure Recovery
1. `git checkout -- packages/lsp/src/service/diagnostics.ts`
2. Re-run Phase 05

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P05.md`

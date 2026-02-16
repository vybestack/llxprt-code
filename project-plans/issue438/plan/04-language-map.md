# Phase 04: Language Map (Pure Data — Stub + Implementation Combined)

## Phase ID
`PLAN-20250212-LSP.P04`

## Prerequisites
- Required: Phase 03a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P03" packages/lsp/src/service/language-map.ts`
- Expected files: `packages/lsp/src/service/language-map.ts` (stub from Phase 03)
- Preflight verification: Phase 00a MUST be completed

## Requirements Implemented (Expanded)

### REQ-LANG-010: Extensible Language Mapping
**Full Text**: The system shall provide an extensible language mapping and server registry architecture that supports any language for which an LSP server exists, through built-in or user-defined server configurations, using file extension–to–LSP language ID mapping.
**Behavior**:
- GIVEN: A file with extension ".ts"
- WHEN: The system looks up the LSP languageId
- THEN: Returns "typescript"
- GIVEN: A file with extension ".unknown"
- WHEN: The system looks up the LSP languageId
- THEN: Returns undefined
**Why This Matters**: Language mapping is the fundamental lookup that determines which LSP server handles which file. Without it, no diagnostics.

## Implementation Tasks

### Files to Modify

- `packages/lsp/src/service/language-map.ts`
  - MODIFY: Replace stub with complete ReadonlyMap implementation
  - MUST include: `@plan:PLAN-20250212-LSP.P04`
  - MUST include: `@requirement:REQ-LANG-010`
  - MUST include: `@pseudocode:language-map.md lines 01-62`
  - Implements: Extension-to-languageId mapping from pseudocode
  - MUST export: `getLanguageId(extension: string): string | undefined`
  - MUST export: `getExtensionsForLanguage(languageId: string): readonly string[]`

### Files to Create

- `packages/lsp/test/language-map.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P04`
  - MUST include: `@requirement:REQ-LANG-010`
  - Tests: All common extensions return correct languageId
  - Tests: Unknown extensions return undefined
  - Tests: getExtensionsForLanguage returns correct extensions
  - Tests: Map is immutable (ReadonlyMap)
  - Property-based: Any string not in the map returns undefined
  - MUST have 30%+ property-based tests

### Required Code Markers

Every function/file created in this phase MUST include:
```typescript
/**
 * @plan PLAN-20250212-LSP.P04
 * @requirement REQ-LANG-010
 * @pseudocode language-map.md lines 01-82
 */
```

## Verification Commands

### Automated Checks

```bash
# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P04" packages/lsp/ | wc -l
# Expected: 2+ occurrences

# Tests exist and pass
cd packages/lsp && bunx vitest run test/language-map.test.ts
# Expected: All pass

# Property-based test percentage
TOTAL=$(grep -c "it\|test(" packages/lsp/test/language-map.test.ts)
PROPERTY=$(grep -c "fc\.\|prop\[" packages/lsp/test/language-map.test.ts)
echo "Property tests: $PROPERTY / $TOTAL"
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|return \[\]|return \{\})" packages/lsp/src/service/language-map.ts
# Expected: No matches (this is a complete implementation, not a stub)
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Does getLanguageId return correct values?** — Test .ts→typescript, .py→python, .go→go, .rs→rust
2. **Does unknown extension return undefined?** — Test .xyz→undefined
3. **Is the map immutable?** — ReadonlyMap prevents modification
4. **Does it cover the required languages?** — TypeScript, JavaScript, Python, Go, Rust, Java, C/C++

#### Feature Actually Works
```bash
cd packages/lsp && bunx vitest run test/language-map.test.ts
# Expected: All tests pass
```

#### Integration Points Verified
- [ ] getLanguageId() callable from Orchestrator to determine server routing
- [ ] getLanguageIdForFile() callable from Orchestrator with full file paths
- [ ] Extension mapping consistent with ServerRegistry extensions (same extensions)
- [ ] ReadonlyMap export prevents accidental mutation

#### Lifecycle Verified
- [ ] Pure data module — no initialization or cleanup needed
- [ ] Module-level map created at import time (no lazy init)
- [ ] No side effects on import

#### Edge Cases Verified
- [ ] Unknown extension → returns undefined (not empty string)
- [ ] Extension without dot (e.g., "ts") → handled correctly
- [ ] Extension with dot (e.g., ".ts") → handled correctly
- [ ] Case variants (.TS, .Ts) → case-insensitive lookup
- [ ] Extensionless files (e.g., Dockerfile, Makefile) → matched by exact name
- [ ] Empty string → returns undefined

## Success Criteria
- Language map is complete with ~60 extension mappings
- All tests pass including property-based tests
- 30%+ property-based tests
- No deferred implementation patterns

## Failure Recovery
1. `git checkout -- packages/lsp/src/service/language-map.ts packages/lsp/test/language-map.test.ts`
2. Re-run Phase 04

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P04.md`

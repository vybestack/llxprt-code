# Phase 09: LSP Client Stub

## Phase ID
`PLAN-20250212-LSP.P09`

## Prerequisites
- Required: Phase 08a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P08" packages/lsp/src/service/diagnostics.ts`
- Expected: Diagnostics formatting fully implemented and tested

## Requirements Implemented (Expanded)

This stub creates the skeleton for LspClient — the component that manages a single LSP server connection.

### REQ-LIFE-010: Lazy Startup (stub scaffolding)
**Full Text**: When the first file of a given language is touched, the system shall start the appropriate LSP server(s) if not already running.

### REQ-TIME-050: Debounce (stub scaffolding)
**Full Text**: When awaiting diagnostics from an LSP server, the system shall apply a 150 ms debounce period.

### REQ-LIFE-070: Crash Handling (stub scaffolding)
**Full Text**: If an individual LSP server crashes, the system shall mark it as broken and not restart it.

## Implementation Tasks

### Files to Modify

- `packages/lsp/src/service/lsp-client.ts`
  - MODIFY: Replace minimal stub with typed class skeleton
  - MUST include: `@plan:PLAN-20250212-LSP.P09`
  - Class: `LspClient` with typed methods:
    - `constructor(config: LspServerRegistryEntry, workspaceRoot: string)` 
    - `async initialize(): Promise<void>` — throws NotYetImplemented
    - `async touchFile(filePath: string, content?: string): Promise<void>` — throws NotYetImplemented
    - `async waitForDiagnostics(filePath: string, timeoutMs: number): Promise<Diagnostic[]>` — returns []
    - `async gotoDefinition(file: string, line: number, char: number): Promise<Location[]>` — returns []
    - `async findReferences(file: string, line: number, char: number): Promise<Location[]>` — returns []
    - `async hover(file: string, line: number, char: number): Promise<string | null>` — returns null
    - `async documentSymbols(file: string): Promise<DocumentSymbol[]>` — returns []
    - `isAlive(): boolean` — returns false
    - `isFirstTouch(): boolean` — returns true
    - `async shutdown(): Promise<void>` — no-op
  - All types fully defined (no `any`)
  - Under 100 lines

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P09
 * @pseudocode lsp-client.md
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Compiles
cd packages/lsp && bunx tsc --noEmit

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P09" packages/lsp/src/service/lsp-client.ts | wc -l
# Expected: 1+

# Under 100 lines
LINES=$(wc -l < packages/lsp/src/service/lsp-client.ts)
[ "$LINES" -le 100 ] && echo "PASS" || echo "FAIL"

# Class exported
grep "export class LspClient" packages/lsp/src/service/lsp-client.ts && echo "PASS" || echo "FAIL"

# All method signatures present
for method in initialize touchFile waitForDiagnostics gotoDefinition findReferences hover documentSymbols isAlive isFirstTouch shutdown; do
  grep -q "$method" packages/lsp/src/service/lsp-client.ts && echo "PASS: $method" || echo "FAIL: $method missing"
done
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Stubs may throw NotYetImplemented or return empty — expected for stub phase.
# But no TODO/FIXME/HACK comments:
grep -rn -E "(TODO|FIXME|HACK|XXX|WIP)" packages/lsp/src/service/lsp-client.ts
# Expected: No matches

# No cop-out comments:
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/lsp/src/service/lsp-client.ts
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/lsp/src/service/lsp-client.ts | grep -v ".test.ts"
# Expected: For stub phases, empty returns ARE expected (stubs return empty/throw NotYetImplemented by design).
# This check is for awareness — confirms stubs are minimal. In the impl phase (P11/P12), these should be gone.
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do method signatures match pseudocode lsp-client.md?** — Compare constructor, initialize, touchFile, waitForDiagnostics, navigation methods, shutdown
   - [ ] Each method signature verified against pseudocode
2. **Are return types correct?** — Diagnostic[], Location[], string|null, DocumentSymbol[], boolean, void
   - [ ] No `any` types
3. **Are stubs minimal?** — Each method either throws NotYetImplemented or returns empty type-correct values
   - [ ] No implementation logic in stubs
4. **Does the class accept correct constructor params?** — config: ServerRegistryEntry, workspaceRoot: string
   - [ ] Matches pseudocode line 01
5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] Full implementation is deferred to the impl phase (P11/P12) — this is by design
   - [ ] [List any unexpected gaps]

#### Feature Actually Works

```bash
# Stub phase — verify stubs compile and class is instantiable:
cd packages/lsp && bunx tsc --noEmit
# Expected: Clean compilation
```

#### Integration Points Verified
- [ ] LspClient class is exported and importable
- [ ] Constructor accepts ServerRegistryEntry (from server-registry.ts types)
- [ ] Methods return types compatible with Orchestrator expectations (Diagnostic[], Location[], etc.)

#### Lifecycle Verified
- [ ] Constructor does not start any processes (lazy startup per REQ-LIFE-010)
- [ ] initialize() is separate from constructor
- [ ] shutdown() method exists for cleanup

#### Edge Cases Verified
- [ ] Not applicable for stub phase — edge cases tested in P11/P12

## Success Criteria
- LspClient class compiles with correct types
- Under 100 lines
- All 11 method signatures present and typed
- Methods return empty values or throw NotYetImplemented
- No TODO/FIXME comments

## Failure Recovery
1. `git checkout -- packages/lsp/src/service/lsp-client.ts`
2. Re-run Phase 09

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P09.md`

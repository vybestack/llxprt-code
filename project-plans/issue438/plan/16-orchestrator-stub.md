# Phase 16: Orchestrator Stub

## Phase ID
`PLAN-20250212-LSP.P16`

## Prerequisites
- Required: Phase 15a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P15" packages/lsp/src/service/server-registry.ts`
- Expected: Server registry and LSP client fully implemented

## Requirements Implemented (Expanded)

Stub for the central orchestrator that coordinates lazy server startup, routes files to clients, collects diagnostics in parallel, and manages workspace boundaries.

### REQ-ARCH-040: Shared Orchestrator (stub)
**Full Text**: The system shall share a single LSP orchestrator instance and a single set of language server connections between both channels.

### REQ-BOUNDARY-010: Workspace Boundary Enforcement (stub)
**Full Text**: The system shall enforce workspace boundary checks at the orchestrator layer.

### REQ-BOUNDARY-020: No Servers for External Files (stub)
**Full Text**: The system shall not start LSP servers for files outside the workspace root, including system paths or other external directories.

### REQ-KNOWN-020: Known-Files Removal (stub)
**Full Text**: When a file's current diagnostics become empty, or when the tracking server shuts down or the session ends, the system shall remove that file from the known-files set.

### REQ-LIFE-020: No Servers at Startup (stub)
**Full Text**: The system shall not start any LSP servers at session startup. Servers shall be started on demand based on file extensions.

## Implementation Tasks

### Files to Modify

- `packages/lsp/src/service/orchestrator.ts`
  - MODIFY: Replace minimal stub with typed class skeleton
  - MUST include: `@plan:PLAN-20250212-LSP.P16`
  - Class: `Orchestrator` with methods:
    - `constructor(config: LspConfig, workspaceRoot: string)`
    - `async checkFile(filePath: string, text?: string, signal?: AbortSignal): Promise<Diagnostic[]>` — returns []
    - `async getAllDiagnostics(): Promise<Record<string, Diagnostic[]>>` — returns {}
    - `getDiagnosticEpoch(): number` — returns 0 [RESEARCH Bug 2]
    - `async getAllDiagnosticsAfter(afterEpoch: number, waitMs?: number): Promise<Record<string, Diagnostic[]>>` — returns {} [RESEARCH Bug 2]
    - `async status(): Promise<ServerStatus[]>` — returns []
    - `async gotoDefinition(file, line, char): Promise<Location[]>` — returns []
    - `async findReferences(file, line, char): Promise<Location[]>` — returns []
    - `async hover(file, line, char): Promise<string | null>` — returns null
    - `async documentSymbols(file): Promise<DocumentSymbol[]>` — returns []
    - `async workspaceSymbols(query): Promise<WorkspaceSymbol[]>` — returns []
    - `async shutdown(): Promise<void>` — no-op
  - Private fields MUST include:
    - `clients: Map<string, LspClient>` — active server connections
    - `brokenServers: Set<string>` — permanently failed servers
    - `firstTouchServers: Set<string>` — servers in cold-start phase
    - `startupPromises: Map<string, Promise<LspClient>>` — [RESEARCH Bug 1] single-flight startup guard
    - `opQueues: Map<string, ClientOpQueue>` — [RESEARCH Bug 4] per-client operation queue
    - `knownFileDiagSources: Map<string, Set<string>>` — multi-server known-files tracking
  - Under 100 lines

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P16
 * @pseudocode orchestrator.md
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Compiles
cd packages/lsp && bunx tsc --noEmit

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P16" packages/lsp/src/service/orchestrator.ts | wc -l
# Expected: 1+

# Class exported
grep "export class Orchestrator" packages/lsp/src/service/orchestrator.ts && echo "PASS" || echo "FAIL"

# Under 100 lines
LINES=$(wc -l < packages/lsp/src/service/orchestrator.ts)
[ "$LINES" -le 100 ] && echo "PASS: $LINES lines" || echo "FAIL: $LINES lines"

# All method signatures present
for method in checkFile getAllDiagnostics status gotoDefinition findReferences hover documentSymbols workspaceSymbols shutdown; do
  grep -q "$method" packages/lsp/src/service/orchestrator.ts && echo "PASS: $method" || echo "FAIL: $method missing"
done

# No `any` types
grep -n ": any" packages/lsp/src/service/orchestrator.ts && echo "WARNING: any type found" || echo "PASS: no any"
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Stubs return empty — expected for stub phase. No TODO/FIXME:
grep -rn -E "(TODO|FIXME|HACK|XXX|WIP)" packages/lsp/src/service/orchestrator.ts
# Expected: No matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/lsp/src/service/orchestrator.ts
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/lsp/src/service/orchestrator.ts | grep -v ".test.ts"
# Expected: For stub phases, empty returns ARE expected (stubs return empty values by design).
# This check is for awareness — confirms stubs are minimal. In the impl phase (P18/P19), these should be gone.
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do method signatures match pseudocode orchestrator.md?** — Compare constructor and all methods
   - [ ] constructor(config, workspaceRoot, registry, languageMap) — lines 01-10
   - [ ] checkFile, getAllDiagnostics, status, navigation methods, shutdown
2. **Are return types correct?** — Diagnostic[], Record<string, Diagnostic[]>, ServerStatus[], Location[], string|null, DocumentSymbol[], WorkspaceSymbol[]
   - [ ] No `any` types
3. **Are internal state fields declared?** — clients Map, brokenServers Set, firstTouchServers Set, startupPromises Map, opQueues Map
   - [ ] Private fields match pseudocode lines 03-08 (including 04f-04k from research fixes)
4. **Does it compile?** — TypeScript --noEmit passes
   - [ ] Confirmed
5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] Full implementation is deferred to the impl phase (P18/P19) — this is by design
   - [ ] [List any unexpected gaps]

#### Feature Actually Works

```bash
cd packages/lsp && bunx tsc --noEmit
# Expected: Clean compilation
```

#### Integration Points Verified
- [ ] Orchestrator class is exported and importable by rpc-channel.ts and mcp-channel.ts
- [ ] Constructor accepts ServerRegistry and LanguageMap dependencies (dependency injection)
- [ ] checkFile returns Diagnostic[] compatible with RPC channel response format
- [ ] Navigation methods return types compatible with MCP channel tool responses

#### Lifecycle Verified
- [ ] Constructor does not start any language servers (REQ-LIFE-020: no servers at startup)
- [ ] shutdown() method exists for cleanup
- [ ] No process spawning in stubs

#### Edge Cases Verified
- [ ] Not applicable for stub phase — edge cases tested in P18/P19

## Success Criteria
- Orchestrator class with all 10 methods compiles
- All method signatures typed correctly (no `any`)
- Internal state fields declared
- Under 100 lines
- No TODO/FIXME comments

## Failure Recovery
1. `git checkout -- packages/lsp/src/service/orchestrator.ts`
2. Re-run Phase 16

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P16.md`

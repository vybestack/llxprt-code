# Phase 27: LspServiceClient (Core) Stub

## Phase ID
`PLAN-20250212-LSP.P27`

## Prerequisites
- Required: Phase 26a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P26" packages/lsp/src/main.ts`
- Expected: Entire packages/lsp implemented (main entry, channels, orchestrator, clients)
- Preflight verification: Phase 00a completed

## Requirements Implemented (Expanded)

This stub creates the skeleton for LspServiceClient — the thin client in `packages/core/` that spawns and communicates with the Bun LSP subprocess.

### REQ-ARCH-060: vscode-jsonrpc Only Dependency (stub scaffolding)
**Full Text**: The system shall add only `vscode-jsonrpc` as a new dependency to the core package. This dependency shall be pure JavaScript with zero native modules.

### REQ-GRACE-040: isAlive() Returns False When Unavailable (stub scaffolding)
**Full Text**: If the LSP service is unavailable or has crashed, then `LspServiceClient.isAlive()` shall return `false`, and all subsequent `checkFile()` calls shall return an empty array immediately.

### REQ-GRACE-045: No Retry on Startup Failure (stub scaffolding)
**Full Text**: If LSP service startup fails (because Bun is unavailable, the LSP package is missing, or the subprocess fails to spawn), then the system shall keep LSP permanently disabled for the remainder of the session and shall not retry startup.

### REQ-LIFE-050: Graceful Shutdown (stub scaffolding)
**Full Text**: When shutting down the LSP service, the system shall send an `lsp/shutdown` request, wait briefly for graceful exit, then kill the subprocess.

## Implementation Tasks

### Files to Create

- `packages/core/src/lsp/lsp-service-client.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P27`
  - Class: `LspServiceClient` with typed methods:
    - `constructor(config: LspConfig, workspaceRoot: string)`
    - `async start(): Promise<void>` — no-op (stub)
    - `async checkFile(filePath: string): Promise<Diagnostic[]>` — returns []
    - `async getAllDiagnostics(): Promise<Record<string, Diagnostic[]>>` — returns {}
    - `async status(): Promise<ServerStatus[]>` — returns []
    - `isAlive(): boolean` — returns false
    - `async shutdown(): Promise<void>` — no-op
    - `getMcpTransportStreams(): { readable: Readable, writable: Writable } | null` — returns null
  - All types from `packages/core/src/lsp/types.ts` (already created in Phase 03)
  - NO Bun APIs — uses only Node.js + vscode-jsonrpc (REQ-ARCH-050)
  - Under 80 lines

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P27
 * @pseudocode lsp-service-client.md
 */
export class LspServiceClient {
  // Stub methods
}
```

## Verification Commands

```bash
# File exists
test -f packages/core/src/lsp/lsp-service-client.ts && echo "PASS" || echo "FAIL"

# TypeScript compiles (in core, not lsp package)
cd packages/core && npx tsc --noEmit
# Note: may need vscode-jsonrpc installed first

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P27" packages/core/src/lsp/lsp-service-client.ts | wc -l
# Expected: 1+

# Class exported
grep "export class LspServiceClient" packages/core/src/lsp/lsp-service-client.ts && echo "PASS" || echo "FAIL"

# All method signatures present
for method in start checkFile getAllDiagnostics status isAlive shutdown getMcpTransportStreams; do
  grep -q "$method" packages/core/src/lsp/lsp-service-client.ts && echo "PASS: $method" || echo "FAIL: $method missing"
done

# Under 80 lines
LINES=$(wc -l < packages/core/src/lsp/lsp-service-client.ts)
[ "$LINES" -le 80 ] && echo "PASS: $LINES lines" || echo "FAIL: $LINES lines"

# No Bun APIs
grep -rn "Bun\.\|import.*bun" packages/core/src/lsp/lsp-service-client.ts && echo "FAIL: Bun API in core" || echo "PASS"

# No TODO
grep "TODO\|FIXME" packages/core/src/lsp/lsp-service-client.ts && echo "FAIL" || echo "PASS"

# No `any` types
grep -n ": any" packages/core/src/lsp/lsp-service-client.ts && echo "WARNING" || echo "PASS"
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Stubs return empty — expected for stub phase. No TODO/FIXME:
grep -rn -E "(TODO|FIXME|HACK|XXX|WIP)" packages/core/src/lsp/lsp-service-client.ts
# Expected: No matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/lsp/lsp-service-client.ts
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/lsp/lsp-service-client.ts | grep -v ".test.ts"
# Expected: For stub phases, empty returns ARE expected (stubs return empty values by design).
# This check is for awareness — confirms stubs are minimal. In the impl phase (P29/P30), these should be gone.

# No Bun APIs in core (REQ-ARCH-050)
grep -rn "Bun\.\|import.*bun" packages/core/src/lsp/lsp-service-client.ts && echo "FAIL: Bun API in core" || echo "PASS"
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do method signatures match pseudocode lsp-service-client.md?** — Compare lines 01-118
   - [ ] start(), checkFile(), getAllDiagnostics(), status(), isAlive(), shutdown(), getMcpTransportStreams()
2. **Are return types correct?** — Diagnostic[], Record<string, Diagnostic[]>, ServerStatus[], boolean, null
   - [ ] No `any` types
3. **Are stubs minimal?** — Return empty values, no logic
   - [ ] Under 80 lines confirmed
4. **Is this in packages/core (not packages/lsp)?** — CRITICAL distinction
   - [ ] File path is packages/core/src/lsp/lsp-service-client.ts
5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] Full implementation is deferred to the impl phase (P29/P30) — this is by design
   - [ ] [List any unexpected gaps]

#### Feature Actually Works

```bash
# Stub phase — verify stubs compile in core package:
cd packages/core && npx tsc --noEmit
# Expected: Clean compilation
```

#### Integration Points Verified
- [ ] LspServiceClient is importable by config.ts (getLspServiceClient accessor)
- [ ] checkFile returns Diagnostic[] compatible with edit.ts formatting code
- [ ] getAllDiagnostics returns Record<string, Diagnostic[]> compatible with write-file.ts
- [ ] getMcpTransportStreams returns streams compatible with direct MCP SDK Client (FdTransport)
- [ ] Types (Diagnostic, ServerStatus, LspConfig) from packages/core/src/lsp/types.ts

#### Lifecycle Verified
- [ ] Constructor stores config but does NOT spawn subprocess (deferred to start())
- [ ] start() is separate from constructor
- [ ] isAlive() returns false by default in stub
- [ ] shutdown() exists for cleanup

#### Edge Cases Verified
- [ ] Not applicable for stub phase — edge cases tested in P29/P30

## Success Criteria
- LspServiceClient class compiles in packages/core
- All method signatures present and typed
- Under 80 lines
- No Bun APIs used (REQ-ARCH-050)
- No `any` types
- Returns empty values (stub phase)

## Failure Recovery
1. `git checkout -- packages/core/src/lsp/lsp-service-client.ts`
2. Re-run Phase 27

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P27.md`

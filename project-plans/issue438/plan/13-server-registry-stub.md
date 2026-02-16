# Phase 13: Server Registry Stub

## Phase ID
`PLAN-20250212-LSP.P13`

## Prerequisites
- Required: Phase 12a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P12" packages/lsp/src/service/lsp-client.ts`

## Requirements Implemented (Expanded)

### REQ-LANG-020: Built-in Server Configs (stub)
**Full Text**: The system shall provide built-in server configurations for at least: TypeScript, ESLint, Go, Python, Rust.

### REQ-CFG-040: Custom Servers (stub)
**Full Text**: Users can define custom LSP server configurations.

## Implementation Tasks

### Files to Modify

- `packages/lsp/src/service/server-registry.ts`
  - MODIFY: Replace minimal stub with typed interface and skeleton
  - MUST include: `@plan:PLAN-20250212-LSP.P13`
  - Export interface `ServerRegistryEntry` with fields: id, extensions, command, args, env, detect, initOptions, workspaceRootDetectors
  - Export function `getBuiltinServers(): readonly ServerRegistryEntry[]` — returns []
  - Export function `getServersForExtension(ext: string, userConfig?): ServerRegistryEntry[]` — returns []
  - Export function `mergeUserConfig(builtins, userConfig): ServerRegistryEntry[]` — returns []
  - Under 80 lines

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P13
 * @pseudocode server-registry.md
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Compiles
cd packages/lsp && bunx tsc --noEmit

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P13" packages/lsp/src/service/server-registry.ts | wc -l
# Expected: 1+

# Under 80 lines
LINES=$(wc -l < packages/lsp/src/service/server-registry.ts)
[ "$LINES" -le 80 ] && echo "PASS: $LINES lines" || echo "FAIL: $LINES lines"

# Interface exported
grep "export interface ServerRegistryEntry" packages/lsp/src/service/server-registry.ts && echo "PASS" || echo "FAIL"

# Functions exported
for fn in getBuiltinServers getServersForExtension mergeUserConfig; do
  grep -q "export function $fn" packages/lsp/src/service/server-registry.ts && echo "PASS: $fn" || echo "FAIL: $fn missing"
done
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Stubs return empty arrays — expected for stub phase. No TODO/FIXME:
grep -rn -E "(TODO|FIXME|HACK|XXX|WIP)" packages/lsp/src/service/server-registry.ts
# Expected: No matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/lsp/src/service/server-registry.ts
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/lsp/src/service/server-registry.ts | grep -v ".test.ts"
# Expected: For stub phases, empty returns ARE expected (stubs return empty arrays by design).
# This check is for awareness — confirms stubs are minimal. In the impl phase (P14/P15), these should be gone.
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Does ServerRegistryEntry interface match pseudocode?** — Compare with server-registry.md lines 01-30
   - [ ] Fields: id, displayName, extensions, command, args, env, workspaceRootMarkers, initializationOptions, detectCommand
2. **Do function signatures match pseudocode?** — getBuiltinServers, getServersForExtension, mergeUserConfig
   - [ ] Each function's parameters and return type verified
3. **Are stubs minimal?** — Return empty arrays, no logic
   - [ ] Under 80 lines confirmed
4. **Does it compile?** — TypeScript --noEmit passes
   - [ ] Confirmed
5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] Full implementation is deferred to the impl phase (P14/P15) — this is by design
   - [ ] [List any unexpected gaps]

#### Feature Actually Works

```bash
cd packages/lsp && bunx tsc --noEmit
# Expected: Clean compilation
```

#### Integration Points Verified
- [ ] ServerRegistryEntry type is importable by orchestrator.ts and lsp-client.ts
- [ ] getServersForExtension returns ServerRegistryEntry[] (compatible with Orchestrator.checkFile)
- [ ] mergeUserConfig accepts LspConfig.servers for user overrides

#### Lifecycle Verified
- [ ] All functions are pure (no state, no initialization needed)
- [ ] No process spawning in stubs

#### Edge Cases Verified
- [ ] Not applicable for stub phase — edge cases tested in P14/P15

## Success Criteria
- ServerRegistryEntry interface with all required fields
- 3 exported functions with correct signatures
- Compiles with strict TypeScript
- Under 80 lines
- No TODO/FIXME comments

## Failure Recovery
1. `git checkout -- packages/lsp/src/service/server-registry.ts`
2. Re-run Phase 13

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P13.md`

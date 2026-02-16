# Phase 03: Shared Types & Config Schema Stubs

## Phase ID
`PLAN-20250212-LSP.P03`

## Prerequisites
- Required: Phase 02.5 integration contracts completed
- Verification: `test -f project-plans/issue438/.completed/P02.5.md`
- Preflight verification: Phase 00a MUST be completed

## Requirements Implemented (Expanded)

### REQ-PKG-050: Type Duplication
**Full Text**: The system shall duplicate the shared types (Diagnostic, ServerStatus, LspConfig) in both packages/lsp/src/types.ts and packages/core/src/lsp/types.ts to avoid cross-boundary build complexity between the Bun-native package and the Node.js core package.
**Behavior**:
- GIVEN: Two separate packages (core on Node.js, lsp on Bun) that cannot share build artifacts
- WHEN: Types are defined
- THEN: Identical type definitions exist in both packages, matching the JSON-RPC wire format
**Why This Matters**: Cross-package type sharing between Bun-native and Node.js packages causes build complexity; duplication is the pragmatic choice.

### REQ-PKG-010: Package Independence
**Full Text**: The packages/lsp/ package shall not be included in the root npm workspaces array, following the packages/ui/ precedent.
**Behavior**:
- GIVEN: A new packages/lsp directory
- WHEN: The project is configured
- THEN: packages/lsp is NOT listed in root package.json workspaces
**Why This Matters**: Follows established precedent for Bun-native packages.

### REQ-PKG-020: Own Configuration
**Full Text**: The packages/lsp/ package shall have its own eslint.config.cjs, tsconfig.json, and CI steps.
**Behavior**:
- GIVEN: packages/lsp is created
- WHEN: Lint, typecheck, or test is run
- THEN: Uses local configuration files, not root ones
**Why This Matters**: Ensures pedantic Bun-native linting separate from core's Node.js config.

### REQ-PKG-030: Max Lines Enforcement
**Full Text**: The packages/lsp/ package shall enforce a max-lines lint rule of 800 lines per file.
**Behavior**:
- GIVEN: Any .ts file in packages/lsp
- WHEN: File exceeds 800 lines
- THEN: Lint error is raised
**Why This Matters**: Prevents monolithic files like OpenCode's 2047-line server.ts.

### REQ-PKG-040: Strict Type Safety
**Full Text**: The packages/lsp/ package shall enforce strict TypeScript rules including no-unsafe-assignment, no-unsafe-member-access, and no-unsafe-return.
**Behavior**:
- GIVEN: LSP server responses which are typed as any by vscode-jsonrpc
- WHEN: Code accesses those responses
- THEN: TypeScript forces explicit typing before access
**Why This Matters**: LSP server responses are inherently untyped; strict rules force proper typing.

### REQ-ARCH-060: Core Dependency Minimalism
**Full Text**: The system shall add only vscode-jsonrpc as a new dependency to the core package. This dependency shall be pure JavaScript with zero native modules.
**Behavior**:
- GIVEN: packages/core needs to communicate with LSP service
- WHEN: Dependencies are added
- THEN: Only vscode-jsonrpc is added, no other new dependencies
**Why This Matters**: Keeps core's dependency tree lean; vscode-jsonrpc is ~50KB pure JS.

### REQ-PKG-060: Root ESLint Ignore
**Full Text**: The root eslint.config.js shall add packages/lsp/** to its ignore list.
**Behavior**:
- GIVEN: Root ESLint configuration
- WHEN: Lint is run from root
- THEN: packages/lsp files are ignored (linted by their own config)
**Why This Matters**: Prevents root ESLint from trying to lint Bun-native code with Node.js rules.

## Implementation Tasks

### Files to Create

- `packages/lsp/package.json` — Package manifest following packages/ui pattern
  - MUST include: engines.bun >= 1.2.0
  - MUST include: dependencies for vscode-jsonrpc, vscode-languageserver-types, @modelcontextprotocol/sdk
  - MUST include: devDependencies for @types/bun, typescript, vitest, eslint plugins

- `packages/lsp/tsconfig.json` — TypeScript configuration
  - MUST include: strict: true, noEmit: true, types: ["bun"]
  - MUST include: moduleResolution: "bundler"
  - Adapted from packages/ui/tsconfig.json (no React/JSX)

- `packages/lsp/eslint.config.cjs` — ESLint configuration
  - MUST include: max-lines: 800, no-unsafe-assignment, no-unsafe-member-access, no-unsafe-return
  - Adapted from packages/ui/eslint.config.cjs (no React plugins)

- `packages/lsp/src/types.ts` — Shared type definitions for LSP package
  - MUST include: `@plan:PLAN-20250212-LSP.P03`
  - Types: Diagnostic, ServerStatus, LspConfig, LspServerConfig
  - MUST match pseudocode config-integration.md lines 03-37

- `packages/lsp/src/config.ts` — Config type re-exports for LSP-side usage
  - MUST include: `@plan:PLAN-20250212-LSP.P03`

- `packages/core/src/lsp/types.ts` — Shared type definitions for core package (DUPLICATE)
  - MUST include: `@plan:PLAN-20250212-LSP.P03`
  - MUST include: `@requirement:REQ-PKG-050`
  - Types identical to packages/lsp/src/types.ts

- `packages/core/src/lsp/lsp-service-client.ts` — Stub class
  - MUST include: `@plan:PLAN-20250212-LSP.P03`
  - Methods: start(), checkFile(), getAllDiagnostics(), status(), shutdown(), isAlive(), getMcpTransportStreams()
  - All methods throw `new Error('NotYetImplemented')` or return empty values

- `packages/lsp/src/main.ts` — Stub entry point
  - MUST include: `@plan:PLAN-20250212-LSP.P03`
  - Minimal: import types, stub main function

- `packages/lsp/src/service/orchestrator.ts` — Stub class
  - MUST include: `@plan:PLAN-20250212-LSP.P03`

- `packages/lsp/src/service/lsp-client.ts` — Stub class
  - MUST include: `@plan:PLAN-20250212-LSP.P03`

- `packages/lsp/src/service/diagnostics.ts` — Stub functions
  - MUST include: `@plan:PLAN-20250212-LSP.P03`

- `packages/lsp/src/service/server-registry.ts` — Stub
  - MUST include: `@plan:PLAN-20250212-LSP.P03`

- `packages/lsp/src/service/language-map.ts` — Stub
  - MUST include: `@plan:PLAN-20250212-LSP.P03`

- `packages/lsp/src/channels/rpc-channel.ts` — Stub
  - MUST include: `@plan:PLAN-20250212-LSP.P03`

- `packages/lsp/src/channels/mcp-channel.ts` — Stub
  - MUST include: `@plan:PLAN-20250212-LSP.P03`

- `packages/lsp/test/fixtures/fake-lsp-server.ts` — Minimal LSP server fixture for testing
  - MUST include: `@plan:PLAN-20250212-LSP.P03`

### Files to Modify

- `packages/core/package.json`
  - ADD: `"vscode-jsonrpc": "^8.2.1"` to dependencies
  - ADD comment: `@plan:PLAN-20250212-LSP.P03`

- Root `eslint.config.js` (if it exists)
  - ADD: `packages/lsp/**` to ignores array
  - ADD comment: `@plan:PLAN-20250212-LSP.P03`

### Required Code Markers

Every file created MUST include:
```typescript
/**
 * @plan PLAN-20250212-LSP.P03
 * @requirement REQ-PKG-050 (for type files)
 * @requirement REQ-PKG-010 (for package.json)
 * @pseudocode config-integration.md lines 01-37 (for type files)
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan:PLAN-20250212-LSP.P03" packages/lsp/ packages/core/src/lsp/ | wc -l
# Expected: 10+ occurrences

# Check package structure
test -f packages/lsp/package.json && echo "PASS" || echo "FAIL"
test -f packages/lsp/tsconfig.json && echo "PASS" || echo "FAIL"
test -f packages/lsp/eslint.config.cjs && echo "PASS" || echo "FAIL"
test -f packages/lsp/src/types.ts && echo "PASS" || echo "FAIL"
test -f packages/core/src/lsp/types.ts && echo "PASS" || echo "FAIL"

# Verify not in root workspaces
grep -q "packages/lsp" package.json && echo "FAIL: lsp in workspaces" || echo "PASS"

# TypeScript compiles
cd packages/lsp && bunx tsc --noEmit && echo "PASS" || echo "FAIL"
cd packages/core && npx tsc --noEmit && echo "PASS" || echo "FAIL"

# ESLint max-lines rule present
grep "max-lines" packages/lsp/eslint.config.cjs && echo "PASS" || echo "FAIL"

# Strict type rules present
grep "no-unsafe-assignment" packages/lsp/eslint.config.cjs && echo "PASS" || echo "FAIL"

# vscode-jsonrpc added to core
grep "vscode-jsonrpc" packages/core/package.json && echo "PASS" || echo "FAIL"
```

### Deferred Implementation Detection (MANDATORY)

```bash
# These are stubs, so NotYetImplemented is OK. But check for TODO/FIXME:
grep -rn -E "(TODO|FIXME|HACK)" packages/lsp/src/ packages/core/src/lsp/ | grep -v ".test.ts"
# Expected: No matches (stubs use Error('NotYetImplemented'), not TODO comments)
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do types match between core and lsp packages?** — Diff the two types.ts files
2. **Do stubs compile?** — TypeScript --noEmit passes
3. **Is the package structure correct?** — Follows packages/ui precedent
4. **Are the right dependencies declared?** — Check both package.json files

#### Feature Actually Works
```bash
# At this stage, nothing user-facing works yet. Verify compilation only:
cd packages/lsp && bunx tsc --noEmit
cd packages/core && npx tsc --noEmit
```

#### Integration Points Verified
- [ ] Types in packages/lsp/src/types.ts importable by other lsp package modules
- [ ] Types in packages/core/src/lsp/types.ts importable by core modules (edit.ts, write-file.ts, config.ts)
- [ ] Shared types match between packages (diff the two types.ts files)
- [ ] vscode-jsonrpc importable in packages/core after adding dependency
- [ ] Root eslint ignores packages/lsp (no cross-boundary lint errors)

#### Lifecycle Verified
- [ ] No processes spawned in this phase (types and stubs only)
- [ ] No runtime initialization needed for types
- [ ] Package structure ready for subsequent phases

#### Edge Cases Verified
- [ ] packages/lsp NOT in root workspaces array (REQ-PKG-010)
- [ ] ESLint max-lines: 800 rule enforced (REQ-PKG-030)
- [ ] ESLint no-unsafe-* rules enforced (REQ-PKG-040)
- [ ] All stubs compile with strict TypeScript (no `any`)

### CI Type Drift Guard (RESEARCH — Source 5)

To prevent the two `types.ts` files from silently diverging over time:

- **CI sync script**: Create `scripts/check-lsp-type-sync.sh` (or equivalent) that diffs `packages/core/src/lsp/types.ts` and `packages/lsp/src/types.ts`. The diff must be empty; if diverged, CI fails with a clear message explaining which file to update.
- **When to run**: Add to CI pipeline alongside lint/typecheck steps for both packages.
- **Implementation**: Simple `diff -u` or a structured comparison that ignores leading comments but compares all type definitions, interfaces, and type aliases.
- **Contract test**: One integration test (in Phase 36) sends a JSON-RPC message containing all fields of `Diagnostic`, `ServerStatus`, and `LspConfig` across the process boundary and verifies both sides parse it identically.

## Success Criteria
- All stub files compile
- Package structure follows packages/ui precedent
- Types are identical in both packages
- ESLint config enforces max-lines: 800 and no-unsafe-* rules
- vscode-jsonrpc added to core dependencies
- Root ESLint ignores packages/lsp
- CI type drift guard script created (or task tracked for Phase 36)

## Failure Recovery
If this phase fails:
1. `git checkout -- packages/lsp/ packages/core/src/lsp/ packages/core/package.json`
2. Fix specific issues
3. Re-run Phase 03

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P03.md`

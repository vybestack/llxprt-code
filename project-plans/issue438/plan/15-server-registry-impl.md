# Phase 15: Server Registry Implementation

## Phase ID
`PLAN-20250212-LSP.P15`

## Prerequisites
- Required: Phase 14a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P14" packages/lsp/test/server-registry.test.ts`

## Requirements Implemented (Expanded)

### REQ-LANG-020: Built-in Servers
**Full Text**: TypeScript (tsserver), ESLint, Go (gopls), Python (pyright), Rust (rust-analyzer).

### REQ-CFG-030/040: User Configuration
**Full Text**: Disable individual servers, define custom servers.

### REQ-PKG-030: Max Lines
**Full Text**: 800 lines max per file. Registry must be decomposed if necessary.

## Implementation Tasks

### Files to Modify

- `packages/lsp/src/service/server-registry.ts`
  - MODIFY: Replace stubs with built-in server configurations
  - MUST include: `@plan:PLAN-20250212-LSP.P15`
  - MUST follow pseudocode `server-registry.md`:
    - Lines 01-30: TypeScript server config
    - Lines 32-48: ESLint server config
    - Lines 50-66: Go server config
    - Lines 68-84: Python server config
    - Lines 86-102: Rust server config
    - Lines 104-120: Extension index
    - Lines 122-150: User config merge logic
  - Each server entry: id, extensions, command, args, detect function, initOptions
  - If file would exceed 800 lines: decompose into server-registry.ts + per-server config files

### Files NOT to Modify

- `packages/lsp/test/server-registry.test.ts` — DO NOT MODIFY

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P15
 * @requirement REQ-LANG-020
 * @pseudocode server-registry.md lines 01-30
 */
```

## Verification Commands

```bash
cd packages/lsp && bunx vitest run test/server-registry.test.ts
git diff packages/lsp/test/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL" || echo "PASS"
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/lsp/src/service/server-registry.ts
LINES=$(wc -l < packages/lsp/src/service/server-registry.ts)
[ "$LINES" -le 800 ] && echo "PASS" || echo "FAIL"
cd packages/lsp && bunx tsc --noEmit && bunx eslint src/service/server-registry.ts
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/lsp/src/service/server-registry.ts
# Expected: No matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/lsp/src/service/server-registry.ts
# Expected: No matches

grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/lsp/src/service/server-registry.ts
# Expected: No matches in main logic paths (guard clauses OK)
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Does the code DO what the requirement says?**
   - [ ] REQ-LANG-020: 5 built-in servers configured with real commands (typescript, eslint, gopls, pyright, rust-analyzer)
   - [ ] REQ-LANG-030: Custom server configs merged from user config
   - [ ] REQ-CFG-030: Individual server disable via `enabled: false`
   - [ ] REQ-PKG-030: Under 800 lines

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] Real server commands (not "echo hello")
   - [ ] Real file extensions

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify actual server configs (command, args, extensions)

4. **Is the feature REACHABLE?**
   - [ ] Orchestrator imports and uses ServerRegistry

5. **What's MISSING?**
   - [ ] [gap 1 or "none"]

#### Feature Actually Works

```bash
cd packages/lsp && bunx vitest run test/server-registry.test.ts
# Expected: All tests pass
```

##### Verdict
[PASS/FAIL]

#### Integration Points Verified
- [ ] getBuiltinServers() returns ServerRegistryEntry[] used by Orchestrator constructor
- [ ] getServersForExtension() returns entries used by Orchestrator.checkFile() to determine which servers handle a file
- [ ] mergeUserConfig() accepts LspConfig.servers from config.ts
- [ ] ServerRegistryEntry fields (command, args, env, extensions) are sufficient for LspClient to spawn a server

#### Lifecycle Verified
- [ ] All functions are pure (stateless, no side effects)
- [ ] No process spawning in registry (spawning is LspClient's job)
- [ ] No cleanup needed

#### Edge Cases Verified
- [ ] getServersForExtension with extension not in any server → empty array
- [ ] mergeUserConfig with user disabling all built-in servers → empty list
- [ ] Custom server with minimal config (just command + extensions)
- [ ] Case-insensitive extension matching (.TS vs .ts)
- [ ] Extension with dot prefix (.ts) vs without (ts) → handled consistently
- [ ] File size check: registry file ≤ 800 lines (REQ-PKG-030)

## Success Criteria
- All unit tests pass
- No test files modified
- Pseudocode references (server-registry.md lines 01-161)
- 5 built-in servers: TypeScript, ESLint, Go, Python, Rust
- User config merging works (override, disable, add custom)
- File ≤ 800 lines (REQ-PKG-030)

## Failure Recovery
1. `git checkout -- packages/lsp/src/service/server-registry.ts`
2. Re-run Phase 15

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P15.md`

# Phase 14: Server Registry TDD

## Phase ID
`PLAN-20250212-LSP.P14`

## Prerequisites
- Required: Phase 13a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P13" packages/lsp/src/service/server-registry.ts`

## Requirements Implemented (Expanded)

### REQ-LANG-020: Built-in Server Configurations
**Full Text**: The system shall provide built-in server configurations for at least: TypeScript (tsserver), ESLint, Go (gopls), Python (pyright), and Rust (rust-analyzer).
**Behavior**:
- GIVEN: No user configuration
- WHEN: getBuiltinServers() is called
- THEN: Returns entries for at least TS, ESLint, Go, Python, Rust

### REQ-LANG-010: Extension-to-Server Mapping
**Full Text**: The system shall use file extension-to-LSP language ID mapping.
**Behavior**:
- GIVEN: Extension ".ts"
- WHEN: getServersForExtension(".ts") is called
- THEN: Returns entries for TypeScript and ESLint

### REQ-LANG-040: Multiple Servers Per Extension
**Full Text**: When multiple LSP servers apply to a single file extension, the system shall start all applicable servers.
**Behavior**:
- GIVEN: Extension ".ts" which maps to both tsserver and eslint
- WHEN: getServersForExtension(".ts") is called
- THEN: Returns both server entries

### REQ-CFG-030: Disable Individual Servers
**Full Text**: Users can disable individual servers via config.
**Behavior**:
- GIVEN: User config with `servers: { eslint: { enabled: false } }`
- WHEN: mergeUserConfig() is called
- THEN: ESLint entry is excluded

### REQ-CFG-040: Custom Servers
**Full Text**: Users can define custom LSP server configurations.
**Behavior**:
- GIVEN: User config with a custom "deno" server
- WHEN: mergeUserConfig() is called
- THEN: Custom server appears in merged result

## Implementation Tasks

### Files to Create

- `packages/lsp/test/server-registry.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P14`
  - Tests (15+):
    - Built-in servers: at least 5 exist (TS, ESLint, Go, Python, Rust)
    - Each built-in has: id, command, extensions, args
    - Extension lookup: .ts returns TS + ESLint
    - Extension lookup: .go returns gopls
    - Extension lookup: .unknown returns empty
    - User config: disable server
    - User config: custom server
    - User config: override command for built-in
    - Merge: custom server added to builtins
    - Merge: disabled server removed from result
    - Server entries are immutable (ReadonlyArray)
  - 30%+ property-based tests:
    - Any string extension never throws
    - getBuiltinServers always returns same result (deterministic)
    - mergeUserConfig never returns more entries than builtins + customs

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P14
 * @requirement REQ-LANG-020
 * @scenario Built-in servers include TypeScript
 */
```

## Verification Commands

```bash
test -f packages/lsp/test/server-registry.test.ts && echo "PASS" || echo "FAIL"
TEST_COUNT=$(grep -c "it(\|test(" packages/lsp/test/server-registry.test.ts)
[ "$TEST_COUNT" -ge 15 ] && echo "PASS" || echo "FAIL"
PROP_COUNT=$(grep -c "fc\.\|prop\[" packages/lsp/test/server-registry.test.ts)
RATIO=$((PROP_COUNT * 100 / TEST_COUNT))
[ "$RATIO" -ge 30 ] && echo "PASS" || echo "FAIL"
grep -rn "NotYetImplemented" packages/lsp/test/server-registry.test.ts && echo "FAIL" || echo "PASS"
cd packages/lsp && bunx vitest run test/server-registry.test.ts 2>&1 | tail -5
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/lsp/test/server-registry.test.ts
# Expected: No matches

grep -rn -E "(skip|xit|xdescribe|\.todo)" packages/lsp/test/server-registry.test.ts
# Expected: No skipped tests
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do tests verify all 5 built-in servers?** — TypeScript, ESLint, Go, Python, Rust
   - [ ] Each server has correct extensions, command, and detect strategy
2. **Do tests verify extension lookup returns multiple servers?** — .ts → [typescript, eslint]
   - [ ] REQ-LANG-040 test exists
3. **Do tests verify user config merging?** — Override built-in, add custom
   - [ ] REQ-CFG-030 (disable) and REQ-CFG-040 (custom) tested
4. **Do property-based tests express invariants?** — e.g., "every extension maps to at least one server"
   - [ ] Verified meaningful invariants, not just "doesn't crash"

#### Feature Actually Works

```bash
cd packages/lsp && bunx vitest run test/server-registry.test.ts 2>&1 | tail -5
# Expected: Tests FAIL on stubs
```

#### Integration Points Verified
- [ ] Tests import functions from server-registry.ts
- [ ] Tests use LspServerConfig type for user config merging
- [ ] Test data matches realistic user configuration format

#### Lifecycle Verified
- [ ] Registry functions are pure (no state mutation, no processes)
- [ ] No cleanup needed

#### Edge Cases Verified
- [ ] Unknown extension → empty server list
- [ ] User disables all built-in servers → empty list
- [ ] Custom server with empty extensions array
- [ ] User config overrides command for built-in server
- [ ] Case-insensitive extension matching

## Success Criteria
- 15+ tests covering all REQ-LANG-* and REQ-CFG-030/040
- 30%+ property-based
- Tests fail naturally on stubs

## Failure Recovery
1. `git checkout -- packages/lsp/test/server-registry.test.ts`
2. Re-run Phase 14

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P14.md`

# Phase 03a: Shared Types & Config Schema Stubs Verification

## Phase ID
`PLAN-20250212-LSP.P03a`

## Prerequisites
- Required: Phase 03 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P03" packages/lsp/ packages/core/src/lsp/`
- Expected files:
  - `packages/lsp/package.json`, `tsconfig.json`, `eslint.config.cjs`
  - `packages/lsp/src/types.ts`, `src/config.ts`, `src/main.ts`
  - `packages/lsp/src/service/orchestrator.ts`, `lsp-client.ts`, `diagnostics.ts`, `server-registry.ts`, `language-map.ts`
  - `packages/lsp/src/channels/rpc-channel.ts`, `mcp-channel.ts`
  - `packages/core/src/lsp/types.ts`, `lsp-service-client.ts`

## Verification Commands

### Automated Checks

```bash
# 1. All expected files exist
FILES=(
  "packages/lsp/package.json"
  "packages/lsp/tsconfig.json"
  "packages/lsp/eslint.config.cjs"
  "packages/lsp/src/types.ts"
  "packages/lsp/src/main.ts"
  "packages/lsp/src/service/orchestrator.ts"
  "packages/lsp/src/service/lsp-client.ts"
  "packages/lsp/src/service/diagnostics.ts"
  "packages/lsp/src/service/server-registry.ts"
  "packages/lsp/src/service/language-map.ts"
  "packages/lsp/src/channels/rpc-channel.ts"
  "packages/lsp/src/channels/mcp-channel.ts"
  "packages/core/src/lsp/types.ts"
  "packages/core/src/lsp/lsp-service-client.ts"
)
for f in "${FILES[@]}"; do
  test -f "$f" && echo "PASS: $f" || echo "FAIL: $f missing"
done

# 2. TypeScript compiles in both packages
(cd packages/lsp && bunx tsc --noEmit) && echo "PASS: lsp compiles" || echo "FAIL: lsp compile"
(cd packages/core && npx tsc --noEmit) && echo "PASS: core compiles" || echo "FAIL: core compile"

# 3. Plan markers present
MARKERS=$(grep -r "@plan:PLAN-20250212-LSP.P03" packages/lsp/ packages/core/src/lsp/ | wc -l)
echo "Plan markers found: $MARKERS"
[ "$MARKERS" -ge 10 ] && echo "PASS" || echo "FAIL: insufficient markers"

# 4. Type duplication check (types should match)
diff <(grep -E "^export " packages/core/src/lsp/types.ts | sort) <(grep -E "^export " packages/lsp/src/types.ts | sort)
echo "Types match: $?"

# 5. No version duplication
find packages/lsp -name "*V2*" -o -name "*New*" -o -name "*Copy*"
# Expected: No output

# 6. Stubs don't use TODO
grep -rn "TODO" packages/lsp/src/ packages/core/src/lsp/ | grep -v ".test.ts" | grep -v "node_modules"
# Expected: No matches

# 7. ESLint config has required rules
grep "max-lines" packages/lsp/eslint.config.cjs | grep "800" && echo "PASS: max-lines 800" || echo "FAIL"
grep "no-unsafe-assignment" packages/lsp/eslint.config.cjs && echo "PASS: no-unsafe-assignment" || echo "FAIL"
grep "no-unsafe-member-access" packages/lsp/eslint.config.cjs && echo "PASS: no-unsafe-member-access" || echo "FAIL"
grep "no-unsafe-return" packages/lsp/eslint.config.cjs && echo "PASS: no-unsafe-return" || echo "FAIL"
```

### Semantic Verification Checklist (MANDATORY)

#### Holistic Functionality Assessment

##### What was implemented?
[Describe the package structure, types created, and stubs established]

##### Does it satisfy the requirements?
- [ ] REQ-PKG-050: Types duplicated in both packages — verify by diff
- [ ] REQ-PKG-010: Not in root workspaces — verify by grep
- [ ] REQ-PKG-020: Own eslint.config.cjs, tsconfig.json — verify existence
- [ ] REQ-PKG-030: max-lines: 800 enforced — verify eslint config
- [ ] REQ-PKG-040: no-unsafe-* rules present — verify eslint config
- [ ] REQ-ARCH-060: Only vscode-jsonrpc added to core — verify package.json diff
- [ ] REQ-PKG-060: Root ESLint ignores packages/lsp — verify root config

##### Verdict
[PASS/FAIL with explanation]

## Success Criteria
- All files exist and compile
- Types are duplicated correctly
- Package follows ui precedent
- ESLint rules are strict

## Failure Recovery
If verification fails:
1. Identify specific failures
2. Return to Phase 03 to fix
3. Re-run Phase 03a


### Deferred Implementation Detection (MANDATORY)

```bash
# Stubs are allowed to throw NotYetImplemented or return empty values.
# But they must NOT have TODO/FIXME/HACK comments:
grep -rn -E "(TODO|FIXME|HACK)" [modified-files] | grep -v ".test.ts"
# Expected: No matches

# No cop-out comments even in stubs:
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" [modified-files] | grep -v ".test.ts"
# Expected: No matches
```


### Feature Actually Works

```bash
# Stub phase — verify compilation only:
cd packages/lsp && bunx tsc --noEmit
cd packages/core && npx tsc --noEmit
# Expected: Both compile cleanly
```


## Phase Completion Marker
Create: `project-plans/issue438/.completed/P03a.md`

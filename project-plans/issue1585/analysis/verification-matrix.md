# Phase Verification Matrix

Plan ID: PLAN-20260608-ISSUE1585

This matrix defines checks that implementation and verification agents must run in addition to phase-specific tests.

## Canonical Final Verification Commands

```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load waferglm5 "write me a haiku and nothing else"
```

## Phase-Specific Verification Commands

### After P03 (Scaffold + Stubs)

```bash
npm run typecheck --workspace @vybestack/llxprt-code-tools
```

### After P05 (Contract Implementation)

```bash
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run test --workspace @vybestack/llxprt-code-tools
```

### After P08 (Release Implementation)

```bash
npm run typecheck
npm run build --workspace @vybestack/llxprt-code-tools
npm run test:scripts
node scripts/bind-release-deps.js --dry-run
# Verify scripts/version.js already includes tools
rg -n "@vybestack/llxprt-code-tools" scripts/version.js
# Verify scripts/prepare-package.js handles tools
rg -n "copyFiles.*tools|'tools'" scripts/prepare-package.js
# Verify scripts/build.js uses workspaces
rg -n "workspaces" scripts/build.js
# Verify Dockerfile install order
rg -n "npm install.*tools|COPY.*tools" Dockerfile
```

### After P09 (Tool Inventory)

```bash
# Verify packages/tools/package.json dependencies
node -e "const p=require('./packages/tools/package.json'); if (!p.dependencies || Object.keys(p.dependencies).length < 5) process.exit(1)"
# Verify no forbidden dependencies
node -e "const p=require('./packages/tools/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; if (d['@vybestack/llxprt-code-core'] || d['@vybestack/llxprt-code-providers'] || d['@vybestack/llxprt-code']) process.exit(1)"
# Verify test-utils is devDependency only
node -e "const p=require('./packages/tools/package.json'); if (p.dependencies && p.dependencies['@vybestack/llxprt-code-test-utils']) process.exit(1)"
# Verify root workspaces include tools
node -e "const p=require('./package.json'); if (!p.workspaces.includes('packages/tools')) process.exit(1)"
# Verify package-lock includes tools
node -e "const p=require('./package-lock.json'); if (!p.packages['packages/tools']) process.exit(1)"
# Verify non-tools-core-dependency-map has zero FORBIDDEN_UNRESOLVED entries
! rg -n "FORBIDDEN_UNRESOLVED" project-plans/issue1585/analysis/non-tools-core-dependency-map.md
# Expected: exit code 0 (zero FORBIDDEN_UNRESOLVED entries)
# Verify mcp-tool-decision artifact exists
test -f project-plans/issue1585/analysis/mcp-tool-decision.md && echo "ok"
# Verify moved utility external deps scanned
test -f project-plans/issue1585/analysis/moved-utility-external-imports.txt && echo "ok"
```

### After P10 (Tool Move TDD)

```bash
npm run test --workspace @vybestack/llxprt-code-tools
# Verify pre-extraction characterization fixtures exist with concrete golden values (not placeholders)
! rg -n "placeholder|TODO|FIXME|captured output|expected list" packages/tools/src/__tests__/fixtures -g "*.ts"
# Expected: exit code 0 (zero placeholder markers)
# Verify fixture files exist
ls packages/tools/src/__tests__/fixtures/*.ts | wc -l
# Expected: 3+ fixture files
# Verify fixture capture script exists and was executed
test -f project-plans/issue1585/analysis/capture-pre-extraction-fixtures.mjs
# Verify test count
ls packages/tools/src/__tests__/fixtures/*.ts | wc -l
# Expected: 3+ fixture files
# Verify test count
ls packages/tools/src/__tests__/*.test.ts | wc -l
# Expected: 11+ test groups
# Verify test fixtures do not import core/providers (anti-coupling rule)
! rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers" packages/tools/src/__tests__/fixtures -g "*.ts"
# Expected: exit code 0 (zero matches)
# Verify tools export manifest exists (P06-P08 stub requirement)
test -f project-plans/issue1585/analysis/tools-public-export-manifest.md
```

### After P11 (Tool Move — Grouped Compile-Safe Migrations)

```bash
# Forbidden import scan using rg (consistent syntax) — failing form
! rg -n "@vybestack/llxprt-code-core|packages/core/src|@vybestack/llxprt-code-providers|packages/providers/src|packages/cli/src" packages/tools/src -g "*.ts"
# Expected: exit code 0 (zero matches)
# Verify no core runtime/history imports in moved code
! rg -n "runtime/contracts|services/history" packages/tools/src -g "*.ts"
# Expected: exit code 0 (zero matches)
# Typecheck both packages after EACH group
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run typecheck --workspace @vybestack/llxprt-code-core
# Run behavioral tests
npm run test --workspace @vybestack/llxprt-code-tools
npm run test --workspace @vybestack/llxprt-code-core
# Verify adapters exist
ls packages/core/src/tools-adapters/Core*Adapter.ts | wc -l
# Expected: 14 (mandatory) or 15 (with CoreMcpToolServiceAdapter if mcp-tool moves)
ls packages/core/src/tools-adapters/Core*Adapter.ts
# List exact adapter files:
# CoreToolHostAdapter.ts, CoreToolRegistryHostAdapter.ts, CoreMessageBusAdapter.ts,
# CoreShellToolHostAdapter.ts, CoreSubagentServiceAdapter.ts, CoreAsyncTaskServiceAdapter.ts,
# CoreSkillServiceAdapter.ts, CoreIdeServiceAdapter.ts, CoreLspServiceAdapter.ts,
# CoreStorageServiceAdapter.ts, CoreToolKeyStorageAdapter.ts, CoreTodoServiceAdapter.ts,
# CoreSettingsServiceAdapter.ts, CorePromptRegistryServiceAdapter.ts
# + CoreMcpToolServiceAdapter.ts (conditional: only if mcp-tool.ts moves)
# Verify MCP client/manager remain in core
test -f packages/core/src/tools/mcp-client.ts
test -f packages/core/src/tools/mcp-client-manager.ts
# Verify ToolKeyStorage class stays in core
test -f packages/core/src/tools/tool-key-storage.ts
```

### After P12 (Adapters + Registry Integration)

```bash
npm run typecheck
npm run test --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code-tools
# Verify no remaining old imports for moved modules — failing form
! rg -n "from ['\"]\.\.\/tools\/" packages/core/src -g "*.ts" | rg "mcp-client|mcp-client-manager|tools-adapters"
# Expected: exit code 0 (zero matches for moved modules except retained)
```

### After P13 (Consumer Migration)

```bash
npm run typecheck
npm run test --workspaces --if-present
# Zero old deep imports in providers — failing form
! rg -n "@vybestack/llxprt-code-core/tools/" packages/providers/src -g "*.ts"
# Expected: exit code 0 (zero matches for moved modules)
# Zero CLI direct tools deep imports — failing form
! rg -n "from ['\"]@vybestack/llxprt-code-core/tools/" packages/cli -g "*.ts"
# Expected: exit code 0
# A2A server still compiles and tests pass
npm run typecheck --workspace @vybestack/llxprt-code-a2a-server
npm run test --workspace @vybestack/llxprt-code-a2a-server
```

### After P14 (Release)

```bash
npm run test:scripts
node scripts/bind-release-deps.js --dry-run
rg -n "@vybestack/llxprt-code-tools" .github/workflows/release.yml .github/workflows/build-sandbox.yml scripts/tests/release-process.test.js scripts/build_sandbox.js Dockerfile package.json packages/tools/package.json
test -f project-plans/issue1585/manual-trusted-publishing.md
# scripts/version.js coverage
rg -n "@vybestack/llxprt-code-tools" scripts/version.js
# scripts/prepare-package.js coverage
rg -n "copyFiles.*tools|'tools'" scripts/prepare-package.js
# scripts/build.js workspaces coverage
rg -n "workspaces" scripts/build.js
# Dockerfile install order (tools, core, providers, cli)
rg -n "npm install.*tools|COPY.*tools" Dockerfile
# Verify release.yml includes --tag and --dry-run for tools
rg -n "NPM_TAG.*tools|is_dry_run.*tools" .github/workflows/release.yml
```

### After P15 (Cleanup)

```bash
find packages/core/src/tools -type f -name '*.ts' | sort
# Must match approved retained-file list
rg -n "@vybestack/llxprt-code-tools" packages/core/src/tools -g "*.ts"
# Expected: zero (no re-export shims)
```

## Global Checks

Run after any phase that changes production code or package metadata:

```bash
npm run typecheck
npm run test --workspaces --if-present
```

## Forbidden Import Checks

After packages/tools exists and migration begins:

```bash
# Failing form: returns exit code 1 if any forbidden import found
! rg -n "@vybestack/llxprt-code-core|packages/core/src|\.\./core/|\.\./config/|\.\./confirmation-bus/|\.\./services/" packages/tools/src -g "*.ts"
# Expected: exit code 0 (no matches)
```

After provider utility migration:

```bash
# Failing form
! rg -n "@vybestack/llxprt-code-core/tools/" packages/providers/src -g "*.ts"
# Expected: exit code 0 (zero matches for modules moved to packages/tools)
```

After cleanup:

```bash
find packages/core/src/tools -type f -name '*.ts' | sort
# Expected: only intentionally retained core infrastructure (mcp-client, mcp-client-manager)
```

## Package Metadata Constraints Checks

After packages/tools has package.json:

```bash
# Anti-cycle: tools has no core/providers/cli dependency
node -e "const p=require('./packages/tools/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; if (d['@vybestack/llxprt-code-core'] || d['@vybestack/llxprt-code-providers'] || d['@vybestack/llxprt-code']) process.exit(1)"
# test-utils is devDependency only
node -e "const p=require('./packages/tools/package.json'); if (p.dependencies && p.dependencies['@vybestack/llxprt-code-test-utils']) process.exit(1)"
# tools exports exist
node -e "const p=require('./packages/tools/package.json'); if (!p.exports || !p.exports['.']) process.exit(1)"
# tsconfig anti-cycle
node -e "const c=require('./packages/tools/tsconfig.json'); if ((c.references||[]).some(r => String(r.path).includes('../core') || String(r.path).includes('../providers') || String(r.path).includes('../cli'))) process.exit(1)"
```

## No-Shim Scan

After cleanup, use `rg` for consistent syntax (not `grep`):

```bash
# No-shim scan restricted to packages/core/src/tools/** only (NOT core/src/index.ts)
# Failing form: returns exit code 1 if any shim found
! rg -n "export \\* from ['\"]@vybestack/llxprt-code-tools|export \\{.*\\} from ['\"]@vybestack/llxprt-code-tools" packages/core/src/tools -g "*.ts"
# Expected: exit code 0 (zero matches)

# Separately verify allowed top-level re-exports in packages/core/src/index.ts (allowed)
rg -n "export .* from ['\"]@vybestack/llxprt-code-tools" packages/core/src/index.ts
# Expected: non-zero (CLI-compatible type re-exports are allowed)
```

**Separation rule**: `packages/core/src/tools/**` → zero re-exports from `@vybestack/llxprt-code-tools`. `packages/core/src/index.ts` → allowed explicit re-exports for public API compatibility. This is REQ-NO-SHIM-SCOPE per `plan/requirements-appendix.md`.

## Retained Core Tools Allowlist

After P15, `packages/core/src/tools/` may only contain files from this allowlist:

| File | Classification | Rationale |
| --- | --- | --- |
| mcp-client.ts | STAY_CORE_INFRASTRUCTURE | OAuth/auth/token-storage MCP infrastructure |
| mcp-client-manager.ts | STAY_CORE_INFRASTRUCTURE | MCP client lifecycle management |
| tool-key-storage.ts | STAY_CORE_INFRASTRUCTURE | SecureStore/keyring-backed ToolKeyStorage class |
| mcp-client.test.ts | TEST_STAYS_WITH_SOURCE | Test for retained MCP client |
| mcp-client-manager.test.ts | TEST_STAYS_WITH_SOURCE | Test for retained MCP client manager |
| tool-key-storage.test.ts | TEST_STAYS_WITH_SOURCE | SecureStore integration test only |
| mcp-tool.ts | STAY_CORE_INFRASTRUCTURE (conditional) | Only if it cannot move without core coupling |

**All other core/tools files are moved or removed.** No core/tools file may re-export from packages/tools.

Verify:
```bash
find packages/core/src/tools -type f -name '*.ts' | sort
# Must match allowlist above
find packages/core/src/tools -type f -name '*.ts' | sort | wc -l
# Expected: 3-6 (mcp-client.ts, mcp-client-manager.ts, tool-key-storage.ts, + their tests if they exist, + mcp-tool.ts if conditional stay)
```

**Retained-file verification**: Compare actual files with move-map retained list:
```bash
# Compare actual files with move-map-final retained list — failing form
find packages/core/src/tools -type f -name "*.ts" | sort > /tmp/actual-core-tools.txt
rg "STAY_CORE_INFRASTRUCTURE" project-plans/issue1585/analysis/move-map-final.md | awk '{print $1}' | sort > /tmp/expected-retained.txt
! diff /tmp/actual-core-tools.txt /tmp/expected-retained.txt
# Expected: exit code 0 (actual matches expected — no diff)
```

**Retained-file verification command** (from review-03):
```bash
# Compare actual files with move-map-final retained list — failing form
find packages/core/src/tools -type f -name "*.ts" | sort > /tmp/actual-core-tools.txt
rg "STAY_CORE_INFRASTRUCTURE" project-plans/issue1585/analysis/move-map-final.md | awk '{print $1}' | sort > /tmp/expected-retained.txt
! diff /tmp/actual-core-tools.txt /tmp/expected-retained.txt
# Expected: exit code 0 (actual matches expected — no diff)
```

## Behavioral Regression Checks

Specific test selections must cover:

- Filesystem read/write/list/glob/grep tools (packages/tools tests with pre-extraction fixtures)
- Edit/apply-patch/AST edit behavior (packages/tools tests)
- Shell approval/execution behavior through adapters (packages/tools tests)
- Task/list-subagents/check-async-tasks through adapters (packages/tools tests)
- Todo tools and todo continuation integration (packages/tools tests)
- MCP tool wrapper behavior or documented deferral (packages/tools or core tests)
- Provider ToolFormatter and tool ID normalization behavior (providers tests with characterization fixtures)
- ToolRegistry discovery and built-in registration (core integration tests)
- Scheduler execution of a representative moved tool (core integration tests)
- Tool key storage masking, resolution, and IToolKeyStorage adapter (packages/tools tests with key-storage fixtures)
- Memory tool and LLXPRT dir path resolution (packages/tools tests)
- Boundary scan: forbidden imports, no shims, package metadata constraints (packages/tools boundary test)

## Key Storage And Memory Path Regression Coverage

```bash
npm run test --workspace @vybestack/llxprt-code-tools -- --grep "key.*storage|maskKey|tool.*key|memory|LLXPRT.*dir|storage.*path"
```

## Semantic Review Questions

Every verification phase must answer:

1. Does the code still execute the same user-facing behavior through existing CLI/scheduler paths?
2. Is the moved code reachable, or was it copied into an isolated package only?
3. Does packages/tools avoid importing core/cli/providers?
4. Are adapters narrow and explicit, or did Config/MessageBus become hidden service bags?
5. Are all interfaces consumed by tools tools-owned (no core-local interfaces)?
6. Are tests behavioral (asserting ToolResult, filesystem state, provider output, storage state) and would they fail if the real implementation were broken?
7. Are release and sandbox workflows updated so the package can be published and consumed?
8. Does key storage/memory path behavior match pre-extraction behavior?
9. Do scripts/version.js, scripts/prepare-package.js, and scripts/build.js cover the tools package?
10. Is the Dockerfile install order tools -> core -> providers -> cli?
11. Is the sandbox pack order tools before core/providers/cli (tools pack first)?
12. Is `@vybestack/llxprt-code-test-utils` a devDependency-only of packages/tools?
13. Are IToolFormatter exports mapped to `dist/src/formatters/IToolFormatter.js` (not `dist/src/interfaces/`)?
14. Does the exact adapter count match the expected list (14 mandatory + 1 conditional CoreMcpToolServiceAdapter)?
15. Do test fixtures in packages/tools avoid importing from core/providers?
16. Does `npm run format` produce zero diff (`git diff --quiet -- ':!project-plans/'`)?

# Phase 6: Wire Orchestrator + Update All Callers

**Subagent:** `typescriptexpert`
**Prerequisite:** Phase 5 config builder/runtime extraction passes verification
**Verification:** `npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

## Goal

This is the "big bang" phase. Rewrite `loadCliConfig` as a thin orchestrator that delegates to all extracted modules. Update ALL remaining callers. Remove dead re-exports. After this phase, config.ts should be ~120-180 lines.

**This is the riskiest phase.** Every test mock that references config.ts must be checked and potentially migrated.

## What To Read First

- `project-plans/issue1582/plan/00-overview.md` — critical ordering guarantees (the 17-step sequence), caller tables, mock migration notes
- `packages/cli/src/config/config.ts` — the current monolith (will be gutted)
- `packages/cli/src/config/config.test.ts` — 2,305 lines with heavy `vi.mock()` usage
- `packages/cli/src/config/config.integration.test.ts` — uses extensionless imports
- All new modules from Phases 2-5

## Task 6.1: Rewrite `config.ts`

After all extractions, `config.ts` contains ONLY:
- Imports from the new modules
- `loadCliConfig()` as a thin orchestrator

Target structure of `loadCliConfig`:
```typescript
export async function loadCliConfig(
  settings: Settings,
  extensions: GeminiCLIExtension[],
  extensionEnablementManager: ExtensionEnablementManager,
  sessionId: string,
  argv: CliArgs,
  cwd: string = process.cwd(),
  runtimeOverrides: { settingsService?: SettingsService } = {},
): Promise<Config> {
  // Step 1-2: Bootstrap (existing profileBootstrap functions)
  const bootstrapParsed = parseBootstrapArgs();
  const runtimeState = await prepareRuntimeForProfile(/* ... */);

  // Step 3: Profile resolution and loading
  const { profileToLoad, profileExplicitlySpecified } = resolveProfileToLoad(/* ... */);
  const profileResult = await loadAndPrepareProfile(/* ... */);
  const effectiveSettings = profileResult.effectiveSettings;

  // Step 4: Context and environment resolution
  const context = resolveContextAndEnvironment(/* ... */);

  // Step 5: Memory loading
  const memoryResult = await loadMemoryContent(/* ... */);

  // Step 6: MCP server resolution
  const mergedMcpServers = mergeMcpServers(effectiveSettings, context.activeExtensions);
  const mcpResult = filterMcpServers(/* ... */);

  // Step 7: Approval mode
  const approvalMode = resolveApprovalMode(/* ... */);

  // Step 8: Provider and model resolution
  const providerModel = resolveProviderAndModel(/* ... */);

  // Intermediate: screen reader, policy, ripgrep, output format, sandbox, question, excludeTools
  // (small inline computations, ~20 lines total)

  // Step 9: Build Config object
  const config = buildConfig(/* ... */);

  // Steps 10-17: Post-config runtime finalization
  return finalizeConfig(/* ... */);
}
```

**Target: `loadCliConfig` body ~80-120 lines** — pure orchestration, no business logic.

## Task 6.2: Remove dead re-exports

Remove lines 2016-2023 (re-exports from `../runtime/runtimeAccessors.js`). Verified no caller imports through this path.

## Task 6.3: Update ALL remaining production imports

| File | Old Import | New Import |
|------|-----------|------------|
| `gemini.tsx` | `from './config/config.js'` | `loadCliConfig` from `./config/config.js`, `parseArguments` from `./config/cliArgParser.js` |
| `commands/skills/list.ts` | `from '../../config/config.js'` | `loadCliConfig` from `../../config/config.js`, `CliArgs` from `../../config/cliArgParser.js` |
| `ui/commands/memoryCommand.ts` | `from '../../config/config.js'` | `from '../../config/environmentLoader.js'` |
| `ui/containers/SessionController.tsx` | `from '../../config/config.js'` | `from '../../config/environmentLoader.js'` |
| `ui/containers/AppContainer/hooks/useMemoryRefreshAction.ts` | `from '../../../../config/config.js'` | `from '../../../../config/environmentLoader.js'` |

## Task 6.4: Update ALL test imports

| File | Old Import | New Import |
|------|-----------|------------|
| `config.test.ts` | `from './config.js'` | `loadCliConfig` from `./config.js`, `parseArguments` from `./cliArgParser.js` |
| `config.loadMemory.test.ts` | `from './config.js'` | `loadCliConfig` from `./config.js`, `CliArgs` from `./cliArgParser.js` |
| `config.kimiModelBootstrap.test.ts` | `from './config.js'` | `parseArguments` from `./cliArgParser.js`, `loadCliConfig` from `./config.js` |
| `__tests__/continueFlagRemoval.spec.ts` | `from '../config.js'` | `from '../cliArgParser.js'` |
| `__tests__/nonInteractiveTools.test.ts` | `from '../config.js'` | `from '../toolGovernance.js'` |
| `gemini.test.tsx` | `from './config/config.js'` | `loadCliConfig` from `./config/config.js`, `parseArguments` from `./config/cliArgParser.js` |
| `commands/skills/list.test.ts` | `from '../../config/config.js'` | `from '../../config/config.js'` (loadCliConfig stays in config.ts) |
| `ui/commands/memoryCommand.test.ts` | `from '../../config/config.js'` | `from '../../config/environmentLoader.js'` |

## Task 6.5: Migrate mock paths (CRITICAL)

Any test that uses `vi.mock('./config.js')` or `vi.mock('../../config/config.js')` must be checked. If the mock targets symbols that moved, the mock path must be updated to the new module.

**`config.test.ts` (2,305 lines)** uses extensive `vi.mock()` for:
- `'../runtime/runtimeSettings.js'` (dynamic import mocked)
- `'./config.js'` (self-reference in integration-style tests)
- Various core module mocks

Each moved function requires updating:
1. The mock target path (e.g., `vi.mock('./config.js')` → `vi.mock('./cliArgParser.js')`)
2. The import path in the test's own imports
3. Any `vi.importActual` calls that reference the old module

### Mandatory mock-migration verification

Before considering this phase complete, run ALL of the following checks. These are **hard gates** — do not proceed until all pass:

```bash
# 1. Find ALL vi.mock, vi.importActual, and vi.hoisted calls in config-related test files
grep -rn "vi\.mock\|vi\.importActual\|vi\.hoisted" packages/cli/src/config/ --include="*.test.*" --include="*.spec.*"
# Review EVERY hit: verify the mock path matches the current location of the mocked symbol

# 2. Verify no stale vi.mock paths remain for ANY moved symbol
grep -rn "vi\.mock.*['\"]\.\/config['\"]" packages/cli/src/config/ --include="*.test.*" --include="*.spec.*"
# Review each hit: the mock should only target symbols that STILL live in config.ts (i.e., loadCliConfig)
# If a mock targets parseArguments, CliArgs, READ_ONLY_TOOL_NAMES, loadHierarchicalLlxprtMemory, etc. — it's STALE

# 3. Broader stale mock check across the entire cli package
grep -rn "vi\.mock.*config/config\|vi\.mock.*['\"]\.\/config['\"]" packages/cli/src/ --include="*.test.*" --include="*.spec.*"
# Same review as above but for files outside the config/ directory

# 4. Check for stale vi.importActual calls specifically
grep -rn "vi\.importActual.*config" packages/cli/src/ --include="*.test.*" --include="*.spec.*"
# Each hit must reference the correct module for the symbols it's importing

# 5. Check for stale vi.hoisted calls
grep -rn "vi\.hoisted.*config" packages/cli/src/ --include="*.test.*" --include="*.spec.*"
# Same review — hoisted mocks must target the correct module

# 6. Find dynamic import mocks
grep -rn "import(" packages/cli/src/config/config.test.ts | head -20
```

### Mock-path migration checklist for `config.test.ts`

`config.test.ts` is the highest-risk file for mock breakage. Before marking this phase complete:

- [ ] Every `vi.mock('./config.js')` call reviewed — does it mock symbols still in config.ts, or symbols that moved?
- [ ] Every `vi.mock` for moved symbols updated to new module path (e.g., `vi.mock('./cliArgParser.js')`, `vi.mock('./environmentLoader.js')`, `vi.mock('./toolGovernance.js')`)
- [ ] Every `vi.importActual('./config.js')` call reviewed — if it imports moved symbols, path updated
- [ ] Every `vi.hoisted` call reviewed for stale references
- [ ] All mock factory functions checked — the returned mock object must match the new module's exports (not the old config.ts exports)
- [ ] `npm run test` passes with zero mock-related failures

## Post-Phase Mechanical Verification (ALL must pass)

```bash
# 1. No stale imports to config/config.js for moved symbols
grep -rn "from.*config/config" packages/cli/src/ --include="*.ts" --include="*.tsx" | grep -E "parseArguments|CliArgs|READ_ONLY_TOOL_NAMES|loadHierarchicalLlxprtMemory|isDebugMode|loadEnvironment"
# Expected: ZERO hits

# 2. No runtime accessor re-exports remain
grep -rn "getCliRuntimeConfig\|getCliRuntimeServices\|getCliProviderManager\|getActiveProviderStatus\|listRuntimeProviders" packages/cli/src/config/config.ts
# Expected: ZERO hits

# 3. config.ts line count
wc -l packages/cli/src/config/config.ts
# Expected: ~120-180 lines

# 4. All tests pass
npm run test
```

## Constraints

- No file >800 lines, no function >80 lines
- `loadCliConfig` body MUST be <80 lines (ideally ~80-120 with comments)
- If intermediate computations push it over, extract a `resolvePreConfigState` helper
- ALL parity tests from Phase 1 must pass — this is the primary safety net
- ALL existing tests must pass — if a test fails due to mock path changes, fix the mock path (not the test logic)

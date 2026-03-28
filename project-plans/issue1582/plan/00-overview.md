# Issue #1582: Break Up `packages/cli/src/config/config.ts`

> **Note:** File sizes and line counts in this plan were measured at plan creation time. Run `wc -l` to verify current sizes before implementation.

## Parent Issue

[#1568](https://github.com/vybestack/llxprt-code/issues/1568) — 0.10.0 Code Improvement Plan

**Critical constraint from #1568:** "This must be a refactoring, and the subissues must avoid creating backward compatibility shims to avoid migrating imports." This means **no re-exports from config.ts** — all callers must be updated to import from the new canonical locations.

## What Is Being Asked

Decompose `packages/cli/src/config/config.ts` from a 2,023-line monolith into focused, single-responsibility modules. The file currently contains:

1. **CLI argument parsing** (`parseArguments`, `CliArgs` interface) — ~530 lines of yargs configuration
2. **Environment/memory loading** (`loadEnvironment`, `findEnvFile`, `isDebugMode`, `loadHierarchicalLlxprtMemory`) — ~80 lines
3. **Tool governance** (`READ_ONLY_TOOL_NAMES`, `normalizeToolNameForPolicy`, `buildNormalizedToolSet`, `createToolExclusionFilter`, `mergeExcludeTools`, + inline tool policy logic) — ~120 lines
4. **MCP server configuration** (`mergeMcpServers`, `allowedMcpServers`, + inline MCP filtering) — ~80 lines
5. **The monolithic `loadCliConfig` orchestrator** (~1,107 lines) which handles:
   - Profile loading/application
   - Approval mode resolution
   - Provider/model precedence chains
   - Interactive mode detection
   - File filtering/include directories
   - Config object construction
   - Runtime setup & provider switching
   - Ephemeral settings propagation
   - Hooks configuration
   - Default disabled tools seeding
6. **Re-exports** from `../runtime/runtimeAccessors.js` (verified unused through this path — no caller imports these via config.ts)

## Acceptance Criteria

- [ ] No single file exceeds 800 lines
- [ ] No single function exceeds 80 lines
- [ ] All existing tests pass
- [ ] Test coverage does not decrease
- [ ] No backward compatibility re-exports — callers are updated directly
- [ ] Clean architecture with typed interfaces between modules

## Current Callers (Must Be Updated)

### Production Code
| File | Imports |
|------|---------|
| `gemini.tsx` | `loadCliConfig`, `parseArguments` |
| `commands/skills/list.ts` | `loadCliConfig`, `CliArgs` |
| `ui/commands/memoryCommand.ts` | `loadHierarchicalLlxprtMemory` |
| `ui/containers/SessionController.tsx` | `loadHierarchicalLlxprtMemory` |
| `ui/containers/AppContainer/hooks/useMemoryRefreshAction.ts` | `loadHierarchicalLlxprtMemory` |

### Test Code
| File | Imports |
|------|---------|
| `config.test.ts` | `loadCliConfig`, `parseArguments` |
| `config.loadMemory.test.ts` | `loadCliConfig`, `CliArgs` |
| `config.kimiModelBootstrap.test.ts` | `parseArguments`, `loadCliConfig` |
| `__tests__/continueFlagRemoval.spec.ts` | `parseArguments` |
| `__tests__/nonInteractiveTools.test.ts` | `READ_ONLY_TOOL_NAMES` |
| `gemini.test.tsx` | `loadCliConfig`, `parseArguments` |
| `commands/skills/list.test.ts` | `loadCliConfig` |
| `ui/commands/memoryCommand.test.ts` | `loadHierarchicalLlxprtMemory` |

### Mechanical Verification (run before implementation — hard gate, paste results in PR)
```bash
# 1. Verify all imports from config/config.js AND extensionless variants — every hit must be in the tables above
grep -rn "from.*['\"].*config/config\|from.*['\"]\.\/config['\"]" packages/cli/src/ --include="*.ts" --include="*.tsx"

# 2. Verify no one imports runtime accessors through config.ts
grep -rn "getCliRuntimeConfig\|getCliRuntimeServices\|getCliProviderManager\|getActiveProviderStatus\|listRuntimeProviders" packages/cli/src/ --include="*.ts" --include="*.tsx" | grep "from.*config/config"

# 3. Verify mock paths in test files that reference config.ts (both .js and extensionless)
grep -rn "vi.mock.*config/config\|vi.mock.*\./config\|jest.mock.*config/config\|vi.mock.*['\"]\.\/config['\"]" packages/cli/src/ --include="*.ts" --include="*.tsx"

# 4. Verify dynamic imports referencing config
grep -rn "import(.*config/config\|import(.*\./config" packages/cli/src/ --include="*.ts" --include="*.tsx"

# 5. Verify type-only imports of moved symbols (should reference new canonical locations, not config/config)
grep -rn "import type.*from.*config/config" packages/cli/src/ --include="*.ts" --include="*.tsx"
```

### Full Symbol Mapping Table

Every exported and non-exported symbol in `config.ts` mapped to its destination:

> **WARNING: Line numbers are approximate.** They were captured at plan creation time and will drift as earlier phases modify `config.ts`. Implementers should use **symbol names** (function names, variable names, interface names) to locate code, not line numbers. When in doubt, use `grep -n` to find the current location of a symbol before extracting it.

| Symbol | Type | Lines | Destination |
|--------|------|-------|-------------|
| `LLXPRT_DIR` | const (private) | 76 | `environmentLoader.ts` |
| `logger` | const (private) | 78 | stays in `config.ts` (or each module creates its own) |
| `READ_ONLY_TOOL_NAMES` | export const | 80-95 | `toolGovernance.ts` |
| `EDIT_TOOL_NAME` | const (private) | 97 | `toolGovernance.ts` |
| `normalizeToolNameForPolicy` | function (private) | 99-100 | `toolGovernance.ts` |
| `buildNormalizedToolSet` | function (private) | 102-136 | `toolGovernance.ts` |
| `CliArgs` | export interface | 138-186 | `cliArgParser.ts` |
| `parseArguments` | export async function | 188-718 | `cliArgParser.ts` + `yargsOptions.ts` |
| `loadHierarchicalLlxprtMemory` | export async function | 723-762 | `environmentLoader.ts` |
| `createToolExclusionFilter` | function (private) | 779-792 | `toolGovernance.ts` |
| `isDebugMode` | export function | 794-801 | `environmentLoader.ts` |
| `loadCliConfig` | export async function | 803-1910 | `config.ts` (orchestrator, delegates to all modules) |
| `loadCliConfig` → `prepareProfileForApplication` | nested function | 838-890 | `profileResolution.ts` |
| `loadCliConfig` → profile resolution chain | inline logic | 928-1014 | `profileResolution.ts` |
| `loadCliConfig` → context resolution | inline logic | 1016-1130 | `interactiveContext.ts` |
| `loadCliConfig` → approval mode resolution | inline logic | 1140-1194 | `approvalModeResolver.ts` |
| `loadCliConfig` → interactive/tool excludes | inline logic | 1196-1240 | `interactiveContext.ts` + `toolGovernance.ts` |
| `loadCliConfig` → MCP filtering | inline logic | 1241-1270 | `mcpServerConfig.ts` |
| `loadCliConfig` → provider/model resolution | inline logic | 1274-1329 | `providerModelResolver.ts` |
| `loadCliConfig` → Config construction | inline logic | 1379-1534 | `configBuilder.ts` |
| `loadCliConfig` → runtime setup | inline logic | 1536-1574 | `postConfigRuntime.ts` |
| `loadCliConfig` → profile application | inline logic | 1576-1667 | `profileRuntimeApplication.ts` (called by `postConfigRuntime.ts`) |
| `loadCliConfig` → CLI overrides | inline logic | 1669-1761 | `postConfigRuntime.ts` |
| `loadCliConfig` → tool governance | inline logic | 1763-1817 | `toolGovernance.ts` (computed), `postConfigRuntime.ts` (applied) |
| `loadCliConfig` → ephemeral settings | inline logic | 1819-1907 | `postConfigRuntime.ts` |
| `allowedMcpServers` | function (private) | 1912-1941 | `mcpServerConfig.ts` |
| `mergeMcpServers` | function (private) | 1943-1961 | `mcpServerConfig.ts` |
| `mergeExcludeTools` | function (private) | 1963-1978 | `toolGovernance.ts` |
| `findEnvFile` | function (private) | 1980-2007 | `environmentLoader.ts` |
| `loadEnvironment` | export function | 2009-2014 | `environmentLoader.ts` |
| Re-exports from runtimeAccessors | export re-export | 2016-2023 | **REMOVED** (unused through this path) |

**Note:** `loadEnvironment` and `findEnvFile` also exist in `settings.ts` with different signatures. The `config.ts` versions are simpler and used only internally. This duplication is a pre-existing issue outside the scope of this refactor.

---

## Proposed Architecture

### New Module Structure

```
packages/cli/src/config/
├── cliArgParser.ts              # CliArgs interface, parseArguments() (thin assembler), command wiring
├── yargsOptions.ts              # Static yargs option definition objects (declarative data only, no command wiring)
├── environmentLoader.ts         # findEnvFile, loadEnvironment, isDebugMode, loadHierarchicalLlxprtMemory
├── toolGovernance.ts            # READ_ONLY_TOOL_NAMES, tool normalization, exclusion filters, policy computation
├── mcpServerConfig.ts           # MCP server merging, filtering, allow/exclude logic
├── approvalModeResolver.ts      # Approval mode precedence chain + security overrides + trust overrides
├── providerModelResolver.ts     # Provider (4-level) and model (6-level) precedence chains
├── interactiveContext.ts        # Interactive mode, IDE mode, include dirs, file filtering, trust, extensions
├── configBuilder.ts             # Config object construction, split into sub-builders
├── postConfigRuntime.ts         # All post-Config side effects, split into ordered sub-functions
├── profileResolution.ts         # Pure profile resolution: parse, resolve, load, merge settings
├── profileRuntimeApplication.ts # Impure profile application: applyProfileSnapshot, warnings, provider updates
├── *Contracts.ts                # Domain-scoped DTOs, created as needed when shared between 2+ modules
├── config.ts                    # Thin orchestrator: loadCliConfig coordinates the above modules
├── profileBootstrap.ts          # (existing — NOT extended, to stay under 800 lines)
└── ... (existing files unchanged)
```

### Design Principles

1. **Each module has a concrete typed contract** — resolver functions take explicit typed inputs and return typed outputs via DTOs defined in domain-scoped contract files (no `Awaited<ReturnType<...>>` leakage)
2. **No backward compatibility shims** — config.ts does NOT re-export anything; callers import from the canonical source
3. **Pure functions where possible** — resolvers return values; mutations happen only in the orchestrator or `postConfigRuntime.ts`
4. **The orchestrator stays in config.ts** because `loadCliConfig` IS the core responsibility of config.ts — it just delegates to focused helpers
5. **`yargsOptions.ts` is declarative data only** — command wiring (`mcpCommand`, `skillsCommand`, `hooksCommand`, `extensionsCommand`) stays in `cliArgParser.ts`
6. **Provider/profile lifecycle ordering is preserved exactly** — the orchestrator documents and enforces the critical ordering guarantees
7. **Mandatory sub-splitting** — any function projected to exceed 80 lines MUST be split up front, not conditionally. Sub-builders and sub-finalizers are required, not optional.
8. **Preserve dynamic import semantics** — two dynamic imports in `loadCliConfig` tail (`import('../runtime/runtimeSettings.js')`) use lazy loading intentionally; preserve this behavior unless measured reason to change
9. **Deduplicate yargs option definitions** — `parseArguments` currently registers some options both at command scope and root scope; normalize to single registration point during extraction
10. **Every extraction step starts with a failing test** — per `dev-docs/RULES.md`, no production code moves without a test proving the extraction didn't break behavior
11. **Immutability in contracts** — use `readonly` arrays/records in all DTO interfaces (`readonly string[]`, `ReadonlySet<string>`, `Readonly<Record<...>>`) to enforce immutability at the type level
12. **Minimal function inputs** — each extracted function receives only the fields it needs, not bulky composite objects. If a sub-function only needs 3 fields from a 15-field DTO, define a narrow input type or pass individual args
13. **Pragmatic DTO ownership** — input/output DTOs colocate in each module that defines them. When a DTO is needed by 2+ modules, extract to a domain-scoped contract file (`profileContracts.ts`, `contextContracts.ts`, etc.). Do NOT pre-create empty contract files
14. **Explicit settings naming across module boundaries** — when passing settings across module boundaries, use explicit names (`baseSettings`, `profileMergedSettings`) rather than generic `effectiveSettings` to make the lifecycle stage clear at each call site. The orchestrator in `config.ts` should name variables to reflect whether settings have had profile overrides applied or not, and each extracted module's input types should use descriptive parameter names that communicate which stage of settings processing they expect.
15. **Per-module debug loggers** — each extracted module creates its own `DebugLogger` instance with a descriptive namespace (e.g., `'llxprt:config:approvalMode'`, `'llxprt:config:toolGovernance'`). Do not share logger instances across modules. This ensures debug output is attributable to the specific module that produced it.

### Critical Ordering Guarantees (MUST be preserved)

The following operations in `loadCliConfig` have **order-dependent side effects**. The orchestrator must call them in this exact sequence:

**Important:** `registerCliProviderInfrastructure` is called in TWO places today:
1. Inside `prepareRuntimeForProfile()` (step 2) — unconditionally, during bootstrap
2. In `loadCliConfig` (step 11) — conditionally (when `oauthManager` exists), via dynamic import of `../runtime/runtimeSettings.js`

This dual-registration is intentional: step 2 sets up initial infrastructure, step 11 re-registers after the runtime context is fully established. The refactored plan must preserve both calls and their conditions.

```
1. parseBootstrapArgs()                    — parse raw argv for profile/provider/auth
2. prepareRuntimeForProfile()              — create SettingsService, ProviderManager, OAuthManager
                                             (also calls registerCliProviderInfrastructure internally)
3. loadAndPrepareProfile()                 — resolve & load profile, merge ephemeral settings
4. resolveContextAndEnvironment()          — debugMode, ideMode, folderTrust, fileFiltering, extensions
5. loadMemoryContent()                     — conditional on jitContextEnabled
6. mergeMcpServers() + filterMcpServers()  — MCP server resolution
7. resolveApprovalMode()                   — depends on settings + trust from step 4
8. resolveProviderAndModel()               — depends on profile from step 3
9. buildConfig()                           — constructs Config object with all resolved values
10. setCliRuntimeContext()                 — MUST be before step 11's re-registration
11. registerCliProviderInfrastructure()    — RE-REGISTERS (conditional, via dynamic import) after runtime context
12. applyProfileToRuntime()               — uses provider manager from steps 2/11
13. switchActiveProvider()                 — activates the chosen provider
14. reapplyCliOverrides()                  — CLI args win after provider switch clears ephemerals
15. applyToolGovernance()                  — depends on interactive + approvalMode from steps 7-8
16. applyEphemeralSettings()              — profile + /set ephemerals, disabled hooks, onReload
17. seedDefaultDisabledTools()            — uses normalized allowed tools
```

---

## Target File Sizes

| File | Target Lines | Notes |
|------|-------------|-------|
| `config.ts` (orchestrator) | ~120-180 | Just imports + `loadCliConfig` orchestrator (<80 line function) |
| `*Contracts.ts` (on-demand) | ~30-50 each | Created only when DTOs shared by 2+ modules |
| `cliArgParser.ts` | ~100 | Thin assembler + `CliArgs` interface |
| `yargsOptions.ts` | ~450 | Declarative data, no functions >80 lines |
| `environmentLoader.ts` | ~100 | 4 small functions |
| `toolGovernance.ts` | ~180 | Constants + 6 functions |
| `mcpServerConfig.ts` | ~100 | 3 functions |
| `approvalModeResolver.ts` | ~70 | 1 function with clear precedence |
| `providerModelResolver.ts` | ~80 | 1 function + internal alias lookup |
| `profileResolution.ts` | ~180 | 3 pure profile resolution functions |
| `profileRuntimeApplication.ts` | ~100 | 1 impure profile application function |
| `interactiveContext.ts` | ~180 | Main orchestrator + 5 mandatory sub-functions for context resolution |
| `configBuilder.ts` | ~200 | Main builder + 3 mandatory sub-builders |
| `postConfigRuntime.ts` | ~280 | `finalizeConfig` orchestrator + 6 mandatory sub-functions |

**Total: ~2,100-2,300 lines across 14-18 files** — increase from structure/types/contracts overhead, but every file is <800 lines and every function is <80 lines.

---

## Dependency Graph

```
config.ts (orchestrator)
├── *Contracts.ts (domain-scoped DTO files — imported by respective modules)
├── cliArgParser.ts ← yargsOptions.ts
├── environmentLoader.ts
├── profileBootstrap.ts (existing, unchanged)
├── profileResolution.ts (pure)
│   └── profileBootstrap.ts (types only)
├── interactiveContext.ts
│   └── environmentLoader.ts (loadHierarchicalLlxprtMemory)
├── approvalModeResolver.ts (pure, no deps)
├── providerModelResolver.ts (pure, uses providerAliases internally)
├── mcpServerConfig.ts (pure)
├── toolGovernance.ts (pure)
├── configBuilder.ts (uses types from configContracts)
└── postConfigRuntime.ts
    ├── profileRuntimeApplication.ts (applyProfileToRuntime)
    ├── toolGovernance.ts (computeToolGovernancePolicy)
    └── (runtime modules from ../runtime/ — preserves dynamic imports)
```

No circular dependencies. Each module depends only on core types and sibling modules at most one level deep.

---

## What CodeRabbit Got Right vs. What We're Doing Differently

### Agreed with CodeRabbit:
- The overall decomposition direction (arg parsing, env loading, MCP, tool governance, resolvers)
- Extracting pure utilities first, then domain resolvers, then refactoring the orchestrator
- The specific functions identified for extraction

### Departures from CodeRabbit:
1. **No re-exports from config.ts** — CodeRabbit proposed "re-export all public API from config.ts so consumers don't need import changes." Parent issue #1568 explicitly forbids this.
2. **`yargsOptions.ts` for yargs data** — CodeRabbit didn't address the 80-line function limit for `parseArguments`. We extract the declarative option definitions to meet it.
3. **`profileResolution.ts` + `profileRuntimeApplication.ts` instead of extending `profileBootstrap.ts`** — profileBootstrap.ts is already 792 lines; adding more would exceed 800. We also split pure resolution from impure runtime application.
4. **`configBuilder.ts` with mandatory sub-builders** — CodeRabbit mentioned extracting Config construction into a helper but didn't make it a distinct module or require sub-splitting.
5. **`postConfigRuntime.ts` with mandatory sub-functions** — CodeRabbit didn't account for the ~350 lines of post-Config side effects. We consolidate them with explicit ordering documentation and mandatory sub-splitting.
6. **`configContracts.ts`** — Shared DTO types prevent `Awaited<ReturnType<...>>` leakage between modules.
7. **`interactiveContext.ts`** — We combine interactive mode detection with file filtering and include directories. They're cohesive: all about "what environment is the CLI running in."
8. **Parity tests first (Phase 1) + per-module unit tests (Phase 7)** — CodeRabbit's plan had no test strategy. We follow RULES.md with behavioral locking before extraction and unit tests after.
9. **Tagged union for `ToolGovernanceResult`** — avoids semantic overloading of `undefined` as "all allowed."
10. **`originalSettings` vs `effectiveSettings` distinction** — explicit in `ContextResolutionInput` to preserve the subtle difference between base settings (for folderTrust/workspaceTrust) and profile-merged settings.

---

## Execution Protocol

### Subagent Roles

| Role | Subagent | When |
|------|----------|------|
| **Implement** | `typescriptexpert` | Each phase's code changes |
| **Review** | `deepthinker` | After each phase completes and passes verification suite |
| **Remediate** | `typescriptexpert` | When deepthinker finds issues (pass deepthinker's feedback as context) |

### Verification Suite (run after EVERY phase)

```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

If any step fails, remediate with typescriptexpert before proceeding.

### Review Loop Protocol

After each phase passes the verification suite, send to deepthinker for review. The deepthinker prompt must be:

> Review the implementation changes for Phase N of the config.ts decomposition plan at `project-plans/issue1582/plan/00-overview.md`.
>
> 1. Read the plan overview to understand overall architecture.
> 2. Read the specific phase file at `project-plans/issue1582/plan/0N-phasename.md`.
> 3. Read ALL changed/new files using `git diff` or direct file reads.
> 4. Verify the changes match the plan's specifications for this phase.
> 5. Check that no behavioral changes were introduced (pure refactor).
> 6. Verify function sizes (<80 lines), file sizes (<800 lines).
> 7. Check typed contracts are clean and don't leak implementation details.
> 8. Verify caller migrations are complete (no stale imports).
>
> Provide specific, actionable feedback. Do not ask follow-up questions.

**CRITICAL:** Use this exact prompt for every review. Do NOT add "REVISED", "RE-REVIEW", review counts, or any hint about previous reviews. Each review must be a clean, unbiased assessment.

If deepthinker finds issues:
1. Send feedback to typescriptexpert for remediation
2. Run verification suite
3. Send back to deepthinker with the SAME prompt (unchanged)
4. Loop up to 3 times per phase, or until deepthinker is pedantic (minor style nits only)

### Commit Strategy

Commit after each phase passes review (not at the end). This gives clean git history and easier bisection if something regresses later. Use conventional commit messages:

```
refactor(cli-config): Phase N - [short description] (#1582)
```

### Phases

Implementation is split across numbered phase files in `project-plans/issue1582/plan/`:

| Phase File | Description |
|------------|-------------|
| `01-parity-tests.md` | Lock current behavior with targeted behavioral tests |
| `02-extract-pure-utilities.md` | Extract non-parser pure utilities (environmentLoader, toolGovernance, mcpServerConfig) |
| `03-extract-parser.md` | Extract CLI argument parser (cliArgParser + yargsOptions) — separate phase due to higher risk |
| `04-extract-domain-resolvers.md` | Extract pure resolver functions from loadCliConfig |
| `05-config-builder-and-runtime.md` | Extract Config construction + post-Config side effects |
| `06-wire-orchestrator.md` | Rewrite loadCliConfig as thin orchestrator, update all remaining callers |
| `07-per-module-tests.md` | Add unit tests for each extracted module |
| `08-final-verification.md` | Line counts, function sizes, coverage, smoke test |

Each phase file is self-contained — a subagent receives ONLY the overview + one phase file.

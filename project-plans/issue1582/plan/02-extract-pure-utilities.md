# Phase 2: Extract Non-Parser Pure Utility Modules

**Subagent:** `typescriptexpert`
**Prerequisite:** Phase 1 parity tests pass
**Verification:** `npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

## Goal

Extract standalone non-parser functions and constants from `config.ts` into focused modules. These extractions only create new files and update imports — they do NOT touch the `loadCliConfig` function body (that happens in later phases).

Parser extraction (`cliArgParser.ts` + `yargsOptions.ts`) is intentionally deferred to Phase 3 because it carries higher risk due to subcommand wiring, `process.exit` behavior, and duplicated root/command options.

**Critical rule:** No backward compatibility re-exports. Callers are updated to import from the new canonical location.

## What To Read First

- `project-plans/issue1582/plan/00-overview.md` — architecture overview, symbol mapping table, design principles
- `packages/cli/src/config/config.ts` — the monolith being decomposed
- All caller files listed in the overview's "Current Callers" tables

## Task 2.1: Create `environmentLoader.ts`

**What moves:**
- `LLXPRT_DIR` constant (line 76)
- `findEnvFile()` (lines 1980-2007)
- `loadEnvironment()` (lines 2009-2014)
- `isDebugMode()` (lines 794-801)
- `loadHierarchicalLlxprtMemory()` (lines 723-762)
- Required imports: `fs`, `path`, `homedir`, `dotenv`, `os`, core `FileDiscoveryService`, `loadServerHierarchicalMemory`, etc.

**Caller updates:**
- `ui/commands/memoryCommand.ts`: `import { loadHierarchicalLlxprtMemory } from '../../config/environmentLoader.js'`
- `ui/commands/memoryCommand.test.ts`: same + update any module mocks
- `ui/containers/SessionController.tsx`: `import { loadHierarchicalLlxprtMemory } from '../../config/environmentLoader.js'`
- `ui/containers/AppContainer/hooks/useMemoryRefreshAction.ts`: `import { loadHierarchicalLlxprtMemory } from '../../../../config/environmentLoader.js'`
- `config.ts` imports `isDebugMode`, `loadHierarchicalLlxprtMemory` from `./environmentLoader.js`

## Task 2.2: Create `toolGovernance.ts`

**What moves:**
- `READ_ONLY_TOOL_NAMES` (lines 80-95)
- `EDIT_TOOL_NAME` constant (line 97)
- `normalizeToolNameForPolicy()` (line 99-100)
- `buildNormalizedToolSet()` (lines 102-136)
- `createToolExclusionFilter()` (lines 779-792)
- `mergeExcludeTools()` (lines 1963-1978)

**New function extracted from loadCliConfig (lines 1763-1817 + 1885-1907):**
```typescript
interface ToolGovernanceInput {
  interactive: boolean;
  experimentalAcp: boolean;
  approvalMode: ApprovalMode;
  cliAllowedTools: string[] | undefined;
  settingsAllowedTools: string[] | undefined;
  profileAllowedTools: ReadonlySet<string>;
  explicitAllowedTools: ReadonlySet<string>;
}

type ToolGovernanceResult =
  | { mode: 'all' }                                    // all tools allowed (YOLO, no restrictions)
  | { mode: 'restricted'; allowedTools: string[] };     // only these tools allowed

function computeToolGovernancePolicy(input: ToolGovernanceInput): ToolGovernanceResult
```

**New function for default disabled tools (lines 1885-1907):**
```typescript
interface DefaultDisabledToolsInput {
  defaultDisabledTools: string[] | undefined;
  currentDisabled: string[];
  currentAllowed: ReadonlySet<string>;
}

function computeDefaultDisabledTools(input: DefaultDisabledToolsInput): string[]
```

These are **pure functions** returning values — the orchestrator applies them to config.

**Caller updates:**
- `__tests__/nonInteractiveTools.test.ts`: `import { READ_ONLY_TOOL_NAMES } from '../toolGovernance.js'`

## Task 2.3: Create `mcpServerConfig.ts`

**What moves:**
- `mergeMcpServers()` (lines 1943-1961)
- `allowedMcpServers()` (lines 1912-1941)

**New pure function extracted from loadCliConfig (lines 1241-1270):**
```typescript
interface McpFilterInput {
  mcpServers: Readonly<Record<string, MCPServerConfig>>;
  allowedMcpServerNames: readonly string[] | undefined;
  settingsAllowMCPServers: readonly string[] | undefined;
  settingsExcludeMCPServers: readonly string[] | undefined;
}

interface McpFilterResult {
  mcpServers: Readonly<Record<string, MCPServerConfig>>;
  blockedMcpServers: readonly { name: string; extensionName: string }[];
}

function filterMcpServers(input: McpFilterInput): McpFilterResult
```

## Constraints

- No file >800 lines, no function >80 lines
- Each new module gets its own DebugLogger instance (don't share the one from config.ts)
- Remove extracted code from config.ts — do NOT leave dead copies
- All parity tests from Phase 1 must still pass after these extractions
- Run the mechanical verification greps from the overview to confirm no stale imports

### Post-Phase Mechanical Verification
```bash
# Confirm no stale imports to config/config.js for moved symbols
grep -rn "from.*config/config" packages/cli/src/ --include="*.ts" --include="*.tsx" | grep -E "READ_ONLY_TOOL_NAMES|loadHierarchicalLlxprtMemory|isDebugMode|loadEnvironment"
# Expected: ZERO hits (all should now import from new canonical locations)
```

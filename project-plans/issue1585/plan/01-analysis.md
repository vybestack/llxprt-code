# Phase 01: Domain And Dependency Analysis

## Phase ID

`PLAN-20260608-ISSUE1585.P01`

## Purpose

Complete dependency graph, file inventory, ownership classification, and release impact analysis. Extend consumer inventory to cover all groups.

## Prerequisites

- Required: P00a completed with preflight results including approved missing-packages decision and MCP ownership.
- Artifacts from P00a: `analysis/preflight-results.md`, `analysis/current-tools-files.txt`, `analysis/all-tool-consumers.txt`.

## Requirements Implemented

### REQ-PKG-001, REQ-MOVE-001, REQ-DEP-001

**Full requirement blocks**: See `plan/requirements-appendix.md` → REQ-MOVE-MAP, REQ-PKG-BOUNDARY

**Behavior specification**:
- GIVEN: Preflight has recorded approved decisions
- WHEN: Domain and dependency analysis completes
- THEN: All 18 consumer groups are covered; production vs test imports are classified separately; dynamic imports and package exports are in the inventory; provider test mocks reference core/tools paths

**Why it matters**: Missing consumer groups mean their imports are never rewritten, causing runtime failures after core removes deep exports.

## Implementation Tasks

### Step 1: Complete Tool File Inventory

```bash
find packages/core/src/tools -type f -name '*.ts' | sort > project-plans/issue1585/analysis/current-tools-files.txt
find packages/core/src/tools -type f \( -name '*.snap' -o -name '*.md' \) | sort > project-plans/issue1585/analysis/current-tools-non-ts.txt
wc -l project-plans/issue1585/analysis/current-tools-files.txt
```

### Step 2: Extended Consumer Inventory

Classify every consumer of `packages/core/src/tools` into these groups. For each group, produce a file listing with exact import targets.

**Group 1: Core config**
- packages/core/src/config/toolRegistryFactory.ts — imports ToolRegistry + 20+ concrete tool classes
- packages/core/src/config/configBaseCore.ts — imports ToolRegistry, McpClientManager, memoryTool LLXPRT_CONFIG_DIR
- packages/core/src/config/config.ts, configBase*.ts

**Group 2: Core runtime (core/)**
- packages/core/src/core/TurnProcessor.ts — hasCycleInSchema
- packages/core/src/core/subagentOrchestrator.ts — ToolRegistry
- packages/core/src/core/TodoContinuationService.ts — TodoStore, Todo
- packages/core/src/core/coreToolHookTriggers.ts — base tool types
- packages/core/src/core/subagentRuntimeSetup.ts — ToolRegistry
- packages/core/src/core/clientToolGovernance.ts — ToolRegistry
- packages/core/src/core/ChatSessionFactory.ts — ToolRegistry
- packages/core/src/core/subagentToolProcessing.ts — ToolErrorType, ToolResultDisplay, TodoStore
- packages/core/src/core/turn.ts — tool types, ToolErrorType, toolNameUtils
- packages/core/src/core/StreamProcessor.ts — hasCycleInSchema
- packages/core/src/core/MessageStreamOrchestrator.ts — Todo
- packages/core/src/core/prompts.ts — memoryTool LLXPRT_CONFIG_DIR
- packages/core/src/core/compression/utils.ts — mediaUtils classifyMediaBlock
- packages/core/src/core/toolGovernance.ts — toolNameUtils

**Group 3: Core scheduler**
- packages/core/src/core/coreToolScheduler.ts — ToolContext, ContextAwareTool

**Group 4: Core agents**
- packages/core/src/agents/* — ToolRegistry, validation tools

**Group 5: Core confirmation-bus**
- packages/core/src/confirmation-bus/* — ToolConfirmationOutcome, payload types

**Group 6: Core telemetry**
- packages/core/src/telemetry/* — ToolConfirmationOutcome, DiscoveredMCPTool, CallableTool, DiffStat, ToolErrorType

**Group 7: Core prompts**
- packages/core/src/prompts/* — DiscoveredMCPPrompt from mcp-client

**Group 8: Core storage**
- packages/core/src/storage/SessionPersistenceService.ts — ToolResult display types

**Group 9: Core policy**
- Any files importing tool policy/governance types

**Group 10: Core hooks**
- Packages importing hook/trigger types from tools

**Group 11: Core runtime services**
- Packages importing tool service definitions

**Group 12: Core test-utils**
- packages/core/src/test-utils/tools.ts — tools.ts types
- packages/core/src/test-utils/mock-tool.ts — tools.ts types

**Group 13: Core utils**
- Files importing utility types from tools

**Group 14: LSP tests and integration**
- packages/lsp test files importing tool types

**Group 15: Package exports**
- packages/core/package.json exports map `./tools/*` entries

**Group 16: Provider test mocks**
- packages/providers/src/anthropic/AnthropicProvider.issue276.test.ts — vi.mock @vybestack/llxprt-code-core/tools/ToolFormatter
- packages/providers/src/anthropic/AnthropicProvider.mediaBlock.test.ts — vi.mock @vybestack/llxprt-code-core/tools/ToolFormatter
- packages/providers/src/anthropic/AnthropicProvider.toolFormatDetection.test.ts — vi.mock @vybestack/llxprt-code-core/tools/ToolFormatter
- packages/providers/src/anthropic/AnthropicProvider.test.ts — vi.mock @vybestack/llxprt-code-core/tools/ToolFormatter

**Group 17: Provider production imports**
- All `@vybestack/llxprt-code-core/tools/*` imports in providers/src

**Group 18: Dynamic imports**
- `import()` or dynamic `require()` of tool modules

```bash
# Verify full consumer coverage using rg (consistent syntax)
rg -n "\.\./tools/|\.\./\.\./tools/|@vybestack/llxprt-code-core/tools/" packages -g "*.ts" > project-plans/issue1585/analysis/all-tool-consumers.txt
# Check dynamic imports
rg -n "import\(.*tools" packages -g "*.ts" >> project-plans/issue1585/analysis/all-tool-consumers.txt
# Check package exports
node -e "const p=require('./packages/core/package.json'); console.log(Object.keys(p.exports||{}).filter(k=>k.startsWith('./tools/')).join('\n'))" > project-plans/issue1585/analysis/core-tools-exports.txt
```

### Step 3: Tools-to-Core Dependency Mapping

```bash
# Production imports only (no test files)
rg -n "from ['\"]\.\./\(config\|confirmation-bus\|services\|core\|mcp\|ide\|lsp\|storage\|debug\|utils\)/" packages/core/src/tools -g "*.ts" | rg -v "__tests__|\.test\.|\.spec\." > project-plans/issue1585/analysis/tools-to-core-imports.txt
```

Classify each production import by target module:
- config: Config, ApprovalMode, Storage, subagentManager, profileManager
- confirmation-bus: MessageBus, confirmation types
- services: shellExecutionService, fileDiscoveryService, fileSystemService, git-stats-service, todo-reminder-service, todo-context-tracker, tool-call-tracker-service, asyncTaskManager, history IContent
- core: turn (DEFAULT_AGENT_ID), subagentTypes, subagentOrchestrator
- ide: ideContext, ide-client
- lsp: lsp-diagnostics (via lsp-diagnostics-helper)
- storage: secure-store, ProviderKeyStorage
- utils: schemaValidator, safeJsonStringify, debugLogger, paths, fileUtils, unicodeUtils, errors, terminalSerializer, fetch, gitUtils, shell-parser, shell-utils, getFolderStructure, editor, workspaceContext, ignorePatterns, ripgrepPathResolver, ast-grep-utils, resolveTextSearchTarget, generateContentResponseUtilities, events, retry
- mcp: google-auth-provider, oauth-provider, oauth-token-storage

### Step 4: Release Impact

```bash
# Release workflow baseline
rg -n "npm publish --workspace=@vybestack/llxprt-code" .github/workflows/release.yml > project-plans/issue1585/analysis/release-baseline.txt
rg -n "providers|tools" scripts/tests/release-process.test.js >> project-plans/issue1585/analysis/release-baseline.txt
rg -n "npm pack -w @vybestack/llxprt-code" scripts/build_sandbox.js >> project-plans/issue1585/analysis/release-baseline.txt
rg -n "vybestack-llxprt-code.*\.tgz" Dockerfile >> project-plans/issue1585/analysis/release-baseline.txt
```

### Files To Create Or Modify

- Update: `analysis/dependency-audit.md` with extended consumer groups
- Create: `analysis/current-tools-files.txt`, `analysis/current-tools-non-ts.txt`
- Create: `analysis/all-tool-consumers.txt`, `analysis/tools-to-core-imports.txt`
- Create: `analysis/core-tools-exports.txt`, `analysis/release-baseline.txt`
- Create: `project-plans/issue1585/.completed/P01.md`

## Verification Commands

```bash
# Verify all consumer inventory files exist and are non-empty
test -s project-plans/issue1585/analysis/current-tools-files.txt
test -s project-plans/issue1585/analysis/all-tool-consumers.txt
test -s project-plans/issue1585/analysis/tools-to-core-imports.txt
test -s project-plans/issue1585/analysis/core-tools-exports.txt
wc -l project-plans/issue1585/analysis/current-tools-files.txt project-plans/issue1585/analysis/all-tool-consumers.txt
```

## Semantic Verification Checklist

- [ ] I covered every consumer group listed above, not just config/scheduler/agents.
- [ ] I classified production vs test imports separately.
- [ ] I included dynamic imports and package exports in the inventory.
- [ ] I verified provider test mocks reference core/tools paths.

## Success Criteria

- Extended consumer inventory covers all 18 groups.
- Tools-to-core import mapping covers every production dependency.
- Release baseline captures current state.
- No production code was changed.

## Failure Recovery

Do not proceed to P01a. Fix the analysis to cover missing groups.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P01.md` with files produced, group coverage, and gaps found.

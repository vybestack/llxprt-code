# Phase 13: Consumer Migration

## Phase ID

`PLAN-20260608-ISSUE1585.P13`

## Purpose

Update providers, core exports/package exports, CLI and other direct consumers to use packages/tools public API. Every `@vybestack/llxprt-code-core/tools/*` import for a moved module must be rewritten. CLI and direct consumers must be explicitly classified.

## Prerequisites

- Required: P12a completed (adapters and registry integration verified).
- Artifacts: adapters, updated toolRegistryFactory, tools package with exports, consumer-rewrite-map-final.md.

## Requirements Implemented

### REQ-DEP-001, REQ-TEST-001

**Full requirement blocks**: See `plan/requirements-appendix.md` → REQ-CONSUMER-MIGRATION, REQ-PKG-BOUNDARY, REQ-BEHAVIOR-PRESERVATION

**Behavior specification**:
- GIVEN: All tools code is moved to packages/tools with interfaces and adapters
- WHEN: Consumer imports (providers, core, CLI, tests, vi.mock calls) are rewritten
- THEN: Zero old deep import paths remain except for retained MCP/key-storage files; provider behavior is preserved; CLI tool type access works through core re-exports

**Why it matters**: Any remaining old import path breaks when core removes the deep export, causing silent runtime failures.

## Implementation Tasks

### Step 0: Exhaustive Consumer Classification (Required Artifact)

Before any import rewrite, generate and verify `analysis/all-tool-consumers-final.md` classifying **every** static, test, mock, dynamic, and reference occurrence of tools imports exactly once. This includes:

- Static production imports (`import { X } from '../tools/Y'`)
- Type-only imports in production and test files
- Test concrete imports in `*.test.ts` files
- `vi.mock()` calls referencing tools paths
- Dynamic `import()` of tools modules
- `new URL(...tools...)` patterns
- Retained MCP consumer imports (mcp-client, mcp-client-manager)
- Package export map references (packages/core/package.json `./tools/*`)
- Tool-key-storage pure function test references

Evidence command (repository-wide, including evals/** and integration-tests/**):
```bash
rg -n "@vybestack/llxprt-code-core/tools/|['\"]\.\.?/.*tools/|import\(.*tools|vi\.mock\(.*tools|new URL\(.*tools" . -g "*.ts" -g "*.tsx" -g "*.js" -g "*.cjs" -g "*.mjs" -g "*.json" -g "!packages/*/dist/**" -g "!node_modules/**" -g "!bundle/**" -g "!project-plans/**" > project-plans/issue1585/analysis/all-tool-consumers-final.txt
```

This raw rg output must be committed as evidence after P13 migration.

See `analysis/all-tool-consumers-final.md` for the full classification with categories and action for each occurrence. P13 MUST NOT proceed until every occurrence is classified.

### Step 1: Rewrite Provider Imports

Every `@vybestack/llxprt-code-core/tools/*` import in providers must be rewritten (see consumer-rewrite-map-final.md for complete list). Key rewrites:

| File | Old Import | New Import |
| --- | --- | --- |
| providers/src/utils/toolFormatDetection.ts | @vybestack/llxprt-code-core/tools/IToolFormatter.js | @vybestack/llxprt-code-tools/IToolFormatter.js |
| providers/src/utils/toolFormatDetection.ts | @vybestack/llxprt-code-core/tools/ToolIdStrategy.js | @vybestack/llxprt-code-tools/ToolIdStrategy.js |
| providers/src/reasoning/reasoningUtils.ts | @vybestack/llxprt-code-core/tools/doubleEscapeUtils.js | @vybestack/llxprt-code-tools/doubleEscapeUtils.js |
| providers/src/reasoning/reasoningUtils.ts | @vybestack/llxprt-code-core/tools/toolIdNormalization.js | @vybestack/llxprt-code-tools/toolIdNormalization.js |
| providers/src/openai-vercel/messageConversion.ts | @vybestack/llxprt-code-core/tools/toolIdNormalization.js | @vybestack/llxprt-code-tools/toolIdNormalization.js |
| providers/src/openai-vercel/messageConversion.ts | @vybestack/llxprt-code-core/tools/ToolIdStrategy.js | @vybestack/llxprt-code-tools/ToolIdStrategy.js |
| providers/src/openai-vercel/OpenAIVercelProvider.ts | @vybestack/llxprt-code-core/tools/doubleEscapeUtils.js | @vybestack/llxprt-code-tools/doubleEscapeUtils.js |
| providers/src/openai-vercel/OpenAIVercelProvider.ts | @vybestack/llxprt-code-core/tools/ToolIdStrategy.js | @vybestack/llxprt-code-tools/ToolIdStrategy.js |
| providers/src/openai-vercel/OpenAIVercelProvider.ts | @vybestack/llxprt-code-core/tools/toolIdNormalization.js | @vybestack/llxprt-code-tools/toolIdNormalization.js |
| providers/src/anthropic/AnthropicProvider.ts | @vybestack/llxprt-code-core/tools/IToolFormatter.js | @vybestack/llxprt-code-tools/IToolFormatter.js |
| providers/src/anthropic/AnthropicStreamProcessor.ts | @vybestack/llxprt-code-core/tools/toolIdNormalization.js | @vybestack/llxprt-code-tools/toolIdNormalization.js |
| providers/src/anthropic/AnthropicStreamProcessor.ts | @vybestack/llxprt-code-core/tools/doubleEscapeUtils.js | @vybestack/llxprt-code-tools/doubleEscapeUtils.js |
| providers/src/anthropic/AnthropicMessageNormalizer.ts | @vybestack/llxprt-code-core/tools/toolIdNormalization.js | @vybestack/llxprt-code-tools/toolIdNormalization.js |
| providers/src/anthropic/AnthropicResponseParser.ts | @vybestack/llxprt-code-core/tools/toolIdNormalization.js | @vybestack/llxprt-code-tools/toolIdNormalization.js |
| providers/src/anthropic/AnthropicResponseParser.ts | @vybestack/llxprt-code-core/tools/doubleEscapeUtils.js | @vybestack/llxprt-code-tools/doubleEscapeUtils.js |
| providers/src/openai/OpenAIResponseParser.ts | @vybestack/llxprt-code-core/tools/toolIdNormalization.js | @vybestack/llxprt-code-tools/toolIdNormalization.js |
| providers/src/openai/OpenAIProvider.ts | @vybestack/llxprt-code-core/tools/ToolFormatter.js | @vybestack/llxprt-code-tools/ToolFormatter.js |
| providers/src/openai/OpenAIProvider.ts | @vybestack/llxprt-code-core/tools/IToolFormatter.js | @vybestack/llxprt-code-tools/IToolFormatter.js |
| providers/src/openai/OpenAIRequestBuilder.ts | @vybestack/llxprt-code-core/tools/IToolFormatter.js | @vybestack/llxprt-code-tools/IToolFormatter.js |
| providers/src/openai/OpenAIRequestBuilder.ts | @vybestack/llxprt-code-core/tools/ToolIdStrategy.js | @vybestack/llxprt-code-tools/ToolIdStrategy.js |
| providers/src/openai/OpenAIRequestBuilder.ts | @vybestack/llxprt-code-core/tools/toolIdNormalization.js | @vybestack/llxprt-code-tools/toolIdNormalization.js |
| providers/src/openai/OpenAINonStreamHandler.ts | @vybestack/llxprt-code-core/tools/toolIdNormalization.js | @vybestack/llxprt-code-tools/toolIdNormalization.js |
| providers/src/openai/OpenAINonStreamHandler.ts | @vybestack/llxprt-code-core/tools/doubleEscapeUtils.js | @vybestack/llxprt-code-tools/doubleEscapeUtils.js |
| providers/src/openai/OpenAIStreamProcessor.ts | @vybestack/llxprt-code-core/tools/toolIdNormalization.js | @vybestack/llxprt-code-tools/toolIdNormalization.js |
| providers/src/openai/OpenAIStreamProcessor.ts | @vybestack/llxprt-code-core/tools/doubleEscapeUtils.js | @vybestack/llxprt-code-tools/doubleEscapeUtils.js |
| providers/src/openai/OpenAIStreamProcessor.ts | @vybestack/llxprt-code-core/tools/IToolFormatter.js | @vybestack/llxprt-code-tools/IToolFormatter.js |
| providers/src/openai/ToolCallNormalizer.ts | @vybestack/llxprt-code-core/tools/doubleEscapeUtils.js | @vybestack/llxprt-code-tools/doubleEscapeUtils.js |
| providers/src/openai/ToolNameValidator.ts | @vybestack/llxprt-code-core/tools/IToolFormatter.js | @vybestack/llxprt-code-tools/IToolFormatter.js |
| providers/src/openai/ToolNameValidator.ts | @vybestack/llxprt-code-core/tools/toolNameUtils.js | @vybestack/llxprt-code-tools/toolNameUtils.js |
| providers/src/openai/syntheticToolResponses.ts | @vybestack/llxprt-code-core/tools/toolIdNormalization.js | @vybestack/llxprt-code-tools/toolIdNormalization.js |
| providers/src/openai/buildResponsesRequest.ts | @vybestack/llxprt-code-core/tools/IToolFormatter.js | @vybestack/llxprt-code-tools/IToolFormatter.js |
| providers/src/openai/buildResponsesRequest.ts | @vybestack/llxprt-code-core/tools/toolIdNormalization.js | @vybestack/llxprt-code-tools/toolIdNormalization.js |
| providers/src/openai-responses/OpenAIResponsesInputBuilder.ts | @vybestack/llxprt-code-core/tools/toolIdNormalization.js | @vybestack/llxprt-code-tools/toolIdNormalization.js |
| providers/src/openai-responses/OpenAIResponsesProviderBase.ts | @vybestack/llxprt-code-core/tools/IToolFormatter.js | @vybestack/llxprt-code-tools/IToolFormatter.js |
| providers/src/openai-responses/buildResponsesInputFromContent.ts | @vybestack/llxprt-code-core/tools/toolIdNormalization.js | @vybestack/llxprt-code-tools/toolIdNormalization.js |

### Step 2: Rewrite Provider Test Mocks

Every vi.mock() referencing core/tools must be updated:

| File | Old Mock Path | New Mock Path |
| --- | --- | --- |
| providers/src/anthropic/AnthropicProvider.issue276.test.ts | @vybestack/llxprt-code-core/tools/ToolFormatter.js | @vybestack/llxprt-code-tools/ToolFormatter.js |
| providers/src/anthropic/AnthropicProvider.mediaBlock.test.ts | @vybestack/llxprt-code-core/tools/ToolFormatter.js | @vybestack/llxprt-code-tools/ToolFormatter.js |
| providers/src/anthropic/AnthropicProvider.toolFormatDetection.test.ts | @vybestack/llxprt-code-core/tools/ToolFormatter.js | @vybestack/llxprt-code-tools/ToolFormatter.js |
| providers/src/anthropic/AnthropicProvider.test.ts | @vybestack/llxprt-code-core/tools/ToolFormatter.js | @vybestack/llxprt-code-tools/ToolFormatter.js |
| providers/src/openai/ToolCallNormalizer.test.ts | @vybestack/llxprt-code-core/tools/doubleEscapeUtils.js | @vybestack/llxprt-code-tools/doubleEscapeUtils.js |
| providers/src/openai/OpenAIProvider.toolNameErrors.test.ts | @vybestack/llxprt-code-core/tools/ToolFormatter.js | @vybestack/llxprt-code-tools/ToolFormatter.js |
| providers/src/openai-responses/__tests__/OpenAIResponsesProvider.toolIdNormalization.test.ts | @vybestack/llxprt-code-core/tools/toolIdNormalization.js | @vybestack/llxprt-code-tools/toolIdNormalization.js |
| providers/src/openai/__tests__/ToolNameValidator.test.ts | @vybestack/llxprt-code-core/tools/IToolFormatter.js | @vybestack/llxprt-code-tools/IToolFormatter.js |

### Step 2a: Provider Migration Automated Checklist

Cross-check every provider file that imports from `@vybestack/llxprt-code-core/tools/`. Generated from actual `rg` output; every row MUST be crossed off during migration:

```bash
rg -n "@vybestack/llxprt-code-core/tools/" packages/providers/src -g "*.ts" > project-plans/issue1585/analysis/provider-tool-import-checklist.txt
```

| File | Import | Migrated? |
| --- | --- | --- |
| providers/src/openai-responses/OpenAIResponsesInputBuilder.ts | normalizeToOpenAIToolId | [ ] |
| providers/src/openai-responses/__tests__/OpenAIResponsesProvider.toolIdNormalization.test.ts | normalizeToOpenAIToolId | [ ] |
| providers/src/openai-responses/OpenAIResponsesProviderBase.ts | ToolFormat (type) | [ ] |
| providers/src/openai-responses/buildResponsesInputFromContent.ts | normalizeToOpenAIToolId | [ ] |
| providers/src/openai-vercel/OpenAIVercelProvider.ts | processToolParameters, getToolIdStrategy, normalizeTo* | [ ] |
| providers/src/openai-vercel/messageConversion.ts | normalizeTo*, ToolIdMapper (type) | [ ] |
| providers/src/anthropic/AnthropicProvider.ts | ToolFormat (type) | [ ] |
| providers/src/anthropic/AnthropicProvider.test.ts | vi.mock ToolFormatter | [ ] |
| providers/src/anthropic/AnthropicProvider.toolFormatDetection.test.ts | vi.mock ToolFormatter | [ ] |
| providers/src/anthropic/AnthropicProvider.mediaBlock.test.ts | vi.mock ToolFormatter | [ ] |
| providers/src/anthropic/AnthropicProvider.issue276.test.ts | vi.mock ToolFormatter | [ ] |
| providers/src/anthropic/AnthropicMessageNormalizer.ts | normalizeToAnthropicToolId | [ ] |
| providers/src/anthropic/AnthropicResponseParser.ts | normalizeToHistoryToolId, processToolParameters | [ ] |
| providers/src/anthropic/AnthropicStreamProcessor.ts | normalizeToHistoryToolId, processToolParameters | [ ] |
| providers/src/utils/toolFormatDetection.ts | ToolFormat (type), getToolIdStrategy... | [ ] |
| providers/src/reasoning/reasoningUtils.ts | processToolParameters, normalizeToHistoryToolId | [ ] |
| providers/src/openai/OpenAIProvider.ts | ToolFormat (type), ToolFormatter | [ ] |
| providers/src/openai/OpenAIProvider.toolNameErrors.test.ts | ToolFormatter | [ ] |
| providers/src/openai/OpenAIRequestBuilder.ts | ToolFormat, ToolIdStrategy, normalizeToOpenAIToolId | [ ] |
| providers/src/openai/OpenAINonStreamHandler.ts | normalizeToHistoryToolId, processToolParameters | [ ] |
| providers/src/openai/ToolCallNormalizer.ts | processToolParameters | [ ] |
| providers/src/openai/ToolCallNormalizer.test.ts | vi.mock doubleEscapeUtils, processToolParameters | [ ] |
| providers/src/openai/ToolNameValidator.ts | ToolFormat (type), toolNameUtils | [ ] |
| providers/src/openai/__tests__/ToolNameValidator.test.ts | ToolFormat (type) | [ ] |
| providers/src/openai/buildResponsesRequest.ts | ResponsesTool (type), normalizeToOpenAIToolId | [ ] |
| providers/src/openai/syntheticToolResponses.ts | normalizeToHistoryToolId | [ ] |
| providers/src/openai/OpenAIStreamProcessor.ts | normalizeTo*, processToolParameters, ToolFormat | [ ] |
| providers/src/openai/OpenAIResponseParser.ts | normalizeToHistoryToolId, processToolParameters | [ ] |

**Verification**: After migration, re-run the rg command and verify zero matches:
```bash
rg -n "@vybestack/llxprt-code-core/tools/" packages/providers/src -g "*.ts"
# Expected: zero matches
```

### Step 3: Rewrite Core Internal Imports

For files in packages/core/src/ that import from `../tools/` (see consumer-rewrite-map-final.md for exhaustive list), rewrite to `@vybestack/llxprt-code-tools`. Key groups:

- **core/config**: ToolRegistry, ActivateSkillTool, setLlxprtMdFilename, LLXPRT_CONFIG_DIR
- **core/confirmation-bus**: ToolConfirmationOutcome, ToolConfirmationPayload
- **core/scheduler**: ToolResult, ToolErrorType, AnyToolInvocation, AnyDeclarativeTool, ToolCallConfirmationDetails
- **core/core**: BaseToolInvocation, normalizeToolName, hasCycleInSchema, TodoStore, ToolResultDisplay
- **core/agents**: ToolRegistry, validation tool classes
- **core/policy**: AnyToolInvocation, BaseToolInvocation
- **core/telemetry**: DiffStat, ToolConfirmationOutcome
- **core/storage**: ToolResultDisplay, maskKeyForDisplay
- **core/utils**: ToolErrorType, memoryTool functions
- **core/test-utils**: ToolInvocation, ToolResult, BaseToolInvocation, modifiable-tool
- **core/services**: Todo, TodoToolCall
- **core/todo**: Todo, TodoToolCall
- **core/compression**: classifyMediaBlock
- **core/lsp**: setLlxprtMdFilename, vi.mock for tools, new URL patterns
- **core/storage**: SessionPersistenceService (ToolResult, ToolResultDisplay)
- **core/todo/services**: TodoReminderService, ToolCallTrackerService (Todo, TodoToolCall types)
- **core/core**: turn.ts, MessageStreamOrchestrator (BaseToolInvocation, ToolResult, ToolErrorType, normalizeToolName, Todo)

### Step 3a: Rewrite Evals And Integration-Tests Imports

| File | Old Import | New Import |
| --- | --- | --- |
| evals/globalSetup.ts | `from '../packages/core/src/tools/memoryTool.js'` | `from '@vybestack/llxprt-code-tools'` |
| integration-tests/globalSetup.ts | `from '../packages/core/src/tools/memoryTool.js'` | `from '@vybestack/llxprt-code-tools'` |
| integration-tests/google_web_search.test.ts | `from '../packages/core/src/tools/tool-names.js'` | `from '@vybestack/llxprt-code-tools'` |

### Step 3b: Rewrite Core Top-Level Re-Exports

Update `packages/core/src/index.ts` to re-export from `@vybestack/llxprt-code-tools` instead of `'./tools/*'` for all moved modules. Keep local re-exports for retained MCP modules (McpClientManager, McpClient). See `analysis/core-top-level-tool-export-manifest.md` for the complete list of re-exports to update.

### Step 4: Update packages/core/package.json Exports

Remove deep `./tools/*` exports for moved modules. Keep only:
- `./tools/mcp-client.js` (retained core infrastructure)
- `./tools/mcp-client-manager.js` (retained core infrastructure)
- Any STAY_CORE_INFRASTRUCTURE exports

### Step 5: Update packages/providers/package.json Dependencies

Add `@vybestack/llxprt-code-tools` to providers dependencies:
```json
"@vybestack/llxprt-code-tools": "file:../tools"
```

**Immediate verification** (not deferred to final verification): After adding the tools dependency, immediately verify:
```bash
# Verify providers package.json has tools dependency
node -e "const p=require('./packages/providers/package.json'); if (!p.dependencies || !p.dependencies['@vybestack/llxprt-code-tools']) { console.error('MISSING: @vybestack/llxprt-code-tools not in providers dependencies'); process.exit(1); } console.log('providers dependency: OK');"

# Run npm install and verify package-lock
npm install
# Verify providers package-lock entry includes tools dependency
node -e "const lock=require('./package-lock.json'); const prov=lock.packages['packages/providers']; if (!prov || !prov.dependencies || !prov.dependencies['@vybestack/llxprt-code-tools']) { console.error('MISSING: @vybestack/llxprt-code-tools not in providers package-lock entry'); process.exit(1); } console.log('providers package-lock entry: OK');"

# Verify providers typecheck still passes
npm run typecheck --workspace @vybestack/llxprt-code-providers
```

### Step 6: CLI/Direct Consumer Migration Decision

**Decision**: CLI uses ONLY `@vybestack/llxprt-code-core` top-level re-exports. CLI has zero direct imports from `@vybestack/llxprt-code-core/tools/`. After tools extraction, core re-exports tool types from `@vybestack/llxprt-code-tools`, and CLI transitively receives them through core. CLI does NOT need a direct `@vybestack/llxprt-code-tools` dependency.

**Dependency direction (per final-architecture.md)**:
    packages/cli        -> packages/core + packages/providers only
    packages/cli        -X-> packages/tools unless direct imports are intentionally added and documented

**A2A Server Consumer Classification**:

packages/a2a-server does not import core tool deep paths directly, but consumes `Config.getToolRegistry()` and ToolRegistry-shaped values through `packages/a2a-server/src/agent/task.ts`, `packages/a2a-server/src/utils/testing_utils.ts`, and `packages/a2a-server/src/http/app.test.ts`. A2A does NOT need a direct `@vybestack/llxprt-code-tools` dependency. ToolRegistry and related types come through core top-level re-exports. Required verification after P13:

```bash
npm run typecheck --workspace @vybestack/llxprt-code-a2a-server
npm run test --workspace @vybestack/llxprt-code-a2a-server
```

**Explicit CLI/direct consumer inspection and classification:**

| File | Tool Types Used | Source | Rewrite Needed? |
| --- | --- | --- | ---|
| `packages/cli/src/zed-integration/zedIntegration.ts` | ToolResult, ToolConfirmationOutcome, ToolConfirmationPayload, ContextAwareTool, DiscoveredMCPTool, AnyToolInvocation, AnyDeclarativeTool, Todo, DEFAULT_AGENT_ID | `@vybestack/llxprt-code-core` (top-level) | No — core re-exports |
| `packages/cli/src/nonInteractiveCliSupport.ts` | ToolResult display function | `@vybestack/llxprt-code-core` (top-level) | No |
| `packages/cli/src/nonInteractiveCli.test-helpers.ts` | Test helpers via core | `@vybestack/llxprt-code-core` (top-level) | No |
| `packages/cli/src/nonInteractiveCli.ts` | Tool types via core | `@vybestack/llxprt-code-core` (top-level) | No |
| `packages/cli/src/nonInteractiveCli*.test.ts` | Test types via core | `@vybestack/llxprt-code-core` (top-level) | No |
| `packages/cli/src/ui/hooks/slashCommandHandlers.ts` | No tool types directly | N/A | No |
| `packages/cli/src/ui/hooks/useToolScheduler.test.ts` | Tool types via core | `@vybestack/llxprt-code-core` (top-level) | No |
| `packages/cli/src/ui/hooks/atCommandProcessor.ts` | No tool types directly | N/A | No |
| `packages/cli/src/ui/hooks/atCommandProcessor*.ts` | No tool types directly | N/A | No |
| `packages/cli/src/ui/types.ts` | ToolCallConfirmationDetails, ToolResultDisplay | `@vybestack/llxprt-code-core` (top-level) | No |
| `packages/cli/src/types/message-bus-augmentation.d.ts` | ToolConfirmationOutcome, ToolConfirmationPayload | `@vybestack/llxprt-code-core` (top-level) | No — core re-exports these from tools |

**Dependency rule**: CLI does NOT add `@vybestack/llxprt-code-tools` to its package.json dependencies. Per approved dependency direction: packages/cli -> packages/core + packages/providers only; packages/cli -X-> packages/tools unless direct imports are intentionally added and documented. CLI's transitive dependency through core is sufficient. Per consumer-rewrite-map-final.md, CLI has zero direct `@vybestack/llxprt-code-core/tools/` imports.

**Verification**:
```bash
# Verify CLI has zero direct tools deep imports
rg -n "from ['\"]@vybestack/llxprt-code-core/tools/" packages/cli -g "*.ts"
# Expected: zero matches
# Verify CLI tool types come from core top-level
rg -n "ToolResult|ToolConfirmation|ToolError|ToolContext" packages/cli/src/zed-integration/zedIntegration.ts
# Verify A2A typecheck and tests pass after migration
npm run typecheck --workspace @vybestack/llxprt-code-a2a-server
npm run test --workspace @vybestack/llxprt-code-a2a-server
```

### Step 7: Update Core Re-Exports For CLI Compatibility

Verify that `packages/core/src/index.ts` re-exports all tool types that CLI and other consumers need:
- ToolResult, ToolConfirmationOutcome, ToolConfirmationPayload
- ToolCallConfirmationDetails, ContextAwareTool, AnyToolInvocation
- DiscoveredMCPTool, DEFAULT_AGENT_ID
- ToolResultDisplay, FileDiff, DiffStat

These re-exports import from `@vybestack/llxprt-code-tools` and re-export at core's top level. This is allowed — core top-level re-exports are not deep-import shims.

### Step 8: Verify No Remaining Core/Tools Deep Imports

Use separate scans instead of ripgrep lookaround. Ripgrep uses Rust regex and does not support negative lookahead.

```bash
# Providers: zero old deep imports for moved modules
rg -n "@vybestack/llxprt-code-core/tools/" packages/providers/src -g "*.ts"
# Expected: zero matches

# CLI: zero direct tools deep imports
rg -n "from ['\"]@vybestack/llxprt-code-core/tools/" packages/cli -g "*.ts"
# Expected: zero matches

# Core: zero relative ../tools imports for moved modules, excluding explicitly retained infrastructure
rg -n "from ['\"]\.\.\/tools\/" packages/core/src -g "*.ts" | rg -v "mcp-client|mcp-client-manager|tool-key-storage|tools-adapters"
# Expected: zero matches

# Repository-wide old deep import scan, excluding retained infrastructure only
rg -n "@vybestack/llxprt-code-core/tools/|from ['\"]\.\.\/tools\/" . -g "*.ts" -g "*.tsx" -g "*.js" -g "*.cjs" -g "*.mjs" -g "*.json" -g "!packages/*/dist/**" -g "!node_modules/**" -g "!bundle/**" -g "!project-plans/**" | rg -v "mcp-client|mcp-client-manager|tools-adapters" > project-plans/issue1585/analysis/post-p13-old-path-matches.txt
# Expected: file is empty except for retained infrastructure matches classified in Step 9

# Symbol-aware key-storage scan: moved symbols MUST NOT be imported from core tool-key-storage after migration.
rg -n "from .*tool-key-storage" . -g "*.ts" -g "!packages/*/dist/**" -g "!node_modules/**" -g "!project-plans/**" > project-plans/issue1585/analysis/post-p13-tool-key-storage-imports.txt
rg -n "maskKeyForDisplay|getSupportedToolNames|isValidToolKeyName|IToolKeyStorage" project-plans/issue1585/analysis/post-p13-tool-key-storage-imports.txt
# Expected: zero matches. These symbols must come from @vybestack/llxprt-code-tools, not core tool-key-storage.

# Typecheck all affected packages
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run typecheck --workspace @vybestack/llxprt-code-providers
npm run typecheck --workspace @vybestack/llxprt-code

# Run provider and core tests
npm run test --workspace @vybestack/llxprt-code-providers
npm run test --workspace @vybestack/llxprt-code-core

# Post-migration evidence: re-run consumer inventory (repository-wide) and commit
rg -n "@vybestack/llxprt-code-core/tools/|['\"]\.\.?/.*tools/|import\(.*tools|vi\.mock\(.*tools|new URL\(.*tools" . -g "*.ts" -g "*.tsx" -g "*.js" -g "*.cjs" -g "*.mjs" -g "*.json" -g "!packages/*/dist/**" -g "!node_modules/**" -g "!bundle/**" -g "!project-plans/**" > project-plans/issue1585/analysis/all-tool-consumers-final.txt
```

### Step 9: Classify Remaining Broad-Scan Matches

After P13 migration re-runs the repository-wide consumer scan, every remaining match in `analysis/all-tool-consumers-final.txt` MUST be classified as one of:

| Classification | Code | Description |
| --- | --- | --- |
| NEW_VALID_TOOLS_IMPORT | `NEW_VALID` | Import of `@vybestack/llxprt-code-tools` or its subpath exports — correct post-migration path |
| RETAINED_CORE_INFRASTRUCTURE | `RETAINED` | Import of retained core tools files (mcp-client, mcp-client-manager, retained tool-key-storage class, tools-adapters) — valid |
| REFERENCE_ONLY | `REF` | Non-executable reference (package.json exports, documentation) — update if it points at moved modules, but it does not break runtime |

Any match that cannot be classified as one of the above MUST be treated as a missed migration and fixed before P13 completes. `tool-key-storage` retained status applies only to the retained `ToolKeyStorage` class and SecureStore integration; it does not allow imports of moved pure functions or `IToolKeyStorage` from core.

**Core package export compatibility check**:
```bash
node - <<'JS'
const p = require('./packages/core/package.json');
const exportsMap = Object.keys(p.exports || {}).filter((key) => key.startsWith('./tools/'));
const allowed = new Set(['./tools/mcp-client.js', './tools/mcp-client-manager.js']);
const forbidden = exportsMap.filter((key) => !allowed.has(key));
if (forbidden.length) {
  console.error('FORBIDDEN moved core ./tools/* exports remain:', forbidden.join('\n'));
  process.exit(1);
}
console.log('Core ./tools/* export map contains only retained infrastructure');
JS
```

## Semantic Verification Checklist

- [ ] All provider imports rewritten to @vybestack/llxprt-code-tools.
- [ ] Provider test mocks updated.
- [ ] Core deep exports removed for moved modules.
- [ ] No deep-import shims in core.
- [ ] CLI has no direct tools deep imports.
- [ ] CLI tool types come from core top-level re-exports.
- [ ] Core re-exports updated to use @vybestack/llxprt-code-tools source.
- [ ] CLI does not need direct tools dependency. Per approved dependency direction: packages/cli -> packages/core + packages/providers only; packages/cli -X-> packages/tools unless direct imports are intentionally added and documented.
- [ ] A2A server typecheck and tests pass after migration.
- [ ] A2A server does not need direct tools dependency.
- [ ] No remaining ../tools/ imports in core for moved modules.
- [ ] Strict old-path zero check passes (excluding retained MCP files; tool-key-storage exclusion is narrow — only retained ToolKeyStorage class, NOT moved pure functions maskKeyForDisplay/getSupportedToolNames/isValidToolKeyName or IToolKeyStorage).
- [ ] Symbol-aware key-storage scan passes: maskKeyForDisplay, getSupportedToolNames, isValidToolKeyName, and IToolKeyStorage are not imported from core tool-key-storage after migration.
- [ ] Post-P13 broad-scan remaining matches all classified as NEW_VALID_TOOLS_IMPORT, RETAINED_CORE_INFRASTRUCTURE, or REFERENCE_ONLY.

## Success Criteria

- Zero old deep import paths in providers and CLI.
- Typecheck passes in all packages.
- Provider formatting/ID normalization behavior unchanged.
- CLI tool type access preserved through core re-exports.

## Failure Recovery

Fix missed import rewrites.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P13.md` with files modified, import rewrite summary, and CLI decision document.

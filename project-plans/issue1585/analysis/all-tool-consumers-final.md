# All Tool Consumers Final: Exhaustive Classification

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585
Generated: 2026-06-08

This document classifies **every** static, test, mock, dynamic, and reference occurrence of `packages/core/src/tools/**` imports across the entire repository, including `evals/**`, `integration-tests/**`, `packages/core/src/index.ts` re-exports, and LSP `new URL('../../tools/...')` entries. Each occurrence is classified exactly once. This supplements `consumer-rewrite-map-final.md` which focuses on import path rewrites; this document adds the missing categories: test fixtures, `vi.mock` calls, dynamic imports, `new URL(...tools...)` patterns, and retained MCP consumers.

## Evidence Command

```bash
rg -n "@vybestack/llxprt-code-core/tools/|['\"]\.\.?/.*tools/|import\(.*tools|vi\.mock\(.*tools|new URL\(.*tools" . -g "*.ts" -g "*.tsx" -g "*.js" -g "*.cjs" -g "*.mjs" -g "*.json" -g "!packages/*/dist/**" -g "!node_modules/**" -g "!bundle/**" -g "!project-plans/**" > project-plans/issue1585/analysis/all-tool-consumers-final.txt
```

**Post-P13 consumer classification**: After P13 migration, every remaining match in the broad scan must be classified as:
- **NEW_VALID_TOOLS_IMPORT**: Import of `@vybestack/llxprt-code-tools` — correct post-migration path
- **RETAINED_CORE_INFRASTRUCTURE**: Import of retained core tools files (mcp-client, mcp-client-manager, tool-key-storage, tools-adapters) — valid
- **REFERENCE_ONLY**: Non-executable reference (package.json exports, documentation) — update but does not break runtime

Any match not falling into one of these categories MUST be treated as a missed migration.

**Note**: This is a repository-wide scan covering TS/TSX/JS/CJS/MJS/JSON files across all directories (`packages/`, `evals/`, `integration-tests/`, etc.), excluding `dist/`, `node_modules/`, `bundle/`, and `project-plans/` directories. The previous package-only TS scan was insufficient; consumer inventory must cover the entire repository to catch eval/integration-test imports, JSON config references, CommonJS module patterns, and other non-standard import forms.

**Exhaustiveness rule**: Every occurrence in the raw rg output MUST have a corresponding entry in this document or in `consumer-rewrite-map-final.md`. If an occurrence has no classification, the implementation agent MUST NOT proceed — instead, classify it and get it reviewed before proceeding.

**Post-P13 verification**: After consumer migration, re-run the evidence command and verify zero occurrences of old paths (except RETAINED_MCP). The raw `analysis/all-tool-consumers-final.txt` output must be committed as evidence.

```bash
# Post-migration strict old-path zero check: zero old deep imports except retained MCP/adapters/new-tools-imports (repository-wide)
rg -n "@vybestack/llxprt-code-core/tools/|from ['\"]\.\./tools/" . -g "*.ts" -g "*.tsx" -g "*.js" -g "*.cjs" -g "*.mjs" -g "*.json" -g "!packages/*/dist/**" -g "!node_modules/**" -g "!bundle/**" -g "!project-plans/**" | rg -v "mcp-client|mcp-client-manager|tool-key-storage|tools-adapters|@vybestack/llxprt-code-tools"
# Expected: zero matches (strict old-path zero check excluding retained files and new valid tools imports)
```

## Classification Categories

| Category | Code | Description | Action |
| --- | --- | --- | --- |
| STATIC_PROD | Static import in production code | `import { X } from '../tools/Y'` | Rewrite to @vybestack/llxprt-code-tools |
| STATIC_TYPE | Type-only import in production code | `import type { X } from '../tools/Y'` | Rewrite to @vybestack/llxprt-code-tools |
| TEST_CONCRETE | Concrete import in test file | `import { X } from '../tools/Y'` in *.test.ts | Rewrite to @vybestack/llxprt-code-tools |
| TEST_TYPE | Type-only import in test file | `import type { X } from '../tools/Y'` in *.test.ts | Rewrite to @vybestack/llxprt-code-tools |
| VI_MOCK | vi.mock() call targeting tools | `vi.mock('../tools/Y')` or `vi.mock('@vybestack/llxprt-code-core/tools/Y')` | Update mock path to @vybestack/llxprt-code-tools |
| DYNAMIC_IMPORT | Dynamic import() of tools | `import('../tools/Y')` | Rewrite to @vybestack/llxprt-code-tools |
| NEW_URL | `new URL()` pattern referencing tools | `new URL('../../tools/Y', import.meta.url)` | Rewrite if file moves, or remove |
| RETAINED_MCP | Import of retained MCP core files | `from '../tools/mcp-client'` or `from '../tools/mcp-client-manager'` | KEEP — remains in core |
| RETAINED_KEY_STORAGE | Import of retained tool-key-storage class | `from '../tools/tool-key-storage'` (ToolKeyStorage class only) | KEEP — remains in core; pure function imports move |
| REFERENCE_ONLY | Reference in comments/config, not executable | Package export maps, documentation | Update export map entries |

## Provider Consumers (vi.mock + test imports)

| File | Occurrence | Category | Target Path After Migration |
| --- | --- | --- | --- |
| providers/src/anthropic/AnthropicProvider.issue276.test.ts | vi.mock('@vybestack/llxprt-code-core/tools/ToolFormatter.js') | VI_MOCK | vi.mock('@vybestack/llxprt-code-tools/ToolFormatter.js') |
| providers/src/anthropic/AnthropicProvider.mediaBlock.test.ts | vi.mock('@vybestack/llxprt-code-core/tools/ToolFormatter.js') | VI_MOCK | vi.mock('@vybestack/llxprt-code-tools/ToolFormatter.js') |
| providers/src/anthropic/AnthropicProvider.toolFormatDetection.test.ts | vi.mock('@vybestack/llxprt-code-core/tools/ToolFormatter.js') | VI_MOCK | vi.mock('@vybestack/llxprt-code-tools/ToolFormatter.js') |
| providers/src/anthropic/AnthropicProvider.test.ts | vi.mock('@vybestack/llxprt-code-core/tools/ToolFormatter.js') | VI_MOCK | vi.mock('@vybestack/llxprt-code-tools/ToolFormatter.js') |
| providers/src/openai/ToolCallNormalizer.test.ts | vi.mock('@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js') | VI_MOCK | vi.mock('@vybestack/llxprt-code-tools/doubleEscapeUtils.js') |
| providers/src/openai/OpenAIProvider.toolNameErrors.test.ts | import from '@vybestack/llxprt-code-core/tools/ToolFormatter.js' | TEST_CONCRETE | import from '@vybestack/llxprt-code-tools/ToolFormatter.js' |
| providers/src/openai-responses/__tests__/OpenAIResponsesProvider.toolIdNormalization.test.ts | import from '@vybestack/llxprt-code-core/tools/toolIdNormalization.js' | TEST_CONCRETE | import from '@vybestack/llxprt-code-tools/toolIdNormalization.js' |
| providers/src/openai/__tests__/ToolNameValidator.test.ts | type import from '@vybestack/llxprt-code-core/tools/IToolFormatter.js' | TEST_TYPE | type import from '@vybestack/llxprt-code-tools/IToolFormatter.js' |

## Core Consumers (dynamic imports and special patterns)

| File | Occurrence | Category | Action |
| --- | --- | --- | --- |
| core/src/config/toolRegistryFactory.ts | Static import of 26+ tool classes from ../tools/ | STATIC_PROD | Rewrite to @vybestack/llxprt-code-tools |
| core/src/core/coreToolHookTriggers.ts | `import('../tools/tools.js')` or similar dynamic import | DYNAMIC_IMPORT | Rewrite to @vybestack/llxprt-code-tools |
| core/src/runtime/AgentRuntimeLoader.ts | May use dynamic tool loading | DYNAMIC_IMPORT | Verify and rewrite if present |
| core/src/utils/events.ts | `type { McpClient } from '../tools/mcp-client.js'` | RETAINED_MCP | KEEP — McpClient stays in core |
| core/src/storage/secure-store-integration.test.ts | `{ maskKeyForDisplay } from ../tools/tool-key-storage.js` | TEST_CONCRETE (pure fn) | Rewrite to @vybestack/llxprt-code-tools (pure function moved) |
| core/src/telemetry/loggers.test.ts | Imports `DiscoveredMCPTool`, `type { CallableTool }` from tools | TEST_CONCRETE/TEST_TYPE | Depends on mcp-tool decision: if mcp-tool stays in core → KEEP; if mcp-tool moves → rewrite |
| core/src/prompts.ts | `memoryTool` exports from ../tools/ | STATIC_PROD | Rewrite to @vybestack/llxprt-code-tools |

## Core Consumers — Scheduler/Agents/Confirmation/Policy

These are covered in detail in `consumer-rewrite-map-final.md`. Key summary:

| Group | Files | Key Imports | Action |
| --- | --- | --- | --- |
| core/scheduler | 5 files | ToolResult, ToolErrorType, AnyToolInvocation, ToolConfirmationOutcome | Rewrite to @vybestack/llxprt-code-tools |
| core/agents | 4 files | ToolRegistry, BaseToolInvocation, validation tool classes | Rewrite to @vybestack/llxprt-code-tools |
| core/confirmation-bus | 4 files | ToolConfirmationOutcome, ToolConfirmationPayload | Rewrite to @vybestack/llxprt-code-tools |
## Tests That Violate Dependency Direction After Tools Extraction

| Test File | Current Import | Violation | Required Resolution |
| --- | --- | --- | --- |
| core/src/tools/ToolFormatter.toResponsesTool.test.ts | `import type { ITool } from '@vybestack/llxprt-code-providers/ITool.js'` | tools→providers (if test moves with ToolFormatter) | Rewrite: replace provider `ITool` type with local structural fixture matching required shape, or move this specific test to providers package |

**Rule**: After tools extraction, NO test file in packages/tools may import from @vybestack/llxprt-code-providers. If a test needs provider types, either: (1) replace with a tools-local structural type matching required shape, or (2) move the test to the providers package.

| core/policy | 2 files | BaseToolInvocation, AnyToolInvocation | Rewrite to @vybestack/llxprt-code-tools |
| core/services | 2 files | Todo, TodoToolCall | Rewrite to @vybestack/llxprt-code-tools |
| core/compression | 1 file | classifyMediaBlock | Rewrite to @vybestack/llxprt-code-tools |
| core/test-utils | 2 files | ToolInvocation, ToolResult, BaseToolInvocation | Rewrite to @vybestack/llxprt-code-tools |

## Core Consumers — Runtime

| File | Occurrence | Category | Action |
| --- | --- | --- | --- |
| core/src/runtime/AgentRuntimeLoader.ts | `type { ToolRegistry } from '../tools/tool-registry.js'` | STATIC_TYPE | Rewrite to @vybestack/llxprt-code-tools |
| core/src/runtime/AgentRuntimeLoader.ts | `normalizeToolName from '../tools/toolNameUtils.js'` | STATIC_PROD | Rewrite to @vybestack/llxprt-code-tools |
| core/src/runtime/AgentRuntimeLoader.test.ts | `{ ToolRegistry } from '../tools/tool-registry.js'` | TEST_CONCRETE | Rewrite to @vybestack/llxprt-code-tools |
| core/src/runtime/runtimeAdapters.ts | `type { ToolRegistry } from '../tools/tool-registry.js'` | STATIC_TYPE | Rewrite to @vybestack/llxprt-code-tools |

## Core Consumers — Hooks/Utils

| File | Occurrence | Category | Action |
| --- | --- | --- | --- |
| core/src/utils/events.ts | `type { McpClient } from '../tools/mcp-client.js'` | RETAINED_MCP | KEEP — mcp-client stays in core |
| core/src/utils/ignorePatterns.ts | `getCurrentLlxprtMdFilename from '../tools/memoryTool.js'` | STATIC_PROD | Rewrite to @vybestack/llxprt-code-tools |
| core/src/utils/ignorePatterns.test.ts | `vi.mock('../tools/memoryTool.js')` | VI_MOCK | Update mock path to @vybestack/llxprt-code-tools |
| core/src/utils/tool-utils.test.ts | `ReadFileTool from '../tools/read-file.js'` | TEST_CONCRETE | Rewrite to @vybestack/llxprt-code-tools |
| core/src/utils/memoryDiscovery.test.ts | `imports from '../tools/memoryTool.js'` | TEST_CONCRETE | Rewrite to @vybestack/llxprt-code-tools |
| core/src/utils/fileUtils.ts | `ToolErrorType from '../tools/tool-error.js'` | STATIC_PROD | Rewrite to @vybestack/llxprt-code-tools |
| core/src/utils/summarizer.test.ts | `type { ToolResult } from '../tools/tools.js'` | TEST_TYPE | Rewrite to @vybestack/llxprt-code-tools |

## Core Consumers — LSP

| File | Occurrence | Category | Action |
| --- | --- | --- | --- |
| core/src/lsp/__tests__/system-integration.test.ts | `vi.mock('../../tools/tool-registry')` | VI_MOCK | Update mock path to @vybestack/llxprt-code-tools |
| core/src/lsp/__tests__/system-integration.test.ts | `vi.mock('../../tools/ls')` | VI_MOCK | Update mock path to @vybestack/llxprt-code-tools |
| core/src/lsp/__tests__/system-integration.test.ts | `vi.mock('../../tools/read-file')` | VI_MOCK | Update mock path to @vybestack/llxprt-code-tools |
| core/src/lsp/__tests__/system-integration.test.ts | `vi.mock('../../tools/grep')` | VI_MOCK | Update mock path to @vybestack/llxprt-code-tools |
| core/src/lsp/__tests__/system-integration.test.ts | `vi.mock('../../tools/glob')` | VI_MOCK | Update mock path to @vybestack/llxprt-code-tools |
| core/src/lsp/__tests__/system-integration.test.ts | `vi.mock('../../tools/edit')` | VI_MOCK | Update mock path to @vybestack/llxprt-code-tools |
| core/src/lsp/__tests__/system-integration.test.ts | `vi.mock('../../tools/shell')` | VI_MOCK | Update mock path to @vybestack/llxprt-code-tools |
| core/src/lsp/__tests__/system-integration.test.ts | `vi.mock('../../tools/write-file')` | VI_MOCK | Update mock path to @vybestack/llxprt-code-tools |
| core/src/lsp/__tests__/system-integration.test.ts | `vi.mock('../../tools/google-web-fetch')` | VI_MOCK | Update mock path to @vybestack/llxprt-code-tools |
| core/src/lsp/__tests__/system-integration.test.ts | `vi.mock('../../tools/read-many-files')` | VI_MOCK | Update mock path to @vybestack/llxprt-code-tools |
| core/src/lsp/__tests__/system-integration.test.ts | `vi.mock('../../tools/memoryTool')` | VI_MOCK | Update mock path to @vybestack/llxprt-code-tools |
| core/src/lsp/__tests__/system-integration.test.ts | `vi.mock('../../tools/mcp-client-manager.js')` | VI_MOCK (RETAINED_MCP) | KEEP — mcp-client-manager stays in core |
| core/src/lsp/__tests__/system-integration.test.ts | `vi.mock('../../tools/mcp-tool.js')` | VI_MOCK | KEEP if mcp-tool stays; update mock path if mcp-tool moves |
| core/src/lsp/__tests__/system-integration.test.ts | `new URL('../../tools/edit.ts', import.meta.url)` | NEW_URL | Rewrite or remove (path existence check) |
| core/src/lsp/__tests__/system-integration.test.ts | `new URL('../../tools/write-file.ts', import.meta.url)` | NEW_URL | Rewrite or remove |
| core/src/lsp/__tests__/system-integration.test.ts | `new URL('../../tools/lsp-diagnostics-helper.ts', import.meta.url)` | NEW_URL | Depends on lsp-diagnostics-helper classification |
| core/src/lsp/__tests__/e2e-lsp.test.ts | `vi.mock('../../tools/tool-registry')` | VI_MOCK | Update mock path to @vybestack/llxprt-code-tools |
| core/src/lsp/__tests__/e2e-lsp.test.ts | Multiple `vi.mock('../../tools/*')` | VI_MOCK | Update mock paths to @vybestack/llxprt-code-tools |
| core/src/lsp/__tests__/e2e-lsp.test.ts | `new URL('../../tools/apply-patch.ts', import.meta.url)` | NEW_URL | Rewrite or remove |
| core/src/lsp/__tests__/e2e-lsp.test.ts | `new URL('../../tools/edit.ts', import.meta.url)` | NEW_URL | Rewrite or remove |
| core/src/lsp/__tests__/e2e-lsp.test.ts | `new URL('../../tools/write-file.ts', import.meta.url)` | NEW_URL | Rewrite or remove |
| core/src/lsp/__tests__/e2e-lsp.test.ts | `new URL('../../tools/lsp-diagnostics-helper.ts', import.meta.url)` | NEW_URL | Depends on lsp-diagnostics-helper classification |

## Core Consumers — Storage

| File | Occurrence | Category | Action |
| --- | --- | --- | --- |
| core/src/storage/SessionPersistenceService.ts | `ToolResult, ToolResultDisplay from '../tools/tools.js'` | STATIC_PROD | Rewrite to @vybestack/llxprt-code-tools |
| core/src/storage/secure-store-integration.test.ts | `maskKeyForDisplay from '../tools/tool-key-storage.js'` | TEST_CONCRETE (pure fn) | Rewrite to @vybestack/llxprt-code-tools |

## Core Consumers — Todo

| File | Occurrence | Category | Action |
| --- | --- | --- | --- |
| core/src/services/todo-reminder-service.ts | `{ type Todo } from '../tools/todo-schemas.js'` | STATIC_TYPE | Rewrite to @vybestack/llxprt-code-tools |
| core/src/services/tool-call-tracker-service.ts | `{ type TodoToolCall } from '../tools/todo-schemas.js'` | STATIC_TYPE | Rewrite to @vybestack/llxprt-code-tools |

## Core Consumers — Core/Telemetry

| File | Occurrence | Category | Action |
| --- | --- | --- | --- |
| core/src/core/turn.ts | `BaseToolInvocation, ToolResult, ... from '../tools/tools.js'` | STATIC_PROD | Rewrite to @vybestack/llxprt-code-tools |
| core/src/core/turn.ts | `ToolErrorType from '../tools/tool-error.js'` | STATIC_PROD | Rewrite to @vybestack/llxprt-code-tools |
| core/src/core/turn.ts | `normalizeToolName from '../tools/toolNameUtils.js'` | STATIC_PROD | Rewrite to @vybestack/llxprt-code-tools |
| core/src/core/MessageStreamOrchestrator.ts | `type { Todo } from '../tools/todo-schemas.js'` | STATIC_TYPE | Rewrite to @vybestack/llxprt-code-tools |
| core/src/telemetry/metrics.ts | `type { DiffStat } from '../tools/tools.js'` | STATIC_TYPE | Rewrite to @vybestack/llxprt-code-tools |

## Evals Consumers

| File | Occurrence | Category | Action |
| --- | --- | --- | --- |
| evals/globalSetup.ts | `imports from '../packages/core/src/tools/memoryTool.js'` | STATIC_PROD | Rewrite to @vybestack/llxprt-code-tools |

## Integration-Tests Consumers

| File | Occurrence | Category | Action |
| --- | --- | --- | --- |
| integration-tests/globalSetup.ts | `imports from '../packages/core/src/tools/memoryTool.js'` | STATIC_PROD | Rewrite to @vybestack/llxprt-code-tools |
| integration-tests/google_web_search.test.ts | `GOOGLE_WEB_SEARCH_TOOL from '../packages/core/src/tools/tool-names.js'` | STATIC_PROD | Rewrite to @vybestack/llxprt-code-tools |

## Core Top-Level Re-Exports (packages/core/src/index.ts)

| Line | Export | Category | Action |
| --- | --- | --- | --- |
| 216 | `export * from './tools/tools.js'` | REFERENCE_ONLY | Update: re-export from @vybestack/llxprt-code-tools |
| 217 | `export * from './tools/tool-error.js'` | REFERENCE_ONLY | Update: re-export from @vybestack/llxprt-code-tools |
| 218 | `export * from './tools/tool-registry.js'` | REFERENCE_ONLY | Update: re-export from @vybestack/llxprt-code-tools |
| 219 | `export * from './tools/tool-context.js'` | REFERENCE_ONLY | Update: re-export from @vybestack/llxprt-code-tools |
| 220 | `export * from './tools/tool-names.js'` | REFERENCE_ONLY | Update: re-export from @vybestack/llxprt-code-tools |
| 233-258 | Tool re-exports (read-file, ls, grep, etc.) | REFERENCE_ONLY | Update: re-export from @vybestack/llxprt-code-tools |
| 318-319 | IToolFormatter, ToolFormatter re-exports | REFERENCE_ONLY | Update: re-export from @vybestack/llxprt-code-tools |
| 438-439 | McpClientManager, McpClient re-exports | REFERENCE_ONLY (RETAINED_MCP) | Keep local re-export (these stay in core) |

## Core Package Exports (reference-only)

| File | Occurrence | Category | Action |
| --- | --- | --- | --- |
| packages/core/package.json | `"./tools/*"` export entries | REFERENCE_ONLY | Remove entries for moved modules; keep only retained MCP/key-storage entries |

## Retained MCP Consumers (keep in core)

| File | Import | Category | Action |
| --- | --- | --- | --- |
| core/src/utils/events.ts | `type { McpClient } from '../tools/mcp-client.js'` | RETAINED_MCP | KEEP — mcp-client stays |
| core/src/tools/mcp-tool.ts | `import { McpClientManager } from './mcp-client-manager.js'` (if file stays) | RETAINED_MCP | KEEP if mcp-tool stays |
| core/src/tools/mcp-tool.ts | `import type { Config } from '../config/config.js'` (if file stays) | RETAINED_MCP | KEEP if mcp-tool stays |

## P13 Requirement: Every Occurrence Classified Exactly Once

P13 consumer migration MUST verify that every row in this document has been acted upon. The P13 implementation agent must:

1. Read this document alongside `consumer-rewrite-map-final.md`
2. For each occurrence, apply the action in the "Target Path After Migration" or "Action" column
3. After all rewrites, run the evidence command again and verify zero occurrences of old paths (except RETAINED_MCP)
4. The `analysis/all-tool-consumers-final.txt` raw rg output must be committed as evidence

```bash
# Post-migration strict old-path zero check: zero old deep imports except retained MCP/adapters/new-tools-imports (repository-wide)
rg -n "@vybestack/llxprt-code-core/tools/|from ['\"]\.\./tools/" . -g "*.ts" -g "*.tsx" -g "*.js" -g "*.cjs" -g "*.mjs" -g "*.json" -g "!packages/*/dist/**" -g "!node_modules/**" -g "!bundle/**" -g "!project-plans/**" | rg -v "mcp-client|mcp-client-manager|tool-key-storage|tools-adapters|@vybestack/llxprt-code-tools"
# Expected: zero matches (strict old-path zero check excluding retained files and new valid tools imports)
```
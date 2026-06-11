# Tools Public Export Manifest

**Phase**: PLAN-20260608-ISSUE1585.P08 (Updated)
**Purpose**: List every symbol that `@vybestack/llxprt-code-tools` exports at the top level and every subpath. This artifact is referenced by P10 (for stub creation), P11 (for barrel export completeness), and P16 (for importability smoke tests).

---

## Top-Level Exports (from `src/index.ts`)

### Interface Contracts (re-exported from `./interfaces/index.js` as type-only)

| Symbol | Kind | Export Type |
|--------|------|------------|
| `IToolHost` | interface | `export type` |
| `IToolRegistryHost` | interface | `export type` |
| `IToolMessageBus` | interface | `export type` |
| `ToolConfirmationOutcome` | type alias | `export type` |
| `PolicyUpdateOptions` | interface | `export type` |
| `ToolMessageHandler` | type alias | `export type` |
| `ToolMessageEvent` | interface | `export type` |
| `Unsubscribe` | type alias | `export type` |
| `IShellExecutionService` | interface | `export type` |
| `ShellOptions` | interface | `export type` |
| `ShellResult` | interface | `export type` |
| `ISubagentService` | interface | `export type` |
| `SubagentRequest` | interface | `export type` |
| `SubagentResult` | interface | `export type` |
| `SubagentInfo` | interface | `export type` |
| `SubagentConfig` | interface | `export type` |
| `IAsyncTaskService` | interface | `export type` |
| `AsyncTaskStatus` | type alias | `export type` |
| `AsyncTaskInfo` | interface | `export type` |
| `ISkillService` | interface | `export type` |
| `SkillActivationResult` | interface | `export type` |
| `SkillManager` | interface | `export type` |
| `IMcpToolService` | interface | `export type` |
| `Part` | interface | `export type` |
| `DiscoveredMCPTool` | interface | `export type` |
| `McpDiscoveredTool` | interface | `export type` |
| `IIdeService` | interface | `export type` |
| `DiffParams` | interface | `export type` |
| `DiffUpdateResult` | interface | `export type` |
| `IDEConnectionStatus` | type alias | `export type` |
| `OpenDiffParams` | interface | `export type` |
| `ILspService` | interface | `export type` |
| `Diagnostic` | interface | `export type` |
| `IStorageService` | interface | `export type` |
| `IToolKeyStorage` | interface | `export type` |
| `ITodoService` | interface | `export type` |
| `TodoStore` | interface | `export type` |
| `TodoReminderService` | interface | `export type` |
| `TodoContextTracker` | interface | `export type` |
| `ISettingsService` | interface | `export type` |
| `SettingsService` | interface | `export type` |
| `IPromptRegistryService` | interface | `export type` |
| `PromptRegistry` | interface | `export type` |
| `Prompt` | interface | `export type` |

### Types (from `./types/tool-context.js`)

| Symbol | Kind | Export Type |
|--------|------|------------|
| `ToolContext` | interface | `export type` |
| `ContextAwareTool` | interface | `export type` |

### Formatter Interfaces (from `./formatters/IToolFormatter.js`)

| Symbol | Kind | Export Type |
|--------|------|------------|
| `IToolFormatter` | interface | `export type` |
| `ToolFormat` | type alias | `export type` |
| `OpenAIFunction` | interface | `export type` |
| `OpenAITool` | interface | `export type` |
| `ResponsesTool` | interface | `export type` |
| `FormatterTool` | interface | `export type` |
| `ToolCallBlock` | interface | `export type` |

### Formatter Implementations (from `./formatters/ToolFormatter.js`)

| Symbol | Kind | Export Type |
|--------|------|------------|
| `ToolFormatter` | class | `export` (value) |

### Tool ID Strategy (from `./formatters/ToolIdStrategy.js`)

| Symbol | Kind | Export Type |
|--------|------|------------|
| `ToolIdStrategy` | interface | `export type` |
| `ToolIdMapper` | interface | `export type` |
| `StrategyContentBlock` (aliased as `ContentBlock`) | interface | `export type` |
| `getToolIdStrategy` | function | `export` (value) |
| `kimiStrategy` | const | `export` (value) |
| `standardStrategy` | const | `export` (value) |
| `mistralStrategy` | const | `export` (value) |
| `isKimiModel` | function | `export` (value) |
| `isDeepSeekReasonerModel` | function | `export` (value) |
| `isMistralModel` | function | `export` (value) |

### Double-Escape Utilities (from `./formatters/doubleEscapeUtils.js`)

| Symbol | Kind | Export Type |
|--------|------|------------|
| `shouldUseDoubleEscapeHandling` | function | `export` (value) |
| `detectDoubleEscaping` | function | `export` (value) |
| `detectDoubleEscapingInChunk` | function | `export` (value) |
| `processToolParameters` | function | `export` (value) |
| `logDoubleEscapingInChunk` | function | `export` (value) |

### Tool Name Utilities (from `./formatters/toolNameUtils.js`)

| Symbol | Kind | Export Type |
|--------|------|------------|
| `normalizeToolName` | function | `export` (value) |
| `toSnakeCase` | function | `export` (value) |
| `isValidFormatterToolName` (exported as `isValidToolName`) | function | `export` (value) |
| `findMatchingTool` | function | `export` (value) |

### Tool ID Normalization (from `./formatters/toolIdNormalization.js`)

| Symbol | Kind | Export Type |
|--------|------|------------|
| `normalizeToOpenAIToolId` | function | `export` (value) |
| `normalizeToHistoryToolId` | function | `export` (value) |
| `normalizeToAnthropicToolId` | function | `export` (value) |

### Confirmation Types (from `./utils/tool-confirmation-types.js`)

| Symbol | Kind | Export Type |
|--------|------|------------|
| `ToolConfirmationOutcome` | enum | `export` (value) |
| `ToolConfirmationPayload` | interface | `export type` |

### Error Types (from `./utils/tool-error.js`)

| Symbol | Kind | Export Type |
|--------|------|------------|
| `ToolErrorType` | enum | `export` (value) |
| `isFatalToolError` | function | `export` (value) |

### Tool Name Constants (from `./utils/tool-names.js`)

| Symbol | Kind | Export Type |
|--------|------|------------|
| `GOOGLE_WEB_SEARCH_TOOL` | const | `export` (value) |
| `EXA_WEB_SEARCH_TOOL` | const | `export` (value) |
| `EDIT_TOOL_NAME` | const | `export` (value) |
| `GREP_TOOL_NAME` | const | `export` (value) |
| `READ_MANY_FILES_TOOL_NAME` | const | `export` (value) |
| `READ_FILE_TOOL_NAME` | const | `export` (value) |
| `LS_TOOL_NAME` | const | `export` (value) |
| `MEMORY_TOOL_NAME` | const | `export` (value) |
| `ACTIVATE_SKILL_TOOL_NAME` | const | `export` (value) |
| `READ_FILE_TOOL` | const | `export` (value) |
| `WRITE_FILE_TOOL` | const | `export` (value) |
| `EDIT_TOOL` | const | `export` (value) |
| `INSERT_AT_LINE_TOOL` | const | `export` (value) |
| `DELETE_LINE_RANGE_TOOL` | const | `export` (value) |
| `READ_LINE_RANGE_TOOL` | const | `export` (value) |
| `READ_MANY_FILES_TOOL` | const | `export` (value) |
| `GREP_TOOL` | const | `export` (value) |
| `RIPGREP_TOOL` | const | `export` (value) |
| `GLOB_TOOL` | const | `export` (value) |
| `LS_TOOL` | const | `export` (value) |
| `LIST_DIRECTORY_TOOL` | const | `export` (value) |
| `CODE_SEARCH_TOOL` | const | `export` (value) |
| `GOOGLE_WEB_FETCH_TOOL` | const | `export` (value) |
| `DIRECT_WEB_FETCH_TOOL` | const | `export` (value) |
| `TASK_TOOL` | const | `export` (value) |
| `MEMORY_TOOL` | const | `export` (value) |
| `TODO_READ_TOOL` | const | `export` (value) |
| `TODO_WRITE_TOOL` | const | `export` (value) |
| `TODO_PAUSE_TOOL` | const | `export` (value) |
| `LIST_SUBAGENTS_TOOL` | const | `export` (value) |
| `SHELL_TOOL` | const | `export` (value) |
| `AST_GREP_TOOL` | const | `export` (value) |
| `STRUCTURAL_ANALYSIS_TOOL` | const | `export` (value) |
| `APPLY_PATCH_TOOL` | const | `export` (value) |
| `EDIT_TOOL_NAMES` | const (Set) | `export` (value) |
| `ToolName` | type | `export type` |

### Media Utilities (from `./utils/mediaUtils.js`)

| Symbol | Kind | Export Type |
|--------|------|------------|
| `MediaBlock` | interface | `export type` |
| `MediaCategory` | type alias | `export type` |
| `classifyMediaBlock` | function | `export` (value) |

### Tool Key Storage Types (from `./utils/tool-key-storage-types.js`)

| Symbol | Kind | Export Type |
|--------|------|------------|
| `ToolKeyRegistryEntry` | interface | `export type` |
| `TOOL_KEY_REGISTRY` | const (Map) | `export` (value) |
| `isValidToolKeyName` | function | `export` (value) |
| `getToolKeyEntry` | function | `export` (value) |
| `getSupportedToolNames` | function | `export` (value) |
| `maskKeyForDisplay` | function | `export` (value) |

---

## Subpath Exports (from `package.json` exports map)

| Subpath | Maps to | Symbols |
|---------|---------|---------|
| `.` | `dist/index.d.ts` / `dist/index.js` | All top-level exports above |
| `./IToolFormatter.js` | `dist/src/formatters/IToolFormatter.js` | `IToolFormatter`, `ToolFormat`, `OpenAIFunction`, `OpenAITool`, `ResponsesTool`, `FormatterTool`, `ToolCallBlock` |
| `./ToolFormatter.js` | `dist/src/formatters/ToolFormatter.js` | `ToolFormatter` |
| `./ToolIdStrategy.js` | `dist/src/formatters/ToolIdStrategy.js` | `ToolIdStrategy`, `ToolIdMapper`, `ContentBlock`, `getToolIdStrategy`, `kimiStrategy`, `standardStrategy`, `mistralStrategy`, `isKimiModel`, `isDeepSeekReasonerModel`, `isMistralModel` |
| `./toolIdNormalization.js` | `dist/src/formatters/toolIdNormalization.js` | `normalizeToOpenAIToolId`, `normalizeToHistoryToolId`, `normalizeToAnthropicToolId` |
| `./doubleEscapeUtils.js` | `dist/src/formatters/doubleEscapeUtils.js` | `shouldUseDoubleEscapeHandling`, `detectDoubleEscaping`, `detectDoubleEscapingInChunk`, `processToolParameters`, `logDoubleEscapingInChunk` |
| `./toolNameUtils.js` | `dist/src/formatters/toolNameUtils.js` | `normalizeToolName`, `toSnakeCase`, `isValidToolName`, `findMatchingTool` |

---

## Package Dependencies

### Runtime Dependencies (declared in `package.json` dependencies)

| Package | Version | Purpose |
|---------|---------|---------|
| `@ast-grep/napi` | `^0.40.5` | AST pattern matching |
| `@google/genai` | `1.30.0` | Google GenAI SDK types |
| `cheerio` | `^1.1.2` | HTML parsing |
| `diff` | `^8.0.3` | Text diffing for edit tools |
| `fast-glob` | `^3.3.3` | Fast globbing for AST tools |
| `glob` | `^12.0.0` | Glob pattern matching |
| `html-to-text` | `^9.0.5` | HTML to text conversion |
| `node-fetch` | `^3.3.2` | HTTP fetch polyfill |
| `shell-quote` | `^1.8.3` | Shell command parsing |
| `turndown` | `^7.2.2` | HTML to markdown |
| `zod` | `^3.25.76` | Schema validation |
| `zod-to-json-schema` | `^3.25.1` | Schema conversion for tool definitions |

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@types/node` | `^24.2.1` | Node.js type definitions |
| `@vybestack/llxprt-code-test-utils` | `file:../test-utils` | Shared test utilities |
| `typescript` | `^5.3.3` | TypeScript compiler |
| `vitest` | `^3.2.4` | Test framework |

### Forbidden Dependencies (MUST NOT appear)

- `@vybestack/llxprt-code-core`
- `@vybestack/llxprt-code-providers`
- `@vybestack/llxprt-code-cli`
- `@vybestack/llxprt-code`

---

## Verification Notes

- Every symbol listed maps to a concrete file in `packages/tools/src/`.
- No symbol depends on `packages/core`, `packages/providers`, or `packages/cli`.
- All runtime exports (classes, enums, functions, constants) are self-contained with zero forbidden imports.
- P10 integration tests will import every symbol listed here via `@vybestack/llxprt-code-tools`.
- P11 migration groups must ensure barrel export coverage matches this manifest.
- P16 importability smoke tests must verify dynamic import of every symbol.

**Total top-level exported symbols**: ~94 public symbols across interfaces, types, classes, enums, functions, constants.
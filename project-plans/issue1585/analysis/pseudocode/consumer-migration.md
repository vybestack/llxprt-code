# Pseudocode: Consumer Migration

Plan ID: PLAN-20260608-ISSUE1585
Phase: P02 Contract-First Pseudocode

## Interface Contracts

Inputs:

- Existing imports from `packages/core/src/tools/**` and `@vybestack/llxprt-code-core/tools/*`.
- New `@vybestack/llxprt-code-tools` top-level API and subpath exports.
- Core adapters in `packages/core/src/tools-adapters/**`.
- Provider-facing formatter and tool ID utility behavior preserved from issue #1584.

Outputs:

- Provider production imports and provider `vi.mock()` paths use `@vybestack/llxprt-code-tools/*` instead of `@vybestack/llxprt-code-core/tools/*`.
- Core registry imports moved tool classes from `@vybestack/llxprt-code-tools` and passes explicit core adapters.
- `packages/core/package.json` no longer exposes moved `./tools/*` deep exports.
- CLI uses core top-level re-exports only; no direct CLI dependency on tools.
- No forbidden deep import shims remain.

## Numbered Pseudocode

10: METHOD migrateConsumers()
11:   FOR `packages/providers/src/utils/toolFormatDetection.ts`
12:     REWRITE import `@vybestack/llxprt-code-core/tools/IToolFormatter.js` → `@vybestack/llxprt-code-tools/IToolFormatter.js`
13:     REWRITE import `@vybestack/llxprt-code-core/tools/ToolIdStrategy.js` → `@vybestack/llxprt-code-tools/ToolIdStrategy.js`
14:     PRESERVE formatter detection behavior and exported provider utility signatures
15:   ENDFOR
16:   FOR `packages/providers/src/reasoning/reasoningUtils.ts`
17:     REWRITE import `@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js` → `@vybestack/llxprt-code-tools/doubleEscapeUtils.js`
18:     REWRITE import `@vybestack/llxprt-code-core/tools/toolIdNormalization.js` → `@vybestack/llxprt-code-tools/toolIdNormalization.js`
19:     PRESERVE reasoning tool-call escaping and normalization behavior
20:   ENDFOR
21:   FOR `packages/providers/src/openai-vercel/messageConversion.ts`
22:     REWRITE import `@vybestack/llxprt-code-core/tools/toolIdNormalization.js` → `@vybestack/llxprt-code-tools/toolIdNormalization.js`
23:     REWRITE import `@vybestack/llxprt-code-core/tools/ToolIdStrategy.js` → `@vybestack/llxprt-code-tools/ToolIdStrategy.js`
24:     REWRITE import `@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js` → `@vybestack/llxprt-code-tools/doubleEscapeUtils.js`
25:   ENDFOR
26:   FOR `packages/providers/src/openai-vercel/OpenAIVercelProvider.ts`
27:     REWRITE import `@vybestack/llxprt-code-core/tools/toolIdNormalization.js` → `@vybestack/llxprt-code-tools/toolIdNormalization.js`
28:     REWRITE import `@vybestack/llxprt-code-core/tools/ToolIdStrategy.js` → `@vybestack/llxprt-code-tools/ToolIdStrategy.js`
29:     REWRITE import `@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js` → `@vybestack/llxprt-code-tools/doubleEscapeUtils.js`
30:   ENDFOR
31:   FOR each matching file in `packages/providers/src/anthropic/*.ts`, including `packages/providers/src/anthropic/AnthropicProvider.ts`
32:     REWRITE all imports matching `@vybestack/llxprt-code-core/tools/*` → `@vybestack/llxprt-code-tools/*`
33:     INCLUDE exact subpaths for formatter and tool ID utilities: `IToolFormatter.js`, `ToolFormatter.js`, `ToolIdStrategy.js`, `toolIdNormalization.js`, `doubleEscapeUtils.js`, `toolNameUtils.js` when present
34:   ENDFOR
35:   FOR `packages/providers/src/openai/OpenAIResponseParser.ts`
36:     REWRITE import `@vybestack/llxprt-code-core/tools/toolIdNormalization.js` → `@vybestack/llxprt-code-tools/toolIdNormalization.js`
37:   ENDFOR
38:   FOR provider tests and fixtures with `vi.mock()` calls referencing tools
39:     REWRITE mock path `@vybestack/llxprt-code-core/tools/IToolFormatter.js` → `@vybestack/llxprt-code-tools/IToolFormatter.js`
40:     REWRITE mock path `@vybestack/llxprt-code-core/tools/ToolFormatter.js` → `@vybestack/llxprt-code-tools/ToolFormatter.js`
41:     REWRITE mock path `@vybestack/llxprt-code-core/tools/ToolIdStrategy.js` → `@vybestack/llxprt-code-tools/ToolIdStrategy.js`
42:     REWRITE mock path `@vybestack/llxprt-code-core/tools/toolIdNormalization.js` → `@vybestack/llxprt-code-tools/toolIdNormalization.js`
43:     REWRITE mock path `@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js` → `@vybestack/llxprt-code-tools/doubleEscapeUtils.js`
44:     REWRITE mock path `@vybestack/llxprt-code-core/tools/toolNameUtils.js` → `@vybestack/llxprt-code-tools/toolNameUtils.js`
45:   ENDFOR
46:   FOR `packages/core/src/config/toolRegistryFactory.ts`
47:     REWRITE moved tool class imports from local `packages/core/src/tools/**` paths to `@vybestack/llxprt-code-tools`
48:     IMPORT `CoreToolHostAdapter` from `packages/core/src/tools-adapters/CoreToolHostAdapter.ts`
49:     IMPORT `CoreToolRegistryHostAdapter` from `packages/core/src/tools-adapters/CoreToolRegistryHostAdapter.ts`
50:     IMPORT `CoreMessageBusAdapter` from `packages/core/src/tools-adapters/CoreMessageBusAdapter.ts`
51:     IMPORT `CoreShellToolHostAdapter` from `packages/core/src/tools-adapters/CoreShellToolHostAdapter.ts`
52:     IMPORT `CoreSubagentServiceAdapter` from `packages/core/src/tools-adapters/CoreSubagentServiceAdapter.ts`
53:     IMPORT `CoreAsyncTaskServiceAdapter` from `packages/core/src/tools-adapters/CoreAsyncTaskServiceAdapter.ts`
54:     IMPORT `CoreSkillServiceAdapter` from `packages/core/src/tools-adapters/CoreSkillServiceAdapter.ts`
55:     IMPORT `CoreIdeServiceAdapter` from `packages/core/src/tools-adapters/CoreIdeServiceAdapter.ts`
56:     IMPORT `CoreLspServiceAdapter` from `packages/core/src/tools-adapters/CoreLspServiceAdapter.ts`
57:     IMPORT `CoreStorageServiceAdapter` from `packages/core/src/tools-adapters/CoreStorageServiceAdapter.ts`
58:     IMPORT `CoreToolKeyStorageAdapter` from `packages/core/src/tools-adapters/CoreToolKeyStorageAdapter.ts`
59:     IMPORT `CoreTodoServiceAdapter` from `packages/core/src/tools-adapters/CoreTodoServiceAdapter.ts`
60:     IMPORT `CoreSettingsServiceAdapter` from `packages/core/src/tools-adapters/CoreSettingsServiceAdapter.ts`
61:     IMPORT `CorePromptRegistryServiceAdapter` from `packages/core/src/tools-adapters/CorePromptRegistryServiceAdapter.ts`
62:     CONDITIONALLY IMPORT `CoreMcpToolServiceAdapter` from `packages/core/src/tools-adapters/CoreMcpToolServiceAdapter.ts` only if `mcp-tool.ts` moves
63:     CONSTRUCT adapters from existing `Config`, core `MessageBus`, `shellExecutionService`, `SubagentManager`, `ProfileManager`, `AsyncTaskManager`, `IdeClient`, `LspDiagnosticsHelper`, `ToolKeyStorage`, `SecureStore`, `TodoReminderService`, and `TodoContextTracker` sources
64:     PASS only the specific required adapter instances into moved tool constructors
65:     DO NOT pass `Config`, concrete `MessageBus`, or a generic service bag into moved tool constructors
66:   ENDFOR
67:   FOR scheduler and registry integration files that instantiate moved tools outside `toolRegistryFactory.ts`
68:     APPLY the same import rewrite to `@vybestack/llxprt-code-tools`
69:     PASS explicit adapters matching `IToolHost`, `IToolRegistryHost`, `IToolMessageBus`, and service interfaces
70:   ENDFOR
71:   FOR `packages/core/package.json`
72:     REMOVE export `./tools/doubleEscapeUtils.js`
73:     REMOVE export `./tools/IToolFormatter.js`
74:     REMOVE export `./tools/ToolFormatter.js`
75:     REMOVE export `./tools/ToolIdStrategy.js`
76:     REMOVE export `./tools/toolNameUtils.js`
77:     REMOVE export `./tools/toolIdNormalization.js`
78:     DO NOT add deep-import wrapper exports for moved modules
79:   ENDFOR
80:   FOR `packages/providers/package.json`
81:     ADD runtime dependency on `@vybestack/llxprt-code-tools` using the same workspace/package version convention as other internal packages
82:   ENDFOR
83:   FOR `packages/tools/package.json`
84:     ADD subpath export `./IToolFormatter.js`
85:     ADD subpath export `./ToolFormatter.js`
86:     ADD subpath export `./ToolIdStrategy.js`
87:     ADD subpath export `./toolIdNormalization.js`
88:     ADD subpath export `./doubleEscapeUtils.js`
89:     ADD subpath export `./toolNameUtils.js`
90:     ADD top-level export `.` for full public API
91:   ENDFOR
92:   FOR CLI/direct consumer migration decision
93:     INSPECT `packages/cli/src/zed-integration/zedIntegration.ts`
94:     INSPECT `packages/cli/src/nonInteractiveCliSupport.ts`
95:     INSPECT `packages/cli/src/nonInteractiveCli.test-helpers.ts`
96:     INSPECT `packages/cli/src/ui/hooks/slashCommandHandlers.ts`
97:     INSPECT `packages/cli/src/ui/hooks/useToolScheduler.test.ts`
98:     INSPECT `packages/cli/src/ui/hooks/atCommandProcessor.ts` and related `atCommandProcessor*.ts`
99:     INSPECT `packages/cli/src/ui/types.ts`
100:     INSPECT `packages/cli/src/types/message-bus-augmentation.d.ts`
101:     KEEP CLI imports on core top-level re-exports only
102:     DO NOT add direct `@vybestack/llxprt-code-tools` dependency to CLI
103:   ENDFOR
104:   RUN `rg -n "@vybestack/llxprt-code-core/tools/" packages/providers/src -g "*.ts"`
105:   ENSURE zero matches in provider production imports and provider tests
106:   RUN `rg -n "@vybestack/llxprt-code-core/tools/" packages/cli/src -g "*.ts"`
107:   ENSURE zero CLI deep-import matches; CLI top-level core imports remain acceptable
108:   RUN `rg -n "\./tools/(doubleEscapeUtils|IToolFormatter|ToolFormatter|ToolIdStrategy|toolNameUtils|toolIdNormalization)" packages/core/package.json`
109:   ENSURE zero moved deep exports remain in core package metadata
110:   RETURN migrated consumers

## Verification Pseudocode

120: RUN provider behavioral tests covering formatter selection, tool ID normalization, double escaping, OpenAI Vercel message conversion, Anthropic tool conversion, and OpenAI response parsing
121: RUN core registry/scheduler behavioral tests through `packages/core/src/config/toolRegistryFactory.ts`
122: RUN typecheck to catch missing package exports and stale mock paths

## Anti-Pattern Warnings

[ERROR] DO NOT: leave providers importing `@vybestack/llxprt-code-core/tools/*` for moved modules.
[ERROR] DO NOT: add `packages/core/src/tools/*.ts` wrapper files that re-export `@vybestack/llxprt-code-tools/*`.
[ERROR] DO NOT: add a direct CLI dependency on tools when core top-level re-exports suffice.
[ERROR] DO NOT: rewrite only production imports and forget provider `vi.mock()` paths.
[OK] DO: verify through existing provider behavior tests and registry/scheduler paths.

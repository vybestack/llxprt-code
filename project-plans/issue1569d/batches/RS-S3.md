# Batch RS-S3 — `sonarjs/regular-expr`

## Target rule

`sonarjs/regular-expr`

Flags regular expression sites that require review for safety and maintainability. Fixes must preserve the matched language. Prefer simplifying/anchoring/bounding the expression where possible; when the regex is intentionally broad but the input is bounded/trusted, use the narrowest possible inline disable with an explanatory reason. Do not use broad file-level disables.

## Baseline (at commit `d1d3d2d76`)

- Warnings: 310
- Offending files: 123
- Source lint JSON summary: `/tmp/rs3-summary.json`

## Split policy

- Production sub-batches are capped at 25 files.
- Test sub-batches are capped at 35 files.
- Files are sorted by path within production/test categories.
- Subagents must not expand the file list during implementation.
- The coordinator promotes the rule globally only after every sub-batch reaches zero repo-wide for this rule.

## Frozen sub-batches

### RS-S3-P01 [OK] COMPLETE

- Files: 25
- Warnings: 45 → 0

- `packages/a2a-server/src/config/settings.ts` — 1 → 0
- `packages/cli/src/config/extensions/extensionEnablement.ts` — 1 → 0
- `packages/cli/src/config/extensions/variables.ts` — 1 → 0
- `packages/cli/src/services/McpPromptLoader.ts` — 2 → 0
- `packages/cli/src/services/todo-continuation/todoContinuationService.ts` — 1 → 0
- `packages/cli/src/settings/modelParamParser.ts` — 1 → 0
- `packages/cli/src/ui/commands/debugCommands.ts` — 1 → 0
- `packages/cli/src/ui/commands/profileCommand.ts` — 1 → 0
- `packages/cli/src/ui/commands/setCommand.ts` — 1 → 0
- `packages/cli/src/ui/commands/subagentCommand.ts` — 1 → 0
- `packages/cli/src/ui/commands/todoCommand.ts` — 4 → 0
- `packages/cli/src/ui/commands/toolsCommand.ts` — 1 → 0
- `packages/cli/src/ui/components/messages/DiffRenderer.tsx` — 1 → 0
- `packages/cli/src/ui/components/messages/ToolGroupMessage.tsx` — 1 → 0
- `packages/cli/src/ui/components/messages/ToolMessage.tsx` — 1 → 0
- `packages/cli/src/ui/components/shared/word-navigation.ts` — 1 → 0
- `packages/cli/src/ui/components/views/ChatList.tsx` — 1 → 0
- `packages/cli/src/ui/contexts/KeypressContext.tsx` — 2 → 0
- `packages/cli/src/ui/hooks/atCommandProcessor.ts` — 1 → 0
- `packages/cli/src/ui/themes/color-utils.ts` — 4 → 0
- `packages/cli/src/ui/utils/highlight.ts` — 1 → 0
- `packages/cli/src/ui/utils/historyExportUtils.ts` — 2 → 0
- `packages/cli/src/ui/utils/InlineMarkdownRenderer.tsx` — 6 → 0
- `packages/cli/src/ui/utils/input.ts` — 1 → 0
- `packages/cli/src/ui/utils/MarkdownDisplay.tsx` — 7 → 0

**Fix approach:** Added narrow inline `eslint-disable-next-line sonarjs/regular-expr` comments with explanatory notes for all static regex patterns. Used minimal block disables (`eslint-disable`/`eslint-enable`) only where multiple regexes appeared in close proximity (e.g., `globToRegex`, `getPlainTextLength`). All regex behavior preserved exactly.

### RS-S3-P02

- Files: 25
- Warnings: 87

- `packages/cli/src/ui/utils/secureInputHandler.ts` — 7
- `packages/cli/src/ui/utils/terminalCapabilityManager.ts` — 2
- `packages/cli/src/ui/utils/terminalSetup.ts` — 1
- `packages/cli/src/utils/bootstrap.ts` — 1
- `packages/cli/src/utils/envVarResolver.ts` — 1
- `packages/cli/src/utils/gitUtils.ts` — 1
- `packages/cli/src/utils/privacy/ConversationDataRedactor.ts` — 21
- `packages/cli/src/utils/sandbox.ts` — 3
- `packages/cli/src/zed-integration/zedIntegration.ts` — 1
- `packages/core/src/agents/utils.ts` — 1
- `packages/core/src/core/baseLlmClient.ts` — 1
- `packages/core/src/core/subagentTypes.ts` — 1
- `packages/core/src/debug/DebugLogger.ts` — 1
- `packages/core/src/filters/EmojiFilter.ts` — 8
- `packages/core/src/mcp/file-token-store.ts` — 1
- `packages/core/src/mcp/oauth-provider.ts` — 1
- `packages/core/src/parsers/TextToolCallParser.ts` — 10
- `packages/core/src/policy/config.ts` — 1
- `packages/core/src/policy/toml-loader.ts` — 1
- `packages/core/src/policy/utils.ts` — 2
- `packages/core/src/prompt-config/prompt-installer.ts` — 4
- `packages/core/src/prompt-config/prompt-loader.ts` — 4
- `packages/core/src/prompt-config/prompt-resolver.ts` — 2
- `packages/core/src/providers/anthropic/AnthropicModelData.ts` — 5
- `packages/core/src/providers/LoggingProviderWrapper.ts` — 6

### RS-S3-P03

- Files: 25
- Warnings: 51

- `packages/core/src/providers/openai/OpenAIResponseParser.ts` — 4
- `packages/core/src/providers/openai/ToolCallNormalizer.ts` — 1
- `packages/core/src/providers/reasoning/reasoningUtils.ts` — 4
- `packages/core/src/providers/utils/localEndpoint.ts` — 2
- `packages/core/src/providers/utils/toolNameNormalization.ts` — 1
- `packages/core/src/services/complexity-analyzer.ts` — 3
- `packages/core/src/services/environmentSanitization.ts` — 2
- `packages/core/src/services/loopDetectionService.ts` — 4
- `packages/core/src/skills/skillLoader.ts` — 3
- `packages/core/src/skills/skillManager.ts` — 1
- `packages/core/src/tools/ast-edit/ast-query-extractor.ts` — 1
- `packages/core/src/tools/ast-edit/constants.ts` — 2
- `packages/core/src/tools/ast-edit/language-analysis.ts` — 4
- `packages/core/src/tools/ast-edit/local-context-analyzer.ts` — 4
- `packages/core/src/tools/doubleEscapeUtils.ts` — 1
- `packages/core/src/tools/fuzzy-replacer.ts` — 1
- `packages/core/src/tools/ls.ts` — 1
- `packages/core/src/tools/mcp-client.ts` — 4
- `packages/core/src/tools/memoryTool.ts` — 1
- `packages/core/src/tools/structural-analysis.ts` — 1
- `packages/core/src/utils/gitLineChanges.ts` — 1
- `packages/core/src/utils/parameterCoercion.ts` — 1
- `packages/core/src/utils/paths.ts` — 1
- `packages/core/src/utils/schemaValidator.ts` — 1
- `packages/core/src/utils/shell-utils.ts` — 2

### RS-S3-P04

- Files: 1
- Warnings: 1

- `packages/core/src/utils/systemEncoding.ts` — 1

### RS-S3-T01

- Files: 35
- Warnings: 99

- `packages/cli/src/auth/oauth-manager.failover-wiring.spec.ts` — 1
- `packages/cli/src/commands/mcp/remove.test.ts` — 1
- `packages/cli/src/config/__tests__/profileBootstrap.test.ts` — 3
- `packages/cli/src/integration-tests/cli-args.integration.test.ts` — 19
- `packages/cli/src/integration-tests/loadbalancer.integration.test.ts` — 2
- `packages/cli/src/integration-tests/todo-continuation.integration.test.ts` — 1
- `packages/cli/src/runtime/__tests__/runtimeIsolation.test.ts` — 4
- `packages/cli/src/services/todo-continuation/todoContinuationService.spec.ts` — 2
- `packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts` — 1
- `packages/cli/src/ui/commands/__tests__/profileCommand.failover.test.ts` — 2
- `packages/cli/src/ui/commands/__tests__/profileCommand.lb.test.ts` — 1
- `packages/cli/src/ui/commands/profileCommand.test.ts` — 1
- `packages/cli/src/ui/commands/test/subagentCommand.test.ts` — 1
- `packages/cli/src/ui/components/__tests__/SessionBrowserDialog.spec.tsx` — 5
- `packages/cli/src/ui/components/Footer.responsive.test.tsx` — 15
- `packages/cli/src/ui/components/Footer.test.tsx` — 2
- `packages/cli/src/ui/components/ProviderDialog.responsive.test.tsx` — 6
- `packages/cli/src/ui/components/SettingsDialog.test.tsx` — 3
- `packages/cli/src/ui/components/shared/BaseSelectionList.test.tsx` — 3
- `packages/cli/src/ui/components/TodoPanel.responsive.test.tsx` — 2
- `packages/cli/src/ui/components/TodoPanel.semantic.test.tsx` — 2
- `packages/cli/src/ui/hooks/shellCommandProcessor.test.ts` — 1
- `packages/cli/src/ui/hooks/useTodoContinuation.spec.ts` — 1
- `packages/cli/src/ui/utils/secureInputHandler.test.ts` — 1
- `packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts` — 4
- `packages/cli/src/utils/sandbox-proxy-integration.test.ts` — 2
- `packages/core/src/auth/__tests__/keyring-token-store.test.ts` — 2
- `packages/core/src/auth/proxy/__tests__/proxy-socket-client.test.ts` — 1
- `packages/core/src/config/config-lsp-integration.test.ts` — 1
- `packages/core/src/core/__tests__/config-regression-guard.test.ts` — 4
- `packages/core/src/core/turn.test.ts` — 1
- `packages/core/src/debug/DebugLogger.test.ts` — 1
- `packages/core/src/debug/FileOutput.test.ts` — 1
- `packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts` — 1
- `packages/core/src/hooks/hookRunner.test.ts` — 1

### RS-S3-T02

- Files: 12
- Warnings: 27

- `packages/core/src/mcp/file-token-store.test.ts` — 2
- `packages/core/src/mcp/token-storage/file-token-storage.test.ts` — 2
- `packages/core/src/policy/utils.test.ts` — 1
- `packages/core/src/prompt-config/prompt-installer.test.ts` — 1
- `packages/core/src/providers/__tests__/LoadBalancingProvider.failover.test.ts` — 2
- `packages/core/src/providers/utils/dumpContext.test.ts` — 3
- `packages/core/src/tools/ast-edit.test.ts` — 1
- `packages/core/src/tools/ast-edit/__tests__/validate-ast-syntax.test.ts` — 1
- `packages/core/src/tools/edit.test.ts` — 2
- `packages/core/src/tools/tool-key-storage.test.ts` — 1
- `packages/core/src/tools/write-file.test.ts` — 6
- `packages/core/src/utils/filesearch/fileSearch.test.ts` — 5

## Validation

- Total files covered: 123
- Total warnings covered: 310
- Duplicate files: 0

## Exit criteria

- `npx eslint <listed-files> --ext .ts,.tsx --rule 'sonarjs/regular-expr:error' --quiet` reports 0 errors for each completed sub-batch.
- Full package-source lint reports 0 errors for `sonarjs/regular-expr` after all sub-batches.
- `sonarjs/regular-expr` is promoted to `error` globally only after repo-wide zero diagnostics and fresh review.

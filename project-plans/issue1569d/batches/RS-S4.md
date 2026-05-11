# Batch RS-S4 — `sonarjs/slow-regex`

## Target rule

`sonarjs/slow-regex`

Flags regular expressions that may exhibit excessive backtracking. Fix by bounding or simplifying the regex where the language can be preserved safely. Where a static regex is intentionally broad but inputs are bounded/trusted, use the narrowest possible inline disable with an explanatory reason. Do not use broad file-level disables.

## Baseline

- Warnings: 73
- Offending files: 37
- Source summary: `/tmp/phase4-summary.json`

## Frozen file list

- `packages/cli/src/utils/privacy/ConversationDataRedactor.ts` — 8 (166:7, 170:7, 176:7, 199:7, 345:18, 346:18, 347:18, 374:7)
- `packages/core/src/parsers/TextToolCallParser.ts` — 1 (624:16)
- `packages/core/src/providers/LoggingProviderWrapper.ts` — 3 (162:9, 166:9, 176:9)
- `packages/core/src/prompt-config/prompt-resolver.ts` — 2 (319:29, 410:29)
- `packages/cli/src/ui/utils/InlineMarkdownRenderer.tsx` — 4 (39:5, 102:43, 115:43, 187:14)
- `packages/cli/src/ui/utils/secureInputHandler.ts` — 3 (206:49, 215:42, 229:45)
- `packages/core/src/prompt-config/prompt-loader.ts` — 2 (181:47, 185:9)
- `packages/cli/src/ui/components/TodoPanel.semantic.test.tsx` — 8 (90:28, 115:28, 136:28, 159:32, 172:33, 215:28, 216:28, 217:28)
- `packages/core/src/services/complexity-analyzer.ts` — 1 (275:29)
- `packages/cli/src/ui/utils/MarkdownDisplay.tsx` — 3 (63:26, 66:19, 68:31)
- `packages/cli/src/ui/components/__tests__/SessionBrowserDialog.spec.tsx` — 4 (418:30, 660:30, 909:30, 925:34)
- `packages/cli/src/services/McpPromptLoader.ts` — 1 (228:27)
- `packages/core/src/services/loopDetectionService.ts` — 3 (170:22, 172:7, 172:43)
- `packages/core/src/skills/skillLoader.ts` — 2 (80:34, 87:34)
- `packages/cli/src/ui/commands/profileCommand.ts` — 1 (315:16)
- `packages/core/src/providers/anthropic/AnthropicModelData.ts` — 2 (27:16, 28:16)
- `packages/core/src/providers/openai/OpenAIResponseParser.ts` — 1 (153:13)
- `packages/cli/src/ui/components/messages/DiffRenderer.tsx` — 1 (28:27)
- `packages/cli/src/ui/components/messages/ToolGroupMessage.tsx` — 1 (42:28)
- `packages/core/src/providers/reasoning/reasoningUtils.ts` — 1 (155:13)
- `packages/core/src/tools/ast-edit/ast-query-extractor.ts` — 1 (225:30)
- `packages/core/src/tools/ast-edit/language-analysis.ts` — 1 (111:42)
- `packages/cli/src/ui/components/shared/BaseSelectionList.test.tsx` — 2 (102:30, 103:30)
- `packages/cli/src/ui/components/messages/ToolMessage.tsx` — 1 (126:27)
- `packages/cli/src/ui/utils/TableRenderer.tsx` — 1 (215:40)
- `packages/cli/src/utils/handleAutoUpdate.ts` — 2 (122:45, 189:45)
- `packages/cli/src/ui/hooks/shellCommandProcessor.test.ts` — 2 (581:29, 587:45)
- `packages/cli/src/ui/utils/terminalSetup.ts` — 1 (44:26)
- `packages/core/src/core/baseLlmClient.ts` — 1 (87:36)
- `packages/core/src/tools/ast-edit.test.ts` — 1 (321:13)
- `packages/core/src/tools/ast-edit/constants.ts` — 1 (35:17)
- `packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts` — 1 (155:36)
- `packages/cli/src/ui/hooks/useShellHistory.ts` — 1 (41:27)
- `packages/core/src/providers/utils/toolResponsePayload.ts` — 2 (95:20, 105:20)
- `packages/cli/src/ui/components/shared/transformations.ts` — 1 (24:3)
- `packages/core/src/config/endpoints.ts` — 1 (121:26)
- `packages/core/src/utils/memoryImportProcessor.test.ts` — 1 (24:46)

## Exit criteria

- `npx eslint <listed-files> --ext .ts,.tsx --rule 'sonarjs/slow-regex:error' --quiet` reports 0 errors.
- Full package-source scan reports 0 `sonarjs/slow-regex` diagnostics before promotion.
- `sonarjs/slow-regex` is promoted to global `error` only after zero diagnostics and fresh review.

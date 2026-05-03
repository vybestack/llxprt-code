# Issue #1569d — max-lines offenders

Captured for Phase 5 C5-PREP after enabling global `max-lines` warning policy:

- Rule config: `max-lines: ["warn", { max: 800, skipBlankLines: true, skipComments: true }]`
- Files scanned: 2250 tracked package TypeScript/TSX files
- Offending files: 107
- Note: counts below use the configured skip-blank-lines/skip-comments policy; physical line count is included for reference.

| # | File | Counted lines | Physical lines |
|---:|---|---:|---:|
| 1 | `packages/core/src/providers/anthropic/AnthropicProvider.test.ts` | 3709 | 4473 |
| 2 | `packages/core/src/providers/__tests__/LoadBalancingProvider.test.ts` | 3232 | 3891 |
| 3 | `packages/core/src/core/coreToolScheduler.test.ts` | 2844 | 3333 |
| 4 | `packages/cli/src/ui/hooks/useGeminiStream.test.tsx` | 2815 | 3340 |
| 5 | `packages/core/src/core/subagent.test.ts` | 2769 | 3318 |
| 6 | `packages/core/src/core/client.test.ts` | 2510 | 3125 |
| 7 | `packages/cli/src/ui/components/shared/text-buffer.test.ts` | 2368 | 2776 |
| 8 | `packages/cli/src/ui/components/InputPrompt.test.tsx` | 2316 | 2728 |
| 9 | `packages/cli/src/config/settingsSchema.ts` | 2273 | 2381 |
| 10 | `packages/core/src/tools/mcp-client.test.ts` | 1960 | 2306 |
| 11 | `packages/cli/src/config/settings.test.ts` | 1903 | 2235 |
| 12 | `packages/cli/src/config/config.test.ts` | 1850 | 2052 |
| 13 | `packages/core/src/recording/ReplayEngine.test.ts` | 1796 | 2559 |
| 14 | `packages/core/src/tools/task.test.ts` | 1795 | 2015 |
| 15 | `packages/cli/src/utils/sandbox.ts` | 1665 | 2245 |
| 16 | `packages/cli/src/config/extension.test.ts` | 1664 | 1922 |
| 17 | `packages/core/src/services/shellExecutionService.test.ts` | 1643 | 2052 |
| 18 | `packages/cli/src/ui/hooks/useSlashCompletion.test.ts` | 1633 | 1897 |
| 19 | `packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts` | 1612 | 2660 |
| 20 | `packages/cli/src/ui/App.test.tsx` | 1601 | 1885 |
| 21 | `packages/core/src/tools/mcp-client.ts` | 1513 | 2030 |
| 22 | `packages/core/src/providers/anthropic/AnthropicProvider.thinking.test.ts` | 1498 | 1804 |
| 23 | `packages/core/src/providers/__tests__/LoadBalancingProvider.failover.test.ts` | 1460 | 1707 |
| 24 | `packages/core/src/config/config.test.ts` | 1459 | 1877 |
| 25 | `packages/core/src/providers/__tests__/RetryOrchestrator.test.ts` | 1452 | 1847 |
| 26 | `packages/core/src/providers/gemini/GeminiProvider.ts` | 1433 | 1960 |
| 27 | `packages/test-utils/src/test-rig.ts` | 1397 | 1765 |
| 28 | `packages/core/src/core/turn.test.ts` | 1394 | 1613 |
| 29 | `packages/cli/src/zed-integration/zedIntegration.ts` | 1386 | 1679 |
| 30 | `packages/core/src/providers/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts` | 1367 | 1638 |
| 31 | `packages/core/src/mcp/oauth-provider.test.ts` | 1351 | 1574 |
| 32 | `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts` | 1345 | 1756 |
| 33 | `packages/cli/src/ui/hooks/useToolScheduler.test.ts` | 1317 | 1486 |
| 34 | `packages/core/src/core/compression/__tests__/high-density-optimize.test.ts` | 1306 | 1907 |
| 35 | `packages/cli/src/ui/components/SettingsDialog.tsx` | 1295 | 1610 |
| 36 | `packages/core/src/services/history/HistoryService.test.ts` | 1292 | 1581 |
| 37 | `packages/core/src/providers/ProviderManager.ts` | 1282 | 1654 |
| 38 | `packages/cli/src/runtime/__tests__/profileApplication.test.ts` | 1274 | 1587 |
| 39 | `packages/core/src/tools/shell.test.ts` | 1267 | 1557 |
| 40 | `packages/cli/src/utils/sessionCleanup.test.ts` | 1263 | 1562 |
| 41 | `packages/core/src/providers/LoggingProviderWrapper.ts` | 1230 | 1569 |
| 42 | `packages/cli/src/ui/hooks/vim.test.ts` | 1190 | 1563 |
| 43 | `packages/core/src/services/history/HistoryService.ts` | 1189 | 1762 |
| 44 | `packages/core/src/providers/anthropic/AnthropicProvider.issue1150.toolresult.test.ts` | 1177 | 1425 |
| 45 | `packages/cli/src/config/__tests__/profileBootstrap.test.ts` | 1165 | 1825 |
| 46 | `packages/cli/src/auth/BucketFailoverHandlerImpl.spec.ts` | 1124 | 1698 |
| 47 | `packages/core/src/services/shellExecutionService.ts` | 1115 | 1411 |
| 48 | `packages/core/src/telemetry/loggers.test.ts` | 1114 | 1238 |
| 49 | `packages/core/src/tools/structural-analysis.ts` | 1103 | 1368 |
| 50 | `packages/core/src/settings/settingsRegistry.ts` | 1090 | 1614 |
| 51 | `packages/core/src/utils/memoryDiscovery.test.ts` | 1090 | 1322 |
| 52 | `packages/core/src/tools/task.ts` | 1064 | 1277 |
| 53 | `packages/cli/src/ui/components/SettingsDialog.test.tsx` | 1061 | 1465 |
| 54 | `packages/cli/src/nonInteractiveCli.test.ts` | 1055 | 1203 |
| 55 | `packages/cli/src/ui/commands/mcpCommand.test.ts` | 1052 | 1354 |
| 56 | `packages/cli/src/ui/components/InputPrompt.tsx` | 1051 | 1211 |
| 57 | `packages/cli/src/services/__tests__/performResume.spec.ts` | 1041 | 1660 |
| 58 | `packages/core/src/auth/__tests__/keyring-token-store.test.ts` | 1028 | 1684 |
| 59 | `packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx` | 1025 | 1215 |
| 60 | `packages/cli/src/services/FileCommandLoader.test.ts` | 1019 | 1184 |
| 61 | `packages/cli/src/ui/commands/todoCommand.ts` | 990 | 1290 |
| 62 | `packages/core/src/recording/integration.test.ts` | 989 | 1419 |
| 63 | `packages/core/src/recording/RecordingIntegration.test.ts` | 988 | 1141 |
| 64 | `packages/core/src/storage/secure-store.test.ts` | 979 | 1508 |
| 65 | `packages/cli/src/__tests__/sessionBrowserE2E.spec.ts` | 977 | 1455 |
| 66 | `packages/cli/src/ui/commands/diagnosticsCommand.spec.ts` | 972 | 1137 |
| 67 | `packages/cli/src/gemini.tsx` | 965 | 1238 |
| 68 | `packages/core/src/prompt-config/prompt-installer.ts` | 963 | 1298 |
| 69 | `packages/cli/src/config/settings.ts` | 959 | 1205 |
| 70 | `packages/core/src/tools/ripGrep.test.ts` | 954 | 1505 |
| 71 | `packages/core/src/tools/edit.test.ts` | 931 | 1107 |
| 72 | `packages/cli/src/ui/commands/profileCommand.ts` | 929 | 1119 |
| 73 | `packages/core/src/prompt-config/prompt-service.test.ts` | 923 | 1188 |
| 74 | `packages/cli/src/config/extension.ts` | 912 | 1160 |
| 75 | `packages/cli/src/ui/components/shared/vim-buffer-actions.test.ts` | 910 | 1121 |
| 76 | `packages/cli/src/runtime/provider-alias-defaults.test.ts` | 909 | 1253 |
| 77 | `packages/core/src/tools/__tests__/ast-edit-characterization.test.ts` | 909 | 1077 |
| 78 | `packages/cli/src/ui/commands/todoCommand.test.ts` | 900 | 1540 |
| 79 | `packages/core/src/auth/precedence.ts` | 899 | 1128 |
| 80 | `packages/core/src/core/compression/__tests__/compression-retry.test.ts` | 896 | 1234 |
| 81 | `packages/core/src/providers/openai/OpenAIStreamProcessor.ts` | 892 | 1060 |
| 82 | `packages/core/src/core/geminiChat.runtime.test.ts` | 889 | 1015 |
| 83 | `packages/core/src/providers/BaseProvider.ts` | 889 | 1242 |
| 84 | `packages/core/src/core/__tests__/geminiChat-density.test.ts` | 884 | 1305 |
| 85 | `packages/core/src/utils/retry.test.ts` | 873 | 1165 |
| 86 | `packages/core/src/utils/fileUtils.test.ts` | 872 | 1027 |
| 87 | `packages/cli/src/ui/hooks/slashCommandProcessor.ts` | 864 | 982 |
| 88 | `packages/core/src/parsers/TextToolCallParser.ts` | 864 | 1088 |
| 89 | `packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts` | 863 | 1249 |
| 90 | `packages/cli/src/gemini.test.tsx` | 862 | 1057 |
| 91 | `packages/core/src/utils/shell-utils.test.ts` | 861 | 1019 |
| 92 | `packages/core/src/core/MessageStreamOrchestrator.ts` | 859 | 973 |
| 93 | `packages/cli/src/auth/proxy/credential-proxy-server.ts` | 848 | 1109 |
| 94 | `packages/core/src/providers/LoadBalancingProvider.ts` | 847 | 1281 |
| 95 | `packages/core/src/tools/mcp-tool.test.ts` | 843 | 986 |
| 96 | `packages/cli/src/ui/hooks/useSelectionList.test.ts` | 842 | 1044 |
| 97 | `packages/cli/src/ui/components/__tests__/SessionBrowserDialog.spec.tsx` | 837 | 1202 |
| 98 | `packages/core/src/scheduler/confirmation-coordinator.test.ts` | 830 | 997 |
| 99 | `packages/core/src/filters/EmojiFilter.test.ts` | 828 | 1178 |
| 100 | `packages/core/src/providers/openai-vercel/nonStreaming.test.ts` | 827 | 995 |
| 101 | `packages/cli/src/ui/contexts/KeypressContext.test.tsx` | 826 | 1091 |
| 102 | `packages/cli/src/ui/hooks/useCommandCompletion.test.ts` | 826 | 979 |
| 103 | `packages/core/src/core/geminiChat.tokenSync.test.ts` | 817 | 1038 |
| 104 | `packages/cli/src/integration-tests/cli-args.integration.test.ts` | 812 | 1124 |
| 105 | `packages/cli/src/ui/hooks/geminiStream/useStreamEventHandlers.ts` | 806 | 880 |
| 106 | `packages/cli/src/auth/oauth-manager.issue1468.spec.ts` | 802 | 993 |
| 107 | `packages/core/src/core/StreamProcessor.ts` | 801 | 1007 |

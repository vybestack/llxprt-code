# Batch RS-S1 — sonarjs/todo-tag

## Target rule

sonarjs/todo-tag

Policy from BATCH_INVENTORY.md: do not hide real TODOs merely to satisfy lint. TODOs that reference real follow-up work must be converted to linked issue-reference comments or resolved. Domain-language uses of TODO/todo that describe the product todo feature may be reworded when they are not follow-up markers.

## Baseline

- Source lint JSON: /tmp/phase4-summary.json
- Warnings: 249
- Offending files: 64

## Frozen file list

1. packages/cli/src/ui/commands/todoCommand.test.ts — 100 (76:31, 77:29, 101:30, 102:30, 103:29, 122:34, 124:29, 159:32, 161:29, 184:25, 185:24, 186:29, 187:14, 213:25, 214:24, 215:29, 216:14, 241:22, 242:29, 278:29, 303:24, 304:29, 332:25, 333:24, 334:29, 335:14, 364:32, 365:22, 366:29, 401:22, 402:29, 439:29, 472:29, 499:32, 501:29, 502:19, 532:29, 563:29, 651:24, 652:29, 681:31, 682:30, 683:29, 696:59, 705:40, 707:29, 726:35, 728:29, 748:29, 772:29, 797:23, 798:24, 799:29, 800:14, 828:29, 862:29, 892:29, 917:36, 919:29, 946:24, 947:24, 948:29, 949:14, 975:37, 977:29, 1002:24, 1004:29, 1031:22, 1032:24, 1033:29, 1034:14, 1060:22, 1062:29, 1063:21, 1089:35, 1091:29, 1116:22, 1118:29, 1147:19, 1194:33, 1195:24, 1196:29, 1213:48, 1219:31, 1220:24, 1221:29, 1222:32, 1239:48, 1248:23, 1249:30, 1250:29, 1263:59, 1277:23, 1279:29, 1301:23, 1303:29, 1327:23, 1329:29, 1508:22, 1524:32)
2. packages/cli/src/utils/privacy/ConversationDataRedactor.ts — 2 (256:6, 499:6)
3. packages/cli/src/zed-integration/zedIntegration.ts — 3 (241:10, 577:21, 1517:28)
4. packages/cli/src/ui/commands/todoCommand.ts — 18 (21:32, 109:23, 111:22, 140:10, 153:11, 184:11, 251:11, 318:25, 348:11, 415:25, 445:11, 570:11, 758:11, 916:11, 1052:24, 1084:11, 1177:11, 1255:25)
5. packages/cli/src/integration-tests/todo-continuation.integration.test.ts — 12 (29:4, 31:57, 93:20, 180:23, 196:23, 330:21, 424:24, 478:19, 506:23, 522:29, 691:28, 698:32)
6. packages/cli/src/ui/components/TodoPanel.semantic.test.tsx — 1 (92:39)
7. packages/core/src/services/complexity-analyzer.ts — 4 (30:17, 38:23, 78:36, 92:54)
8. packages/cli/src/config/settings.ts — 1 (960:4)
9. packages/cli/src/gemini.tsx — 1 (811:10)
10. packages/core/src/tools/edit.ts — 1 (630:16)
11. packages/core/src/tools/read-many-files.ts — 1 (93:4)
12. packages/cli/src/services/McpPromptLoader.ts — 1 (155:14)
13. packages/core/src/tools/shell.ts — 1 (606:14)
14. packages/core/src/utils/memoryDiscovery.ts — 1 (26:4)
15. packages/cli/src/services/todo-continuation/todoContinuationService.ts — 6 (136:6, 241:24, 261:16, 262:13, 546:45, 548:27)
16. packages/core/src/tools/todo-store.ts — 5 (14:20, 15:38, 41:47, 131:37, 140:36)
17. packages/cli/src/config/extension.ts — 2 (333:8, 538:8)
18. packages/cli/src/ui/components/messages/ToolGroupMessage.tsx — 2 (118:17, 119:19)
19. packages/core/src/config/config.ephemeral.test.ts — 6 (44:18, 45:35, 59:15, 60:35, 77:15, 78:35)
20. packages/core/src/ide/ide-client.ts — 1 (542:12)
21. packages/core/src/providers/openai/OpenAIProvider.ts — 3 (373:8, 383:8, 650:8)
22. packages/cli/src/ui/hooks/useToolScheduler.test.ts — 1 (574:6)
23. packages/core/src/core/subagentToolProcessing.ts — 1 (475:4)
24. packages/core/src/services/todo-context-tracker.ts — 5 (8:27, 9:55, 58:21, 65:21, 72:23)
25. packages/core/src/services/tool-call-tracker-service.ts — 5 (11:37, 39:20, 53:29, 80:38, 177:67)
26. packages/cli/src/integration-tests/compression-todo.integration.test.ts — 4 (11:18, 88:19, 138:25, 170:23)
27. packages/cli/src/ui/components/DialogManager.tsx — 4 (25:83, 58:73, 256:6, 296:6)
28. packages/cli/src/ui/components/ProfileCreateWizard/utils.ts — 1 (291:8)
29. packages/cli/src/ui/hooks/useTodoContinuation.spec.ts — 3 (388:16, 467:50, 600:40)
30. packages/cli/src/ui/hooks/useTodoContinuation.ts — 3 (45:19, 47:14, 217:40)
31. packages/core/src/core/compression/utils.ts — 1 (171:54)
32. packages/vscode-ide-companion/src/ide-server.ts — 1 (475:12)
33. packages/cli/src/ui/commands/types.ts — 3 (53:8, 107:6, 317:22)
34. packages/cli/src/ui/hooks/useCommandCompletion.tsx — 1 (227:23)
35. packages/core/src/hooks/tool-render-suppression-hook.ts — 3 (17:55, 32:35, 33:35)
36. packages/core/src/services/todo-reminder-service.ts — 3 (25:34, 36:28, 104:25)
37. packages/core/src/services/tool-call-tracker-service.test.ts — 3 (60:35, 91:25, 124:41)
38. packages/cli/src/ui/containers/AppContainer/hooks/useDisplayPreferences.ts — 2 (42:6, 97:8)
39. packages/cli/src/ui/containers/AppContainer/hooks/useTodoContinuationFlow.ts — 2 (9:17, 71:14)
40. packages/cli/src/ui/hooks/usePrivacySettings.ts — 2 (12:6, 16:4)
41. packages/core/src/core/subagentExecution.ts — 1 (144:8)
42. packages/core/src/hooks/tool-render-suppression-hook.test.ts — 2 (40:50, 65:34)
43. packages/core/src/integration-tests/todo-system.test.ts — 2 (40:50, 58:35)
44. packages/core/src/scheduler/types.ts — 2 (100:6, 106:6)
45. packages/core/src/utils/extensionLoader.ts — 2 (94:10, 189:10)
46. packages/core/src/utils/ignorePatterns.ts — 2 (167:8, 202:8)
47. packages/cli/src/commands/extensions/update.ts — 1 (71:10)
48. packages/cli/src/config/config.test.ts — 1 (1763:4)
49. packages/cli/src/test-utils/mockCommandContext.ts — 1 (52:10)
50. packages/cli/src/ui/components/TodoPanel.tsx — 1 (112:22)
51. packages/cli/src/ui/containers/AppContainer/hooks/useAppBootstrap.ts — 1 (174:17)
52. packages/cli/src/ui/contexts/TodoContext.tsx — 1 (15:18)
53. packages/cli/src/ui/contexts/TodoProvider.tsx — 1 (61:17)
54. packages/cli/src/ui/contexts/ToolCallContext.tsx — 1 (12:46)
55. packages/cli/src/ui/contexts/ToolCallProvider.tsx — 1 (36:46)
56. packages/cli/src/ui/hooks/geminiStream/toolCompletionHandler.ts — 1 (204:6)
57. packages/cli/src/ui/hooks/useTodoPausePreserver.test.ts — 1 (15:37)
58. packages/core/src/code_assist/codeAssist.ts — 1 (86:10)
59. packages/core/src/code_assist/server.ts — 1 (47:4)
60. packages/core/src/core/coreToolScheduler.test.ts — 1 (2017:6)
61. packages/core/src/services/asyncTaskReminderService.ts — 1 (89:40)
62. packages/core/src/tools/todo-pause.spec.ts — 1 (120:68)
63. packages/core/src/tools/todo-write.ts — 1 (156:19)
64. packages/core/src/types/modelParams.ts — 1 (102:14)

## Implementation guidance

- Do not add sonarjs/todo-tag disables for real TODO markers. Resolve the underlying follow-up marker or convert it to a proper issue-linked TODO comment only if there is an actual follow-up issue.
- Many existing warnings are comments or tests that use TODO/todo as domain terminology for the todo-list feature. Reword those comments/descriptions to task-list or todo-list terminology that does not look like an untracked TODO marker, without changing runtime behavior or weakening test assertions.
- Do not touch files outside the frozen list.
- Do not modify eslint.config.js; the coordinator promotes the rule after repo-wide verification.

## Exit criteria

- npx eslint <listed files> --ext .ts,.tsx --rule sonarjs/todo-tag:error --quiet reports 0 errors for sonarjs/todo-tag.
- Full scoped lint for the listed files passes with unused disables treated as errors.
- Relevant tests/typecheck/build remain green.

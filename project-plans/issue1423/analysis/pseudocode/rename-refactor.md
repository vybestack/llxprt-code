# Pseudocode: Issue #1423 Rename Refactor

Plan ID: PLAN-20260608-ISSUE1423

## Interface Contracts

```typescript
// INPUTS this refactor receives:
interface RenameTargets {
  chatModule: 'packages/core/src/core/geminiChat.ts';
  chatTypesModule: 'packages/core/src/core/geminiChatTypes.ts';
  cliEntry: 'packages/cli/src/gemini.tsx';
  clientClass: 'GeminiClient';
  chatClass: 'GeminiChat';
  configAccessor: 'getGeminiClient';
  configField: 'geminiClient';
  testHelper: 'createGeminiChatRuntime';
  testHelperTypes: ['GeminiChatConfigShape', 'GeminiChatRuntimeOptions', 'GeminiChatRuntimeResult'];
  zedHelper: 'getRuntimeGeminiClient';
  providerTestHelper: 'createGeminiChat';
}

// OUTPUTS this refactor produces:
interface RenameResults {
  chatModule: 'packages/core/src/core/chatSession.ts';
  chatTypesModule: 'packages/core/src/core/chatSessionTypes.ts';
  cliEntry: 'packages/cli/src/cli.tsx';
  clientClass: 'AgentClient';
  chatClass: 'ChatSession';
  configAccessor: 'getAgentClient';
  configField: 'agentClient';
  testHelper: 'createChatSessionRuntime';
  testHelperTypes: ['ChatSessionConfigShape', 'ChatSessionRuntimeOptions', 'ChatSessionRuntimeResult'];
  zedHelper: 'getRuntimeAgentClient';
  providerTestHelper: 'createChatSession';
}

// DEPENDENCIES this refactor requires:
interface RefactorDependencies {
  git: 'file moves must preserve tracked history where possible';
  ripgrep: 'source-wide reference discovery';
  typescript: 'typecheck verifies import/name completeness';
  vitest: 'existing tests verify behavior remains unchanged';
}
```

## Numbered Algorithm

10: METHOD createNamingRegressionTests()
11: ADD/UPDATE a source-controlled test or script that scans non-generated source paths for old targeted provider-agnostic filenames, import paths, exported symbols, and config accessors.
12: EXCLUDE generated and out-of-scope paths: dist, coverage, tmp, node_modules, project-plans, Gemini provider/auth files, provider aliases, and `geminiStream` directory unless a targeted old symbol appears there.
13: ASSERT old source files `packages/core/src/core/geminiChat.ts`, `packages/core/src/core/geminiChatTypes.ts`, and `packages/cli/src/gemini.tsx` do not exist after implementation.
14: ASSERT old import paths `./geminiChat.js`, `./geminiChatTypes.js`, and `./gemini.js` do not appear in targeted source/test files after implementation.
15: ASSERT old exported/provider-agnostic type names `GeminiChat`, `GeminiClient`, `getGeminiClient`, `geminiClient` (field), `createGeminiChatRuntime`, `GeminiChatConfigShape`, `GeminiChatRuntimeOptions`, `GeminiChatRuntimeResult`, and `getRuntimeGeminiClient` do not remain outside explicitly allowed Gemini provider-specific contexts.
16: VERIFY the new test/script fails before implementation because old names currently exist.

20: METHOD renameChatSessionModule()
21: MOVE `packages/core/src/core/geminiChat.ts` to `packages/core/src/core/chatSession.ts`.
22: MOVE `packages/core/src/core/geminiChatTypes.ts` to `packages/core/src/core/chatSessionTypes.ts`.
23: RENAME exported class `GeminiChat` to `ChatSession`.
24: UPDATE internal imports/exports in `chatSession.ts` from `geminiChatTypes.js` to `chatSessionTypes.js`; also update the re-export `export { StreamEventType, StreamEvent } from './geminiChatTypes.js'` to `'./chatSessionTypes.js'`.
25: UPDATE all imports from `geminiChat.js` to `chatSession.js` in core (47 source/test files), CLI, A2A, and providers tests.
26: UPDATE all imports from `geminiChatTypes.js` to `chatSessionTypes.js` in the 9 verified core consumers: `geminiChat.ts` (lines 46, 51, 57), `ConversationManager.ts` (line 26), `DirectMessageProcessor.ts` (line 34), `MessageConverter.ts` (line 34), `StreamProcessor.ts` (line 53), `TurnProcessor.ts` (line 48), `StreamProcessor.retryBoundary.test.ts` (line 16), and `generateContentResponseUtilities.ts` (lines 23, 90).
27: UPDATE type annotations and local names that directly refer to `GeminiChat` to `ChatSession` across 44 unique files (core: 35, CLI: 3, providers: 1, integration-tests: 2+). Includes `ChatSessionFactory.ts` where `Promise<GeminiChat>` return types, `new GeminiChat(...)`, and JSDoc "GeminiChat" references must all become `ChatSession`.
28: UPDATE `packages/core/package.json` export subpath from `"./core/geminiChat.js": "./dist/src/core/geminiChat.js"` to `"./core/chatSession.js": "./dist/src/core/chatSession.js"`.
29: RENAME chat-session test filenames that start with `geminiChat` to `chatSession`; verified list: `packages/core/src/core/__tests__/geminiChat-density.test.ts`, `geminiChat.runtimeState.test.ts`, and side-by-side tests `geminiChat.contextlimit.test.ts`, `geminiChat.hook-control.test.ts`, `geminiChat.issue1150.integration.test.ts`, `geminiChat.issue1729.test.ts`, `geminiChat.runtime.test.ts`, `geminiChat.thinking-spacing.test.ts`, `geminiChat.thinking-toolcalls.test.ts`, `geminiChat.thinkingHistory.test.ts`, `geminiChat.tokenSync.test.ts`; and integration test `packages/core/src/integration-tests/geminiChat-isolation.integration.test.ts`.
30: RENAME integration test filenames that start with `geminiChat` to `chatSession`.
31: PRESERVE runtime logic and error classes that are already provider-agnostic.
32: RENAME `createGeminiChatRuntime` and its types `GeminiChatConfigShape`, `GeminiChatRuntimeOptions`, `GeminiChatRuntimeResult` in `packages/core/src/test-utils/runtime.ts` to `createChatSessionRuntime`, `ChatSessionConfigShape`, `ChatSessionRuntimeOptions`, `ChatSessionRuntimeResult`; update all 7+ core test files importing `createGeminiChatRuntime` (compression-retry, compression-recency, hook-control, contextlimit, tokenSync, thinking-spacing, density).
33: RENAME `createGeminiChat()` function and `geminiChat` local variable in `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts` to `createChatSession()` and `chatSession`; preserve `gemini-1.5-pro` and `gemini-embedding` model name strings.
34: UPDATE JSDoc and inline comments referencing `geminiChat.ts` or `GeminiChat` as a module/class name in: `ChatSessionFactory.ts` (lines 232, 298), `generateContentResponseUtilities.ts` (line 90), `HistoryService.ts` (line 814), `turnLogging.ts` (line 9), `bucketFailoverIntegration.ts` (line 9), `baseLlmClient.ts` (line 107), `MessageStreamOrchestrator.ts` (line 102), `setCommand.ts` (lines 554, 557), and CLI integration-test comments (compression-settings-apply, ephemeral-settings, compression-todo).
35: UPDATE `packages/core/src/index.ts` line 80 from `export * from './core/geminiChat.js'` to `export * from './core/chatSession.js'`; do NOT change line 85 `export * from './core/geminiRequest.js'`.

40: METHOD renameCliEntryModule()
41: MOVE `packages/cli/src/gemini.tsx` to `packages/cli/src/cli.tsx`.
42: MOVE CLI entry tests `gemini.test.tsx`, `gemini.startInteractiveUI.test.tsx`, `gemini.provider-init.test.ts`, and `gemini.renderOptions.test.tsx` to matching `cli.*` names.
43: UPDATE `packages/cli/index.ts` import from `./src/gemini.js` to `./src/cli.js`.
44: UPDATE `packages/cli/src/commands/skills.tsx` and tests from `../gemini.js` to `../cli.js`.
45: UPDATE dynamic imports in CLI tests from `./gemini.js` to `./cli.js`; specifically `gemini.renderOptions.test.tsx` lines 114 and 150.
46: UPDATE comments that refer to `gemini.tsx` as an entry module to `cli.tsx`.
47: PRESERVE provider-specific Gemini auth/provider file names.

60: METHOD renameAgentClient()
61: RENAME class `GeminiClient` to `AgentClient` in `packages/core/src/core/client.ts`.
62: RENAME private field `chat?: GeminiChat` to use `ChatSession` type.
63: UPDATE all core public exports/imports to export/import `AgentClient` from `client.js`.
64: RENAME `ConfigBaseCore` import type `GeminiClient` to `AgentClient`.
65: RENAME protected field `geminiClient` (line 119) to `agentClient`.
66: RENAME accessor `getGeminiClient()` (line 494) to `getAgentClient()`; also rename the return type from `GeminiClient` to `AgentClient`.
67: UPDATE `packages/core/src/config/config.ts`: rename `new GeminiClient(...)` to `new AgentClient(...)` (lines 198, 315), `this.geminiClient` to `this.agentClient` (line 345), `previousGeminiClient` to `previousAgentClient` (lines 235, 237, 240, 241, 310, 331, 332, 335), `newGeminiClient` parameter and local to `newAgentClient` (lines 274, 283, 300, 315, 319, 325, 345), and JSDoc comments referencing `GeminiClient`.
68: UPDATE all production/test callers of `getGeminiClient()` to `getAgentClient()`; verified 72 unique files across core (35 files), CLI (33 files), A2A (1 file), and providers.
69: UPDATE all production/test imports/types/local stubs named `GeminiClient` to `AgentClient` where they refer to the core agent client; verified 57 unique files.
70: UPDATE local variables, mocks, helper names, and comments from `geminiClient`/`mockGeminiClient` to agent-client names wherever they refer to the provider-agnostic core client; verified 186 `mockGeminiClient` references across 10 CLI test files and 4 core test files, plus `makeGeminiClient()` helper in `checkpointPersistence.test.ts`, `geminiClient` local variables in 39 unique files, and `getRuntimeGeminiClient()` helper in `zedIntegration.ts`.
71: RENAME core client test filenames `packages/core/src/core/__tests__/geminiClient.runtimeState.test.ts` and `geminiClient.dispose.test.ts` to `agentClient.runtimeState.test.ts` and `agentClient.dispose.test.ts`.
72: PRESERVE runtime logic and method bodies except for necessary identifier/import updates.

73: METHOD renameAgentClientInGeminiStreamDirectory()
74: FILES inside `packages/cli/src/ui/hooks/geminiStream/` that must update `GeminiClient`/`geminiClient`/`getGeminiClient` references (directory name and `useGeminiStream` hook name stay): `useGeminiStreamOrchestration.ts` (type import, field, call-site args), `toolCompletionHandler.ts` (type import, parameter, call-sites, JSDoc), `useSubmitQuery.ts` (type import, field, call-sites), `checkpointPersistence.ts` (type import, parameter, call-sites, JSDoc), `useGeminiStreamLifecycle.ts` (type import, parameters, call-sites), `useGeminiStream.ts` (type import).
75: TEST files inside `packages/cli/src/ui/hooks/geminiStream/__tests__/` that must update `GeminiClient`/`mockGeminiClient`/`geminiClient` references: `toolCompletionHandler.test.ts` (type import, local mock, call-sites), `checkpointPersistence.test.ts` (type import, `makeGeminiClient()` helper rename to `makeAgentClient()`, local variable `geminiClient` rename to `agentClient`, call-sites).
76: PRESERVE `geminiStreamLogger` in `toolCompletionHandler.ts` and `useGeminiStream` hook name — these are directory/module-scoped identifiers that stay.

80: METHOD cleanupAndVerify()
81: RUN targeted ripgrep scans for old paths and names with generated/out-of-scope exclusions: `**/dist/**`, `**/coverage/**`, `**/node_modules/**`, `tmp/**`, `project-plans/**`, `**/*.log`, and `**/*.xml`.
82: INCLUDE package metadata and test utilities in scans; specifically verify `packages/core/package.json` has no `geminiChat` export.
83: READ remaining matches and classify each as legitimate Gemini provider-specific name or violation.
84: FIX any violation by direct rename, not alias.
85: RUN focused tests for renamed chat session, cli entry, config/client, non-interactive CLI, and A2A task paths.
86: RUN `npm run test`.
87: RUN `npm run lint`.
88: RUN `npm run typecheck`.
89: RUN `npm run format`.
90: RUN `npm run build`.
91: RUN smoke command `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"`.
92: IF any check fails, inspect failure and remediate directly without reintroducing old names.
93: RECORD completion markers and actual verification outputs.

## Integration Points Line-by-Line

- Line 28: `packages/core/package.json` subpath export MUST be replaced, not appended; old `./core/geminiChat.js` entry MUST be removed entirely.
- Line 35: Core barrel `packages/core/src/index.ts` line 80 MUST export from `./core/chatSession.js`; line 85 (`./core/geminiRequest.js`) MUST NOT change.
- Line 43: CLI binary MUST import from the renamed module or user startup fails.
- Line 67: Config construction MUST use the renamed class and field names or TypeScript/public exports fail.
- Line 68: All callers MUST use `getAgentClient()` because old accessor aliases are forbidden.
- Line 73-76: Files inside `geminiStream/` directory MUST update provider-agnostic client symbols even though the directory keeps its name.
- Line 85: Existing behavioral tests MUST remain the proof that the rename did not alter runtime behavior.

## Anti-Pattern Warnings

[ERROR] DO NOT: `export { ChatSession as GeminiChat }`.
[OK] DO: update all imports to `ChatSession`.

[ERROR] DO NOT: keep `getGeminiClient()` delegating to `getAgentClient()`.
[OK] DO: update every caller to `getAgentClient()`.

[ERROR] DO NOT: create `gemini.tsx` that imports `cli.tsx`.
[OK] DO: update `packages/cli/index.ts` and all tests to `cli.js`.

[ERROR] DO NOT: rename concrete Gemini provider/auth files outside the issue scope.
[OK] DO: leave provider-specific names intact and document why remaining matches are legitimate.

[ERROR] DO NOT: leave `mockGeminiClient`, `makeGeminiClient`, `createGeminiChatRuntime`, `GeminiChatConfigShape`, `previousGeminiClient`, `newGeminiClient` as old-name aliases.
[OK] DO: rename all local variables, mocks, helpers, and parameter names to their agent-client/chat-session equivalents.

[ERROR] DO NOT: skip files inside `geminiStream/` because the directory name is out of scope.
[OK] DO: update all `GeminiClient`/`geminiClient`/`getGeminiClient` references inside `geminiStream/` files while keeping the directory and hook names.

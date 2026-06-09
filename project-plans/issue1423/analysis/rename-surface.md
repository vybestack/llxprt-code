# Rename Surface Inventory

Plan ID: PLAN-20260608-ISSUE1423

This inventory is generated from the current pre-implementation scan in `analysis/current-rename-matches.txt`. Preflight P0.5 must refresh the inventory with actual outputs before execution.

## Must-Rename / Must-Update Groups

### A2A package

- `packages/a2a-server/src/agent/task.ts`
- `packages/a2a-server/src/agent/executor.ts`
- `packages/a2a-server/src/agent/task.test.ts`
- `packages/a2a-server/src/http/app.test.ts`
- `packages/a2a-server/src/http/endpoints.test.ts`
- `packages/a2a-server/src/utils/testing_utils.ts`

Update core agent client imports/types, local fields/mocks, and accessor names to `AgentClient`, `agentClient`, and `getAgentClient` where they refer to the provider-agnostic client.

### CLI entry module and entry tests

- `packages/cli/index.ts`
- `packages/cli/src/gemini.tsx`
- `packages/cli/src/gemini.test.tsx`
- `packages/cli/src/gemini.provider-init.test.ts`
- `packages/cli/src/gemini.renderOptions.test.tsx`
- `packages/cli/src/gemini.startInteractiveUI.test.tsx`
- `packages/cli/src/commands/skills.tsx`

Rename files to `cli*`, update import paths/mocks/dynamic imports/descriptions/comments.

### CLI runtime, hooks, commands, and tests

Current matches include commands, AppContainer hooks, `zed-integration`, non-interactive support, command context test utilities, `ui/hooks/geminiStream/**`, and integration tests. Files inside `ui/hooks/geminiStream/**` keep the folder name for this issue but must still rename provider-agnostic core symbols/local variables such as `GeminiClient`, `geminiClient`, and `getGeminiClient` to agent-client names.

Representative files from current scan:

- `packages/cli/src/nonInteractiveCliSupport.ts`
- `packages/cli/src/zed-integration/zedIntegration.ts`
- `packages/cli/src/test-utils/mockCommandContext.ts`
- `packages/cli/src/ui/commands/*.ts*` and related tests
- `packages/cli/src/ui/containers/AppContainer/hooks/*.ts*`
- `packages/cli/src/ui/hooks/*.ts*`
- `packages/cli/src/ui/hooks/geminiStream/**/*.ts*`
- CLI integration tests listed in `analysis/current-rename-matches.txt`

### Core package metadata and public exports

- `packages/core/package.json` must replace export subpath `./core/geminiChat.js` with `./core/chatSession.js` or remove it if no longer needed.
- `packages/core/src/index.ts` must export from `./core/chatSession.js` and expose `AgentClient`, not old aliases.

### Core implementation, config, utilities, tools, agents, and tests

Current matches include:

- `packages/core/src/core/geminiChat.ts`
- `packages/core/src/core/geminiChatTypes.ts`
- `packages/core/src/core/client.ts`
- `packages/core/src/config/config.ts`
- `packages/core/src/config/configBaseCore.ts`
- `packages/core/src/core/ChatSessionFactory.ts`
- `packages/core/src/core/StreamProcessor.ts`
- `packages/core/src/core/TurnProcessor.ts`
- `packages/core/src/core/MessageConverter.ts`
- `packages/core/src/core/DirectMessageProcessor.ts`
- `packages/core/src/core/ConversationManager.ts`
- `packages/core/src/core/MessageStreamOrchestrator.ts`
- `packages/core/src/agents/executor.ts`
- `packages/core/src/tools/shell.ts`
- `packages/core/src/code_assist/codeAssist.ts`
- `packages/core/src/utils/extensionLoader.ts`
- `packages/core/src/utils/generateContentResponseUtilities.ts`
- all related tests listed in `analysis/current-rename-matches.txt`

### Provider package tests importing core provider-agnostic names

- `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts`

Update imports/types if they refer to renamed core chat/client symbols. Do not rename actual Gemini provider implementation code.

## Generated / Test Output Artifacts to Exclude From Scans

Exclude these categories from naming-regression scans:

- `**/dist/**`
- `**/coverage/**`
- `**/node_modules/**`
- `tmp/**`
- `project-plans/**`
- `**/*.log`
- `**/*.xml`
- generated report files such as junit output

Known current generated/test-output files containing old names and excluded by plan scans:

- `packages/cli/junit-cli-integration.xml`
- `packages/core/src/hooks/__tests__/test-run.log`

## Provider-Specific Names To Preserve

Do not rename solely due to `gemini` in these provider-specific surfaces:

- `packages/cli/src/auth/gemini-oauth-provider.ts`
- `packages/cli/src/providers/aliases/gemini.config`
- Gemini provider implementation/config/auth names
- `packages/core/src/core/geminiRequest.ts`
- `packages/cli/src/ui/hooks/geminiStream/` folder/API name as a folder-level scope decision for this issue

Important: preserving `geminiStream/` folder name does not allow old provider-agnostic `GeminiClient`, `geminiClient`, or `getGeminiClient` identifiers inside those files.

## Final Scan Policy

A remaining match is a violation unless it is:

1. In an explicitly excluded generated/test-output path, or
2. In an explicitly Gemini provider-specific path/name, or
3. In issue plan documentation.

Broad provider-agnostic source path matches cannot be waved through as out of scope.

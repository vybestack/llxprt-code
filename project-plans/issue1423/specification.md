# Feature Specification: Provider-Agnostic Core Naming for Issue #1423

## Purpose

Issue #1423 requests a refactor of misleading Gemini-specific names in provider-agnostic code because those names confuse LLM agents working in this repository. The work must rename the selected files/classes/methods instead of adding aliases or compatibility shims, and it must update all callers to the new names.

This is a code quality refactor. Runtime behavior must remain unchanged.

## Architectural Decisions

- **Pattern**: direct rename refactor with no aliases and no compatibility wrappers.
- **Technology Stack**: TypeScript strict mode, Node.js >=20, npm workspaces, Vitest.
- **Data Flow**: Existing CLI and A2A entry points continue to create config, initialize the agent client, start chat sessions, and stream responses through the same runtime paths.
- **No shims**: old exports such as `GeminiChat`, `GeminiClient`, `getGeminiClient`, `geminiChat.js`, and `gemini.js` must not remain as compatibility aliases.
- **Scope boundaries**: Gemini provider-specific code remains Gemini-specific. Do not rename the Gemini auth/provider implementation, provider aliases, provider config files, `geminiRequest.ts`, or the `geminiStream` hook directory as folder/API surface unless a direct import/type update is required by the renamed core types.

## Project Structure

```text
project-plans/issue1423/
  specification.md
  execution-tracker.md
  analysis/
    domain-model.md
    integration-contract.md
    pseudocode/
      rename-refactor.md
  plan/
    00-overview.md
    00a-preflight-verification.md
    01-analysis.md
    01a-analysis-verification.md
    02-pseudocode.md
    02a-pseudocode-verification.md
    03-naming-regression-tdd.md
    03a-naming-regression-tdd-verification.md
    04-core-chat-rename-impl.md
    04a-core-chat-rename-verification.md
    05-cli-entry-rename-impl.md
    05a-cli-entry-rename-verification.md
    06-agent-client-rename-impl.md
    06a-agent-client-rename-verification.md
    07-cross-package-cleanup-impl.md
    07a-cross-package-cleanup-verification.md
    08-full-verification.md
    08a-final-semantic-review.md
```

## Technical Environment

- **Type**: TypeScript monorepo CLI/library refactoring.
- **Runtime**: Node.js >=20.
- **Testing**: Vitest through package/root npm scripts.
- **Build**: `node scripts/build.js` through root `npm run build`.

## Integration Points

### Existing Code That Will Use The Renamed Components

- `packages/cli/index.ts` imports the CLI entry module.
- `packages/cli/src/commands/skills.tsx` imports CLI listener initialization from the entry module.
- `packages/core/src/config/config.ts` constructs the agent client and stores it on config.
- `packages/core/src/config/configBaseCore.ts` exposes the agent client accessor.
- `packages/core/src/core/client.ts` starts chat sessions through `ChatSessionFactory` and stores the active chat session.
- `packages/core/src/core/ChatSessionFactory.ts` constructs chat sessions.
- `packages/core/src/core/StreamProcessor.ts`, `TurnProcessor.ts`, `MessageConverter.ts`, `DirectMessageProcessor.ts`, `ConversationManager.ts`, and `MessageStreamOrchestrator.ts` consume chat session types/events.
- CLI UI hooks and commands consume `Config.getAgentClient()` and `AgentClient` types for history, streaming, prompts, shell history, tool refresh, and command flows.
- `packages/a2a-server/src/agent/task.ts` constructs and uses the core agent client.

### Existing Code To Be Replaced Or Removed

- `packages/core/src/core/geminiChat.ts` renamed to `packages/core/src/core/chatSession.ts`.
- `packages/core/src/core/geminiChatTypes.ts` renamed to `packages/core/src/core/chatSessionTypes.ts`.
- `packages/core/package.json` export subpath `./core/geminiChat.js` replaced with `./core/chatSession.js`; no old public subpath remains.
- `packages/cli/src/gemini.tsx` renamed to `packages/cli/src/cli.tsx`.
- Core class `GeminiChat` renamed to `ChatSession`.
- Core class `GeminiClient` renamed to `AgentClient` inside `packages/core/src/core/client.ts`.
- Config field `geminiClient` renamed to `agentClient`.
- Config method `getGeminiClient()` renamed to `getAgentClient()`.
- Tests, test utilities, package metadata, source import paths, dynamic imports, mocks, local variables, and comments that refer to the renamed provider-agnostic targets must be updated.

### User Access Points

All current user access points must keep working:

- `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"`.
- CLI package binary path through `packages/cli/index.ts`.
- Non-interactive CLI prompt execution.
- Interactive UI startup and history/session restore flows.
- A2A server task execution paths.

### Migration Requirements

- No user data migration.
- Rename source/test files with git-tracked moves where possible.
- No old-name aliases, re-export shims, wrapper files, or duplicated `V2`/`New` classes.
- Update all callers directly.
- Preserve Gemini provider-specific names where they describe the Gemini provider rather than provider-agnostic agent runtime.

## Formal Requirements

[REQ-NAME-001] Chat session module rename
  [REQ-NAME-001.1] `packages/core/src/core/geminiChat.ts` MUST be renamed to `packages/core/src/core/chatSession.ts`.
  [REQ-NAME-001.2] `GeminiChat` MUST be renamed to `ChatSession` and all callers updated.
  [REQ-NAME-001.3] `packages/core/src/core/geminiChatTypes.ts` MUST be renamed to `packages/core/src/core/chatSessionTypes.ts` and all callers updated.
  [REQ-NAME-001.4] Old chat module paths MUST NOT remain as source files, package metadata exports, or exported shims.

[REQ-NAME-002] CLI entry module rename
  [REQ-NAME-002.1] `packages/cli/src/gemini.tsx` MUST be renamed to `packages/cli/src/cli.tsx`.
  [REQ-NAME-002.2] CLI imports, tests, and comments that refer to the old entry file MUST be updated.
  [REQ-NAME-002.3] Old CLI entry module path MUST NOT remain as a source file or exported shim.

[REQ-NAME-003] Agent client rename
  [REQ-NAME-003.1] `GeminiClient` MUST be renamed to `AgentClient` in `packages/core/src/core/client.ts`.
  [REQ-NAME-003.2] Config storage and accessor MUST be renamed from `geminiClient`/`getGeminiClient()` to `agentClient`/`getAgentClient()`.
  [REQ-NAME-003.3] All production and test callers in core, CLI, A2A, and test utilities MUST use the new names.
  [REQ-NAME-003.4] Old client names MUST NOT remain as aliases, compatibility exports, or wrapper types.

[REQ-VERIFY-001] Behavioral and structural verification
  [REQ-VERIFY-001.1] Existing behavior tests for chat sessions, CLI startup, config, and streaming MUST pass after the rename.
  [REQ-VERIFY-001.2] Add a regression test or verification script that fails while old provider-agnostic source files/classes/accessors still exist.
  [REQ-VERIFY-001.3] Full verification required by project memory MUST pass before check-in.

## Data Schemas

No runtime data schema is introduced.

## Constraints

- Do not rename Gemini provider-specific files such as `packages/cli/src/auth/gemini-oauth-provider.ts`, provider aliases/config, or `packages/core/src/core/geminiRequest.ts`.
- Do not introduce old-name aliases to ease migration.
- Do not modify `.llxprt/`.
- Prefer mechanical renames and targeted import/name updates over behavioral changes.
- Preserve existing public behavior and error handling.

## Example Data

Before:

```typescript
import { GeminiClient } from '@vybestack/llxprt-code-core';
const client = config.getGeminiClient();
```

After:

```typescript
import { AgentClient } from '@vybestack/llxprt-code-core';
const client = config.getAgentClient();
```

## Success Criteria

- No provider-agnostic source/test import uses `geminiChat.js`, `geminiChatTypes.js`, or `gemini.js` for the renamed targets.
- No provider-agnostic source/test references `GeminiChat`, `geminiChat`, `geminiChatTypes`, `GeminiClient`, `geminiClient`, or `getGeminiClient` except in issue plan documentation or explicitly Gemini provider-specific contexts.
- `packages/core/package.json` exposes `./core/chatSession.js` if that subpath remains needed and does not expose `./core/geminiChat.js`.
- No package metadata, package exports, source-directory test snapshots/logs, test utility names, mocks, or local variables expose targeted provider-agnostic old names except generated artifacts explicitly excluded by verification.
- Full project verification and smoke test pass.

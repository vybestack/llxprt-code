# Domain Analysis: Issue #1423 Provider-Agnostic Naming

Plan ID: PLAN-20260608-ISSUE1423

## Entities

### In-Scope Rename Targets

#### ChatSession

Current name: `GeminiChat` in `packages/core/src/core/geminiChat.ts` (line 118: `export class GeminiChat`).

Role: conversation/session coordinator that wires compression, conversation state, turn processing, stream processing, and direct message generation. It is not Gemini-provider-specific and therefore should be renamed to `ChatSession`.

Re-exported through:
- `packages/core/src/index.ts` line 80: `export * from './core/geminiChat.js'`
- `packages/core/package.json` line 27: `"./core/geminiChat.js": "./dist/src/core/geminiChat.js"`
- `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts` line 11: `import { GeminiChat } from '@vybestack/llxprt-code-core/core/geminiChat.js'`

All three must be renamed in lockstep: the class, the file, the barrel export, and the package.json subpath.

#### ChatSessionTypes

Current file: `packages/core/src/core/geminiChatTypes.ts`.

Role: stream event types, stream errors, schema-depth detection, and other chat-session-related type exports. It is not Gemini-provider-specific and should follow the chat session module name.

Imported by the following core files (all must update import paths):
- `packages/core/src/core/geminiChat.ts` (lines 46, 51, 57)
- `packages/core/src/core/ConversationManager.ts` (line 26)
- `packages/core/src/core/DirectMessageProcessor.ts` (line 34)
- `packages/core/src/core/MessageConverter.ts` (line 34)
- `packages/core/src/core/StreamProcessor.ts` (line 53)
- `packages/core/src/core/TurnProcessor.ts` (line 48)
- `packages/core/src/core/StreamProcessor.retryBoundary.test.ts` (line 16)
- `packages/core/src/utils/generateContentResponseUtilities.ts` (lines 23, 90)

Note: `geminiChat.ts` re-exports `StreamEventType` and `StreamEvent` from `geminiChatTypes.js` (line 46). These exports are provider-agnostic and must be preserved through the renamed module path.

#### AgentClient

Current name: `GeminiClient` in `packages/core/src/core/client.ts` (line 72: `export class GeminiClient`).

Role: main agent orchestration client. It owns the current chat session, content generator, history services, loop detection, tool setup, direct generation utilities, and stream orchestration. It operates over runtime provider abstractions and is not Gemini-specific.

Imported by consumers across all four packages:
- Core: `config.ts` (constructs `new GeminiClient` lines 198, 315), `configBaseCore.ts` (accessor `getGeminiClient()` line 494)
- CLI: 85+ files via `geminiClient`, `getGeminiClient`, and type references throughout hooks, commands, and tests
- A2A: `task.ts` (imports `GeminiClient`, field `geminiClient`, `new GeminiClient` line 153), `executor.ts`, `task.test.ts`, `app.test.ts`, `endpoints.test.ts`, `testing_utils.ts`
- Providers: `OpenAIStreamProcessor.stopReason.test.ts` (does not import `GeminiClient` directly but imports `GeminiChat`)

#### Config Agent Client Accessor

Current storage/accessor: `geminiClient` (field) and `getGeminiClient()` (method) on `ConfigBaseCore`.

Role: config-owned access to the initialized core agent client for CLI commands, UI hooks, A2A, tools, and extensions. Must be renamed in lockstep with `AgentClient`.

Verified locations:
- `packages/core/src/config/configBaseCore.ts` line 494: `getGeminiClient(): GeminiClient`
- `packages/core/src/config/config.ts` lines 198, 315: `this.geminiClient = new GeminiClient(...)` and `const newGeminiClient = new GeminiClient(...)`
- `packages/a2a-server/src/utils/testing_utils.ts` line 254: `getGeminiClient: vi.fn()`

#### CLI Entry Module

Current file: `packages/cli/src/gemini.tsx`.

Role: bootstraps CLI startup, provider initialization, and interactive/non-interactive flows. It is the CLI entry implementation, not Gemini-specific.

Imported by:
- `packages/cli/index.ts` line 11: `import { main } from './src/gemini.js'`
- `packages/cli/src/commands/skills.tsx` line 13: `import { initializeOutputListenersAndFlush } from '../gemini.js'`
- `packages/cli/src/gemini.provider-init.test.ts` line 8: `import * as gemini from './gemini.js'`
- `packages/cli/src/gemini.startInteractiveUI.test.tsx` line 8: `import { validateDnsResolutionOrder, startInteractiveUI } from './gemini.js'`
- `packages/cli/src/gemini.renderOptions.test.tsx` lines 114, 150: `await import('./gemini.js')`

All must be updated to import from `cli.js` / `./cli.js`.

### Out-of-Scope Entities (Provider-Specific or Protocol Names to Preserve)

These entities contain "Gemini" in their names but are either provider-specific, protocol-level, or represent Gemini API concepts. They must NOT be renamed in this issue.

#### GeminiEventType (enum, 456 references)

Defined in `packages/core/src/core/turn.ts` line 78: `export enum GeminiEventType { ... }`.

This is a protocol-level event type enum used across all packages (core, CLI, A2A) with 456 references. It represents the Gemini streaming protocol's event types (Content, Thought, ToolCallRequest, etc.). Although the name contains "Gemini," it is deeply embedded as a stream protocol contract and renaming it would require updating every stream event consumer. This is a larger-scope API change beyond the scope of issue #1423's provider-agnostic class/file/method rename.

#### ServerGeminiStreamEvent (type, 160 references)

Defined in `packages/core/src/core/turn.ts` line 315: `export type ServerGeminiStreamEvent = ...`.

A union type including `ServerGeminiChatCompressedEvent` that represents server-sent stream events. Used extensively in A2A (`task.ts`, `task-support.ts`, `executor.ts`) and CLI stream processing. A protocol-level type, not a provider-agnostic agent name.

#### ServerGeminiChatCompressedEvent (type, 7 references)

Defined in `packages/core/src/core/turn.ts` line 248.

Used in `packages/cli/src/ui/hooks/geminiStream/streamEventDispatcher.ts` and `useStreamEventHandlers.ts`. A compression-specific event type within the stream protocol.

#### GeminiCLIExtension (interface, 223 references)

Defined in `packages/core/src/config/configTypes.ts` line 134: `export interface GeminiCLIExtension { ... }`.

A core config type used by extension loading, MCP client management, tool registration, and settings. Although named with "Gemini," it represents a CLI extension abstraction consumed by 223+ references. Renaming this is a larger-scope API change that would touch the entire extension system.

#### GeminiOAuthProvider (class)

File: `packages/cli/src/auth/gemini-oauth-provider.ts`.

Provider-specific OAuth implementation for the Gemini authentication flow. Must not be renamed.

#### geminiStream/ (directory) and useGeminiStream (hook)

Directory: `packages/cli/src/ui/hooks/geminiStream/`.

Contains 16+ source files implementing stream event processing. The directory name, `useGeminiStream` hook name, `geminiStreamLogger` logger, and barrel comments reference "geminiStream" as a UI module scope. The folder and hook names are out of scope for this issue per the specification. However, files inside this directory that reference provider-agnostic `GeminiClient`/`geminiClient`/`getGeminiClient` (e.g., `useGeminiStreamOrchestration.ts`, `toolCompletionHandler.ts`, `useSubmitQuery.ts`) MUST still be updated for those symbols.

#### setServerGeminiMdFilename (local alias)

File: `packages/cli/src/config/interactiveContext.ts` line 9: `setLlxprtMdFilename as setServerGeminiMdFilename`.

This is a local import alias from an already-provider-agnostic core function `setLlxprtMdFilename`. The local alias name `setServerGeminiMdFilename` is a naming artifact, not a provider-agnostic symbol rename target — the core function is already correctly named.

#### geminiRequest.ts

File: `packages/core/src/core/geminiRequest.ts`.

Gemini API-specific request utilities. Provider-specific, must not be renamed. Exported from `packages/core/src/index.ts` line 85: `export * from './core/geminiRequest.js'`.

#### gemini.config (provider alias file)

File: `packages/cli/src/providers/aliases/gemini.config`.

Provider configuration for the Gemini provider. Must not be renamed.

#### gemini-1.5-pro and gemini-embedding (model names)

These are actual Gemini provider model name strings used in tests (e.g., `OpenAIStreamProcessor.stopReason.test.ts` lines 37, 40). They are literal model identifiers, not provider-agnostic names.

## State Transitions

1. CLI entry (`cli.tsx`) parses startup flags and builds config.
2. Config initializes runtime provider state and constructs `AgentClient`.
3. Consumers retrieve the client through `config.getAgentClient()`.
4. `AgentClient.startChat()` creates a `ChatSession` using `ChatSessionFactory`.
5. `ChatSession` delegates to stream/turn/conversation/compression processors.
6. Existing history, stream, and command behaviors continue unchanged.

## Business Rules

- Rename selected provider-agnostic identifiers directly.
- Do not keep old-name compatibility shims because issue #1423 explicitly says "not alias and update all callers".
- Preserve provider-specific Gemini names where they still describe a concrete Gemini provider or protocol.
- Do not introduce behavior changes; this is a maintainability refactor.

## Edge Cases

- Dist/coverage/tmp outputs contain old names but are not authoritative source targets; scans must exclude generated artifacts.
- `ServerGeminiStreamEvent` (160 refs), `GeminiEventType` (456 refs), `ServerGeminiChatCompressedEvent` (7 refs), and `GeminiCLIExtension` (223 refs) are protocol/API-level names that contain "Gemini" but are outside scope. These represent stream event types, event enums, and extension interfaces — not provider-agnostic agent/client/session names.
- The `geminiStream/` directory and `useGeminiStream` hook name remain as-is for this issue, but files inside that directory must still update `GeminiClient`/`geminiClient`/`getGeminiClient` references.
- Test mocks and local variable names may need renaming to avoid lint/readability failures even when runtime behavior is unaffected.
- Dynamic imports in tests and comments can break after file renames if not updated.
- A2A package imports core `GeminiClient`; it must migrate with core export changes.
- `setServerGeminiMdFilename` in `interactiveContext.ts` is a local import alias for the already-renamed `setLlxprtMdFilename` — not a rename target.
- `geminiStreamLogger` in `packages/cli/src/ui/hooks/geminiStream/toolCompletionHandler.ts` is a module-scoped logger name that stays as-is.
- Provider test file `OpenAIStreamProcessor.stopReason.test.ts` imports `GeminiChat` from the core subpath export (`@vybestack/llxprt-code-core/core/geminiChat.js`) and contains literal Gemini model name strings (`gemini-1.5-pro`, `gemini-embedding`). The import and type/function references must be updated; the model name strings must not.

## Error Scenarios

- TypeScript compile fails if any old import path remains.
- Runtime CLI startup fails if `packages/cli/index.ts` still imports `./src/gemini.js`.
- Tests fail if renamed test files still import old paths.
- Hidden old aliases make the code compile but violate issue intent and must fail verification.
- The `geminiChatTypes.js` → `chatSessionTypes.js` import path change must be propagated to all 9+ core consumers or TypeScript compilation will fail.
- The `gemini.js` → `cli.js` import path change must propagate to 5+ CLI consumers (index.ts, skills.tsx, and 3 test files) or CLI startup and tests will break.

## Integration Touch Points

Detailed current-match inventory lives in `analysis/rename-surface.md` (175 files, verified current by P0.5 diff — empty diff against fresh scan). The implementation surface includes:

### Core (83 files)

- Core package metadata in `packages/core/package.json`: current subpath export `./core/geminiChat.js` at line 27 must be replaced with `./core/chatSession.js`.
- Core barrel exports in `packages/core/src/index.ts`:
  - Line 80: `export * from './core/geminiChat.js'` must become `export * from './core/chatSession.js'`.
  - Line 77: `export * from './core/client.js'` exports `GeminiClient` — class rename happens in-file, export path stays.
  - Line 85: `export * from './core/geminiRequest.js'` — out of scope, must NOT be changed.
- `packages/core/src/core/geminiChatTypes.ts` and its 9 importers must all switch to `chatSessionTypes.js` paths.
- Core chat/session files under `packages/core/src/core/`, including 14+ chat session test files.
- Core config construction/accessors under `packages/core/src/config/config.ts` and `configBaseCore.ts`.
- Core agents, utilities, tools, telemetry/config tests, test utilities, and package-level regression tests listed in `analysis/current-rename-matches.txt`.

### CLI (85 files)

- CLI entry: `packages/cli/index.ts` line 11 imports `./src/gemini.js`, `packages/cli/src/gemini.tsx`, and 4 test files.
- CLI runtime, hooks, commands: 20 command files, 16+ hook files, 10+ AppContainer hook files, test utilities.
- `packages/cli/src/ui/hooks/geminiStream/**` — directory name stays, but `GeminiClient`/`geminiClient`/`getGeminiClient` references inside must be renamed (notably `useGeminiStreamOrchestration.ts`, `toolCompletionHandler.ts`, `useSubmitQuery.ts`, `__tests__/toolCompletionHandler.test.ts`).
- `packages/cli/src/config/interactiveContext.ts` — `setServerGeminiMdFilename` local alias stays as-is.

### A2A (6 files)

- `packages/a2a-server/src/agent/task.ts`: imports `GeminiClient`, declares `geminiClient: GeminiClient` field, constructs `new GeminiClient(...)`, and uses `ServerGeminiStreamEvent`.
- `packages/a2a-server/src/agent/executor.ts`: imports `GeminiEventType` (out of scope) and `ServerGeminiStreamEvent` (out of scope).
- `packages/a2a-server/src/agent/task-support.ts`: uses `GeminiEventType` and `ServerGeminiStreamEvent` (both out of scope).
- `packages/a2a-server/src/agent/task.test.ts`, `http/app.test.ts`, `http/endpoints.test.ts`, `utils/testing_utils.ts`: mock and test references to `GeminiClient`.

### Providers tests (1 file)

- `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts`:
  - Imports `GeminiChat` from `@vybestack/llxprt-code-core/core/geminiChat.js` (IN SCOPE — must rename to `ChatSession` and update import path).
  - Uses `createGeminiChat()` function and `geminiChat` local variable (IN SCOPE — must rename).
  - Contains `gemini-1.5-pro` and `gemini-embedding` as actual model name strings (OUT OF SCOPE — must not rename).

### Excluded artifacts

- `packages/cli/junit-cli-integration.xml` — generated test output.
- `packages/core/src/hooks/__tests__/test-run.log` — generated log output.
- `dist/`, `coverage/`, `node_modules/`, `*.log`, `*.xml` — excluded from scans per P0.5 exclusion patterns.

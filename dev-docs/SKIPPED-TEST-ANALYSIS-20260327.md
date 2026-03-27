# Skipped Test Analysis — 2026-03-27

## Executive Summary

**172 skipped tests** across **59 files** (vs. 28 skips in upstream gemini-cli).

| Category            | Tests | Action                                                        |
| ------------------- | ----: | ------------------------------------------------------------- |
| DELETE-OBSOLETE     |   ~30 | Remove — functionality removed or superseded                  |
| DELETE-MOCK-THEATER |   ~22 | Remove — violate RULES.md (test implementation, not behavior) |
| DELETE-UNFINISHED   |   ~28 | Remove — speculative tests for never-implemented features     |
| FIX-AND-ENABLE      |   ~48 | Fix and unskip — validate real behavior                       |
| KEEP-SKIPPED        |   ~44 | Leave — legitimately platform/credential-gated                |

**~80 tests should be deleted. ~48 should be fixed and enabled. ~44 are legitimately skipped.**

---

## "Old Google Imports" Question

There are **no categorically-skipped test files due to old Google imports from cherry-picking**. The `@google/genai` imports throughout the test suite are our _current_ active dependency — they're the Gemini SDK we actually use. Files like `client.test.ts`, `turn.test.ts`, `coreToolScheduler.test.ts` all import from `@google/genai` and their non-skipped tests **pass fine**.

What you may be remembering is the `google-auth-library` imports (used in `mcp/google-auth-provider.test.ts`, `code_assist/oauth2.test.ts`, etc.) — but those are also current dependencies that work.

The skips are NOT import-related. They're overwhelmingly: (a) LLM-written aspirational tests for features never finished, (b) mock theater that tests internals, or (c) tests for removed functionality.

---

## Group 1: OpenAI Responses API & Providers (24 skipped)

| File                                             | Skipped | Classification                            | Notes                                                                                              |
| ------------------------------------------------ | ------: | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `parseResponsesStream.test.ts`                   |       5 | **FIX-AND-ENABLE**                        | Valid parser behavior. Fixtures use stale Chat Completions format; need Responses API event format |
| `OpenAIProvider.callResponses.stateless.test.ts` |       3 | 2× DELETE-MOCK-THEATER, 1× FIX-AND-ENABLE | Suite-wide skip blocks good tests; 2 tests assert fetch body internals                             |
| `ResponsesContextTrim.integration.test.ts`       | 1 suite | **DELETE-MOCK-THEATER**                   | Asserts fetch call count/order/cache internals, not behavior                                       |
| `OpenAIProvider.responsesIntegration.test.ts`    | 1 suite | **DELETE-UNFINISHED**                     | File says "depends on responses API implementation which is not complete"                          |
| `OpenAIProvider.stateful.integration.test.ts`    |       1 | **DELETE-UNFINISHED**                     | References missing ConversationContext, has "TODO: Revert before finishing"                        |
| `OpenAIProvider.integration.test.ts`             |       1 | **KEEP-SKIPPED**                          | Real API test, needs live credentials                                                              |
| `multi-provider.integration.test.ts`             |      11 | **KEEP-SKIPPED**                          | All gated by API key availability — legitimate CI skip                                             |
| `BaseProvider.guard.stub.test.ts`                |       1 | **DELETE-UNFINISHED**                     | Empty placeholder with "pending coverage" comment                                                  |

---

## Group 2: Core System (35+ skipped across 12 files)

| File                                              |           Skipped | Classification                                                                                                                                                           | Notes                                                                                                                                      |
| ------------------------------------------------- | ----------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `client.test.ts`                                  |                 8 | 2× DELETE-MOCK-THEATER (MAX_TURNS/nextSpeaker), 4× DELETE-UNFINISHED (Model Routing, updateModel, listAvailableModels, AfterAgent hook), 2× DELETE-OBSOLETE (JIT memory) | `nextSpeaker` and `ModelRouterService` don't exist in client.ts                                                                            |
| `coreToolScheduler.test.ts`                       |                 3 | **DELETE-MOCK-THEATER**                                                                                                                                                  | Tests expect sequential queueing; implementation does parallel. Mock call count assertions                                                 |
| `prompts-async.test.ts`                           |                 2 | **FIX-AND-ENABLE**                                                                                                                                                       | Flash model instructions and folder structure truncation — real behavior, needs settings mock fix                                          |
| `AgentRuntimeState.stub.test.ts`                  |                10 | **DELETE-OBSOLETE**                                                                                                                                                      | Phase 03 stub verification; Phase 05 implemented real functionality. Comments confirm "SKIPPED: Phase 05 implemented actual functionality" |
| `DebugLogger.test.ts`                             |                 1 | **DELETE-MOCK-THEATER**                                                                                                                                                  | Microbenchmark timing assertion (<0.1ms), not behavioral                                                                                   |
| `orphaned-tools-comprehensive.test.ts`            |                 3 | **DELETE-OBSOLETE**                                                                                                                                                      | Self-labeled "OBSOLETE — atomic implementation prevents orphans"                                                                           |
| `loopDetectionService.test.ts`                    |                 2 | **FIX-AND-ENABLE**                                                                                                                                                       | Real user-reported loop patterns; detection algorithm needs tuning                                                                         |
| `shellExecutionService.windows.test.ts`           |                 2 | 1× KEEP-SKIPPED (platform), 1× DELETE-MOCK-THEATER (encoding plumbing internals)                                                                                         |
| `shellExecutionService.windows.multibyte.test.ts` |                 1 | **KEEP-SKIPPED**                                                                                                                                                         | Platform-conditional                                                                                                                       |
| `retry.test.ts`                                   | 1 suite (4 tests) | **DELETE-OBSOLETE**                                                                                                                                                      | Flash model fallback removed — llxprt uses multi-provider design                                                                           |
| `tool-registry.test.ts`                           |                 1 | **DELETE-OBSOLETE**                                                                                                                                                      | MCP discovery decoupled from ToolRegistry in refactor                                                                                      |
| `shell.test.ts`                                   |                 1 | **KEEP-SKIPPED**                                                                                                                                                         | Platform-conditional (Windows)                                                                                                             |

---

## Group 3: Hooks, CLI & UI (42 skipped across 12 files)

| File                                   | Skipped | Classification                            | Notes                                                                         |
| -------------------------------------- | ------: | ----------------------------------------- | ----------------------------------------------------------------------------- |
| `hooks-caller-integration.test.ts`     |       9 | **DELETE-UNFINISHED**                     | All predicated on unimplemented typed-return architecture ("P20" plan)        |
| `notification-hook.test.ts`            |       4 | **FIX-AND-ENABLE**                        | Real notification behavior; needs temp file isolation and async fixes         |
| `useGeminiStream.integration.test.tsx` |       7 | **DELETE-UNFINISHED**                     | File says "NotYetImplemented stub"; todo continuation feature never completed |
| `useToolScheduler.test.ts`             |       4 | 2× FIX-AND-ENABLE, 2× DELETE-MOCK-THEATER | Timer/callback choreography tests vs. real tool behavior                      |
| `App.test.tsx`                         |       2 | **FIX-AND-ENABLE**                        | Brittle setup; needs provider/mock stabilization                              |
| `DiffRenderer.test.tsx`                |       1 | **DELETE-MOCK-THEATER**                   | Oversized parameterized snapshot matrix                                       |
| `nonInteractiveCli.test.ts`            |       2 | **FIX-AND-ENABLE**                        | Stream handling behavior; needs deterministic generators                      |
| `McpPromptLoader.test.ts`              | 1 suite | **DELETE-OBSOLETE**                       | Completion support removed, comment confirms                                  |
| `FileCommandLoader.test.ts`            |       2 | **KEEP-SKIPPED**                          | Windows symlink permission gating                                             |
| `performance.test.ts`                  | 1 suite | **DELETE-UNFINISHED**                     | Mock perf scaffold with non-falsifiable thresholds                            |
| `prompt-installer.test.ts`             |       6 | **KEEP-SKIPPED**                          | OS-conditional file permission tests                                          |
| `prompt-loader.test.ts`                |       2 | **KEEP-SKIPPED**                          | OS-conditional permission tests                                               |

---

## Group 4: Integration Tests, Auth & Config (71 skipped across 27 files)

| File                               | Skipped | Classification                                             | Notes                                                  |
| ---------------------------------- | ------: | ---------------------------------------------------------- | ------------------------------------------------------ |
| `run_shell_command.test.ts`        |       6 | 4× FIX-AND-ENABLE, 1× KEEP-SKIPPED, 1× DELETE-MOCK-THEATER |
| `ide-client.test.ts`               |       4 | 3× FIX-AND-ENABLE, 1× DELETE-UNFINISHED                    |
| `replace.test.ts`                  |       3 | **FIX-AND-ENABLE**                                         | Literal $, multiline insert, block delete — high value |
| `stdin-context.test.ts`            |       2 | 1× FIX-AND-ENABLE, 1× KEEP-SKIPPED (Windows)               |
| `read_many_files.test.ts`          |       1 | **FIX-AND-ENABLE**                                         |
| `file-system.test.ts`              |       1 | **FIX-AND-ENABLE**                                         |
| `token-tracking.test.ts`           |       1 | **FIX-AND-ENABLE**                                         |
| `google_web_search.test.ts`        |       1 | **KEEP-SKIPPED**                                           | Network/API dependent                                  |
| `ctrl-c-exit.test.ts`              |       1 | **KEEP-SKIPPED**                                           | Signal handling env-dependent                          |
| `todo-reminder.e2e.test.ts`        |       1 | **FIX-AND-ENABLE**                                         |
| `simple-mcp-server.test.ts`        |       1 | **FIX-AND-ENABLE**                                         |
| `mcp_server_cyclic_schema.test.ts` |       1 | **FIX-AND-ENABLE**                                         |
| `shell-service.test.ts`            |       5 | 2× FIX-AND-ENABLE, 3× DELETE-MOCK-THEATER                  |
| `config.test.ts`                   |       1 | **FIX-AND-ENABLE**                                         |
| `settings.test.ts`                 |       3 | 2× FIX-AND-ENABLE, 1× DELETE-UNFINISHED                    |
| `settings.env.test.ts`             |       3 | 2× FIX-AND-ENABLE, 1× KEEP-SKIPPED                         |
| `cli-args.integration.test.ts`     |       1 | **FIX-AND-ENABLE**                                         |
| `security.integration.test.ts`     |       4 | 2× FIX-AND-ENABLE, 2× DELETE-MOCK-THEATER                  |
| `test-utils.test.ts`               |       2 | **DELETE-MOCK-THEATER**                                    | Tests test-helper internals                            |
| `platform-matrix.test.ts`          |      11 | 8× KEEP-SKIPPED, 3× DELETE-UNFINISHED                      |
| `platform-uds-probe.test.ts`       |       8 | 6× KEEP-SKIPPED, 2× FIX-AND-ENABLE                         |
| `authCommand-logout.test.ts`       |       4 | 2× FIX-AND-ENABLE, 2× DELETE-MOCK-THEATER                  |
| `auth-e2e.integration.test.ts`     |       1 | **KEEP-SKIPPED**                                           | Credential-dependent                                   |
| `workspaceContext.test.ts`         |       2 | 1× FIX-AND-ENABLE, 1× DELETE-MOCK-THEATER                  |
| `paths.test.ts`                    |       2 | **FIX-AND-ENABLE**                                         |
| `shell-utils.test.ts`              |       1 | **FIX-AND-ENABLE**                                         |
| `extension-multi-folder.test.ts`   |       1 | **KEEP-SKIPPED**                                           | Needs VS Code host                                     |

---

## How Did We Get Here?

The 144 extra skips (vs. upstream's 28) accumulated through several patterns:

1. **LLM-driven TDD aspirational tests** — An LLM would write tests for a feature plan, skip them as "will pass once implemented," then the feature was never completed (hooks-caller-integration, useGeminiStream todo continuation, Model Routing, updateModel, listAvailableModels, AfterAgent hook, BaseProvider guard, performance logging)

2. **Post-refactor debris** — Features were refactored/removed but skipped tests were left behind rather than deleted (AgentRuntimeState stubs superseded by real impl, orphaned-tools tests superseded by atomic impl, Flash fallback removed, MCP discovery decoupled, JIT memory redesigned)

3. **Mock theater** — Tests that verify internal plumbing (`expect(mock).toHaveBeenCalledWith(...)`) rather than behavior, which then break on any refactor and get skipped rather than fixed (coreToolScheduler queueing, ResponsesContextTrim, security/shell internals)

4. **Cherry-pick/sync casualties** — Some integration tests broke during upstream syncs and were skipped with "deflake" notes rather than properly fixed

5. **Legitimate platform skips** — Windows-specific, credential-gated, and VS Code extension tests (these are fine)

---

## Recommended Priority Order

### Phase 1: Delete Dead Weight (~80 tests)

Delete all DELETE-OBSOLETE, DELETE-MOCK-THEATER, and DELETE-UNFINISHED tests. Pure removal, no risk. Reduces noise and false sense of "coverage."

### Phase 2: Fix High-Value Integration Tests (~20 tests)

- `replace.test.ts` (3) — core tool behavior
- `run_shell_command.test.ts` (4) — allowlist policy
- `parseResponsesStream.test.ts` (5) — our Responses API parser
- `loopDetectionService.test.ts` (2) — user-reported bugs
- `prompts-async.test.ts` (2) — prompt generation

### Phase 3: Fix Remaining Behavioral Tests (~28 tests)

- notification-hook, nonInteractiveCli, App, config/settings, auth, stdin-context, MCP tests, etc.

# Requirements — Configurable Compression Strategies

EARS (Easy Approach to Requirements Syntax) format.
Covers issues #169, #170, #171, #173.

---

## REQ-CS-001: Strategy Pattern Architecture

### REQ-CS-001.1: Strategy Interface
The system shall define a `CompressionStrategy` interface with a `name` property, a `requiresLLM` property, and a `compress(context)` method that accepts a `CompressionContext` and returns a `CompressionResult`.

### REQ-CS-001.2: Strategy Factory
The system shall provide a strategy factory that maps strategy names to `CompressionStrategy` instances.

### REQ-CS-001.3: Unknown Strategy
If a strategy name is requested that does not exist in the factory, then the system shall throw an error identifying the unknown strategy name.

### REQ-CS-001.4: Compression Result Metadata
The system shall include metadata in every `CompressionResult` containing: original message count, compressed message count, strategy used, whether an LLM call was made, and (where applicable) counts of top-preserved, bottom-preserved, and middle-compressed messages.

---

## REQ-CS-002: Middle-Out Strategy (Extraction of Existing Behavior)

### REQ-CS-002.1: Behavioral Equivalence
The `MiddleOutStrategy` shall produce the same compression output as the current inline implementation in `geminiChat.ts` for identical inputs and configuration.

### REQ-CS-002.2: Sandwich Split
The `MiddleOutStrategy` shall split curated history into three sections: top-preserved (first N%), middle-to-compress, and bottom-preserved (last N%), where N% is driven by the existing `preserveThreshold` and `topPreserveThreshold` settings.

### REQ-CS-002.3: Tool-Call Boundary Respect
The `MiddleOutStrategy` shall adjust split points using shared boundary utilities so that no tool call is separated from its corresponding tool response.

### REQ-CS-002.4: LLM Compression Call
The `MiddleOutStrategy` shall send the middle section to an LLM with the compression prompt and return the structured summary.

### REQ-CS-002.5: Compression Profile
Where a `compression.profile` setting is configured, the `MiddleOutStrategy` shall resolve and use that profile's provider and model for the compression LLM call instead of the active foreground model.

### REQ-CS-002.6: Default Compression Model
Where no `compression.profile` setting is configured, the `MiddleOutStrategy` shall use the active foreground model for the compression LLM call.

### REQ-CS-002.7: Result Assembly
The `MiddleOutStrategy` shall assemble its result as: `[...toKeepTop, summaryAsHumanMessage, ackAsAiMessage, ...toKeepBottom]`.

### REQ-CS-002.8: Minimum Compressible Messages
If the middle section contains fewer than 4 messages after boundary adjustment, then the `MiddleOutStrategy` shall return the original history unmodified.

### REQ-CS-002.9: Code Removal
When the `MiddleOutStrategy` is extracted, the following shall be removed from `geminiChat.ts`: `getCompressionSplit()`, `directCompressionCall()`, `applyCompression()`, `adjustForToolCallBoundary()`, `findForwardValidSplitPoint()`, `findBackwardValidSplitPoint()`, and the `getCompressionPrompt` import.

---

## REQ-CS-003: Top-Down Truncation Strategy

### REQ-CS-003.1: LLM-Free Operation
The `TopDownTruncationStrategy` shall not make any LLM calls. Its `requiresLLM` property shall be `false`.

### REQ-CS-003.2: Oldest-First Removal
The `TopDownTruncationStrategy` shall remove messages from the beginning of the history until the estimated token count is below the compression target.

### REQ-CS-003.3: Tool-Call Boundary Respect
The `TopDownTruncationStrategy` shall use shared boundary utilities to ensure truncation does not separate a tool call from its corresponding tool response.

### REQ-CS-003.4: Result Assembly
The `TopDownTruncationStrategy` shall return only the surviving messages as its `newHistory`, with no synthetic summary or acknowledgment messages.

---

## REQ-CS-004: Shared Utilities

### REQ-CS-004.1: Boundary Adjustment
The system shall provide a shared `adjustForToolCallBoundary(history, index)` function that finds a valid split point that does not break tool call/response pairs.

### REQ-CS-004.2: Forward Search
The shared utilities shall provide `findForwardValidSplitPoint(history, index)` that scans forward from an index to find a position where no tool response is orphaned.

### REQ-CS-004.3: Backward Search
The shared utilities shall provide `findBackwardValidSplitPoint(history, startIndex)` that scans backward to find a valid split position.

### REQ-CS-004.4: Behavioral Equivalence
The shared utility functions shall produce the same results as the current implementations in `geminiChat.ts` for identical inputs.

---

## REQ-CS-005: Compression Prompt Loading

### REQ-CS-005.1: Prompt File
The `MiddleOutStrategy` shall load its compression prompt from a markdown file (`compression/middle-out.md`) via the existing `PromptResolver`.

### REQ-CS-005.2: Resolution Hierarchy
When the `MiddleOutStrategy` resolves its prompt, the `PromptResolver` shall search in order: model-specific override (`providers/{provider}/models/{model}/compression/middle-out.md`), provider-specific override (`providers/{provider}/compression/middle-out.md`), base (`compression/middle-out.md`), returning the first match.

### REQ-CS-005.3: Built-In Default
The system shall include the current `getCompressionPrompt()` content as a built-in default in `ALL_DEFAULTS` so the `PromptInstaller` ships `compression/middle-out.md` on first run.

### REQ-CS-005.4: Prompt Content Equivalence
The shipped `compression/middle-out.md` default shall contain the same prompt text as the current `getCompressionPrompt()` function in `prompts.ts`.

### REQ-CS-005.5: Deprecation
When the prompt is loaded via `PromptResolver`, the `getCompressionPrompt()` function in `prompts.ts` shall no longer be called by any production code.

---

## REQ-CS-006: Dispatcher in `geminiChat.ts`

### REQ-CS-006.1: Strategy Delegation
When compression is triggered, `performCompression()` shall read the `compression.strategy` setting, obtain the corresponding strategy from the factory, and delegate to `strategy.compress()`.

### REQ-CS-006.2: Result Application
After a strategy returns a `CompressionResult`, `performCompression()` shall clear the history service and add each entry from `newHistory` to the history service. The strategy itself shall not interact with the history service's locking or add/clear methods.

### REQ-CS-006.3: Fail Fast
If the strategy's `compress()` method throws, then `performCompression()` shall propagate the error. The system shall not silently fall back to a different strategy.

---

## REQ-CS-007: Settings — Ephemeral (`/set`)

### REQ-CS-007.1: Strategy Setting
The system shall accept `/set compression.strategy <value>` where value is one of the registered strategy names.

### REQ-CS-007.2: Profile Setting
The system shall accept `/set compression.profile <value>` where value is a profile name.

### REQ-CS-007.3: Unset
The system shall accept `/set unset compression.strategy` and `/set unset compression.profile` to clear the ephemeral override and revert to the persistent setting.

### REQ-CS-007.4: Strategy Autocomplete
When the user types `/set compression.strategy `, the system shall offer autocomplete suggestions for all registered strategy names (`middle-out`, `top-down-truncation`).

### REQ-CS-007.5: Profile Autocomplete
When the user types `/set compression.profile `, the system shall offer autocomplete suggestions populated from the list of saved profiles.

### REQ-CS-007.6: Profile Persistence
Both `compression.strategy` and `compression.profile` shall have `persistToProfile: true` so they are saved when the user runs `/profile save`.

---

## REQ-CS-008: Settings — Persistent (`/settings` Dialog)

### REQ-CS-008.1: Strategy in Dialog
The `/settings` dialog shall display a compression strategy option under Chat Compression with a dropdown offering the registered strategy names.

### REQ-CS-008.2: Profile in Dialog
The `/settings` dialog shall display a compression profile option under Chat Compression as a text field.

### REQ-CS-008.3: Default Value
The settings schema shall define `'middle-out'` as the default value for `compression.strategy`. This is the single source of truth for the default.

---

## REQ-CS-009: Settings Resolution

### REQ-CS-009.1: Ephemeral Priority
While an ephemeral `compression.strategy` value is set (via `/set` or profile load), the system shall use that value for compression, ignoring the persistent setting.

### REQ-CS-009.2: Persistent Fallback
While no ephemeral `compression.strategy` value is set, the system shall use the persistent value from `/settings`.

### REQ-CS-009.3: No Scattered Defaults
The runtime resolution code (e.g., `createAgentRuntimeContext.ts`) shall not contain hardcoded fallback values for `compression.strategy` or `compression.profile`. The default is defined once in the settings schema.

### REQ-CS-009.4: Settings Failure
If the settings system fails to provide a `compression.strategy` value (both ephemeral and persistent are undefined), then the system shall fail with an error rather than silently using a hardcoded default.

---

## REQ-CS-010: Type Definitions

### REQ-CS-010.1: EphemeralSettings
The `EphemeralSettings` interface shall include `'compression.strategy'` typed as the union of registered strategy names and `'compression.profile'` typed as `string`.

### REQ-CS-010.2: ChatCompressionSettings
The `ChatCompressionSettings` interface shall include `strategy` typed as the union of registered strategy names and `profile` typed as `string`, in addition to the existing `contextPercentageThreshold`.

---

## REQ-CS-011: Settings Registry

### REQ-CS-011.1: Strategy Spec
The `SETTINGS_REGISTRY` shall include a spec for `compression.strategy` with type `enum`, the registered strategy names as `enumValues`, default `'middle-out'`, category `'cli-behavior'`, and `persistToProfile: true`.

### REQ-CS-011.2: Profile Spec
The `SETTINGS_REGISTRY` shall include a spec for `compression.profile` with type `string`, category `'cli-behavior'`, and `persistToProfile: true`.

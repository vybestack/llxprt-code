# Configurable Compression Strategies

## Issues Addressed

| Issue | Title | Summary |
|-------|-------|---------|
| #169 | Summarization control | Umbrella: enable different models and strategies for context compression |
| #170 | Enable switching summarization model | Allow specifying a different model/profile for compression instead of always using the active model |
| #171 | Enable summarization strategies | Allow selecting different compression strategies; the current single approach can leave models confused |
| #173 | Create a middle-out summarization strategy | Preserve top and bottom of history literally, compress the middle — this is actually the current default behavior already |

## Current State

### What Exists Today

The compression system lives inline in `geminiChat.ts` with no extensibility seam:

- **`getCompressionSplit()`** — Already implements "sandwich" (middle-out) compression: preserves top ~20% and bottom ~20% of messages literally, compresses the middle ~60%.
- **`directCompressionCall()`** — Sends the middle section to the active provider/model with an XML `<state_snapshot>` prompt asking for structured summarization.
- **`applyCompression()`** — Clears history and rebuilds it as `[...toKeepTop, summaryMessage, ackMessage, ...toKeepBottom]`.
- **`adjustForToolCallBoundary()`** / `findForwardValidSplitPoint()` / `findBackwardValidSplitPoint()` — Shared logic to avoid splitting tool call/response pairs.
- **`getCompressionPrompt()`** — Hardcoded in `prompts.ts`, returns an XML template prompt.

### What's NOT Configurable Today

1. **Strategy** — Only one strategy exists (middle-out with XML state_snapshot). No way to select alternatives.
2. **Model/profile for compression** — `directCompressionCall()` always uses `this.runtimeState.model` (the current active model). No way to say "use a cheap/fast model for compression."
3. **The compression prompt** — Hardcoded in `prompts.ts` via `getCompressionPrompt()`. Not overridable per provider or model.

### What IS Configurable Today

- `compression-threshold` — ephemeral setting controlling when compression triggers (fraction of context limit, 0-1).
- `compression-preserve-threshold` / `topPreserveThreshold` — how much of the bottom/top to preserve (percentages).
- These thresholds are accessible via `runtimeContext.ephemerals`.

## Design

### Strategy Pattern Architecture

Extract compression into a pluggable strategy system. Each strategy owns its full pipeline: split → compress → reassemble.

```
packages/core/src/core/compression/
├── types.ts                        # CompressionStrategy interface, CompressionContext, CompressionResult
├── utils.ts                        # Shared tool-call boundary logic
├── MiddleOutStrategy.ts            # Extracts current sandwich logic from geminiChat.ts
├── TopDownTruncationStrategy.ts    # New LLM-free truncation strategy
├── compressionStrategyFactory.ts   # Map<string, () => CompressionStrategy> registry
└── index.ts                        # Barrel exports
```

### Strategy Names — Single Source of Truth

Strategy names are defined once as a const tuple and everything derives from it:

```typescript
export const COMPRESSION_STRATEGIES = ['middle-out', 'top-down-truncation'] as const;
export type CompressionStrategyName = (typeof COMPRESSION_STRATEGIES)[number];
```

Settings registry `enumValues`, type unions in `EphemeralSettings` and `ChatCompressionSettings`, and factory validation all derive from this constant. No duplicated string lists.

### Strategy Interface

```typescript
export interface CompressionStrategy {
  readonly name: CompressionStrategyName;
  readonly requiresLLM: boolean;

  compress(context: CompressionContext): Promise<CompressionResult>;
}

export interface CompressionContext {
  readonly history: readonly IContent[];
  readonly runtimeContext: AgentRuntimeContext;
  readonly runtimeState: AgentRuntimeState;
  readonly estimateTokens: (contents: readonly IContent[]) => Promise<number>;
  readonly currentTokenCount: number;
  readonly logger: Logger;
  readonly resolveProvider: (profileName?: string) => IProvider;
  readonly promptResolver: PromptResolver;
  readonly promptContext: Readonly<Partial<PromptContext>>;
  readonly promptId: string;
}

export interface CompressionResult {
  newHistory: IContent[];
  metadata: {
    originalMessageCount: number;
    compressedMessageCount: number;
    strategyUsed: string;
    llmCallMade: boolean;
    topPreserved?: number;
    bottomPreserved?: number;
    middleCompressed?: number;
  };
}
```

Note: `historyService` is intentionally **not** in `CompressionContext`. Strategies receive immutable inputs and return a result. The dispatcher in `geminiChat.ts` owns history service locking, clearing, and rebuilding. This enforces separation — strategies cannot accidentally mutate history state.

### Strategy 1: Middle-Out (current behavior, extracted)

- Sandwich: keep top N%, compress middle via LLM, keep bottom N%.
- LLM compression produces XML `<state_snapshot>` with structured sections.
- Loads its prompt via the existing `PromptResolver` hierarchy (see Prompt Loading below).
- `requiresLLM: true` — uses `compression.profile` if set, otherwise the active model.

### Strategy 2: Top-Down Truncation (new)

- **No LLM call** — pure mechanical truncation. That's the point.
- Drops oldest messages until token count is under the compression target.
- Respects tool-call boundaries via shared utility (won't orphan a tool response from its call).
- Must preserve a minimum number of messages (at least 2 — one human, one AI) to avoid producing an empty or degenerate history.
- `requiresLLM: false`.

### Shared Utilities (`utils.ts`)

Extracted from `geminiChat.ts`:

- `adjustForToolCallBoundary(history, index)` — finds a valid split point that doesn't break tool call/response pairs.
- `findForwardValidSplitPoint(history, index)` — searches forward for a clean boundary.
- `findBackwardValidSplitPoint(history, startIndex)` — searches backward for a clean boundary.

Both strategies use these. The boundary logic is not strategy-specific — it's a constraint of the message format that all models expect.

### Refactoring: Extract Middle-Out from `geminiChat.ts`

This is a refactor of existing behavior, not a rewrite. The following methods are **extracted** from `geminiChat.ts` and relocated:

**Moved to `MiddleOutStrategy.ts`:**
- `getCompressionSplit()` — the sandwich split logic (top/middle/bottom)
- `directCompressionCall()` — the LLM call that produces the XML state_snapshot
- `applyCompression()` — the history rebuild (toKeepTop + summary + ack + toKeepBottom)
- The compression prompt (currently imported from `prompts.ts` via `getCompressionPrompt()`) — moves to a `.md` file loaded via PromptResolver

**Moved to `compression/utils.ts`:**
- `adjustForToolCallBoundary()`
- `findForwardValidSplitPoint()`
- `findBackwardValidSplitPoint()`

**What remains in `geminiChat.ts`:**

`performCompression()` becomes a thin dispatcher:

1. Read strategy name from settings (ephemeral → persistent, no hardcoded fallback — see Configuration below).
2. Look up strategy via factory.
3. Call `strategy.compress(context)`.
4. Apply result: `historyService.clear()` + `historyService.add()` for each entry in `newHistory`.

All extracted logic is removed from `geminiChat.ts`. The `getCompressionPrompt` import from `prompts.ts` is also removed.

### Prompt Loading

The compression prompt for middle-out currently lives hardcoded in `prompts.ts` as `getCompressionPrompt()`. It moves to a markdown file loaded through the **existing `PromptResolver`** hierarchy:

**Resolution chain (most specific wins):**
```
~/.llxprt/prompts/providers/{provider}/models/{model}/compression/middle-out.md
~/.llxprt/prompts/providers/{provider}/compression/middle-out.md
~/.llxprt/prompts/compression/middle-out.md    ← user override
(built-in default via ALL_DEFAULTS)            ← ships with install
```

This reuses the same `PromptResolver.resolveFile()` that already handles `core.md`, `env/*.md`, and `tools/*.md`. No new resolution infrastructure needed.

The built-in default content (the current `getCompressionPrompt()` XML template) gets added to `ALL_DEFAULTS` in `prompt-config/defaults/` so the `PromptInstaller` ships it to `~/.llxprt/prompts/compression/middle-out.md` on first run.

The `MiddleOutStrategy` receives the `PromptService` (or `PromptResolver` directly) via `CompressionContext` and calls `resolveFile('compression/middle-out.md', { provider, model })` to load its prompt. Users can override per-provider or per-model by dropping a file in the right directory.

### Configuration & Settings

#### Two-Tier Resolution (No Scattered Hardcoded Defaults)

```
1. Ephemeral (/set or profile-loaded)     → highest priority, per-session
2. Persistent (/settings dialog)          → user's global default
```

The default value (`'middle-out'`) is defined **once** in the settings schema as the setting's default. It is not repeated as a fallback anywhere in runtime code. If the settings system fails to provide a value, that is a bug and should fail fast — not silently degrade to some hardcoded string buried in a runtime accessor. This avoids the anti-pattern of scattering `?? 'middle-out'` throughout the codebase where it becomes impossible to trace what's actually driving behavior.

#### New Ephemeral Settings

In `EphemeralSettings` (`packages/core/src/types/modelParams.ts`):

```typescript
'compression.strategy'?: 'middle-out' | 'top-down-truncation';
'compression.profile'?: string;
```

#### Settings Registry

In `SETTINGS_REGISTRY` (`packages/core/src/settings/settingsRegistry.ts`):

- `compression.strategy` — type `enum`, values `['middle-out', 'top-down-truncation']`, default `'middle-out'`, `persistToProfile: true`.
- `compression.profile` — type `string`, hint `'profile name'`, `persistToProfile: true`. Dynamic completer lists available profiles.

#### Persistent Settings (`/settings` dialog)

Expand `ChatCompressionSettings` in `packages/core/src/config/config.ts`:

```typescript
export interface ChatCompressionSettings {
  contextPercentageThreshold?: number;  // existing
  strategy?: 'middle-out' | 'top-down-truncation';  // new
  profile?: string;  // new
}
```

Update `settingsSchema.ts` to set `showInDialog: true` on `chatCompression` with sub-properties for strategy (dropdown) and profile (text input).

#### Runtime Resolution

In `createAgentRuntimeContext.ts`:

```typescript
compressionStrategy: (): CompressionStrategyName => {
  const value =
    options.settings['compression.strategy'] ??     // ephemeral first
    options.chatCompression?.strategy;               // persistent (has schema default)
  if (!value) {
    throw new Error(
      'compression.strategy is not configured — settings system failed to provide a value'
    );
  }
  return value;
},

compressionProfile: (): string | undefined =>
  options.settings['compression.profile'] ??         // ephemeral first
  options.chatCompression?.profile,                  // persistent
  // undefined = use active model
```

The settings schema defines `'middle-out'` as the default for `compression.strategy`. That single definition is the source of truth. Runtime code never repeats it. If both ephemeral and persistent are somehow undefined, the accessor throws immediately rather than returning undefined to be discovered later during compression.

#### `/set` Command UX

```
/set compression.strategy middle-out             # autocompletes from enum values
/set compression.strategy top-down-truncation    # autocompletes from enum values
/set compression.profile myflashprofile          # autocompletes from profile list
/set unset compression.profile                   # revert to default (use active model)
```

`compression.strategy` gets free autocomplete from `enumValues` via `getDirectSettingSpecs()`.

`compression.profile` needs a dynamic completer (profile names are runtime data). Follows the established pattern from `profileCommand.ts` using `getRuntimeApi().listSavedProfiles()`. Added as a special case in `setCommand.ts` alongside the existing `custom-headers` special case.

### Error Handling

Fail fast and hard. No silent fallback to a different strategy. Specific failure modes:

- **Strategy execution fails** (LLM error, timeout, etc.) — propagate error. User needs to know.
- **Unknown strategy name** — factory throws identifying the bad name.
- **`compression.strategy` not resolved** — runtime accessor throws at read time, not deferred to compression time.
- **Unknown `compression.profile`** — profile name doesn't exist, strategy throws with actionable error identifying the missing profile.
- **Profile exists but provider/model unavailable** — provider resolution throws, strategy propagates.
- **Prompt resolution fails** — missing file or malformed content, strategy throws.
- **Token estimation fails** — strategy propagates the error.

### What's Explicitly Out of Scope

- **Shell tool output summarization** — The Gemini-only `summarizeToolOutput` in `utils/summarizer.ts` is a separate concern (issue #169 comment discussion). Will be addressed separately.
- **Additional strategies beyond the initial two** — The factory pattern makes adding new strategies trivial, but we're only implementing `middle-out` and `top-down-truncation` to start. The goal is getting the system/seams right.
- **Automatic strategy selection** — No auto-detection of "best" strategy based on conversation type. The user picks.

### Testing Approach

- **Per-strategy unit tests** — Each strategy tested in isolation with mock inputs. Verifies split logic, result assembly, boundary respect, failure modes.
- **Shared utility tests** — Focused tests for tool-call boundary adjustment functions, extracted from any existing coverage in `geminiChat.test.ts`.
- **Factory tests** — Registry lookup, unknown strategy name → error.
- **Settings resolution** — Verify two-tier resolution (ephemeral → persistent), verify `/set` autocomplete for both settings.
- **Behavioral equivalence** — Middle-out under default shipped prompt with no overrides must produce same output as current inline implementation for identical inputs.

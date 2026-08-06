# Issue #3070 — Prompt-cache prefix stability across providers

Branch: `issue3070`

## Framing

The issue was filed with Anthropic-specific detail. It is **not** Anthropic-specific.
Every mutation that breaks the cacheable prefix lives in `packages/agents` and
`packages/core`, i.e. **above** the provider boundary, so it reaches `anthropic`,
`claudecode`, `openai`, `openai-responses`, `codex` and `gemini` identically.

Note two structural facts that shape the fix:

- There is no separate `codex` or `claudecode` provider. `codex` is an alias to
  `openai-responses` (with an `isCodex` flag); `claudecode` is an alias to `anthropic`.
- Anthropic caching is **explicit** (client-written `cache_control` breakpoints).
  OpenAI Chat, OpenAI Responses/Codex and Gemini caching is **implicit**
  (server-side longest-common-prefix match). Implicit caches still die at the first
  divergent token, so **prefix stability matters equally for all of them** — but
  implicit providers need no marking, only stable bytes.

## Verified defects

### Defect A — the compression trigger collapses to zero on small context windows

`CompressionHandler.shouldCompress` (`packages/agents/src/compression/CompressionHandler.ts:270-313`):

```
const effectiveLimit = Math.max(0, contextLimit - completionBudget);   // L283
const compressionThreshold = threshold * effectiveLimit;                // L284
const shouldCompress = currentTokens >= compressionThreshold;           // L301
```

`getCompletionBudget` (`packages/agents/src/compression/compressionBudgeting.ts:70-94`)
falls back to a fixed `DEFAULT_COMPLETION_BUDGET = 65_536` (L76) when nothing is
configured. The registry `maxOutputTokens` (`packages/core/src/models/hydration.ts:142`)
feeds `RuntimeModel`, **not** this `generationConfig`, so for an unconfigured session the
budget really is the flat 65,536.

Therefore any `context-limit <= 65_536` yields `effectiveLimit === 0`, so
`compressionThreshold === 0`, so `currentTokens >= 0` is **always true** and
**compression runs on every single send** — each one a paid LLM summarization call
(`MiddleOutStrategy.requiresLLM = true`) plus a full prefix rewrite.

Our own documentation walks users into this: `docs/local-models.md` recommends
`context-limit` values of 32768 (L72, L132, L207, L241, L312), 65536 (L343) and
16384 (L386). Every one of those is at or below the default budget.

The response is also superlinear well above the cliff, which is the mechanism behind the
reporter's "lowering context-limit costs more" claim: with a 65,536 budget, 200k → trigger
114,294 and 100k → trigger 29,294, so halving the limit cuts the trigger ~3.9x, not 2x.

**Root cause:** a fixed absolute default output reservation that can equal or exceed the
whole window, plus a `Math.max(0, ...)` clamp that converts that contradiction into silent,
expensive behaviour instead of surfacing it.

### Defect B — the preserved head is not a stable prefix

`MiddleOutStrategy.computeSplit` (`packages/agents/src/compression/MiddleOutStrategy.ts:246-247`):

```
let topSplitIndex = Math.ceil(history.length * topPreserveThreshold);
let bottomSplitIndex = Math.floor(history.length * (1 - preserveThreshold));
```

The head boundary is a **fraction of the current length**, and compression shrinks the
history. So the head is not monotonic:

- N1 = 40 → topSplit = ceil(8) = 8, bottomSplit = floor(24) = 24 → new length 8 + 2 + 16 = 26
- append 6 turns → N2 = 32 → topSplit = ceil(6.4) = **7**

The entry at index 7, which the first compression preserved, is summarized away by the
second. The head **shrank**. There is no monotonic floor anywhere in the codebase
(`grep -rn "cacheAnchor|anchorIndex|stablePrefix" packages/` → zero matches), and there is
no test anywhere asserting prefix stability.

Note the head is otherwise preserved byte-identically — `assembleHistory` keeps `toKeepTop`
by reference and `historyChronology.stamp()` preserves existing markers across the
clear/rebuild — so the *only* thing destroying it is the oscillating boundary.

## Fix

### 1. Make the default completion budget proportional; fail fast on a contradictory one

In `compressionBudgeting.ts`:

- The **default** (nothing configured) becomes
  `Math.min(DEFAULT_COMPLETION_BUDGET, Math.floor(contextLimit * DEFAULT_COMPLETION_FRACTION))`
  with `DEFAULT_COMPLETION_FRACTION = 0.5`. Never reserve more than half the window for
  output. This preserves today's behaviour for every window >= 131,072 (the common cloud
  case) and fixes small windows continuously, with no discontinuity.
- An **explicitly configured** budget (ephemeral `maxOutputTokens`, `generationConfig`,
  or provider params) that is `>= contextLimit` is a genuinely impossible configuration:
  **throw** a typed `InvalidContextBudgetError` naming both numbers and the setting to
  change. No clamp, no fallback, no try/catch.
- Delete the `Math.max(0, contextLimit - completionBudget)` clamp at
  `CompressionHandler.ts:283`.

Rationale for the split: a *user-configured* contradiction is a user error and must fail
fast. A collision with our own *unconfigured default* is **our** bug, and hard-failing every
local-model user for it would be wrong. Fixing the default is the actual fix, not a hedge.

### 2. Monotonic cache anchor (the durable, provider-agnostic root-cause fix)

The primitive already exists: `metadata.chronology.seq` is monotonic, never reused,
preserved across the compression rebuild, and never serialized to a provider.

- `HistoryService` gains `cacheAnchorSeq` with `getCacheAnchorSeq()`,
  `setCacheAnchorSeq(seq)`, and `resetCacheAnchorSeq()`. The setter validates a positive
  integer identity but accepts a numerically lower seq: compressed histories are not
  seq-sorted because synthetic summaries precede preserved tail entries. Reset sets it to 0.
- `MiddleOutStrategy.computeSplit` raises `topSplitIndex` to
  `Math.max(baseSplitIndex, anchorIndex + 1)` where `anchorIndex` is found by **exact seq
  identity match** (forward scan for the entry whose `chronology.seq === cacheAnchorSeq`),
  NOT a backward `<=` threshold scan. The array is NOT sorted by seq after a compression
  (preserved tail entries keep their original low seqs while the summary/continuation get
  the highest seqs and sit in the middle), so a `<=` scan would match a low-seq tail entry
  at a high index and wedge the strategy into a permanent structural no-op. When no entry
  matches exactly, there is no floor; fall back to the base fractional split. Do NOT sort.
- `adjustForToolCallBoundary` runs AFTER the anchor floor is applied and can move the index
  backward below the floor. After the adjustment, if `topSplitIndex < anchorFloor`, search
  FORWARD via `findValidSplitAtOrAboveFloor(history, floor)` for the next valid split point
  at or above the floor. If no valid split exists at or above the floor, return a clean
  structural no-op. Never silently drop below the floor.
- `CompressionHandler` resolves and validates the new anchor value BEFORE mutating history
  (so invalid strategy metadata cannot leave a partially applied compression). The anchor is
  derived from `newHistory[topPreserved - 1]` using the strategy-reported `topPreserved`
  length (MiddleOutStrategy reports it as `metadata.topPreserved`), NOT by searching the
  output for the compression summary (the summary-search approach pins the anchor to the
  first compression's stale summary forever, making the feature inert). After history
  mutation: if the prefix was destroyed (`topPreserved <= 0`), explicitly RESET the anchor;
  otherwise set the anchor to the resolved chronology identity.
- The anchor is read into `CompressionContext` as one new readonly field.

**Anchor advance via strategy-reported head length (NOT summary search).** The original
plan's anchor design searched the post-compression history for the compression summary and
used its index. That is wrong: from the second compression onward the previous compression's
summary sits INSIDE the preserved head and still carries `metadata.reason ===
'compression-state-snapshot'`, so the first match is the STALE summary and the anchor pins
to the same seq forever. The fix threads the strategy-reported `topPreserved` head length
through the entire callback chain (`runCompressionWithRetryAndFallback` →
`handleStructuralNoop` → `applyFallbackCompressionResult` → `performFallbackCompression`)
and derives the anchor from `newHistory[topPreserved - 1]`.

**Anchor lifecycle.** `clear()` preserves the anchor (compression rebuild). Resets are
explicit calls at:

| Call site | Semantics | Anchor |
|---|---|---|
| `CompressionHandler.ts` apply callback | compression rebuild | **survives** (or **resets** if prefix destroyed) |
| `ConversationManager.clearHistory()` | session reset | **resets to 0** |
| `ConversationManager.setHistory()` | history restore | **resets to 0** |
| `client.resetChat()` | session reset | **resets to 0** |
| `client.restoreHistory()` | wholesale history replacement | **resets to 0** |
| `providerContentEnforcement` / `pendingContextWindowEnforcement` | post-truncation rebuild | **resets to 0** |

`client.restoreHistory` does a wholesale replacement via `validateAndFix()` + `addAll()`
WITHOUT calling `clear()`, so it was missed in the original lifecycle enumeration; it now
calls `resetCacheAnchorSeq()` at the start.

**Prefix-destroying strategies.** `TopDownTruncationStrategy` front-drops the entire head
and emits no summary. When a compression result preserves no head (`topPreserved === 0` or
absent), the apply callback explicitly resets the anchor rather than leaving it pointing at
deleted content. This is an explicit, readable decision at the apply site, not a hidden
fallback.

### 3. Documentation corrections (part of the bug, not a nicety)

- `docs/local-models.md` — every recommended `context-limit` at or below the default output
  reservation, plus the rule that `context-limit` must exceed `max_tokens`.
- `docs/providers/models-and-limits.md` — state that the compression trigger is a fraction
  of `context-limit − max_tokens`, that lowering `context-limit` therefore increases spend
  superlinearly (more compressions, more cache-prefix rewrites), and that a configured
  `max_tokens >= context-limit` is now rejected.
- One sentence that `compression.strategy=high-density` mutates history continuously and is
  hostile to prompt caching.

## Tests (bun:test, behavioral, no network)

Shared test-local helpers define the operational meaning of "cacheable prefix":

```
serializeForCache(contents) = contents.map(c => JSON.stringify({ speaker, blocks }))
commonPrefixLength(a, b)    = count of equal leading entries
```

Metadata is deliberately excluded — `chronology` is never sent to a provider. This proxy is
exactly what an implicit-cache provider matches on and exactly what determines where an
Anthropic breakpoint could pay off, which is what makes these tests provider-agnostic.

The only test double is a **real** in-process async generator satisfying the `IProvider`
port that compression requires. We never assert it was called; every assertion is on
returned data. (Do not copy the `vi.mock` style in the existing Anthropic caching tests.)

**A. `packages/agents/src/compression/__tests__/compressionPrefixStability.test.ts`**

- A1 — head never shrinks across successive compressions. Uses the production
  `resolveHeadAnchorSeq(newHistory, topPreserved)` advance path (not hand-computed).
- A2 — property form: 5 cycles of append-12-then-compress; asserts CONTENT prefix stability
  via `commonPrefixLength(serializeForCache(...))` using the production advance path.
- A3 — trigger arithmetic. Exact values for 200k and 100k, and the ratio > 3.5 asserting the
  superlinear response. Explicit-budget-exceeds-limit throws. Default budget on a 32,768
  window produces a **positive** trigger (proves the every-send loop is gone).
- A4 — anchor contract: exact identity accepts a numerically lower seq, invalid seqs throw, a fresh service is 0, the
  compression rebuild preserves it, and each session-reset path resets it.
- A5 — invariants hold: anchor floor HOLDS when an UNMATCHED / interrupted tool_call sits at
  the boundary (the case that CAN fail); an anchor that would push past the bottom split
  yields a clean structural no-op with an unmodified history.
- A6 — `resolveHeadAnchorSeq(newHistory, topPreserved)` contract: returns the seq of the
  last preserved head entry by topPreserved index; returns undefined when topPreserved is 0
  (prefix destroyed) or exceeds history length; the resolved seq is accepted by
  `setCacheAnchorSeq`.

The test helper `buildContext` uses production geometry: `preserveThreshold=0.4`,
`topPreserveThreshold=0.2` (matching `createAgentRuntimeContext.ts`), not 0.2/0.2.

**E2E. `packages/agents/src/compression/__tests__/compressionAnchorE2E.test.ts`**

- E2E — drives `CompressionHandler.performCompression` (NOT MiddleOutStrategy directly)
  against a real `HistoryService` over 5 compressions with a GROWING history, asserting the
  serialized content prefix (the head, located by exact seq identity match to
  preserved boundary is monotonically non-decreasing by array position across every cycle; numeric `cacheAnchorSeq` may decrease. This is the regime
  where Defects 1-4 manifest.
- Defect 5 — after a truncation-style result that preserves no head, the anchor is reset and
  the next compression is not wedged.
- Defect 6 — `client.restoreHistory` resets the anchor (tested via the
  `resetCacheAnchorSeq` primitive + `addAll` wholesale replacement).

**Red/green. `packages/agents/src/compression/__tests__/compressionAnchorRedGreen.test.ts`**

- GREEN: with the anchor floor ENABLED (production path), the head never shrinks across 5
  cycles → `stable === true`.
- RED: with the anchor floor DISABLED (reset the anchor to 0 after each compression), the
  head shrinks → `stable === false`. This proves the anchor floor is the binding mechanism.

**B. `packages/core/src/services/history/historyPrefixStability.test.ts`** (characterization —
these pass on main and must still be committed, because their absence is why this defect
went unnoticed; label them as such)

- B1 — the per-turn provider pipeline is prefix-stable under append.
- B2 — an interrupted tool call perturbs only the tail, not the head.
- B3 — curation is an identity map on any prefix (re-curates through a fresh
`HistoryService`, not a self-comparison).

Red/green order: A3 → A4 → A1 → A2/A5 → B1-B3.

## Anthropic explicit-cache completion

Anthropic cannot automatically re-match the stable head: it only reads a cached prefix at
an explicit `cache_control` breakpoint. This PR therefore carries the anchor on
`IContent.metadata.cacheAnchor`, tags the derived Anthropic message with a module-private
`Symbol` through conversion, and spends a third breakpoint at that boundary. The existing
system and rolling-tail breakpoints remain unchanged, so a normal compressed request uses
3 of Anthropic's 4 allowed breakpoints. The anchor is skipped when it coincides with the
rolling tail. The existing native-Anthropic-endpoint gate also applies, leaving third-party
gateways unchanged.

## Explicitly deferred (file as follow-up issues)

- **D1** `HighDensityStrategy` honouring the anchor (opt-in strategy only — it does not run
  under the default `middle-out`, which is `threshold` mode not `continuous`).
- **D2** System-prompt prefix hazards: user templates using `{{CURRENT_TIME}}`, and core
  memory reloaded from disk per request. No shipped template is affected — latent, not live.
- **D3** Anthropic explicit caching is disabled outright for third-party gateways.
- **D4** OpenAI Chat Completions ignores the `prompt-caching` setting entirely.

## Explicitly NOT in scope

- Changing the `compressionThreshold` (0.85) or `topPreserveThreshold` (0.2) defaults.
  Both are knobs that mask the invariant defect; raising `topPreserveThreshold` actually
  *widens* the oscillation band and starves compression.
- Provider changes beyond the bounded Anthropic anchor breakpoint described above.
- Defensive guards, fallbacks or try/catch absorption in new code.
- Any `eslint-disable`, `@ts-expect-error`, `@ts-ignore`, or loosening of lint/complexity
  rules. If `computeSplit` nears a complexity ceiling, extract a named helper.

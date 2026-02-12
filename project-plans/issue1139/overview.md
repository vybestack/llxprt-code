# Issue #1139: Citations — Functional Specification

## Problem Statement

LLxprt Code currently emits a spammy debug log message (`Failed to determine citation settings: {}`) on every turn for most configurations. Beyond this immediate bug, the citation feature is incomplete: it emits only a generic disclaimer string ("Response may contain information from external sources…") regardless of provider, rather than surfacing the rich, structured citation data that modern LLM APIs provide.

Multiple provider APIs now offer native citation capabilities — each with a different shape and mechanism — but LLxprt consumes none of them. Users get no meaningful source-attribution experience today.

## Goals

1. **Eliminate the spammy log** — the `Failed to determine citation settings` debug message must stop appearing in normal operation.
2. **Unified citation abstraction** — design a single, provider-agnostic citation model that can represent citation data from any supported provider.
3. **Ephemeral control** — citations are controlled via `/set citations enabled` / `/set citations disabled`, defaulting to **disabled**.
4. **Structured citation data** — when a provider returns native citation metadata, surface it (sources, URLs, excerpts) rather than a generic disclaimer.
5. **Clickable terminal links** — citation URLs render as OSC 8 hyperlinks in terminals that support them.
6. **Graceful degradation** — providers and models that lack native citations fall back to either no citation or a brief generic disclaimer; no errors, no log spam.

## Non-Goals

- Implementing document-upload flows for Anthropic's document-grounding citations (requires document management UX).
- Adding web-search or file-search as built-in tools for OpenAI Responses (those are separate tool features).
- Modifying any provider's request payload to *request* citations that require additional API parameters beyond what we already send.
- Per-provider citation settings (one toggle controls all; providers that don't support it simply return no citations).
- Full Anthropic `citations_delta` streaming parsing — LLxprt does not currently send document blocks with `citations.enabled: true`, so the extraction code would never fire. The design defines the extraction interface and a no-op implementation; full parsing activates when document-block support lands.
- Inline citation markers embedded in response text (the design covers a post-response citation block, not in-text markers).
- Citation caching across multi-turn conversations.

---

## Provider Citation Support

Three providers have native citation APIs. Everything else (OpenAI Chat Completions, Kimi K2.5, Qwen 3 Coder Next, GLM 5, MiniMax M2.5) has no citation support — no extraction, no events, nothing.

| Provider | API Surface | Citation Shape | How It Works |
|---|---|---|---|
| **Google Gemini** | Gemini API (generateContent) | `groundingMetadata.groundingChunks` + `groundingSupports` | When Gemini uses Google Search grounding, the response contains `groundingMetadata` with web source chunks (title, URI) and support segments mapping text ranges to source indices. Already partially consumed by `google-web-search-invocation.ts` and `google-web-fetch.ts`. |
| **Anthropic** | Messages API | `citations` array on text content blocks — types: `char_location`, `page_location`, `content_block_location` | Developer supplies documents with `citations.enabled: true`. Response text blocks interleave with citation objects containing `cited_text`, `document_index`, and location info. Streaming includes `citations_delta` events. All active Claude models (except Haiku 3) support this. **Current scope: interface + no-op extraction + tests only** — LLxprt does not currently send document blocks to Anthropic, so full parsing is dormant until document-block support exists. |
| **OpenAI Responses** | Responses API | `annotations` array on `output_text` items — type `url_citation` with `url`, `title`, `start_index`, `end_index` | When web_search or file_search tools are enabled AND invoked by the model, the text output includes annotation objects. Streaming delivers them as part of output item deltas. OpenAI Chat Completions has no citation support — citations are Responses API only. |

---

## Functional Requirements

### FR-1: Ephemeral Citation Toggle

- Users control citations via `/set citations enabled` or `/set citations disabled`.
- Default: **disabled**.
- The existing `ui.showCitations` persistent setting continues to work as a fallback.
- Priority: ephemeral setting > persistent setting > default (false).

### FR-2: Eliminate Spammy Debug Log

- The catch block in `shouldShowCitations()` must not log on expected/benign failures.
- The function must silently return `false` if citation configuration cannot be determined.

### FR-3: Structured Citation Event

- The `ServerGeminiCitationEvent` type is enriched to carry structured source data.
- The `value` field is typed as `CitationPayload`. No union type, no string variant.
- A citation event can contain zero or more source references, each with optional: title, URL, excerpt/cited_text, location info.

### FR-4: Provider Citation Extraction

Each provider's response parsing path extracts native citation data and emits structured citation events:

- **Gemini**: Extract from `groundingMetadata.groundingChunks` and `groundingSupports` already present in tool invocation responses. Promote these to first-class citation events.
- **Anthropic**: Define the extraction interface and implement a no-op extractor with tests that validate the expected input/output contract. Full `citations_delta` streaming parsing is dormant because LLxprt does not currently send document blocks with `citations.enabled: true`. It activates when document-block support is added.
- **OpenAI Responses**: Parse `annotations` from `output_text` items. Map `url_citation` objects to the unified model. Annotations only appear when web_search or file_search tools are enabled AND invoked.
- **All other providers**: No citation support. No extraction. No events.

### FR-5: Citation Display in Terminal

- Citations appear after the assistant's text response, in a distinct visual block.
- Each source is rendered as a numbered list item with title and clickable URL (OSC 8 link).
- If the terminal does not support OSC 8, the URL is displayed as plain text.
- Excerpt text (when available from Anthropic's `cited_text`) is shown as an indented quote.

### FR-6: Citation Display Suppression

- When citations are disabled (default), citation events from providers are silently discarded at the UI layer.
- No citation block is rendered.
- No log messages are emitted about citation determination.

### FR-7: Provider Capability Declaration

- Each provider declares whether it supports citations via a `supportsCitations` flag on its capabilities.
- This is advisory/informational — used for diagnostics and future auto-enable logic.
- Does not gate citation extraction; extraction runs whenever the provider returns citation data, regardless of the flag.

### FR-8: Anti-Duplication Policy

The existing `google-web-search-invocation.ts` already injects inline citation markers (e.g., `[1][2]`) and a `Sources:` block into the tool response text returned to the LLM. The new Turn-level citation system must not duplicate these:

- **Tool-level inline markers** (injected by `GoogleWebSearchToolInvocation`): Continue to appear in the tool response text that the LLM sees. These are part of the context sent to the model and must not be stripped.
- **Turn-level structured citations** (new): Emitted as `ServerGeminiCitationEvent` with `CitationPayload`. These render as a separate citation block in the UI after the assistant's response text.
- **Deduplication rule**: When emitting Turn-level citations from Gemini `groundingMetadata`, skip any source that was already injected as an inline marker by `google-web-search-invocation.ts` in the same turn. Use URL-based matching: if a `groundingChunk.web.uri` already appears in a tool response's `sources` array for the current turn, omit it from the Turn-level citation event.
- **Rationale**: Without deduplication, users would see the same source listed both inline in the response text AND in the citation block below it.

### FR-9: Privacy and Safety Constraints

All citation data displayed to the user must respect these constraints:

- **Maximum excerpt length**: Cited text excerpts (`citedText`) are truncated to **200 characters** with an ellipsis (`…`) appended when truncated. This prevents excessively long quoted passages from dominating the terminal output.
- **URL sanitization**: Citation URLs must use `https:` or `http:` schemes only. URLs with `javascript:`, `data:`, `file:`, `ftp:`, or other schemes are stripped (the source is displayed without a clickable link).
- **Control character escaping**: All citation text fields (title, citedText, URL display text) are stripped of ASCII control characters (U+0000–U+001F, U+007F) before rendering to prevent terminal escape injection.

### FR-10: Centralized Citation Resolution

Citation-enabled checks currently exist in two places: `shouldShowCitations()` in `turn.ts` and `showCitations()` in `useGeminiStream.ts`. This must be consolidated:

- A single shared `resolveCitationsEnabled(config, settings?)` function is implemented in the core package.
- Both `turn.ts` and `useGeminiStream.ts` call this shared function instead of maintaining independent resolution logic.
- This eliminates the risk of the two locations drifting apart as the resolution logic evolves.

---

## User Experience

### Enabling Citations

```
> /set citations enabled
Citations enabled. Structured source references will appear after responses (when available from your provider).

> /set citations disabled
Citations disabled.
```

### Citation Display (Gemini with Google Search)

```
The Rust programming language was first released in 2015. [1][2]

 Sources:
  1. History of Rust — https://en.wikipedia.org/wiki/Rust_(programming_language)
  2. Rust Release Notes — https://blog.rust-lang.org/2015/05/15/Rust-1.0.html
```

### Citation Display (Anthropic with Document)

```
According to the quarterly report, revenue increased by 15%.

 Sources:
  1. "Q3 Revenue Report" (chars 1204–1289):
     > "Total revenue for Q3 2025 increased 15% year-over-year to $4.2 billion."
```

### Citation Display (OpenAI Responses with Web Search)

```
The latest Node.js LTS version is 22.x.

 Sources:
  1. Node.js Release Schedule — https://nodejs.org/en/about/releases
```

### No Citations Available (providers without citation support)

```
The function uses a recursive algorithm to traverse the tree.
```
*(No citation block — clean output, no disclaimers.)*

---

## Settings Interaction Matrix

| Ephemeral `/set citations` | Persistent `ui.showCitations` | Result |
|---|---|---|
| `enabled` | any | Citations shown |
| `disabled` | any | Citations hidden |
| not set | `true` | Citations shown |
| not set | `false` | Citations hidden |
| not set | not set | Citations hidden (default) |

---

## Migration from Current Behavior

1. The generic disclaimer string ("Response may contain information from external sources…") is **removed**.
2. Users who had `ui.showCitations: true` will now see structured citations (where available) instead of the generic disclaimer.
3. Users who had the default (`false`) see no change — citations remain off.
4. The `ui.showCitations` setting label/description is updated to reflect structured citation behavior.
5. **Intentional behavior change:** The code-assist user-tier fallback logic is removed. Previously, non-free-tier users saw the generic disclaimer by default even without opting in. After this change, all users must explicitly enable citations via `/set citations enabled` or `ui.showCitations: true`. This is intentional: the old tier-based behavior produced log spam and a low-value generic disclaimer that was more noise than signal. Non-free users who want structured citations should opt in.

---

## Testing Requirements

### Unit Tests

- `resolveCitationsEnabled()` with all setting combinations (ephemeral overrides persistent, default false).
- Citation extraction from mock Gemini `groundingMetadata`.
- Anthropic no-op extractor returns empty array.
- Citation extraction from mock OpenAI Responses `annotations`.
- `renderCitationBlock()` output formatting.
- Privacy: excerpt truncation at 200 chars, URL scheme validation, control char stripping.

### Behavioral Tests (per RULES.md — no mock theater)

- `/set citations enabled` → citations appear in output.
- `/set citations disabled` → no citations appear.
- Default state → no citations appear.
- Provider without citations → no citations, no errors, no log spam.
- **Provider switch**: Enable citations, switch from a citation-supporting provider to a non-supporting one mid-session → no errors, citations silently absent.
- **Source deduplication**: When `google-web-search-invocation.ts` injects inline markers AND Turn-level citations fire for the same grounding metadata → no duplicate sources in output.
- **Log spam verification**: Run a full turn with citations disabled and default settings → assert zero citation-related log messages at any level.
- **Ordering stability**: Given the same grounding metadata input, citation sources always render in the same order (by chunk index).



# Issue #1139: Citations — Technical Specification

## 1. Architecture Overview

Citations flow through three layers of the LLxprt architecture:

```
Provider Layer          Core Layer              UI Layer
(extraction)            (event pipeline)        (rendering)
                       
GeminiProvider    -->                     
AnthropicProvider -->   Turn.run()        -->   useGeminiStream.ts
OpenAIResponses   -->   (yields events)         handleCitationEvent()
OpenAIProvider    -->                            CitationBlock component
```

Each provider extracts citation data from its native API response format, normalizes it into a unified `ServerGeminiCitationEvent`, and yields it from the Turn's run loop. The UI layer consumes the event and renders it.

### 1.1 Centralized Citation Resolution

Citation-enabled checks currently exist in two independent implementations:
- `shouldShowCitations()` in `turn.ts` (core layer)
- `showCitations()` in `useGeminiStream.ts` (UI layer)

These must be consolidated into a single shared function to eliminate drift risk:

```typescript
// packages/core/src/utils/citationUtils.ts

/**
 * Determines whether citations should be displayed.
 * Single source of truth — called by both Turn (core) and useGeminiStream (UI).
 *
 * Resolution order:
 *   1. Ephemeral setting 'citations' ('enabled' | 'disabled')
 *   2. Persistent setting 'ui.showCitations' (boolean)
 *   3. LoadedSettings fallback merged.ui.showCitations (boolean)
 *   4. Default: false
 *
 * Never throws. Never logs. Returns false on any error.
 */
export function resolveCitationsEnabled(
  config: Config,
  settings?: LoadedSettings,
): boolean;
```

Both `turn.ts` and `useGeminiStream.ts` import and call `resolveCitationsEnabled()` instead of maintaining their own logic. The `showCitations()` function in `useGeminiStream.ts` and `shouldShowCitations()` in `turn.ts` are replaced by calls to this shared function.

## 2. Data Model

### 2.1 Unified Citation Source

```typescript
/** A single source reference extracted from a provider's citation data. */
export interface CitationSource {
  /** Human-readable title of the source (document name, page title, etc.) */
  title?: string;
  /** URL of the source (web page, document link). Used for clickable terminal links. */
  url?: string;
  /** Excerpt of the cited text from the source document. Max 200 chars (truncated with '…'). */
  citedText?: string;
  /** Provider that produced this citation (for diagnostics/display). */
  provider?: 'gemini' | 'anthropic' | 'openai-responses' | 'openai' | string;
  /** Location info — shape varies by provider. Opaque to the UI. */
  location?: CitationLocation;
}

/** Provider-specific location data. The UI does not interpret this; it's for downstream tools. */
export type CitationLocation =
  | { type: 'char_location'; startCharIndex: number; endCharIndex: number; documentIndex: number }
  | { type: 'page_location'; startPageNumber: number; endPageNumber: number; documentIndex: number }
  | { type: 'content_block_location'; startBlockIndex: number; endBlockIndex: number; documentIndex: number }
  | { type: 'url_citation'; startIndex: number; endIndex: number }
  | { type: 'grounding'; groundingChunkIndex: number };
```

### 2.2 Enhanced Citation Event

```typescript
export type ServerGeminiCitationEvent = {
  type: GeminiEventType.Citation;
  value: CitationPayload;
};

export interface CitationPayload {
  /** Summary text (replaces the old generic disclaimer). Empty string if sources speak for themselves. */
  text: string;
  /** Structured source references. Empty array means generic disclaimer only. */
  sources: CitationSource[];
}
```

The `value` field is `CitationPayload`. No union type, no string variant, no normalization shim. All call sites that previously emitted a plain string are updated to emit `CitationPayload` directly.

### 2.3 Provider Capabilities Extension

```typescript
export interface ProviderCapabilities {
  // ... existing fields ...
  /** Whether this provider can return structured citation data. */
  supportsCitations?: boolean;
}
```

### 2.4 Privacy and Safety Constraints

All citation data is sanitized before rendering:

```typescript
/** Maximum length for citedText excerpts. Truncated with '…' when exceeded. */
const MAX_EXCERPT_LENGTH = 200;

/** Allowed URL schemes for citation links. Others are stripped. */
const ALLOWED_URL_SCHEMES = ['https:', 'http:'];

/** Sanitize a citation source before display. */
function sanitizeCitationSource(source: CitationSource): CitationSource {
  const sanitized = { ...source };

  // Truncate excerpts
  if (sanitized.citedText && sanitized.citedText.length > MAX_EXCERPT_LENGTH) {
    sanitized.citedText = sanitized.citedText.slice(0, MAX_EXCERPT_LENGTH) + '…';
  }

  // Validate URL scheme
  if (sanitized.url) {
    try {
      const parsed = new URL(sanitized.url);
      if (!ALLOWED_URL_SCHEMES.includes(parsed.protocol)) {
        sanitized.url = undefined;
      }
    } catch {
      sanitized.url = undefined;
    }
  }

  // Strip control characters from text fields
  const stripControlChars = (s: string) =>
    s.replace(/[\x00-\x1f\x7f]/g, '');

  if (sanitized.title) sanitized.title = stripControlChars(sanitized.title);
  if (sanitized.citedText) sanitized.citedText = stripControlChars(sanitized.citedText);

  return sanitized;
}
```

## 3. Ephemeral Setting Integration

### 3.1 Setting Registration

The `citations` key is added to the ephemeral settings namespace. The SettingsService already supports arbitrary key-value pairs via `getEphemeralSetting()` / `getEphemeralSettings()`.

### 3.2 Citation Resolution Logic

The shared `resolveCitationsEnabled()` function (see §1.1) replaces both `shouldShowCitations()` in `turn.ts` and `showCitations()` in `useGeminiStream.ts`:

```
function resolveCitationsEnabled(config: Config, settings?: LoadedSettings): boolean {
  1. Check config.getEphemeralSetting('citations')
     - 'enabled' -> return true
     - 'disabled' -> return false
  2. Check settingsService.get('ui.showCitations')
     - true/false -> return it
  3. Check settings?.merged?.ui?.showCitations (CLI fallback)
     - true/false -> return it
  4. Return false (default)
}
```

**Key change:** The code-assist user-tier check is removed. This is an intentional behavior change: previously, non-free-tier users saw a generic disclaimer by default. After this change, all users must explicitly opt in. The function never throws or logs on failure.

## 4. Provider Extraction Strategies

### 4.1 Gemini Provider

**Data path:** `GenerateContentResponse.candidates[0].groundingMetadata`

Already partially consumed by `google-web-search-invocation.ts` for inline citation markers. The new design promotes grounding data to first-class citation events at the Turn level.

**Extraction point:** In `Turn.run()`, after yielding content, inspect the response for `groundingMetadata`:

```
resp.candidates?.[0]?.groundingMetadata?.groundingChunks
resp.candidates?.[0]?.groundingMetadata?.groundingSupports
```

Each `groundingChunk` with a `web` property produces a `CitationSource`:
- `title` = chunk.web.title
- `url` = chunk.web.uri

Grounding supports map text segments to chunk indices, enabling inline citation markers (existing behavior preserved in tools, new summary block in Turn output).

#### 4.1.1 Anti-Duplication with Inline Tool Markers

`google-web-search-invocation.ts` already injects inline citation markers (e.g., `[1][2]`) and a `Sources:` block into the tool response text. The Turn-level citation system must not duplicate these.

**Deduplication strategy:**
- When `extractCitations()` processes Gemini `groundingMetadata`, it checks whether the current turn includes a completed `google_web_search` tool call.
- If so, it collects all `source.web.uri` values from that tool call's response.
- Any `groundingChunk` whose `web.uri` matches a tool-response source URI is excluded from the Turn-level `CitationPayload`.
- Matching is performed on normalized URLs (lowercase scheme + host, strip trailing slash).

### 4.2 Anthropic Provider

**Current state:** LLxprt does not currently send document blocks to Anthropic with `citations.enabled: true`. Without document blocks, Anthropic never returns citation data. The extraction design is therefore defined but dormant.

**Deliverables:**
1. Define the `AnthropicCitationExtractor` interface matching the expected Anthropic citation response shape.
2. Implement a no-op extractor that always returns an empty `CitationSource[]`.
3. Write tests that validate:
   - The extractor interface correctly types `char_location`, `page_location`, and `content_block_location` citation objects.
   - The no-op extractor returns `[]` for any input.
   - A mock integration test that, given a simulated Anthropic response with citations, produces the expected `CitationSource[]` — this test validates the *mapping logic* even though the extraction path is dormant.

**When document block support is added**, the extractor activates:
- On `content_block_delta` with `delta.type === 'citations_delta'`, accumulate citation objects.
- On `content_block_stop`, emit accumulated citations for that block.
- Each Anthropic citation object maps to a `CitationSource`:
  - `citedText` = citation.cited_text
  - `title` = citation.document_title
  - `location` = { type: citation.type, ... location fields }
  - `provider` = 'anthropic'

### 4.3 OpenAI Responses Provider

**Data path:** `response.output[]` items of type `message` contain `content[]` items with `annotations[]`.

**Extraction point:** In `OpenAIResponsesProvider.ts` or `parseResponsesStream.ts`, when assembling the response text:

- Scan `output_text` items for `annotations` array.
- Each annotation with `type: 'url_citation'` produces a `CitationSource`:
  - `title` = annotation.title
  - `url` = annotation.url
  - `location` = { type: 'url_citation', startIndex: annotation.start_index, endIndex: annotation.end_index }
  - `provider` = 'openai-responses'

**Streaming:** Annotations arrive as part of `response.output_text.delta` events. Accumulated per-item and emitted when the output item completes.

**Prerequisites:** Annotations only appear when web_search or file_search tools are **enabled in the request AND actually invoked by the model**. Simply having the tools declared in the request is not sufficient — the model must choose to call them, and the tool must execute successfully. Implementation should not assume annotations will be present in every Responses API output.

### 4.4 All Other Providers

OpenAI Chat Completions has no citation support. No extraction, no events. This covers every provider and model not listed above — OpenAIProvider, OpenAIVercelProvider, and all models accessed through OpenAI-compatible or Anthropic-compatible proxy endpoints.

## 5. Turn-Level Changes (packages/core/src/core/turn.ts)

### 5.1 shouldShowCitations() Replacement

The `shouldShowCitations()` private method is removed and replaced by a call to the shared `resolveCitationsEnabled()` function:

```typescript
import { resolveCitationsEnabled } from '../utils/citationUtils.js';

// In Turn class methods, replace:
//   this.shouldShowCitations()
// with:
//   resolveCitationsEnabled(config)
```

The `config` reference is obtained from `this.chat` as currently done (via the existing cast), but the resolution logic itself lives in the shared utility.

**Key differences from current code:**
- No logging in catch block (fixes the spam).
- No code-assist user-tier check (intentional behavior change — see Migration section in functional spec).
- Ephemeral setting takes priority.
- Uses optional chaining throughout.
- Single implementation shared with UI layer.

### 5.2 emitCitation() Enhancement

```typescript
private emitCitation(
  text: string,
  sources?: CitationSource[],
): ServerGeminiCitationEvent | null {
  if (!resolveCitationsEnabled(config)) return null;

  if (sources && sources.length > 0) {
    return {
      type: GeminiEventType.Citation,
      value: { text, sources: sources.map(sanitizeCitationSource) },
    };
  }

  // No structured sources — omit citation entirely (no generic disclaimers)
  return null;
}
```

### 5.3 Citation Extraction in Turn.run()

After yielding content events, extract citations from the provider response:

```typescript
// After content yield:
const citationSources = this.extractCitations(resp);
if (citationSources.length > 0) {
  const citationEvent = this.emitCitation('', citationSources);
  if (citationEvent) yield citationEvent;
}
```

The `extractCitations()` method inspects the `GenerateContentResponse` for Gemini grounding metadata and applies the anti-duplication policy (§4.1.1). For Anthropic and OpenAI, citation extraction happens at the provider level and is passed through the content generation pipeline.

## 6. Provider-Level Citation Propagation

### 6.1 Approach: IContent metadata.providerMetadata

Providers yield `IContent` objects through `generateChatCompletion()`. Citations need to flow through this pipeline to reach the Turn layer.

**Approach:** Store citation data in `IContent.metadata.providerMetadata.citations`. The `IContent` interface (defined in `packages/core/src/services/history/IContent.ts`) uses:
- `speaker` (not `role`) — values: `'human'` | `'ai'` | `'tool'`
- `blocks` (not `parts`) — array of `ContentBlock` union types
- `metadata?: ContentMetadata` — with `providerMetadata?: Record<string, unknown>`

Citations are stored as:

```typescript
// In the provider's IContent yield:
const content: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'text', text: responseText }],
  metadata: {
    providerMetadata: {
      citations: citationSources,  // CitationSource[]
    },
  },
};
```

The Turn layer reads `content.metadata?.providerMetadata?.citations` and emits citation events. This avoids adding a new top-level field to `IContent` — citations are provider-specific metadata, and `providerMetadata` already exists as `Record<string, unknown>` for exactly this purpose.

### 6.2 Why Not a Top-Level IContent Field

Adding a top-level `citations` field to `IContent` would:
1. Pollute the core content interface with provider-specific data.
2. Require updating all `IContent` consumers and serialization paths.
3. Contradict the design intent of `providerMetadata` as the extension point for provider-specific data.

The `metadata.providerMetadata.citations` path is the correct extension point, consistent with how the interface was designed.

## 7. UI Rendering (packages/cli/src/ui/)

### 7.1 Citation Block Component

The `handleCitationEvent` callback in `useGeminiStream.ts` is updated to handle `CitationPayload` values and use the shared resolution function:

```typescript
import { resolveCitationsEnabled } from '@vybestack/llxprt-code-core';

const handleCitationEvent = useCallback(
  (value: CitationPayload, userMessageTimestamp: number) => {
    if (!resolveCitationsEnabled(config, settings)) return;

    const rendered = renderCitationBlock(value);
    if (rendered) {
      addItem({ type: MessageType.INFO, text: rendered }, userMessageTimestamp);
    }
  },
  [addItem, config, settings],
);
```

Note: The `showCitations()` local function in `useGeminiStream.ts` is removed. Both the UI and core layer use `resolveCitationsEnabled()`.

### 7.2 renderCitationBlock()

```typescript
function renderCitationBlock(payload: CitationPayload): string {
  if (payload.sources.length === 0 && !payload.text) return '';

  const lines: string[] = [];

  if (payload.text) {
    lines.push(`\n[Citations] ${payload.text}`);
  } else {
    lines.push('\n[Sources]');
  }

  payload.sources.forEach((rawSource, idx) => {
    const source = sanitizeCitationSource(rawSource);
    const num = idx + 1;
    const title = source.title || `Source ${num}`;

    if (source.url) {
      // OSC 8 hyperlink for supporting terminals
      const link = createOsc8Link(title, source.url);
      lines.push(`  ${num}. ${link}`);
    } else {
      lines.push(`  ${num}. ${title}`);
    }

    if (source.citedText) {
      lines.push(`     > "${source.citedText}"`);
    }
  });

  return lines.join('\n');
}
```

This uses the existing `createOsc8Link()` from `packages/cli/src/ui/utils/terminalLinks.ts`.

## 8. Streaming Considerations

### 8.1 Gemini

Grounding metadata arrives with each streamed chunk. Citations are accumulated per-response and emitted after the content event (same timing as current generic disclaimer).

### 8.2 Anthropic

Citations arrive via `citations_delta` events during streaming. The provider accumulates them per content block and attaches them to the `IContent` yield's `metadata.providerMetadata.citations` for that block.

**Currently dormant:** No streaming citation handling — the no-op extractor means no citations flow through this path until document-block support is added.

### 8.3 OpenAI Responses

Annotations are part of the output text item. In streaming mode, they arrive as `response.output_text.annotations` events. The `parseResponsesStream.ts` pipeline accumulates them and attaches to the assembled output's `metadata.providerMetadata.citations`.

## 9. Configuration and Settings

### 9.1 Ephemeral Setting

Key: `citations`
Values: `'enabled'` | `'disabled'`
Default: not set (falls through to persistent setting or default false)

### 9.2 Persistent Setting

Key: `ui.showCitations`
Type: boolean
Default: false
Location: `packages/cli/src/config/settingsSchema.ts`
Description updated to: "Show structured citation sources after responses when available from the model provider."

### 9.3 Settings Dialog

The `showCitations` toggle remains in the UI settings dialog. Its label is updated to "Show Citations" and description reflects structured citations.

## 10. Testing Strategy

### 10.1 Unit Tests

- `resolveCitationsEnabled()` with all setting combinations (ephemeral overrides persistent, default false).
- Citation extraction from mock Gemini `groundingMetadata`.
- Anthropic no-op extractor returns empty array.
- Anthropic extractor interface types validate against `char_location`, `page_location`, `content_block_location` shapes.
- Citation extraction from mock OpenAI Responses `annotations`.
- `renderCitationBlock()` output formatting.

- `sanitizeCitationSource()`: excerpt truncation at 200 chars, URL scheme validation, control char stripping.
- **Provider switch test**: Verify `resolveCitationsEnabled()` returns correct value regardless of which provider is active.
- **Source deduplication test**: Given a set of tool-response source URIs and grounding metadata, verify `extractCitations()` omits duplicates.
- **Log spam verification test**: Mock the logger, run `resolveCitationsEnabled()` with missing/broken config → assert zero log calls.
- **Ordering stability test**: Given the same `groundingChunks` input, `extractCitations()` always returns sources in chunk-index order.

### 10.2 Integration Tests

- End-to-end Turn.run() with Gemini provider returning grounding metadata → citation event emitted.
- Anthropic provider streaming → no citation events (no-op extractor, dormant until document blocks supported).
- OpenAI Responses provider with url_citation annotations → citation event emitted.

### 10.3 Behavioral Tests (per RULES.md — no mock theater)

- `/set citations enabled` → citations appear in output.
- `/set citations disabled` → no citations appear.
- Default state → no citations appear.
- Provider without citations → no citations, no errors, no log spam.
- **Provider switch**: Enable citations, switch provider mid-session → no errors, citations silently absent for non-supporting providers.
- **Source deduplication**: Gemini web search tool fires AND Turn-level grounding citations fire for same sources → no duplicate rendering.
- **Log spam verification**: Full turn with default settings → zero citation-related log messages.
- **Ordering stability**: Same grounding metadata → same citation order across runs.

## 11. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Anthropic citation extraction runs against proxy endpoints that return unexpected data | Low | Low | Extraction code handles missing/malformed citation data gracefully; returns empty array. |
| OpenAI Responses annotation format changes | Low | Medium | Version-pinned SDK; extraction logic validates structure before mapping. |
| Performance impact of citation extraction on every response | Low | Low | Extraction is O(n) on number of annotations, which is typically small (<20). |
| Duplicate citations from tool-level and Turn-level extraction | Medium | Medium | Anti-duplication policy (§4.1.1) uses URL-based matching to filter Turn-level duplicates. |
| Tier-fallback removal breaks expectations for non-free users | Low | Medium | Documented as intentional behavior change. Non-free users who want citations opt in explicitly. |

## 12. Scope

### In Scope
- Fix spammy log
- Add ephemeral citation toggle
- Restructure citation event type (value is `CitationPayload`, no union)

- Centralize citation resolution into shared `resolveCitationsEnabled()` function
- Extract Gemini grounding citations with anti-duplication against inline tool markers
- Extract OpenAI Responses annotations (when web/file search tools are enabled AND invoked)
- Anthropic: extraction interface + no-op implementation + tests (dormant until document-block support)
- Render structured citations with clickable links
- Apply privacy/safety constraints (200-char excerpt limit, URL scheme validation, control char escaping)
- Remove generic disclaimer
- Remove code-assist user-tier fallback (intentional behavior change)

### Out of Scope (see also: Functional Spec Non-Goals)
- Full Anthropic `citations_delta` streaming parsing (requires document-block support that does not exist yet)
- Anthropic document upload + citation enablement
- Inline citation markers embedded in response text (vs. post-response citation block)
- Citation caching across multi-turn conversations
- Per-provider citation quality metrics

## 13. Files Affected

| File | Change |
|---|---|
| `packages/core/src/utils/citationUtils.ts` | **New file.** Shared `resolveCitationsEnabled()`, `sanitizeCitationSource()`, citation type definitions (`CitationSource`, `CitationPayload`, `CitationLocation`) |
| `packages/core/src/core/turn.ts` | Remove `shouldShowCitations()`, import and use `resolveCitationsEnabled()`. Enhance `emitCitation()`, add `extractCitations()` with anti-duplication logic |
| `packages/core/src/core/turn.ts` (types) | Change `ServerGeminiCitationEvent.value` from `string` to `CitationPayload` |
| `packages/core/src/providers/types.ts` | Add `supportsCitations` to `ProviderCapabilities` |
| `packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts` | Extract `url_citation` annotations, store in `metadata.providerMetadata.citations` |
| `packages/core/src/providers/openai/parseResponsesStream.ts` | Accumulate annotations during streaming |
| `packages/core/src/providers/anthropic/AnthropicProvider.ts` | No-op citation extractor interface + stub (dormant until document-block support) |
| `packages/core/src/providers/gemini/GeminiProvider.ts` | No change (grounding extraction is in Turn) |
| `packages/core/src/services/history/IContent.ts` | **No structural change.** Citations stored in existing `metadata.providerMetadata.citations` (no new top-level field) |
| `packages/cli/src/ui/hooks/useGeminiStream.ts` | Remove `showCitations()` local function, import `resolveCitationsEnabled()`. Update `handleCitationEvent` to accept `CitationPayload` |
| `packages/cli/src/config/settingsSchema.ts` | Update `showCitations` description |
| `packages/cli/src/config/settings.ts` | No structural change |
| `packages/core/src/settings/SettingsService.ts` | No structural change (ephemeral settings already supported) |

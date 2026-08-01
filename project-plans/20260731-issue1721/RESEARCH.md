# RESEARCH — Issue #1721 chronology markers

Evidence gathered against `main` @ `52ae41f78`. Line numbers are from that tree.

## A. History mutation paths (`HistoryService`)

Backing array: `private history: IContent[]`
(`packages/core/src/services/history/HistoryService.ts:78`).

| Path | Operation | Routes through `addInternal`? |
|---|---|---|
| `add()` → `addInternal()` (`HistoryService.ts:285`, `:300`) | push | yes |
| `addAll()` (`:394`) | push per item | yes (via `add`) |
| `recordTurn()` (`:730`) | push | yes |
| `merge()` (`:805`) | push | yes |
| `static fromJSON()` (`:845`) | push | yes |
| queued ops flushed by `endCompression()` (`:855`) | push | yes |
| `validateAndFix()` (`:763`) | `splice` insert of synthetic tool messages | **no** |
| `applyDensityResult()` (`:429`) → `applyDensityMutations()` (`densityValidation.ts`) | index assignment + `splice` removal | **no** |
| `replaceToolResponseBlock()` (`:455`) | index assignment, spreads `{ ...entry, blocks }` so metadata survives | **no** (but metadata-safe) |
| `summarizeOldHistory()` (`:820`) | whole-array replacement | **no** |
| `clear()` / `clearInternal()` (`:607`, `:621`) | array replacement with `[]` | n/a |
| `pop()` (`:672`), `removeLastIfMatches()` (`:662`), `dispose()` (`:586`) | removal | n/a |

`getRawHistory()` (`:538`) returns the live array typed `readonly`;
`getAll()` (`:579`) returns a shallow copy. No production caller was found that
pushes/splices the returned array — all mutation goes through the methods above.

## B. Provider wire boundary

Real wire converters:

- OpenAI chat: `buildMessagesWithReasoning`
  (`packages/providers/src/openai/OpenAIRequestBuilder.ts`)
- OpenAI Responses: `buildResponsesInputFromContent`
  (`packages/providers/src/openai-responses/buildResponsesInputFromContent.ts`)
  and `buildResponsesRequest` (`packages/providers/src/openai/buildResponsesRequest.ts`)
- Anthropic: `convertToAnthropicMessages`
  (`packages/providers/src/anthropic/AnthropicMessageNormalizer.ts`)
- Gemini: `convertHistoryToGeminiFormat`
  (`packages/providers/src/gemini/GeminiMessageConverter.ts:129`)
- Gemini neutral: `ContentConverters.toGeminiContent`
  (`packages/core/src/services/history/ContentConverters.ts:266`)

**Finding: no converter spreads `content` or `content.metadata` into a wire
payload.** Every provider message is built from explicit field picks off
`content.blocks`. The only metadata field that crosses the wire is:

```
packages/providers/src/openai/buildResponsesRequest.ts:321
      if (msg.metadata?.usage) {
:322    result.usage = msg.metadata.usage;
```

which is an explicit pick, not a spread. Metadata is read for *decisions* in two
more places without being serialised:
`AnthropicMessageNormalizer.ts:209` (`metadata.model`, cross-model thinking
strip) and `openAIResponsesStateful.ts:61-63,88` (`responsesStored`/`id` for
`previous_response_id`).

`deepCloneWithoutCircularRefs` (`historyCloneUtils.ts:29-35`) shallow-copies
metadata, so metadata does travel with IContent up to the converter boundary —
but is dropped there.

**Gap: no existing test asserts metadata is excluded from wire payloads.**

`buildProviderDumpBody` (`packages/providers/src/utils/providerRequestConversion.ts:127`)
delegates to the same three real converters for openai/anthropic/gemini, and
falls back to `{ history: params.history }` (raw IContent, metadata included) for
unrecognised providers — this is a local dump file, not a wire payload.

## C. Compression / summarization

`CompressionHandler.performCompression()` applies results with:

```
this.historyService.clear();
for (const content of newHistory) {
  this.historyService.add(content, this.runtimeContext.state.model);
}
```

so every retained item re-enters through `addInternal`.

Summary entries are constructed at `OneShotStrategy.ts:210` and
`MiddleOutStrategy.ts:546` with `metadata: { isSummary: true, synthetic: true,
reason: 'compression-state-snapshot' }` — **no `turnId`, no `timestamp`, no
reference to what was destroyed**. `TopDownTruncationStrategy` produces no
summary at all (deterministic drop). `HighDensityStrategy` replaces tool
responses with metadata-only stubs via `applyDensityResult`.

Retained items keep their object identity and metadata; only their array indices
shift. So a marker stored on the item survives; an index-based scheme would not.

## D. Retries

`retryWithBackoff` (`packages/core/src/utils/retry.ts`),
`RetryOrchestrator` (`packages/providers/src/RetryOrchestrator.ts`), and
`DirectMessageProcessor._executeWithRetry` are the retry surfaces. History is
re-read fresh per attempt via `getCuratedForProvider()`; pending user content is
added once, not per attempt. So retries produce repeated *sends* of the same
history items — which is precisely why a per-item insertion marker (rather than a
per-request counter) is what disambiguates the trace.

## E. Existing tracing surfaces

- `/dumpcontext now` → `dumpImmediateContext()`
  (`packages/cli/src/ui/commands/dumpcontextCommand.ts:100-130`) reads
  `historyService.getAll()` and writes
  `{ url: 'immediate-context-dump', method: 'DUMP', body }` via
  `dumpRequestContext`. The dump file shape is
  `{ provider, timestamp, request }` (`packages/providers/src/utils/dumpContext.ts:117-140`).
  A sibling key can be added without touching `request.body`.
- `/dumpcontext on|error` dumps happen inside provider SDK execution
  (`dumpSDKContext.ts`), which has no `HistoryService` access — sidecar there
  would require cross-package plumbing (declared NG3).
- Debug namespaces: `llxprt:history:service` (`HistoryService.ts:84`),
  `llxprt:content:converters`, `llxprt:core:dumpContext`.
  `curationDebugLogger.logContentAdded` already logs speaker, block types, tool
  ids and `metadata.id` — the natural place to add chronology.
- Telemetry `ConversationRequestEvent` has `turn_number`/`prompt_id`
  (`packages/telemetry/src/telemetry/events/conversation-events.ts`), but these
  are per-request session counters, not per-history-item. Declared NG2.

## F. Existing partial implementations

- `generateTurnKey()` (`HistoryService.ts:163`) → `turn_${randomUUID()}`.
  Unique, **not ordered**. Minted independently at
  `ConversationManager.ts:134,474,498,533,546`, `ChatSessionFactory.ts:189`,
  `DirectMessageProcessor.ts:248`, `streamRequestHelpers.ts:64`,
  `ContentConverters.ts:503`. Summary entries get none.
- `metadata.timestamp` (`IContent.ts:44`): only set when a caller explicitly
  passes it to `createUserMessage`; production AI/tool construction sites do not
  set it.
- `metadata.id` (`IContent.ts:53`): produced by `getIdGeneratorCallback`
  (`HistoryService.ts:157`) → `canonicalizeToolCallId`, i.e. a tool-call ID
  scheme, and separately overloaded as the OpenAI Responses response id. Not
  present on most AI turns, not ordered.
- **No sequence/ordinal/step/position field exists anywhere on `ContentMetadata`.**

## G. Test conventions

| Package | Runner |
|---|---|
| core | vitest (`vitest run`) |
| agents | vitest |
| providers | bun test (`bun ../../scripts/run_bun_tests.ts --workspace providers`), `test:vitest` also available |
| cli | vitest |

`dev-docs/RULES.md` mandates: TDD (failing test first), behaviour over
implementation, no mock theatre (never mock the component under test, never mock
the expected output, never assert that mocks were called), infrastructure-only
mocking, TypeScript strict (no `any`, no assertions), immutability, never
enshrine a bug as a passing test, Arrange-Act-Assert, DRY setup.

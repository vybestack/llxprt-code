# Finish plan for issue #854

The branch is not close to acceptance yet. The journal facade, pager, child journals and streamed resume/checkpoint routes provide much of the foundation, but normal model sends still collect the context in the agent layer. The alternative send route is an opt-in, stateless Responses text implementation that rejects compression escalation and several enabled features. Load balancing and shared provider normalization also collect whole requests, and initialized history replacement can retain media-bearing history arrays between turns. Finish the contracts and production callers before spending more effort on measurement infrastructure. First repair the declaration build, then remove these owners, preserve provider bytes and prove retained growth through repeated turns with compression.

## Scope and evidence

Investigated `issue854` at `52653a6a6`. The pre-existing change to `.llxprt/LLXPRT.md` is outside this work. This plan changes no source, tests, configuration or enforcement.

The design's section 5c and its five acceptance criteria remain the architectural basis. The current R1–R6 requirements supplied with this task supersede older stage-specific identity requirements, transient byte budgets and statistical protocols. No new approval gate, provider restriction or memory allowance is proposed.

One focused test was run: `bun test ./packages/core/src/services/history/structuralAudit.bun.test.ts`. It passed 22 tests, including negative controls, with 66 assertions. Receipt: `tmp/resume854/plan/structural.log`. No full suites, builds, model smoke or heap measurements were run. Other receipts below are historical evidence, not current passes. The execution tracker stops at P05c and cannot describe the consolidated snapshot's present state.

## 1. Current state against R1–R6

### R1: no context-sized owner between turns. Partly implemented, not satisfied throughout the object graph.

- `HistoryServiceCore` has a journal, detached-value facade, scalar accounting and operation owners instead of a history array (`packages/core/src/services/history/HistoryServiceCore.ts:158–277`). The current structural audit checks both facade classes, the resolver, cursor, mutation FIFO and recording integration; it also rejects restoration of eager public APIs (`packages/core/src/services/history/structuralAudit.bun.test.ts:292–358`). The fresh passing result is narrower than a heap proof of everything reachable from a runtime.
- The resolver's membership storage is disk-backed: `units` is a `ResolverDiskIndex`, not an array of decoded rows (`packages/core/src/recording/journalResolver.ts:122–138`). Historical documents calling the current facade's `getAll`/`materializeHistory` live product APIs are stale. `HistoryJournalStore.materialize` and its eager fold still exist internally (`packages/core/src/services/history/historyJournalStore.ts:660–661,955–983`); the facade does not expose them. Remove that test-oracle surface from production after checking its remaining references rather than treating its mere existence as a confirmed live leak.
- The default alternate-buffer pager is enabled (`packages/cli/src/config/settings-schema/schema-ui.ts:162,321`). Its resident rows, viewport margins and eviction are window-local (`packages/cli/src/ui/stores/turn/scrollbackPager.ts:377–388,719–802`). The fallback ledger trims against configured item/byte limits (`packages/cli/src/ui/stores/turn/historyLedger.ts:53–57,112–135`). This supports bounded default UI ownership, but does not certify every configuration or component closure. `staticPrintLedger.tsx` has no discovered product caller and must not be blamed for a production leak.
- Child journals are provisioned separately and durably initialized (`packages/core/src/recording/childJournal.ts:92–116`, tested by `childJournalLifecycle.p05c.test.ts`). Children still use the same incomplete send machinery as the parent. Their own files alone do not establish R1/R2.
- There is a concrete reachable retained owner in initialized `ChatSession.setHistory`: media admission stores the complete admitted array and captures it in `release` until a later replacement/clear (`packages/agents/src/core/chatSession.ts:753–778`). `retainedHistoryAdmissions.ts` also has an array-owning media route. Its detached deferred-array route already records `history: []`; do not conflate the two.
- `_previousHistory` is no longer an established live leak: inspected writes clear it, including source publication (`packages/agents/src/core/client.ts:498–500,511–528`). Authentication transfer already feeds a stream into deferred admission (`packages/core/src/config/agentClientLifecycle.ts:169–203`). Preserve these migrations.

### R2: default send is journal-fed without an agent context graph. Not satisfied.

- The dispatch still selects `diskRequest` only for `requestHistorySource === 'responses-disk-text'`; otherwise it selects `arrayRequest` (`packages/agents/src/core/streamprocessor-request.ts:195–202`). The flag is a test/harness selection, not a product default.
- `arrayRequest` collects curated rows before hooks, estimation, enforcement and sending (`packages/agents/src/core/streamprocessor-request.ts:82–130`; actual collector: `packages/agents/src/core/streamRequestHelpers.ts:178–195`). Wrapping this array in an async generator does not remove ownership (`packages/agents/src/core/promptEnvelopeSendSeam.ts:84–101,119–144`).
- The non-streaming turn path independently collects all curated rows (`packages/agents/src/core/turnMediaRequest.ts:33–40`) and uses array enforcement. Both send entry points must migrate.
- The source route rejects prompt/conversation logging, token-shape logging and AfterModel hooks (`packages/agents/src/core/streamprocessor-disk-source.ts:18–54`). The provider projection restricts it to stateless human/AI text, a selected tokenizer family, no Codex/WebSocket/stateful parent, no request dumps and no input/instructions/tools overrides (`packages/providers/src/openai-responses/responses-disk-text-projection.ts:22–85`).
- Source enforcement only invokes the initial projection check. The stage policy exists but is not executed (`packages/agents/src/compression/provider-source-enforcement.ts:47–81,96–123`). The provider compression callback explicitly throws (`packages/agents/src/compression/CompressionHandler.ts:494–515`). Therefore flipping the flag now would break large contexts rather than finish R2.
- Shared normalization normally collects the stream (`packages/providers/src/BaseProviderNormalization.ts:136–170`). Load balancing collects again before choosing a strategy (`packages/providers/src/LoadBalancingProvider.ts:404–422`), and its fallback estimator collects (`packages/providers/src/loadBalancing/preparedPromptOptions.ts:22–61`). These are not SDK exceptions.

### R3: repeated-turn leak proof with a failing retention trap. Not established.

The retained source test checks a selected Responses request, response/retry cleanup and a 1 MiB allowance; its runner explicitly sets the opt-in flag (`packages/agents/src/core/streamprocessor-retained-run.ts:25`). It is useful lifecycle coverage, not a default-route many-turn proof. The CLI whole-memory harness compares separately loaded fixture sizes through six process pairs per workload (`packages/cli/src/services/wholememory.test.ts:245–324`). Neither inspected test establishes repeated normal sends with compression and settled runtime owners through N turns. No current retained-heap measurement was run during this investigation.

Keep the allowance at 1,048,576 bytes. Add one direct repeated-turn retained-growth test with a deliberately retaining control evaluated by the same predicate. Do not interpret WASM allocator capacity, RSS or transient single-row size as context retention.

### R4: provider request bytes unchanged. Meaningful tests exist; final coverage is incomplete.

`packages/providers/src/__tests__/providerBodyEquivalence.p05b4.test.ts:8–20,98–143` uses an independent eager reference and real provider normalizers with captured BODY bytes. Preserve that oracle. Keep `providerBodyRequestScope.p05b4.test.ts`, `providerBodyLeases.p05b4.test.ts`, `providerBodyBackpressure.p05b4.test.ts`, and the compression/resume/checkpoint byte matrices. No byte suite was rerun here. Existing successes for selected transports do not cover a default source send with all hooks, models, media and wrappers. Extend coverage at each migrated boundary; never make the resolver or new serializer its own expected-value generator.

### R5: resume/continue/checkpoints without session materialization. Ordinary routes substantially migrated; gaps remain.

- `resumeSession` scans metadata and opens `ResumeCursorBoot` at a watermark rather than returning replayed rows (`packages/core/src/recording/resumeSession.ts:207–235`). `restoreResumeBoot` admits `boot.streamRows()` and adopts the recorder. Checkpoint transitions use cursor boot and journal-range copying (`packages/core/src/recording/SessionTransitionService.ts`).
- CLI checkpoint restore now uses an incremental reader, preflight and streamed `setHistoryFromSource` (`packages/cli/src/ui/commands/checkpoint-restore-source.ts`; `packages/cli/src/ui/commands/restoreCommand.ts:113–126,154–164`). The earlier stage report describing whole-file checkpoint restore is obsolete. Keep save/restore byte and failure tests, including Git/UI/tool restoration order.
- The existing complete deferred-startup test includes 512/8192 rows and its original deadline (`packages/cli/src/services/restore-deferred-source.test.ts`). An older stage reported the larger startup failing; it was not rerun here. Resolve any current failure rather than asserting the historic diagnosis still holds.
- Session-browser and ACP title fallback still call a helper that reads/splits the entire journal (`packages/core/src/recording/SessionDiscovery.ts:483–499`; callers: `packages/cli/src/ui/hooks/useSessionBrowserHelpers.ts:387`, `packages/zed-acp/src/zed-session-listing.ts:133`). Replace that read with a bounded scan.
- `/continue import` is an additional whole-session path. The package representation includes complete recording bytes, histories and serialized persisted states (`packages/core/src/recording/session-media-package-validation.ts:56–66,111–141`); package processing collects histories/reservations and replays a full recording (`packages/core/src/recording/session-media-package.ts:74–89,129–137,358–390`). Finite external-input limits do not make these context owners acceptable under R5. Preserve validation limits while migrating storage/validation to file handles and row streams.

### R6: green branch without weakened enforcement. Not satisfied.

The supplied baseline log is red. Its actual inventory is 333 compiler diagnostics: 330 TS6059, two TS2307 and one TS2739. It does not contain the two TS2742 diagnostics mentioned in the driver summary. It also contains MCP/CLI dist-test-artifact guard failures (`tmp/resume854/baseline/typecheck.log:57–76,92–97,1881–1999`). These are historical results on the consolidated branch, not a fresh rerun.

The direct cross-package fixture imports seed the rootDir cascade (`packages/agents/src/core/source-post-send-durable-fixture.ts:13`; `source-telemetry-correlated-fixture.ts:27`). The build includes ordinary `src/**/*.ts` but excludes `__tests__` and test suffixes (`packages/agents/tsconfig.build.json:18–40`). Production source imports two unexported provider subpaths (`prompt-envelope-source-send.ts:9`, `source-pending-selection.ts:7`), producing TS2307 and the inherited-source TS2739. Repair the boundaries and fixture placement, not rootDir, declarations, guards or exclusion enforcement. Root lint, all unit suites, build and smoke are unverified here.

## 2. Minimal completed send design

Use one core-owned, provider-neutral request selection: immutable count/membership, repeatable `openReader(signal)` and an explicit close owner. `ProviderRequestSnapshot` already provides the foundation. Extend the core provider options contract, which currently has only `contents` and no `requestRows` (`packages/core/src/runtime/contracts/RuntimeProviderChat.ts:72–97`). Remove the agents-to-Responses subclass dependency. Do not add a parallel history abstraction or retain an array behind a stream label.

The lifetime is: pin the journal and current pending turn, select tools, apply configured hook changes, enforce against fresh candidates, prepare for the selected provider, log/count through readers, send, then close all readers/projections on success, failure, abort or consumer return. After a mutation, rebuild the selection and discard the obsolete prepared projection. Reuse existing normalization disks, detached values, disk candidates and cleanup owners. Temporary request artifacts must be leased and removed, never become a second durable session archive.

| Boundary | Current blocker and evidence | Minimal change; request-scoped exception |
| --- | --- | --- |
| StreamProcessor and TurnProcessor | Two collectors and array-only prepared request contracts, described under R2. | Share the source-owned seam. Keep only the current user/tool turn in memory. Remove `arrayRequest`, the opt-in flag and whole-request payload callbacks after both callers migrate. No whole-context fallback in the agent. |
| BeforeModel | The new snapshot path handles disk documents, but has a narrower output contract: model/settings changes and some legacy outputs are rejected (`packages/core/src/hooks/hookSnapshotTextRequest.ts`; `packages/agents/src/core/beforeModelHookFire.ts:197–200`). | Preserve existing enabled-hook semantics. Use the snapshot route where supported. If a configured hook's actual contract requires the complete request, materialize only inside that hook invocation owner, recover its output to a disk selection and release it. Never take an eager snapshot when no such hook is registered. |
| AfterModel | Source sends pass no request payload and explicitly reject registered AfterModel hooks (`packages/agents/src/core/StreamProcessor.ts`, `_processAfterModelHook`; source guard at `streamprocessor-disk-source.ts:27–30`). | Pass the pinned selection, selected tools and response chunk to a hook adapter. Full-request hook input is the permitted configured-hook exception; release per invocation/response lifetime. Preserve stop/block/modify, finish reason, usage and allowed-tool filtering. |
| Tool selection | `applyToolSelectionHook` selects a different registry path according to the source flag (`packages/agents/src/core/streamRequestHelpers.ts:220–301`). | Make registry initialization and selection independent of history transport. Tool-selection hooks see their established empty contents input. Preserve `none`, allow lists, scope-local emit, tool omission and logging semantics. Tool schema memory is not a context copy. |
| Enforcement | Initial-only source check and throwing callback; array recomposition still pushes every curated row (`packages/agents/src/compression/providerContentEnforcement.ts:816–825`). | Execute existing stage policy over disk candidates: density, compression, ineffective-compression retry, fallback, tool-response truncation, then overflow. Keep pending membership distinct from raw pending recomposition. Return a replacement source, not an array. Re-estimate every replacement and release old projections. No fallback exception here. |
| Provider-triggered compression | Callback still expects replacement arrays (`CompressionHandler.ts:500–503`; LB array callback path). | Migrate the internal callback contract to an owned source candidate plus result/accounting. Preserve transaction compensation, stateful-chain invalidation and cache-anchor/baseline reset order. Always clear callbacks at call end. |
| Estimation | Generic projection builds a nested structure, `promptText` and `promptSegments` (`packages/providers/src/runtime/promptEnvelopeProjections.ts:73–101`). Source projection requires a selected o200k family. | Estimate the same finalized provider representation from disk segments or row folds, preserving separators, tokenizer boundaries, media cost and retained-parent accounting. Reuse existing tokenizer families; do not sum independently tokenized chunks when that changes tokenization. Return scalar estimates/descriptors to agents, not context strings. SDK-body estimation may happen inside its transport preparation owner, but must not export an extra full-body projection graph. |
| Conversation logging and telemetry | Agent guard rejects logging although provider logging already writes stream artifacts (`packages/providers/src/logging/apiRequestLogger.ts:24–59`; wrapper lease at `LoggingProviderWrapper.ts:244–255`). Agent shape recording still takes arrays, despite an existing source helper (`packages/agents/src/core/tokenUsageEstimateLogger.ts:184–201,231–269`). | Wire source logging and source shape accounting; preserve redaction, media sanitation, IDs, join keys and opt-in behavior. Do not serialize full context into agent telemetry strings. Keep artifact descriptors through export completion, then release. Examine transient tool-call attribution lists and logger-held turn contexts for history-length growth; persist/stream needed attribution instead of hiding it in telemetry. No full-request exception for ordinary file logging. |
| Retry and load balancing | Retry/logging leases exist, but LB collects before all strategies and its fallback estimator collects. | Reopen the same pinned source per attempt, propagate cancellation, preserve projection-token cleanup and chosen-model system prompt rendering. Replace LB cloning/array compression and fallback estimate with source folds. Network/auth retry rules remain unchanged. No full-context exception in wrappers. |
| Media | `resolveRequestMedia` and core `request-media-resolver.ts` take arrays; media admission can retain histories. | Stream per-row admission/resolution and store session media ownership in the existing disk index. Preserve reference multiplicity, MIME/dimensions, budget accounting and release ordering. A 10 MiB valid row is allowed. A transport SDK body can contain resolved media request-scoped; shared resolver/session owners cannot keep all decoded rows. |
| Responses | Only branded stateless text reaches disk projection; restrictions at `responses-disk-text-projection.ts:22–85`. The serializer already has tool/media/stateful-source concepts (`packages/providers/src/runtime/responses-source-serializer.ts:22–56`). | Generalize the existing route to all supported row blocks, reasoning, tool IDs/results, stateful parent/incremental/full-history accounting, request overrides, dumps and Codex. Use disk-backed normalization/joins and existing streamed HTTP body machinery. Keep WebSocket framing request-scoped if its actual API needs a complete frame; do not collect history just to choose transport. Remove text-brand/provider-name/tokenizer admission restrictions once replacement tests pass. |
| Anthropic | Projection prepares an array request/media lease and exports generic full prompt projections (`packages/providers/src/anthropic/AnthropicProvider.ts:873–920`). | Put collection, if required by the Messages SDK, inside concrete transport preparation, reuse that one prepared body for estimate/send/retry, and release on every outcome. SDK requires complete structured Messages input, so that body is a permitted R2 exception. Session state, agents and wrappers still use journal sources. Avoid duplicate neutral-history and projection trees. Preserve cache boundaries, thinking/signatures, OAuth-required prompt and image recovery. |
| OpenAI chat | Shared normalization collects before concrete request conversion; request messages and projection then duplicate it (`BaseProviderNormalization.ts:161`; `OpenAIProvider.ts:831` onward). | Feed the source into concrete chat preparation. Use raw streaming body machinery if already supported; otherwise the SDK's complete `messages` body is a transport-only exception. Do not retain both a neutral context array and wire messages. Preserve chat/tool normalization, reasoning, cache fields, override/property order and retries. |
| Gemini | Concrete plugin takes normalized arrays through media/setup into the SDK (`plugins/google-gemini/src/gemini/GeminiProvider.ts:368–407`). | Read the source at transport preparation and build the SDK-required complete `Content[]` there. This is an explicit R2 exception, not a reason to collect in agents/BaseProvider. Reuse the body for counting and call, then release. Preserve AFC, thought signatures, GenAI/Vertex differences, tool/media validation and SDK output. |
| Vercel | `convertToModelMessages` returns a complete SDK `ModelMessage[]`; its body lease is request-scoped (`packages/providers/src/openai-vercel/OpenAIVercelProvider.ts:119,168,231–252`). | Move source-to-message conversion into the concrete SDK transport owner, retaining only the required SDK body. This SDK input array is an R2 exception. Keep media cleanup, tools, finish/usage and release-after-call assertions. |

Provider exceptions must be explicit in concrete implementations and tests. An `AsyncIterable` collected in BaseProvider, an array retained by LB, a logging string or a tokenizer projection handed back to the agent is not covered by the SDK exception. Existing SDK contracts justify the scoped bodies above; this plan does not require replacing every SDK with a new HTTP client.

## 3. Ordered work packages

Sizes are changed production/test lines, excluding mechanical moves/deletions. All packages belong to the same branch. Split helpers to respect 800-line files and 80-line functions; do not increase caps, broaden rootDir, weaken assertions or exclude failing product paths.

### WP01. Make typecheck/build green: 250–600 LoC

Files: provider exports/barrels, `packages/agents/src/core/prompt-envelope-source-send.ts`, `source-pending-selection.ts`, the three `source-*-fixture.ts` cross-package import offenders, affected test imports, and real production-to-test import offenders identified by the MCP/CLI artifact guards.

Move test-only fixtures/workers into package `__tests__/support/`; use exported contracts instead of relative cross-package source imports. Export a genuinely shared abort helper through an intentional public entry or use the existing core abort facility. Replace the Responses-derived source dependency with a core-owned type. Repair actual declaration errors after the cascade disappears. Clean only generated contaminated dist output through the normal build path; do not bypass artifact guards.

Tests: package export/declaration boundary and existing build artifact guards. Done: `npm run typecheck` and `npm run build` both pass, including guards. Those commands are for implementation verification, not this planning run.

### WP02. Finish value-based mutation ownership: 450–850 LoC

Files: `HistoryServiceCore.ts`, `historyJournalStore.ts`, `historyRowTransform.ts`, `historyBatchContracts.ts`, pending tickets and chronology rollback helpers under `packages/core/src/services/history/`.

Keep detached row values and journal membership as the mutation truth. Replace transaction-wide original-object ledgers with disk-backed candidate/inverse operations where still reachable. Keep append acknowledgement as the durable publication point. Do not lose cleanup when compensation fails or mutate caller metadata before protected admission.

Tests: convert the identity assertions listed in section 4, retaining value/order/token/chronology/durability checks; keep frozen-input, partial admission and compensation-failure regressions. Done: a large failed mutation restores values and accounting without a context-sized strong identity ledger. Bounded current-turn caller identity may survive locally; whole-session identity is not promised.

### WP03. Remove initialized-session media array owners: 400–750 LoC

Files: `retainedHistoryAdmissions.ts`, `chatSession.ts`, initialized client history replacement helpers, `packages/core/src/storage/media-admission-service.ts` and `packages/core/src/storage/history-media-index.ts`.

Replace retained admitted arrays/release closures with disk-backed media ownership and one-row traversal. Migrate internal array restore/resume callers to `setHistoryFromSource`; remove obsolete internal overloads rather than maintaining compatibility adapters.

Tests: existing retained-array/media suites, active and deferred replacement, cancellation, failed admission/publication/release, reference multiplicity and subsequent clear/dispose. Done: both initialized and deferred clients settle with no retained transcript arrays; media remains usable until its actual journal/session ownership ends.

### WP04. Unify the provider-neutral source contract: 250–500 LoC

Files: core `RuntimeProviderChat.ts`, provider `IProvider.ts`, `BaseProvider.ts`, `BaseProviderNormalization.ts`, agent `source-pending-selection.ts`, `source-before-model-hook.ts`, `prompt-envelope-source-send.ts` and `streamprocessor-disk-source.ts`.

Thread core request rows/count/owner and distinguish preparation from concrete transport materialization. Remove `instanceof ResponsesDiskTextRows` as the general acceptance contract. Preserve signal binding, first-pull cancellation and close/release ownership. Do not flip the production default yet.

Tests: source preparation, HTTP/abort and lease tests without the Responses subclass; one-shot and repeatable reader failure cases. Done: every provider/wrapper can receive the neutral selection without shared-layer collection or unsupported-provider rejection.

### WP05. Source-capable finalized estimation: 450–900 LoC

Files: provider `runtime/promptEnvelopeProjections.ts`, existing source serializers/segments/tokenizer integration, core `runtime/contracts/PromptEstimation.ts`, and LB `preparedPromptOptions.ts`.

Use streamed finalized segments or transport-local SDK preparation and return scalar/described projections. Preserve all supported model-family selection and existing estimate semantics. Delete full-context string duplication from source requests, not tokenizer validation.

Tests: existing prompt/tokenizer characterization, segmentation-boundary cases, tool/media costs, stateful baseline and invalid/missing model failures. Done: selected-provider estimates match independent legacy expectations without agent-held full prompt text or a model whitelist introduced by #854.

### WP06. Complete Responses source transport: 550–1,050 LoC

Files: `OpenAIResponsesProviderCore.ts`, `responses-disk-text-projection.ts`, `responses-source-serializer.ts`, existing input builder/source input, request-state and HTTP/WebSocket executor modules.

Activate general source conversion for text, tools, media and reasoning; preserve stateful/Codex/overrides/dumps. Reuse existing disk normalizer and wire serializer rather than adding another body protocol. Complete cleanup of prepared tokens and unsent projections.

Tests: Responses existing BODY and source projection suites extended to these features, HTTP retry bytes, stateful invalidation and WebSocket/Codex fixtures. Done: no feature requires reverting to an agent context array; complete-frame allocation, if needed, stays within its transport lifetime.

### WP07. Anthropic source-to-SDK preparation: 350–700 LoC

Files: `AnthropicProvider.ts`, `AnthropicRequestPreparation.ts`, body/projection/media helpers.

Tests: existing BODY/cache/thinking/OAuth and image-recovery cases, source cancellation, unsent preparation and request leases. Done: the concrete SDK owner alone builds the required body, releases it, and produces unchanged bytes and estimates. No shared normalization collection.

### WP08. OpenAI chat source-to-transport preparation: 350–700 LoC

Files: `OpenAIProvider.ts`, `OpenAIRequestPreparation.ts`, chat conversion/transport and media helpers.

Tests: chat BODY capture, tool pairs, reasoning/cache/provider overrides, retry and early-return cleanup. Done: raw body streaming or the documented SDK body exception, with no extra neutral-history graph and unchanged transport fields/bytes.

### WP09. Gemini transport-owned SDK contents: 300–650 LoC

Files: `plugins/google-gemini/src/gemini/GeminiProvider.ts` and its generation setup/media/count helpers.

Tests: existing Gemini SDK BODY, GenAI/Vertex signature, AFC/tool/media and lease tests. Done: journal rows reach the plugin unchanged; SDK-only contents are released after call/abort. Include plugin tests explicitly because root workspaces do not include this plugin.

### WP10. Vercel transport-owned SDK messages: 250–550 LoC

Files: `packages/providers/src/openai-vercel/OpenAIVercelProvider.ts` and existing conversion/media helpers.

Tests: real converter/body capture, SDK tools/media, finish/usage and request-scoped lease cases. Done: only the SDK-required messages live request-scoped, with no upstream collector.

### WP11. Execute source density/compression stages: 450–850 LoC

Files: `provider-source-enforcement.ts`, `CompressionHandler.ts`, existing disk density/compression attempt runners and source preparation/recomposition helpers.

Connect initial assessment to density, configured compression and ineffective-compression retry. Publish disk candidates durably, rebuild the pending-aware curated selection and discard stale estimates. Use the existing strategies' disk implementations.

Tests: `source-compression-required.test.ts`, compression-attempt/value-lifetime and strategy suites. Done: the existing required-compression test succeeds through actual HTTP, including its large valid row; no missing-array-contract error, pending loss or token-policy change.

### WP12. Complete source hard-limit/callback escalation: 450–850 LoC

Files: `providerContentEnforcement.ts`, `pendingContextWindowEnforcement.ts`, `provider-source-enforcement.ts`, `CompressionHandler.ts`, provider/core compression callback contracts and source send seam.

Connect fallback and tool-response truncation after compression, using existing disk candidates/ranking. Migrate provider-triggered replacement callbacks. Preserve rollback, anchor/baseline and stateful-chain behavior, and return structured overflow only after the established ladder is exhausted.

Tests: source compression ladder, provider-hardlimit/pending-window/fallback propagation and BODY matrices; projection and compensation faults. Done: source and legacy reference choose the same ordered stages and resulting request bytes; no array recomposition.

### WP13. Preserve enabled model/tool hooks: 400–800 LoC

Files: `beforeModelHookFire.ts`, `source-before-model-hook.ts`, `source-tool-selection-hook.ts`, `StreamProcessor.ts`, the other turn hook seam, core hook snapshot request/aggregation modules.

Use snapshot adapters where their contract suffices and a scoped full-request hook adapter where it does not. Preserve all currently supported edits and decisions. Replace AfterModel rejection with selected-source input and chunk behavior; remove flag-dependent tool selection.

Tests: existing hook legacy/source/pending differential tests, explicit empty replacement, model/settings edits, multiple hooks, stop/block/modify, tool restrictions, hook failure/abort and output cleanup. Done: feature-enabled calls work and no-hook calls allocate no hook context snapshot.

### WP14. Wire streaming logs and telemetry: 350–700 LoC

Files: `streamprocessor-disk-source.ts`, `turnLogging.ts`, `tokenUsageEstimateLogger.ts`, `tokenUsageRequestShape.ts`, provider logging policy/wrapper/artifact exporters.

Use already implemented request readers/artifacts and source shape counters. Preserve enabled flags, redaction, media sanitation and request/response attribution. Remove agent source logging guards only after these routes work. Bound or disk-back context-wide attribution details; do not retain them as logger turn state.

Tests: source logging/preflight/post-send/telemetry suites, redaction and artifact-release tests, disabled-path no-work, failed export and cancellation. Done: conversation logging, prompt/body telemetry and token usage logging coexist with source sends, without an agent full-context string/graph.

### WP15. Remove retry/load-balancer collectors: 450–850 LoC

Files: `LoadBalancingProvider.ts`, `loadBalancing/preparedPromptOptions.ts`, projection/guard/failover helpers, `RetryOrchestrator.ts`, `utils/requestRowsLease.ts`, `LoggingProviderWrapper.ts`.

Reuse pinned source readers across attempts and migrate array compression/cloning. Preserve selected-provider tokenizer/rendered prompt, failover eligibility, circuit/TPM behavior and per-attempt IDs. Release abandoned source projections and all readers; keep SDK bodies confined to delegates.

Tests: existing LB prompt-envelope/guard/failover/retry/accounting suites with cold journal inputs, BODY retry equality and cancellation before/after first chunk. Done: every strategy operates without `collectContents` in the wrapper path and preserves chosen-model estimates/bytes.

### WP16. Make both product send seams source-default: 350–650 LoC

Files: `streamprocessor-request.ts`, `StreamProcessor.ts`, `TurnProcessor.ts`, `turnMediaRequest.ts`, `streamRequestHelpers.ts`, `promptEnvelopeSendSeam.ts`, `chatSession.ts`, affected send tests.

Route stream and non-stream turns through the common source-owned pipeline. Delete `requestHistorySource`, `arrayRequest`, array-only whole-request preparation and obsolete internal eager overloads. Do not keep a fallback flag. Preserve live-turn streaming, finalization and child runtime behavior.

Tests: normal unflagged CLI/agent sends against all five provider families, enabled feature combinations, pending tools/media/semantic purge, retry and consumer return. Keep independent BODY tests for both seams. Done: test fixtures do not need the opt-in flag, and product/default calls never reach an agent whole-history collector.

### WP17. Finish bounded resume/discovery edges: 250–550 LoC

Files: `SessionDiscovery.ts`, session-browser/ACP listing helpers, `restoreResumeBoot.ts`, deferred source/factory/token/media startup helpers only if existing tests expose a failure.

Stream first-user title extraction and retain only the capped title. Preserve discovery summaries, child filtering and lock selection. Diagnose the complete 8192-row deferred-startup test on the current tree; fix the actual scan/accounting/adoption bottleneck without loosening its deadline. Preserve journal reuse and streaming authentication transfer.

Tests: existing discovery/title tests, `restore-deferred-source.test.ts`, latest/index/name/UUID/checkpoint continuation and damaged/empty/locked journal cases. Done: complete continue/startup and checkpoint routes stay streamed and pass their behavioral tests; older stage inventories are not used as expected failures.

### WP18. Stream portable session import/export: 450–850 LoC

Files: `session-media-package.ts`, validation/import/state/writer modules, `continuePackageActions.ts` and the actual resume action consumer.

Replace `recordingBytes`, `histories` and serialized state collections with pinned paths/readers and staged outputs. Verify content/media incrementally; use a disk reference/reservation index where counts grow with rows. Preserve external validation limits, package format, blob hashes, atomic rename, rollback and reservation cleanup. Do not persist UI state or a second session transcript.

Tests: existing package/bounds tests, complete `/continue import` followed by send, malformed/changing package, missing blobs, cancellation/publication failure and independent bytes/digests. Done: package continuation never materializes the complete recording/session; export also avoids retaining it for a later import.

### WP19. Consolidate proof/cleanup and close verification: 450–900 LoC

Files: existing structural/ownership/BODY tests and test support, one repeated-turn retained-growth test plus worker under test-only support, obsolete harness paths listed below, and only product files implicated by remaining gate failures.

Move reusable support out of production source. Replace overlapping forensic/statistical measurement runners with one acceptance workload, retaining behavioral regressions and independent byte oracles. Run many real unflagged agent turns with scheduled compression using a deterministic local transport, keeping the facade/runtime/pager alive at checkpoints. Drop test-owned arrays and completed iterator roots before measuring settled retained heap. Compare an established warmed baseline against later checkpoints with the unchanged 1 MiB allowance. The deliberately retaining mode must exceed that same allowance and make the same acceptance predicate fail. Use lifecycle/WeakRef observations as supporting evidence, not substitutes for retained heap. No process restarts between the compared checkpoints and no selection of only favorable measurements.

Done: R1/R2 structural and lifecycle coverage, R3 many-turn proof with failing trap, R4 unchanged independent BODY matrices, R5 complete-route tests, and all R6 commands pass. Fix actual residual lint/test/build failures, splitting oversized functions/files; do not weaken enforcement or claim older baseline failures exempt the branch from R6.

## 4. Cleanup and test conversion

### Move test support out of shipped source

Move these modules with their consuming tests into package `__tests__/support/` or existing test-utils support. Update imports/worker URLs and preserve test discovery/typechecking. A move is not permission to exclude a failing test.

- Agents `src/core/`: `source-post-send-durable-fixture.ts`, `source-strict-logger-fixture.ts`, `source-telemetry-correlated-fixture.ts`, `source-preflight-fixture.ts`, `source-pre-send-strict-fixture.ts`, `source-compression-ladder-fixture.ts`, `streamprocessor-source-fixture.ts`, `streamprocessor-tool-hook-fixture.ts`, `streamprocessor-model-hook-fixture.ts`, `token-usage-source-fixture.ts`, `telemetry-stream-fixture.ts` and `prompt-envelope-source-test-helpers.ts`.
- Agents worker modules: `streamprocessor-logging-worker.ts`, `streamprocessor-model-hook-worker.ts`, `streamprocessor-tool-hook-worker.ts`, `source-hook-pending-worker.ts`, `telemetry-stream-memory-worker.ts`. These are test entry points, not product services.
- Providers `src/openai-responses/`: `projection-ownership-fixture.ts`, `projection-workspace-fixture.ts` and similar fixture-only helpers. Avoid exporting fixtures to repair production declarations.
- CLI `src/services/`: `wholememory-child.ts`, `wholememory-command.ts`, `wholememory-fixture.ts`, `wholememory-probe.ts`, with their consumers when still needed. Neither the telemetry/probe observer nor workload orchestrator belongs in release output.
- CLI `src/ui/commands/dumpcontext-command-fixtures.ts` and MCP OAuth fixtures identified by the dist guards. Trace the production import and remove it; do not strip artifacts after compiling them.

### Remove obsolete measurement architecture after replacement coverage exists

- Retire `packages/agents/src/core/streamprocessor-source-measurements.ts` and the heap-snapshot-only portions of `streamprocessor-retained-census.ts`, `streamprocessor-retained-run.ts`, `streamprocessor-retained-setup.ts`, `streamprocessor-retained-logging.ts` and `streamprocessor-retained-body.ts`. Keep the source/HTTP retry, large-row, abort, log, hook and body assertions in focused tests; move any still-used worker/support code first.
- Replace the six-pair-per-target orchestration in CLI `wholememory.test.ts:245–324` and forensic target/probe/media-peak orchestration with the direct R3 test. Preserve genuine resume/pager/media lifecycle behavior from these tests before deleting wrappers.
- Consolidate #854 child workload helpers under `scripts/tests/`: `comprehensive-memory-child.ts`, `client-array-memory-child.ts`, `conversation-array-memory-child.ts`, `retained-array-memory-child.ts`, `chronology-rollback-memory-child.ts`, `detached-rollback-memory-child.ts`, `history-clone-trace-memory-child.ts`, `childaccept-memory-child.ts`, `provider-binding-bridge-memory-child.ts`, `row-transform-memory-child.ts`, `semantic-purge-memory-child.ts`, `recording-failure-memory-child.ts`, `synchronous-ticket-memory-child.ts`, `token-accounting-memory-child.ts` and `history-suffix-memory-child.ts`. Retain a helper only if a surviving behavioral/ownership test needs it. Keep that coverage in test support; remove duplicated evidence-generation and heap-dump protocols.
- Keep unrelated product memory/lifecycle regressions, including earlier media and Ink/tmux issue tests. This plan is not a repository-wide test deletion exercise.
- Move `HistoryJournalStore.materialize`/eager fold to the independent test oracle if still required by tests; remove unused product helpers. Do not derive expected provider bytes from the new product fold.
- Delete unused `packages/cli/src/ui/print/staticPrintLedger.tsx` and its implementation-only tests if the final production reference census remains empty. Preserve actual StandardStatic print-once/remount tests. Do not wire this extra ledger into production as part of finishing #854.
- Keep old plan/stage documents as provenance. Stop treating their exhaustive manifests, saved heaps, source hashes and forensic receipts as ship requirements. No new multi-hundred-slot protocol or forensic artifact preservation gate.

### Convert persisted-row identity assertions, not value behavior

- `packages/core/src/services/history/chronology-rollback-identity.test.ts:44–67` requires all original marker identities to remain alive/restored after overwrite and GC. This explicitly rewards the context-sized strong ledger that R1 rejects. Replace its product expectation with journal value restoration, chronology/counter/order/durability and release; keep the deliberate-retention mechanism as a trap where useful. Retire `scripts/tests/chronology-rollback-identity-child.ts` if that is its sole remaining purpose.
- Review `chronology-rollback-snapshot.test.ts`, `history-removals-marker-rollback.test.ts`, `frozen-batch-rollback.test.ts` and `transformall-identity-owners.test.ts:128–160`. Change only identity promises across released/disk-round-tripped rows. Keep exact primary error identity, callback ordering, frozen-input failure, compensation diagnostics and bounded live caller-row identity where applicable. The latter is not whole-session row identity.
- Convert remaining `toBe(originalRow)`/marker reference assertions in restore/deferred/transform tests to independent value/order/chronology/durability assertions when rows have left memory. Do not blindly replace all `toBe` assertions; primitive and error reference checks serve different contracts.
- Keep pending-window/tool-pair, retained-owner/trap and byte-equivalence tests meaningful. Replace obsolete per-row aggregate peak requirements only where they contradict the explicit valid-10-MiB-row allowance; do not weaken genuine retention thresholds or hide growth.

## 5. End-state verification commands

These commands are the finish verification, not commands executed for this plan. Run from the repository root. Keep logs under a unique workspace directory such as `tmp/resume854/finish/`, never a shared bare `/tmp` name. Use managed background jobs for long lanes on this workstation. Do not run concurrent heap workloads against one another.

Focused commands during implementation, using actual single files and their existing runner setup:

```sh
bun test ./packages/core/src/services/history/structuralAudit.bun.test.ts
bun test ./packages/providers/src/__tests__/providerBodyEquivalence.p05b4.test.ts
bun test ./packages/providers/src/__tests__/providerBodyRequestScope.p05b4.test.ts
bun test ./packages/providers/src/__tests__/providerBodyLeases.p05b4.test.ts
bun test ./packages/providers/src/__tests__/providerBodyBackpressure.p05b4.test.ts
bun test ./packages/agents/src/core/source-compression-required.test.ts
bun test ./packages/cli/src/services/restore-deferred-source.test.ts
```

Add the new repeated-turn test as `packages/agents/src/core/__tests__/journal-retained-growth.test.ts` and run it in ordinary and deliberate-retention modes. Its worker belongs in `__tests__/support/`. The trap must produce the expected failed acceptance result; a wrapper that merely prints a negative-control label does not prove it.

Final branch gates:

```sh
npm run typecheck
npm run lint
npm run test
npm run test:scripts
npm run build
npm --prefix plugins/google-gemini test
bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"
```

The Gemini plugin's own `test` script is `bun test` (`plugins/google-gemini/package.json:34–38`). `npm run test` only covers root workspaces, so the explicit plugin command covers its migrated transport. Include new test support in the existing Bun test typecheck/discovery contracts, not a disconnected custom test lane.

The smoke must boot, load `lunahigh`, send through the default source path and emit only the requested haiku. Report actual command results, the independent BODY matrix, normal/trap retained-growth outcomes and any remaining failures. Completion means all R1–R6 hold on this tree, not that a selected stage or source-only harness passed. Merging still requires Andrew's explicit instruction.

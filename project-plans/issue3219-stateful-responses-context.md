# Plan: Issue #3219 Stateful Responses Context Enforcement

Plan ID: PLAN-20260825-STATEFUL-RESPONSES-CONTEXT
Generated: 2026-08-25
Issue: https://github.com/vybestack/llxprt-code/issues/3219

## Accepted behavior

### AC-1: Effective provider context is distinct from transport size

**Given** an OpenAI Responses request with an eligible `previous_response_id`, provider-observed prompt and completion usage on the selected parent, and a small post-parent delta,
**when** the provider projects the finalized request,
**then** the projection and estimate distinguish:

- tokens in the serialized request sent over transport;
- whether the request uses a stateful parent;
- the retained provider-context baseline;
- the estimated effective provider context used for context-window decisions.

The retained baseline conservatively includes the selected parent's observed prompt and completion usage. The new model-visible contribution includes the current instructions, tools, and post-parent input. Cached tokens remain part of context occupancy. They are not subtracted. Prior noncarried request configuration may therefore be conservatively overcounted, but selected-parent output and current configuration are not omitted.

**Boundaries:**

- Stateless and full-history requests have no retained baseline and use the full serialized projection as their effective context. History must not be counted twice.
- Statefulness configured without an eligible parent remains a full-history request.
- `store: false`, cross-endpoint parents, rejected parents, unsupported stateful transports, and a parent with no post-parent content retain their current full-history behavior.
- If a provider parent lacks usable observed prompt or completion usage, estimation must still use the complete locally model-visible history rather than the transport delta alone.
- The selected parent's completion contributes to retained input. The new request's completion budget remains separate and is counted once by enforcement.

### AC-2: Stateful transport remains a delta optimization

**Given** an eligible stateful parent,
**when** the projected envelope is transported,
**then** the wire request keeps `previous_response_id` and only post-parent input. It does not send the full local history beside the parent ID.

Non-Codex stateful behavior continues to use `store: true`. Codex WebSocket statefulness continues to use its existing storage semantics. Projection must not resolve transport authentication or replace the prepared transport body.

### AC-3: Send-time enforcement uses effective context

**Given** a retained baseline near the configured input capacity and a small transport delta,
**when** send-time provider-content enforcement runs,
**then** compression starts when the effective provider context crosses the configured compression threshold, even though the transport delta is below it.

The recomposed candidate is projected again before transport. If compression and the existing bounded truncation paths cannot fit the effective context, the existing structured local context-overflow error and metadata are preserved.

### AC-4: History rewrites invalidate stale Responses lineage

**Given** local history with stored Responses parent metadata,
**when** compression, density mutation, provider-enforcement fallback rebuilding, pending-context fallback rebuilding, or successful history tool-response replacement rewrites retained history,
**then** every retained AI entry loses `metadata.responsesStored` before the next projection and send. Existing response IDs and unrelated metadata remain.

The next request sends the recomposed full history without a stale `previous_response_id`. A later successful stored response may establish a fresh parent so subsequent requests return to delta transport.

**Boundaries:**

- Existing primary compression and density paths remain unchanged where they already invalidate lineage.
- Failed, rolled-back, or structural no-op rewrites preserve the original valid lineage.
- Pending-only edits that affect only unsent post-parent content do not invalidate an older retained parent.
- Generic history import, resume, `clear`, `add`, and `addAll` behavior is not changed.

### AC-5: Provider-declared SSE input failures are terminal transport outcomes

**Given** HTTP 200 with an OpenAI Responses SSE `response.failed`, failed terminal response, or top-level `error` event that declares a context-window or input-validation failure,
**when** the stream parser surfaces the error,
**then** the error preserves provider `type`, `code`, `param`, message, and applicable status/classification. The provider transport does not retry the unchanged request.

A context-window error reaches the existing structured context-size recovery path. A generic input-validation error remains terminal and actionable. HTTP and SSE forms of the same provider-declared input failure have equivalent retryability.

**Boundaries:**

- Genuine premature EOF, disconnect, malformed partial streaming data, and other transport interruption behavior remains `STREAM_INTERRUPTED` and retryable.
- Retryable provider failures such as server errors and rate limits keep their existing retry behavior.
- Existing no-replay behavior after visible text, thinking, or tool output remains unchanged.

### AC-6: Telemetry exposes transport and effective context

**Given** a finalized OpenAI Responses estimate,
**when** send-seam token telemetry records the request,
**then** the record reports transmitted-envelope tokens, retained-context tokens, effective provider-context tokens, and whether a stateful parent was used. Existing estimated-token fields remain compatible and represent the authoritative effective count used by enforcement.

For stateless requests, transmitted and effective counts are equal and the retained baseline is zero. For stateful requests, telemetry shows the divergence. Provider-reported cached tokens remain separately observable but do not reduce effective context.

### AC-7: Foreground and isolated subagents share the behavior

Both runtimes use the same provider projection, send-time enforcement, history rewrite, retry, and telemetry paths. No subagent-specific history seeding or agent-memory change is accepted. A separate initialization change is excluded unless a failing behavioral test proves the shared path does not apply.

## Behavioral evidence plan

Tests must use Bun and real production components at the behavior seam. Network transport may be stubbed. Tests must not mock the component under test or assert only mock calls.

1. Extend `packages/providers/src/openai-responses/__tests__/OpenAIResponsesPromptEnvelopeProjection.test.ts`.
   - Stateful parent with large observed baseline and small delta reports distinct transmitted, retained, and effective counts.
   - Cached parent usage does not lower effective context.
   - Prepared transport still sends only the delta with `previous_response_id`.
   - Stateless/full-history controls do not double count.
   - Missing parent usage still projects complete local model-visible history.
2. Extend the existing provider-content enforcement characterization or hard-limit test that drives the real enforcer.
   - Effective stateful context above threshold triggers compression when delta alone would fit.
   - Ineffective recovery preserves the structured overflow result and metadata.
3. Extend `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.codex.stateful.remediation.test.ts` where needed.
   - Rewritten history sends full recomposed history without the stale parent.
   - A successful response establishes a fresh parent for a later delta.
4. Extend existing fallback and history replacement suites.
   - `packages/agents/src/compression/__tests__/compression-provider-fallback-propagation.test.ts`
   - `packages/agents/src/compression/__tests__/compression-retry-hardlimit.test.ts`
   - `packages/core/src/services/history/HistoryService.replaceToolResponseBlock.test.ts`
   - Successful retained-history rewrites remove `responsesStored`; failed/no-op controls preserve the prior state.
5. Extend `packages/providers/src/openai/parseResponsesStream.test.ts` and `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.retryClassification.test.ts`.
   - In-band context-window failure is attempted once and preserves provider metadata.
   - Top-level input-validation event preserves type, code, param, and message and is terminal.
   - Equivalent HTTP and SSE input failures have the same retryability.
   - Genuine incomplete/disconnected streams remain retryable.
6. Extend existing token usage contract/logger tests with real projection-derived values.
   - Stateful records expose transmitted and effective counts.
   - Stateless records expose equal counts.
   - Avoid literal-in/literal-out telemetry tests that only repeat fixture values.
7. Use existing subagent isolation tests plus a provider-backed shared-path assertion only if needed. Do not add subagent-specific production behavior without a RED test.

## Implementation phases

### Phase 0.5: Preflight verification

- Confirm the prepared transport-token cache can retain the delta request while estimation uses effective-context data.
- Confirm the prompt projection and estimate contracts can carry the four accounting facts without changing unrelated providers' behavior.
- Confirm parent `metadata.usage.promptTokens` and `metadata.usage.completionTokens` are populated from Responses usage and identify the selected parent at request construction.
- Confirm token telemetry schema compatibility for optional additive fields.
- Confirm existing lineage invalidation utility and the exact rewrite gaps.
- Confirm existing HTTP structured error shape and retry classification to reuse for SSE parity.

### Phase 1: Projection and effective-context accounting, test first

- Write failing provider projection and transport tests.
- Extend the projection/estimate contract with the minimum internal data needed for AC-1.
- Populate stateful baseline and transport semantics from the selected eligible parent.
- Preserve the prepared transport request under the existing opaque transport token.
- Make the authoritative estimated prompt count equal effective provider context.

### Phase 2: Enforcement and telemetry, test first

- Write failing provider-enforcement threshold tests using the effective estimate.
- Keep enforcement on the authoritative effective count and retain completion-budget behavior.
- Add optional telemetry fields for transmitted, retained, effective, and stateful-parent facts.
- Preserve existing serialized record compatibility.

### Phase 3: Rewrite invalidation, test first

- Write failing behavior tests for each confirmed rewrite gap.
- Reuse `invalidateResponsesStatefulChain` only after successful retained-history rewrites.
- Prove stale parent omission, full-history recomposition, and fresh-chain re-establishment.

### Phase 4: SSE terminal classification, test first

- Write failing parser and real-executor retry tests.
- Reuse the existing structured provider error conventions so SSE input/context failures match HTTP retryability.
- Keep transport interruptions and retryable provider failures unchanged.

### Phase 5: Verification and review

Run the complete local gate:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Also run `bun scripts/test-audit/scan.ts` and compare touched-test findings against main. Then run implementation review and no more than two local Open Code Review rounds. Classify every finding as `Blocker-Fix`, `In-scope-Fix`, `Reject`, or `Defer`.

## Scope exclusions

- No dependency, workflow, quality-rule, profile, settings, or `.llxprt` changes.
- No new request-builder subsystem, retry framework, provider wrapper, or public API unrelated to prompt projection.
- No changes to stateful parent selection or transport semantics except data needed to account for the already-selected parent.
- No broad retry cleanup or speculative provider error aliases without fixture evidence.
- No subagent history initialization or agent-memory change without a failing behavioral parity test.
- No unrelated refactor or test migration.

## Approved verification-blocker fix

Repeated exact full-suite runs exposed a deterministic Bun/macOS process-discovery hang before `HistoryService` construction. The asynchronous `exec` wrapper could remain pending after `ps` had exited, which made unrelated agent API tests exhaust their fixed timeouts. The user approved fixing this blocker rather than treating it as an external failure.

The Unix process lookup now invokes `ps` synchronously with an argument array. A behavioral regression test supplies a permanently pending asynchronous child completion and proves IDE discovery still settles with the expected ancestor. The focused test passes 16/16. The exact full repository suite then passed with exit code 0, followed by green lint, typecheck, format, and build gates. The required Stepfun smoke reached the external provider but returned HTTP 400 because the account has no active Step plan subscription.

The final test-audit scan completed without scanner errors. It introduced no findings in the process-discovery regression test or other new tests; the diff contains only shifted line numbers for findings that already existed on main.

## Final local OCR triage

The second and final local OCR produced eleven hypotheses. Each was checked against the current source, tests, provider contract, and accepted behavior:

1. Repeated token-usage accounting propagation: `Follow-up`. It repeats the first-round maintainability finding and does not change behavior.
2. Duplicate candidate-history commit sequence: `Follow-up`. Extracting a shared subsystem is outside this issue.
3. Successful fallback bookkeeping before an asynchronous candidate commit: `In-scope-Fix`. Failing tests showed pending and provider commit rejection could publish success state. The callback contract now awaits the commit before updating bookkeeping.
4. Whole-history rollback could discard an addition made during tool-response replacement: `Blocker-Fix`. Failing race tests reproduced the loss. The replacement now uses the existing history mutation queue, without changing the compression queue tracked by issue #3264.
5. Prompt-estimation runtime guards after validation: `Not-applicable`. The checks enforce runtime invariants without prohibited narrowing assertions.
6. Estimator identity on effective counts that include provider-observed usage: `Follow-up`. This is a telemetry-contract documentation question, not an accepted behavior defect.
7. An undefined incremental request: `Not-applicable`. The internal producer contract requires the field and every production caller supplies it.
8. Supplying both retained baseline and full-history accounting: `Follow-up`. Current internal producers emit mutually exclusive forms. Rejecting hypothetical third-party combinations is optional contract hardening.
9. A provider-observed zero prompt-token baseline: `Not-applicable`. The usage contract accepts finite nonnegative values. Treating zero as invalid lacks provider evidence.
10. Terminal handling for `invalid_request_error`: `Not-applicable`. AC-5 requires terminal SSE input-validation handling and HTTP/SSE retryability parity.
11. Top-level SSE event type `error`: `Not-applicable`. OpenAI documents `ResponseErrorEvent.type` as always `error`, and AC-5 requires preserving provider fields.

No third local OCR will be run. The two accepted findings were remediated test-first, and the remaining items do not authorize issue-scope expansion.

## PR review triage

The first PR review run and CodeRabbit produced fourteen positioned threads plus summary-only hypotheses. Each was checked against current source and focused behavior:

1. `PRRT_kwDOPB5qbc6cXV8i`: `Reject`. The provider test passes strict typechecking. Its call-options helper contextually types the content fixture, and finalized estimation always returns validated transmitted tokens.
2. `PRRT_kwDOPB5qbc6cXV8m`: `Blocker-Fix`. Parent prompt usage alone omitted the selected parent's output and current noncarried request configuration. The retained estimate now uses validated parent prompt plus completion usage, does not subtract cached tokens, and adds the current model-visible wire prompt. Missing or invalid usage still uses full local-history accounting. Transport remains parent ID plus delta.
3. `PRRT_kwDOPB5qbc6cX8lh` and `PRRT_kwDOPB5qbc6cX8n_`: `Blocker-Fix`, one root cause. A fallback could install candidate history and then reject during post-installation bookkeeping. The fallback now snapshots history, cache anchor, and prompt baseline, restores them on post-installation failure, and reports rollback failure rather than hiding it.
4. `PRRT_kwDOPB5qbc6cX8pv`, `PRRT_kwDOPB5qbc6cX8rV`, and `PRRT_kwDOPB5qbc6cX8s5`: `Reject`, one root cause. The findings conflated finalized wire, incremental, retained, and effective estimates. Focused contract tests confirm the configured estimators and current values.
5. `PRRT_kwDOPB5qbc6cX8uz`: `Reject`. Send-time enforcement intentionally uses effective provider context. Using transmitted tokens would recreate the small-delta overflow defect.
6. `PRRT_kwDOPB5qbc6cX8w2`: `Reject`. The compatibility estimate remains the authoritative effective count; transmitted, retained, and effective values are also recorded separately.
7. `PRRT_kwDOPB5qbc6cX8ym`: `Reject`. A marker before the rewrite boundary identifies a valid parent that predates a post-parent-only edit. A marker at or after the rewrite causes full-chain invalidation, including earlier markers.
8. `PRRT_kwDOPB5qbc6cX81O`: `Reject`. The throwing listener belongs to a fresh per-test `HistoryService` instance that is not shared or retained.
9. `PRRT_kwDOPB5qbc6cX83Q`: `Reject`. `replaceAllInternal` does not change `baseTokenOffset`; rollback restores history and total tokens while the unchanged offset remains included.
10. `PRRT_kwDOPB5qbc6cX849`: `Reject`. Runtime-context creation registers no listener on the per-test `SettingsService`, and cleanup removes the active reference.
11. `PRRT_kwDOPB5qbc6cX86u`: `Reject`. `node:util.isDeepStrictEqual` is cycle-aware; a Bun runtime probe with self-referential values completed without throwing.
12. Summary-only zero-baseline, duplicate validation-guard, and private terminal-error status findings: `Reject`. Zero is accepted through explicit undefined checks, local guards provide strict narrowing after a void validator, and the terminal-error helper type is module-private.
13. Changed-file coverage metadata: `Defer`. This was review-run metadata rather than a source finding. Changing broad coverage or quality tooling is outside this issue.

Accepted PR findings were reproduced with failing behavioral tests before remediation. No additional local OCR round was started.

The final remediation cycle passed the exact full repository suite, lint, typecheck, format, and build. The required Stepfun smoke reached the provider and returned HTTP 400, `you have no active step plan subscription`, from the external account. Test-audit scanned 2,707 files on current main and the candidate with no scanner errors; normalized findings were identical after excluding shifted line numbers.

## Completion gate

Completion requires behavioral evidence for every accepted criterion, the full local verification cycle on the candidate head, review findings triaged and accepted fixes resolved, no more than two local and two PR OCR rounds, green CI on the candidate head, resolved CodeRabbit threads, correct ancestry, and a conflict-free PR. Optional cleanup stops when these gates pass.

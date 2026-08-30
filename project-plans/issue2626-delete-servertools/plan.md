# Plan: Delete the dead serverTools machinery and its Gemini special-cases

Plan ID: PLAN-20260826-SERVERTOOLS-DELETE

Tracking issue: https://github.com/vybestack/llxprt-code/issues/2626 (part of #2614)

Generated: 2026-08-26

## Objective

Remove the entire `serverTools` concept from the codebase: interface methods
(`getServerTools`/`invokeServerTool`), manager tracking
(`getServerToolsProvider`/`setServerToolsProvider`), runtime contracts,
wrapper passthroughs, host/CLI wiring, the Gemini implementation, the
generation-config `serverTools` channel, the three `name === 'gemini'` setConfig
pokes, and the `supportsTools` capability field. Retire the three behavioral
Gemini special-cases with explicit uniform semantics. Client-side web tools
(`ExaWebSearchTool`, `DirectWebFetchTool`) are unaffected.

The issue text is the authoritative work plan (Steps 1-6). This document adds
acceptance criteria, verification, and division of labor. Line numbers in the
issue have drifted slightly on current main; grep anchors below are current.

## Acceptance criteria

### A1 — No serverTools concept in production code

- GIVEN the branch, WHEN running
  `grep -rnE "invokeServerTool|getServerTools\b|ServerToolsProvider|serverToolLogger|ServerToolContext|resolveServerTools" packages/*/src --include='*.ts' --include='*.tsx'`
  THEN it returns nothing.
- Expected survivors deliberately NOT matched (leave untouched): MCP
  `serverToolName` fields; the legacy core-turn `ServerTool`/`ServerToolCall*Event`
  family in `core/src/core/turn.ts`, `agents/src/core/turn.ts`, `eventAdapter.ts`.
- Members deleted from: `IProvider`, `IProviderManager`, `RuntimeProvider`,
  `RuntimeProviderManager`, and ALL implementors (GeminiProvider, BaseProvider,
  OpenAIProvider, AnthropicProvider, OpenAIResponsesProviderBase,
  OpenAIVercelProvider, LoadBalancingProvider, FakeProvider,
  CompressionLoadBalancingProvider, LoggingProviderWrapper, RetryOrchestrator).
- `geminiServerTools.ts` and `logging/serverToolLogger.ts` (+ its test) deleted.
- Generation-config channel deleted: `resolveServerTools` in
  `geminiRequestBuilding.ts`, the `serverTools` branch in
  `DirectMessageProcessor._extractDirectGeminiOverrides`, the `serverTools: []`
  cast in `autoPromptGenerator.ts`.
- Hard rule: REMOVE, don't shim. No deprecated no-op stubs.

### A2 — Uniform shell-output summarization

- GIVEN the user setting `summarizeToolOutput` is enabled, WHEN the shell tool
  host summarizes oversized output, THEN summarization is attempted regardless
  of the active provider and regardless of whether a provider manager is
  configured. The gemini gate and the `providerManager === undefined` guard in
  `CoreShellToolHostAdapter.trySummarizeOutput` are both deleted.
- Behavioral test pins "setting on → summarization attempted" with a non-gemini
  provider and with no provider manager.

### A3 — Uniform provider-switch settings wipe

- GIVEN a session sets a provider-scoped setting (e.g. `/key` or base-url) on
  gemini, WHEN switching to another provider, THEN gemini's provider-scoped
  settings are wiped exactly like every other provider's. The
  `serverToolsProvider` early-return in `providerSwitch.clearPreviousProviderSettings`
  is deleted; the `@plan:PLAN-20260603-ISSUE1584.P14` annotation is updated.
- Switch tests updated to cover gemini like other providers.

### A4 — Uniform auth-cache behavior on switch

- GIVEN gemini is active with resolved auth, WHEN switching to another provider
  and back to gemini, THEN gemini's in-memory auth cache is cleared on
  switch-away (the `setActiveProvider` exemption is deleted) and auth is
  re-resolved from the persisted token store on return; generation succeeds.
- The auto-adoption block in `setActiveProvider` (`name === 'gemini'` → adopt
  as serverToolsProvider) is deleted, as is the `updateProviderWrapping`
  re-wrap sync of the tracking field.
- Regression test: gemini → other → gemini re-resolves auth and generates.

### A5 — The three gemini setConfig pokes are gone

- `grep -rn "'gemini'" packages/agents/src/api/providerActivationExecutor.ts packages/cli/src/validateNonInteractiveAuth.ts`
  returns nothing. `cliProviderInit.ts` no longer has
  `configureServerToolsProvider`.
- In `providerActivationExecutor.ts`, `ensureProviderManagerOnConfig` reduces to
  the live `configureProviderRuntimeFactories(config, manager)` call (comments
  updated). In `validateNonInteractiveAuth.ts` the poke, the now-unused
  `providerManager` local, and the header mention die. In `cliProviderInit.ts`
  the function, its call, and its doc comment die.
- Regression test: gemini activation via `executeProviderOrOauth` generates
  successfully with no poke.

### A6 — `supportsTools` deleted everywhere

- Removed from: capability capture (`providerCapabilitiesService.ts`),
  compatibility scoring (denominator drops from 4 checks to 3),
  `providers/src/types.ts`, telemetry `provider-context.ts` (ProviderCapabilities),
  `conversation-events.ts` (createDefaultContext). Tests updated.

### A7 — Redactor case fixed

- `ConversationDataRedactor` replaces the dead `case 'web_search':` /
  `case 'fetch_url':` pair with `case 'direct_web_fetch':` (client tool with a
  `url` param). `exa_web_search` redaction is out of scope (separate concern).

### A8 — Host/runtime/CLI wiring deleted

- `IToolHost`: `getServerToolsProvider?()` AND `hasProviderManager?()` deleted.
- `CoreToolHostAdapter`: plumbing for both deleted.
- `cliUiRuntime.ts`: the `UiContentGeneratorConfig.providerManager.getServerToolsProvider`
  slot deleted.
- Test-utils (`agents/src/test-utils/runtimeProviderManager.ts`,
  `core/src/test-utils/runtime.ts`) no longer implement the deleted accessors.

### A9 — Client-side web tools unaffected

- `toolRegistryFactory` registration of `ExaWebSearchTool`/`DirectWebFetchTool`
  untouched. Smoke test confirms generation works.

## Out of scope (non-goals)

- Removing or changing `ExaWebSearchTool`/`DirectWebFetchTool`.
- Designing a future provider-hosted search capability.
- The summarizer's model-selection defect (subissue E of #2614 owns it).
- `exa_web_search` query redaction (separate concern).
- MCP "server tools" phrasing in docs (unrelated concept).

## Implementation phases

The issue's Steps 1-5 are implemented in three commits:

1. **Commit 1** — production deletion + behavioral changes + the new behavioral
   tests + direct-surface test rewrites. Everything under Steps 1-4 plus Step 5
   items 1 and 3.
2. **Commit 2** — mechanical test cleanup (Step 5 item 2: ~110 test files whose
   IProvider mocks carry `invokeServerTool`/`getServerTools`).
3. **Commit 3** — docs/plan-annotation touch-ups if anything remains.

## Verification

Full verification cycle per the issue-workflow skill:

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Plus the two greps from the issue's Step 6 (A1 and A5 above) and behavioral
test evidence for A2-A4.

## Review policy

- deepthinker reviews for compliance and issue intent (max 2 rounds).
- OCR: max 2 local + 2 PR rounds.
- Findings classified Blocker-Fix / In-scope-Fix / Reject / Defer.

## Implementation log (2026-08-26)

### Behavioral test coverage map

- **A2 (uniform summarization)** — three new tests in
  `packages/core/src/tools-adapters/CoreShellToolHostAdapter.test.ts`
  (`describe('CoreShellToolHostAdapter.trySummarizeOutput (issue #2626: uniform summarization))'`):
  oversized output summarized with (1) no provider manager configured,
  (2) a non-gemini active provider, (3) short content returned unchanged with
  no summarization call. Tests (1) and (2) fail against the old gate by
  construction (the old code returned the content unsummarized in both
  scenarios). The summarizing agent client is produced by the real test-utils
  factory (`createTestAgentClient`, newly exported with an overrides
  parameter); only the network generation boundary is substituted, and it
  reports the prompt it received (asserted to embed the full content).
- **A3 (uniform settings wipe)** — pinned by the rewritten
  `clears gemini provider settings when switching active provider` in
  `packages/cli/src/integration-tests/provider-switching.integration.test.ts`.
- **A4 (auth roundtrip)** — new
  `re-resolves gemini auth from the persisted settings store after a provider roundtrip (#2626)`
  in `packages/providers/src/ProviderManager.gemini-switch.test.ts`: real
  GeminiProvider/OpenAIProvider, real SettingsService store, real
  ProviderManager; gemini → other (uniform clear) → rotate stored key →
  gemini; asserts the freshly resolved token equals the rotated key and the
  provider reports authenticated.
- **A5-adjacent (no-poke activation)** — new test
  `(g) gemini-named activation via provider-or-oauth activates and the switched provider generates (#2626)`
  in `packages/agents/src/api/__tests__/providerActivation.behavior.test.ts`:
  a provider registered under the `gemini` name (the deleted gate's trigger)
  is activated through the real executor; the switched provider generates.

### A4 clearState propagation (initially deferred, then fixed)

The uniform-clear DELTA was initially deferred with the note that
`clearState` did not reach `BaseProvider` through the standard wrapping
(RetryOrchestrator did not forward it). The final review round correctly
rejected that deferral: with the gemini exemption deleted, the accepted A4
behavior (in-memory auth cache actually cleared on switch-away) depends on
the clear propagating through the production wrapper chain. Fixed by adding
`clearState` forwarding to RetryOrchestrator (mirroring its existing
`clearAuthCache`/`clearAuth` forwarding), with the A4 regression test
extended to record `clearState` on the RAW GeminiProvider beneath the
wrappers and assert it fires exactly once on switch-away (verified
red without the forwarding, green with it).

The remaining observability note stands: OAuth-era cache invalidation is
not directly observable offline (Code Assist OAuth was removed in #2409;
API-key resolution is stateless per call), so the roundtrip test pins the
raw-provider propagation plus re-resolution of a rotated key from the
persisted store. Real gemini generation is covered by the stepfun-37 smoke
test.

### Coverage of "generates successfully" (A4/A5)

Offline unit coverage asserts the activated runtime generates through the
switched provider (A5 test (g)) and auth resolves fresh (A4 roundtrip). Live
gemini generation end-to-end is verified by the smoke test in the verification
cycle.

## Review log

### deepthinker round 1 (of max 2) — completed 2026-08-26

Verdict: compliant with issue intent. Two test-strength blockers, both fixed:

1. A4 roundtrip test could not detect restoration of the gemini clearState
   exemption (it read the raw provider, never asserted clearState, and never
   generated). FIXED: the manager now receives `setConfig(makeFakeConfig())`
   before registration so providers are registered through the real
   production wrapping (LoggingProviderWrapper over RetryOrchestrator); the
   test records invocations of the REGISTERED wrapper's clearState via
   getActiveProvider() and asserts exactly one call on switch-away
   (the restored exemption would produce zero); and generation now runs
   through the registered wrapper chain end-to-end (mocked @google/genai
   stream), asserting the request carried the re-resolved rotated key.
2. The (g) activation test lacked a dead-surface trap. FIXED: added
   `'getServerToolsProvider' in manager === false` on the live production
   manager the executor used. A restored poke fails either the `in` check
   (member present) or the existing activation/generation assertions
   (executor crashes without the member).

DEFERRED (documented, out of scope): RetryOrchestrator does not forward
`clearState` (it forwards only `clearAuthCache`), so ProviderManager's
clearState call never reaches BaseProvider.clearState for ANY provider
through the standard wrapping. Fixing that forwarding is an adjacent
behavior change beyond #2626's scope; the wrapper-boundary recorder above is
unaffected by the gap (it observes the manager→wrapper call).
**Superseded in round 2** — the final review classified this a Blocker and
the forwarding fix was applied (see round 2 below).

### OCR local round 1 (of max 2) — deepthinker-initiated run over the full diff

Triage of the four findings:

| # | Finding | Disposition |
|---|---|---|
| 1 | providerSwitch wipe comment said "session-set settings" while the wipe clears the full provider-scoped record (incl. persisted auth-key) | In-scope-Fix (comment corrected to state the full-record wipe is deliberate, gemini included). The BEHAVIOR half of the finding is Rejected: the full wipe is exactly what every non-gemini provider already received pre-#2626 and what the issue mandates ("wiped on switch-away exactly like every other provider — consciously owned"). |
| 2 | ConversationDataRedactor hardcodes `case 'direct_web_fetch':` instead of importing the canonical tool-name constant | Rejected: the literal is prescribed verbatim by the issue text; every sibling case in the same switch is a string literal; the file has no tools-package import and adding one for a single case is a style change beyond scope. |
| 3 | readAuthToken `as unknown as` cast to a protected member is brittle | In-scope-Fix: the strengthened A4 test keeps the cast (public isAuthenticated() cannot distinguish key rotation) with a comment naming the protected member and why the cast is the only observation channel. |
| 4 | providerManagerUnconfigured.test.ts lost its only no-network assertion when the serverToolsProvider cases were deleted (#2481 coverage) | In-scope-Fix: restored a generic "issues no network request while unconfigured" test against the remaining unconfigured surface (construction + listProviders), fetch-swizzled with save/restore. |

Positive OCR evidence recorded: cross-file searches confirm no lingering
getServerToolsProvider/setServerToolsProvider/getServerTools/invokeServerTool/
supportsTools references in source; GeminiProvider.clearState() only clears
the auth cache (re-resolved lazily from settings), consistent with the new
uniform-clear behavior.

### deepthinker round 2 (of max 2) — final review on HEAD a3cf0bb07 + 5b55dd9c6

Verdict: NOT COMPLIANT (1 BLOCKER, 2 LOW). All other work-plan items,
behavioral decisions, non-goals, greps, and spot tests verified positively.

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 1 | RetryOrchestrator does not forward `clearState`, so the uniform switch-away clear never reaches the underlying provider's auth-cache clear through the standard wrapping — A4's accepted behavior not delivered end-to-end | BLOCKER | **Blocker-Fix (applied).** The round-1 deferral of this exact gap was rejected: with the gemini exemption deleted, A4 hinges on the clear propagating. Added `clearState` forwarding to RetryOrchestrator (mirrors existing clearAuthCache/clearAuth forwarding; no shim, no new abstraction) and extended the A4 regression test to record `clearState` on the RAW GeminiProvider beneath the wrappers (verified red without the fix, green with it). |
| 2 | providerSwitch wipe comment lost the plan-traceability annotation the work plan called for | LOW | In-scope-Fix (applied): comment now carries `@plan:PLAN-20260826-SERVERTOOLS-DELETE` and names the superseded PLAN-20260603-ISSUE1584.P14 special case. |
| 3 | typecheck7.log lacked the asserted `TYPECHECK_EXIT=0` marker | LOW | In-scope-Fix (process): typecheck re-run post-fix with the exit marker captured (typecheck8.log). |

Both deepthinker rounds are now exhausted; per policy, remaining
MEDIUM/LOW items would be documented as follow-ups, but all findings from
round 2 are fixed outright.

### OCR local round 2 (of max 2) — full branch range review post-remediation

166 files reviewed; 1 finding:

| # | Finding | Disposition |
|---|---|---|
| 1 | [medium] New RetryOrchestrator.clearState forwarding lacks direct test coverage; a future refactor dropping it would go undetected; absent-member branch untested | **In-scope-Fix (applied).** Partially overstated — the deepthinker-strengthened A4 chain test already fails if the forwarding is dropped (proven red without the forwarding). The genuinely uncovered half is the ABSENT-member branch (every chain-test provider is a BaseProvider, which always has clearState). Added two unit tests to RetryOrchestrator.basic.test.ts pinning both branches: forwarding fires exactly once on the wrapped provider, and clearState is a safe no-op when the wrapped provider lacks the member. |

Local OCR budget now exhausted (2/2). All findings from both rounds are
fixed outright; none rejected beyond the two documented round-1 rejections.

## CI round 1 (PR #3354) — GenAI importer ratchet

First CI run: all test shards, E2E, Interactive UI, CodeQL green; two lint
jobs red, single root cause: the `@google/genai` import ratchet
(`scripts/genai-import-inventory.ts --check`) flagged
`ProviderManager.gemini-switch.test.ts` as a NEW importer — its SDK mock
(`vi.mock('@google/genai', ...)`) matched the quoted-specifier scan, and the
baseline also still listed the deleted `geminiServerTools.ts`.

Fix (In-scope-Fix):

- Removed the SDK mock and the mocked-generation phase from the A4 test. The
  test keeps its full real-path contract (wrapper clear x1, raw-provider
  propagation, rotated-key re-resolution, authenticated). Coverage for
  "generates with the re-resolved key" stays where it already lives:
  `GeminiProvider.auth.test.ts` asserts the resolved key flows into
  `buildGoogleGenAIOptions`, and the stepfun-37 smoke exercises live
  generation. Deliberately NOT done: growing the baseline (ratchet says the
  inventory may only shrink) and computed-specifier `vi.mock` evasion
  (defeats the ratchet's intent).
- Regenerated `dev-docs/genai-import-baseline.md` (27 -> 25 importers):
  `geminiServerTools.ts` (deleted here) and `GeminiProvider.auth.test.ts`
  (de-coupled earlier in this issue when its tests were retargeted to the
  options seam; the baseline had not been regenerated for that shrink).
- Verification: ratchet `--check` green, the edited test 4/0, prettier +
  eslint clean, full typecheck exit 0, providers workspace suite
  578/578 files pass.

## PR #3354 review triage (round 1)

- **CodeRabbit**: review skipped by the bot itself — 169 files exceeds the
  150-file plan limit and metered capacity was unavailable. No findings to
  address; nothing an author change can fix without splitting the deletion
  (the issue mandates one PR for the concept removal). Documented, not chased.
- **OpenCodeReview (PR action)**, 2 findings:
  - `[maintainability/low]` missing baseURL coverage at the
    `buildGoogleGenAIOptions` seam in `GeminiProvider.auth.test.ts` —
    **In-scope-Fix**. The retargeted tests had dropped the baseURL assertion
    the old constructor-spy tests carried. Added
    `maps a resolved baseURL into httpOptions.baseUrl for the SDK client`
    (with-baseURL branch; the without-baseURL branch is already pinned by
    every `toStrictEqual` expecting `httpOptions: { headers: {} }`).
    File now 19/0; eslint + prettier clean; genai ratchet unaffected
    (no quoted SDK specifier in the file).
  - `WARNING: changed-file coverage 1/166 below 90%` — bulk-deletion PR
    artifact (OCR's coverage preview counts mechanical mock-sweep edits).
    **Reject** as not actionable for a pure-deletion PR; noted here.
- **Walkthrough bot** pre-merge check claims
  `CompressionLoadBalancingProvider` still contains the dead methods —
  **Reject (factual mistake)**: `grep -nE "getServerTools|invokeServerTool|ServerTool"
  packages/agents/src/core/CompressionLoadBalancingProvider.ts` returns no
  matches on the PR head; the bot's "provided diff summary" is stale.
- PR round budget: this fix push closes round 1; round 2 reserved for any
  new CI/bot findings on the final head.

## Final status (2026-08-26)

- CI on final head `5761f082d`: 38/38 checks pass (incl. Lint (Javascript)
  10m51s — the ratchet fix confirmed; zero pending, zero fail).
- The round-1 OCR inline finding ("restore the @google/genai constructor mock",
  maintainability/medium) — **Reject**: conflicts with the shrink-only genai
  import ratchet this PR's CI fix enforces; no separate mapping layer exists
  (helper result is passed straight to `new GoogleGenAI(...)`); live
  instantiation covered by the smoke test. Disposition posted on PR and the
  thread resolved.
- PR body amended (seam-coverage wording for A4/A5 claims; auth-test line in
  the reviewer plan). CodeRabbit: skipped by the bot (file count + credits).
- All acceptance greps clean on the final head (A1/A5/supportsTools=0).

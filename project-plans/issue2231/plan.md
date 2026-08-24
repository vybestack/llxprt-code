# Execution Plan — issue #2231

Plan ID: PLAN-20260824-ISSUE2231
Generated: 2026-08-24
Branch: `issue2231`
Issue: Error message says 'Error when talking to {provider} API' regardless of
actual endpoint

## Scope, in one paragraph

`packages/agents/src/core/turn.ts` `handleRunError` builds the report base
message from the logical provider name only. The fix resolves the actual HTTP
endpoint through the session — `ChatSession.getResolvedBaseUrl()`, a new
public read-only accessor that reuses the existing private
`resolveProviderBaseUrl` (load-balancer last-selected URL → native-Anthropic
default → `runtimeState.baseUrl`) — and (a) prints
`Error when talking to {providerName} (endpoint: {baseUrl})` to stderr when a
URL resolves, (b) records `baseUrl` in the JSON report context. When no URL
resolves the message stays exactly `Error when talking to {providerName} API`.
The `ServerErrorEvent` payload is unchanged. Nothing else changes.

## Accepted behavior (requirements)

### REQ-2231-1: endpoint in the stderr base message

- GIVEN: a `Turn` with `providerName` `P` whose chat resolves base URL `U`,
  and a `sendMessageStream` rejection that reaches the generic error branch
- WHEN: `Turn.run` handles the error
- THEN: the stderr line begins
  `Error when talking to P (endpoint: U)` (followed by the existing
  ` Full report available at: …` suffix from `reportError`)

### REQ-2231-2: fallback when no endpoint resolves

- GIVEN: the chat resolves no base URL (provider resolution throws, or the
  resolved provider yields no URL — e.g. default gemini with no explicit
  `baseUrl`)
- WHEN: `Turn.run` handles the error
- THEN: the stderr line begins `Error when talking to P API` and contains no
  `(endpoint:` fragment; diagnostics resolution failures never throw out of
  the error handler

### REQ-2231-3: endpoint in the JSON report file

- GIVEN/WHEN: as REQ-2231-1
- THEN: the report file's `context` object contains `baseUrl: U`, so the
  failing service is identifiable from the report alone; when no URL resolves,
  `baseUrl` is absent from the context

### REQ-2231-4: resolution semantics of `ChatSession.getResolvedBaseUrl()`

The accessor returns, for the provider the runtime would use next:

1. the load balancer's `getLastSelectedBaseUrl()` when the resolved provider
   exposes it (takes precedence over `runtimeState.baseUrl`)
2. otherwise `runtimeState.baseUrl` (with the existing native-Anthropic
   default for provider `anthropic`)
3. `undefined` when provider resolution itself fails (no active provider)

### REQ-2231-5: event contract unchanged

- The `AgentEventType.Error` event payload (`message`, optional `status`,
  `category`, `reason`) is byte-for-byte what it is today; endpoint enrichment
  affects only the report base message and report context.

## Out of scope (explicitly rejected)

- Changing the `StructuredError` / event schema to carry the endpoint.
- Adding provider-default endpoints for providers other than the existing
  native-Anthropic default baked into `resolveProviderBaseUrl`.
- Appending `: {errorMessage}` to the base message (the error message already
  travels in the report file and the Error event; the issue's "e.g." format is
  indicative, the requirement is endpoint visibility).
- Any refactor of `reportError`, dedupe fingerprints, or rotation.

## Test matrix

### Turn level — extend `packages/agents/src/core/turn.errorReport.bun.test.ts`

`FixtureChat` gains `getResolvedBaseUrl: () => string | undefined`.

| Row | Requirement | GIVEN/WHEN/THEN | RED/GUARD |
|-----|--------------|-----------------|-----------|
| E1 | REQ-2231-1 | fixture returns `https://ollama.example/v1/`, providerName `fixture`; run fails; stderr contains `Error when talking to fixture (endpoint: https://ollama.example/v1/)` | RED |
| E2 | REQ-2231-3 | same setup; parsed report `context.baseUrl` deep-equals `https://ollama.example/v1/` | RED |
| E3 | REQ-2231-2 | fixture returns `undefined`; stderr contains `Error when talking to fixture API` and not `(endpoint:`; report context has no `baseUrl` key | GUARD |
| E4 | REQ-2231-5 | with URL present, yielded events are exactly `[{ type: Error, value: { error: { message } } }]` | GUARD |

### ChatSession level — create `packages/agents/src/core/__tests__/chatSession.resolvedBaseUrl.bun.test.ts`

Reuse the harness shape from `__tests__/chatSession.runtimeState.test.ts`
(`createAgentRuntimeState`, `createAgentRuntimeContext`,
`createProviderAdapterFromManager`) with the `RuntimeProviderManager` from
`packages/agents/src/test-utils/runtimeProviderManager.ts` to register
provider stand-ins. Providers here are the infrastructure boundary, not the
component under test; `ChatSession` is real.

| Row | Requirement | GIVEN/WHEN/THEN | RED/GUARD |
|-----|--------------|-----------------|-----------|
| S1 | REQ-2231-4.1 | active provider exposes `getLastSelectedBaseUrl: () => 'https://lb-child.example/v1'` and `runtimeState.baseUrl` is a different URL; `getResolvedBaseUrl()` returns the LB URL | RED |
| S2 | REQ-2231-4.2 | plain provider, `runtimeState.baseUrl = 'https://proxy.example/v1'`; returns it | RED |
| S3 | REQ-2231-4.3 | provider adapter with no registered/active provider (resolution throws); returns `undefined` without throwing | RED |
| S4 | REQ-2231-4.2 | provider named `anthropic`, no `runtimeState.baseUrl`; returns the native Anthropic default base URL | RED |
| S5 | REQ-2231-4 | active LB provider whose `getLastSelectedBaseUrl()` returns `undefined` (no selection yet — e.g. the very first request failing), `runtimeState.baseUrl` set; returns the runtime base URL | GREEN (adopted from OCR round 1; locks the fallback ordering) |

### Existing fixtures to update (mechanical, no behavior change)

- `packages/agents/src/core/turn.test.ts` `mockChatInstance` and
  `turn-test-helpers.ts` `MockedChatInstance`: add `getResolvedBaseUrl:
  () => undefined` so the mocked error-path test keeps reaching
  `handleRunError` without a TypeError (its assertion is a call-count check
  on `reportError`, not a message check).
- Any other Turn fixture that reaches the generic error branch and fails with
  a missing-method TypeError (the full suite run reveals them; fix by adding
  the same stub).

## Phases

### P01 — RED

Add rows E1-E4 and create the S-file with rows S1-S4. Tag every test
`@plan:PLAN-20260824-ISSUE2231.P01` and `@requirement:REQ-2231-N`. Fixture
stubs for `getResolvedBaseUrl` land in this phase (they are test code). Run:

```bash
cd packages/agents && bun test src/core/turn.errorReport.bun.test.ts src/core/__tests__/chatSession.resolvedBaseUrl.bun.test.ts
```

**Gate:** every RED row observed failing for the right reason (missing
endpoint in message/context; missing accessor). GUARD rows pass. Record
output in `## RED evidence` below.

### P02 — GREEN

1. `packages/agents/src/core/chatSession.ts`: public
   `getResolvedBaseUrl(): string | undefined` — resolve the runtime provider
   via `resolveProviderForRuntime` inside a try/catch that returns
   `undefined` on failure (diagnostic enrichment must not mask the error
   being reported; mirrors the existing `getActiveProvider()` pattern), then
   return `this.resolveProviderBaseUrl(provider)`.
2. `packages/agents/src/core/turnErrorReportContext.ts`:
   `buildErrorReportContext(history, request, baseUrl?)` includes `baseUrl`
   in the returned record when defined.
3. `packages/agents/src/core/turn.ts` `handleRunError`: resolve
   `const baseUrl = this.chat.getResolvedBaseUrl();` and build the base
   message per REQ-2231-1/2, passing `baseUrl` into
   `buildErrorReportContext`.

**Gate:** all P01 rows pass; full verification cycle (npm run test / lint /
typecheck / format / build; smoke test with profile stepfun-37).

### P03 — review cycle

deepthinker compliance review; OCR (max 2 rounds); triage findings as
Blocker-Fix / In-scope-Fix / Reject / Defer.

## RED evidence

Command:

```bash
cd packages/agents && bun test src/core/turn.errorReport.bun.test.ts src/core/__tests__/chatSession.resolvedBaseUrl.bun.test.ts
```

Exit code: 1. Bun reported `10 pass`, `6 fail`, and `30 expect()` calls
across 16 tests.

- E1 failed with `Expected to contain: "Error when talking to fixture
  (endpoint: https://ollama.example/v1/)"`; stderr still contained `Error when
  talking to fixture API Full report available at: ...`.
- E2 failed with `Expected: "https://ollama.example/v1/"` and `Received:
  undefined` for `report.context.baseUrl`.
- E3 and E4 passed, confirming the unresolved fallback and event contract guards.
- S1, S2, S3, and S4 each failed because the production `ChatSession` did not
  yet expose `getResolvedBaseUrl` (`TypeError: ...getResolvedBaseUrl is not a
  function`). The Turn fixture already exposed the method, so no Turn failure
  was caused by a missing fixture stub.
- Existing T1-T8 all passed unchanged.

## Verification evidence (P02)

| Step | Result |
|------|--------|
| `npm run test` (full monorepo) | First run: 377 agents files green except 2 contention flakes (see below); CLI 714 files green except 1; second solo run recorded below. |
| Contention flakes | `agent.approvalMode.behavior.test.ts` T1 (180s timeout) and `cli-turn-parity.early.spec.ts` EP1 (30s timeout) failed only while an invalid concurrent `cd packages/agents && bun test` job (missing `run-bun-tests.ts` preloads) ran on the same machine; both files pass in isolation (`5 pass`, `3 pass`). Caused by test-harness misuse during verification, not by the change. |
| CLI assertion update | `packages/cli/src/integration-tests/cli-args.integration.test.ts` "should apply CLI args after profile load but before provider switch" asserted the literal old message; the run prints `Error when talking to gemini (endpoint: https://cli-base-url.example.com)` because the test passes `--baseurl`. Updated the assertion to the new message — it now directly proves the CLI `--baseurl` won over the profile base URL. In scope: the issue's behavior change requires it (CI-green mandate). File passes: 20/20. The fallback-message tests (`gemini API` with no explicit base URL, incl. `cli-args.profile-flag.integration.test.ts`) still pass unchanged. |
| `npm run lint` | EXIT=0 |
| `npm run typecheck` | EXIT=0 |
| `npm run format` | EXIT=0, no files changed |
| `npm run build` | EXIT=0 |
| Smoke: `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"` | EXIT=0, haiku printed |
| Test-audit scanner (`bun scripts/test-audit/scan.ts`) | findings.tsv diff vs main baseline: only line-number shifts of pre-existing findings; zero new MOCK_MIRROR/ALWAYS_TRUE/SELF_CONFIRMED/NO_ASSERT findings on touched files. |

Full-suite re-run after the CLI test edit: recorded in `## Final green evidence` once complete.

## Final green evidence

`npm run test` (solo run, after the CLI assertion update): EXIT=0 — 43/43,
392/392, 377/377 workspace test files, 714/714 CLI test files;
`Test cases: 9169 passed, 0 failed, 5 skipped, 13 todo (9187 total)`.

## Review findings triage

### Round 1 — architect subagent (deepthinker profile unavailable: provider
error "The 'gpt-5.6-sol' model is not supported when using Codex with a
ChatGPT account", retried once; architect on opusthinking used as fallback)

Verdict: PASS. All five requirements verified satisfied against source; no
scope creep; test quality confirmed behavioral (no mocks in the E-file; real
ChatSession in the S-file). Four findings, all LOW:

| # | Finding | Classification | Action |
|---|---------|----------------|--------|
| 1 | `turn.ts` gates the message on truthiness while `turnErrorReportContext.ts` gates on `=== undefined`; an empty-string base URL would yield the fallback message plus `baseUrl: ""` in the report context | Reject | Both behaviors satisfy REQ-2231-1/2/3 as written (`""` is defined, and recording it is accurate). Aligning predicates is optional polish with no requirement driving it. |
| 2 | `turn.tool-restrictions.test.ts` omits the now-required `getResolvedBaseUrl` member of `MockedChatInstance` (invisible to CI due to a pre-existing tsconfig exclusion) | In-scope-Fix | Added the same one-line mechanical stub used by the other fixtures — completes the fixture update the plan already accepts and removes the latent trap. |
| 3 | Plan text claimed `turn.test.ts` asserts the fallback message via `reportError` call args; it asserts call count only | In-scope-Fix | Corrected the plan sentence (stub is still required there). |
| 4 | `chatSession.ts` comment said "Read-only diagnostics" but `resolveProviderForRuntime` can enforce an active-provider switch | In-scope-Fix | Reworded the comment on the accessor added by this change to describe the resolution path accurately. |

Reviewer explicitly proposed no code changes for findings 1 and 4; the fixes
applied for 2-4 are one-liners inside the change's own footprint. Full
verification cycle re-run after remediation (see `## Post-review verification`).

### Round 2 — Open Code Review (ocr, `--audience agent --timeout 20`, local)

5 findings across 17 files:

| # | Finding | Classification | Action |
|---|---------|----------------|--------|
| 1 | `turn.preRequestTimeout.test.ts` — inline stub duplication; extract a shared mock helper | Reject | Optional refactor; the one-line stubs are the accepted mechanical pattern. No behavioral issue. |
| 2 | `turn.tool-restrictions.test.ts` — stub is untested wiring; add a resolved-URL scenario to the tool-restriction suite | Reject | Tool-restriction flows never read the endpoint; a URL scenario there tests nothing about them. Endpoint behavior is covered by E1-E4, S1-S5, and CLI end-to-end. |
| 3 | `chatSession.ts` — add a read-only `{allowSwitch: false}` variant of provider resolution for `getResolvedBaseUrl` | Reject | New abstraction beyond the plan; the send path already runs the same resolver before any error path, so the enforced switch has already converged; conflicts with the fail-fast preference (no behavioral bug demonstrated). The JSDoc states the behavior accurately. |
| 4 | `turn.idle-timeout.test.ts` — `getResolvedBaseUrl` stub added only to the `beforeEach` mock; 5 rebuilt mock sites (lines 98, 187, 238, 333, 427) lack it, a latent TypeError if any of those error-surface tests ever reaches the generic error branch | In-scope-Fix | Added the one-line stub to all 5 rebuild sites — completes the file's mechanical update. |
| 5 | `chatSession.resolvedBaseUrl.bun.test.ts` — no coverage for LB present but `getLastSelectedBaseUrl()` undefined (first-failure case); suggested S5 | In-scope-Fix | Adopted S5 (locks fallback ordering; directly exercises the issue's first-request-failure scenario). |

### OCR round 2 (remediation re-run; 2-round OCR cap now reached) — ocr re-run after remediation

1 finding; 1 of 17 items (stream-pipeline.characterization.test.ts) timed out
in OCR's own LLM loop — that file was reviewed with zero findings in the
first OCR round and its only change (the mechanical stub) is unchanged since.

| # | Finding | Classification | Action |
|---|---------|----------------|--------|
| 1 | `turnErrorReportContext.ts:28` [security · medium] — baseUrl in the report context may leak internal endpoint URLs (query-string credentials, private hostnames) into reports "that could be logged or shared externally" | Reject | Verified against the actual sink: `reportError` writes only to `os.tmpdir()` via local `fs.writeFile` (errorReporting.ts:401,455) — no network upload, fetch, or POST. The report already contains the error stack and the last 8 conversation entries by design (T1/T2), which are strictly more sensitive than a configured base URL; baseUrl is a config endpoint (OPENAI_BASE_URL, LB sub-profile), not a per-request URL — auth travels in headers in this codebase. Sanitizing would contradict the issue's explicit requirement ("include the resolved base URL in the error report"). No change. |

## Post-review verification

Final cycle after all review remediation (logs: `/tmp/issue2231-{npm-test4,lint3,typecheck3,format3,build3,smoke3}.log`):

| Step | Result |
|------|--------|
| `npm run test` | All new/changed tests green in the full-suite context (idle-timeout, S1–S5, tool-restrictions, E1–E4, CLI integration); CLI 714/714. 3 unrelated api tests (`createAgent.harness`, `lspControl`, `sandbox-boundary` T18e) hit their 180s failsafe while OCR round 2 ran concurrently on the same machine — all 16 tests in those 3 files pass in isolation (4.19s), and the same suite ran 9169/0 solo earlier in the day. Load-induced flakes, not regressions; CI runs solo on a fresh runner. |
| `npm run lint` | EXIT=0 |
| `npm run typecheck` | EXIT=0 |
| `npm run format` | EXIT=0 (no file changes) |
| `npm run build` | EXIT=0 |
| Smoke: `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"` | EXIT=0 (haiku printed) |
| Test-audit scanner (`bun scripts/test-audit/scan.ts`) | No new findings vs main baseline on touched files (line-number shifts only) |

# Issue #3984: request media budget and historical image retirement

## Verified PR remediation

After CodeRabbit and the scoped CI lint failure, the complete serial remediation
cycle finished on 2026-10-30 at 18:28:27 (-03:00), all exit 0: full typecheck,
strict CI-equivalent scoped lint (including `packages/lsp`), format check, build,
complete workspace tests, and live `gpt-luna-high` smoke. The actual formatter
also passed afterward. Test-audit findings are identical to r10. A bounded
independent review of these changes passed with no concrete defects. The
construction-time budget limitation is tracked as follow-up #3989.

## Final local verification

The complete **r10** sequence passed on Linux on 2026-10-30:

- `npm run test`: exit 0, including 814/814 agents, 516/516 core,
  660/660 providers, 996/996 CLI and all remaining workspace suites.
- `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`: exit 0.
- Live smoke: exit 0 with `gpt-luna-high` and a haiku-only prompt.

Checks ran serially, with supported core/agent/CLI test file concurrency set to
one. No coverage was skipped, production deadline changed, or assertion disabled.
The final test run lasted 10:54:04–12:42:47 (-03:00); all remaining checks finished
by 12:58. Earlier failed runs and their remediation are recorded below.
Local OCR remains unavailable; the two revised independent review rounds are the
review evidence. macOS, Windows and packaged/container execution were not tested
locally. Scratch evidence stays uncommitted under `.tmp-issue3984/`.

## Current design

The production default remains a strict **15 MiB (15,728,640-byte) encoded-media budget** for both tool-result batch admission and provider request media. The previous proposal to raise native Anthropic media admission to 32,000,000 bytes is superseded. The exact native Anthropic complete-body guard remains **32,000,000 serialized JSON bytes**, independent of media setting.

Before resolving provider media, the agent builds a request view. When request media exceeds the effective positive media budget, it replaces the oldest eligible historical images with honest text notes, aiming to bring the request-view image total to at most 75% of budget. Pending content remains protected; if it prevents fitting, the resolver still rejects the request. The process preserves canonical history and original stored pixels and recomputes the view for each request, including after recomposition. This is safety retirement for one request view, not durable retirement or semantic purge. There is no age clock, four-exchange policy, separate reread tool, or guarantee that a named path remains available. A note recommends reading the path again only if it is known and may be available in the workspace; otherwise it asks for the source again.

A direct provider request that bypasses the agent's request-view retirement still rejects media above its 15 MiB budget. This is the correct lower-level hard gate, not a bug. The request-producer tests exercise retirement and fitting at the actual incident boundary.

### Budget and compatibility details

- Tool-result admission default: 15 MiB of normalized base64 length.
- Native Anthropic request media default: 15 MiB. Compatible third-party hosts retain the generic 15 MiB default.
- Native Anthropic complete JSON body: exact 32,000,000-byte guard.
- An explicit larger media budget admits media only if that complete request still fits. An explicit 128 MiB media budget cannot bypass the body guard.
- Explicit zero preserves the existing split behavior: tool-batch image filtering is disabled; request-view retirement does not run and the resolver rejects encoded media.
- Accounting distinguishes normalized encoded image lengths from complete serialized request-body bytes and model tokens.
- The Messages API reference publishes a 128 MB request limit; Claude Code documents a 32 MB limit. Neither establishes an OAuth-specific maximum. LLxprt retains 32,000,000 bytes as conservative application policy. See [Anthropic's API limit](https://platform.claude.com/docs/en/api/errors#request-size-limits) and [Claude Code's guidance](https://code.claude.com/docs/en/errors#request-too-large).

The optional `media.semantic-purge` feature remains an explicit, lossy policy that changes canonical conversation history. Request-view safety retirement does not enable it, advance its frontier, or mutate source pixels. User-facing settings and profiles documentation is in [settings-and-profiles.md](../docs/settings-and-profiles.md#image-payload-budget).

## Behavioral evidence and coverage

The implementation is in `packages/agents/src/compression/historicalImageRetirement.ts`; agent integration uses the existing request/enforcement flow. The request-view unit tests cover pressure retirement to the 75% target, oldest-first ordering, pending protection, reference-media accounting, stable recomputation, unchanged inputs, path-sensitive source notes, and explicit-zero behavior. Incident-level producer coverage is in `packages/agents/src/compression/__tests__/historical-image-retirement.incident.test.ts`: the 26-image fixture totals 15,915,624 encoded bytes, runs at the original 15 MiB budget, verifies the newest image and bounded newer suffix are sent, checks notes and content length, and confirms canonical history and stored source pixels remain unchanged. Separate byte-pressure tests cover recomposition and enforcement paths.
## Full verification remediation

The first revised complete workspace run (`test-r3`) finished with exit 1.
All new image suites passed, but seven other files exposed timing/fixture issues:
web-fetch overflow cancellation, MCP auth cancellation, LSP late response,
agent construction properties, profile-name scanning, child approval readiness,
and completion enrichment timeout. These failures were investigated instead of
being dismissed because their files lay outside the initial diff.

Bounded test-only remediation preserves the behavioral assertions:

- Hold the web-fetch response open after crossing 5 MiB until cancellation or a
  watchdog; remove the race against the server completing the response.
- Give MCP connection setup and LSP fixture initialization enough time before
  their still-enforced timeout tests. Timeout, joining and late-response behavior
  remain asserted; deadlines are still wall-clock bounds.
- Keep all 100 fast-check agent identity iterations and use a 60-second bound.
- Revalidate the duplicate profile name while awaiting the async directory scan.
- Await real child approval readiness with a bounded 30-second wait.
- Install the held enrichment promise at the current workspace definitions
  boundary and wait for search start before advancing the fake timeout clock.

Focused repeats: web-fetch 5 x 20 tests; MCP 3 x 8; LSP 3 x 42;
agent properties 2 x 3; profile-save 8 x 8; child approval 1 and completion 15
passed. Property runs measured 19–21 seconds under load, exceeding their former
15-second cap. Profile-save failed in one of three isolated pre-fix runs; the
web-fetch race also reproduced in isolation. No main-baseline comparison was
performed, so this is not proof that all failures predated this branch.

Full r5 completed with exit 1: the repaired files passed, but MCP extension
retirement and three CLI files failed. Full r7 completed with exit 1 for only
MCP reload retirement; all 996 CLI files passed. Both MCP tests released a held
initialize after 20 ms while abort delivery could still be in flight, creating
an orphan session at the synthetic server. They now share bounded transition
settlement synchronization. All rejection, ordering, socket and session assertions
remain. Both files passed three isolated repeats after the shared repair.

Full r8 exposed additional timing-sensitive failures under host load above 40,
including LSP startup and crash-notification delivery. The LSP tests now wait
for observed process death and give spawned fixtures one second before request
timeouts, retaining timeout assertions. The core owner test has a 30-second
outer bound; its production navigation deadline remains 250 ms and can still
fail under load. No production LSP timeout is changed. Focused results are in
`lsp-final-r9.log`: integration 11 passed, timeout 42 passed, owner 10 passed on
rerun (its first rerun had two failures). This is not proof of a consistently
quiet-host pass. R8 finished with exit 1, including startup/CPU deadline failures,
a declaration-build watchdog, and a trust-dialog ordering race. The trust test
now awaits the first accepted selection before submitting duplicate input, and
flushes selection settlement before testing the next Escape. Assertions remain.

Typecheck and build are serialized to avoid declaration-output races. Full r7
and r8 typecheck passed; r7 lint, build and live smoke passed. The earlier r3
typecheck also caught new fixture typings; unsupported Array.at and incorrect
ToolResult shapes were corrected before the full r4 typecheck passed.
Audit changes add no forbidden flags; existing findings on completion tests are
unchanged apart from ordering and line offsets. Local live smoke uses the
available `gpt-luna-high` because the documented `luna` profile is absent.

## Revised batch admission and loop recovery

`imagePayloadBudget.ts` now measures stored image references as well as inline
images. It preserves all tool responses/call IDs and the deterministic fitting
image prefix. Omission feedback identifies available file, tool and call labels,
MIME type, encoded bytes and the numeric batch budget. Aggregate excess advises
fewer images or smaller batches. A single image larger than the entire budget
gets resize/crop advice, including when it occurs after another omission.

The foreground `buildToolResponses` and child `processFunctionCalls` paths share
that feedback. Their producer-boundary regressions exercise real conversion and
admission. `agentic-loop.image-batch-recovery.test.ts` goes further: real
AgenticLoop and CoreToolScheduler receive four parallel 4,000-byte image results
under a 10,000-byte budget. A protocol-aware model fixture responds to actual
feedback by requesting just the two omitted images, then completes. This validates
loop mechanics and actionable protocol output, not inference by a live model.
Stored-reference accounting is separately covered; the full scheduler regression
uses inline images. `chat-session.image-retirement.test.ts` checks 30 sequential
request preparations through real ChatSession while preserving canonical images.

## Revised review and TDD evidence

- Batch RED: 15 helper and 2 producer cases failed before implementation. GREEN:
  helper/producer 61 passing; child processing suites 61 passing; broader focused
  loop/noninteractive suites 158 passing. Child-specific tests were authored after
  the caller change; a wrong-budget mutation was verified to fail.
- Original retention task hit its time limit without returning a saved RED record.
  Do not infer red-first evidence from its passing tests. Current isolated focused
  retirement/incident/byte-pressure/ChatSession/batch suites passed 106 tests; later
  pending-boundary and full-loop tests extend that evidence.
- Revised retention review round 1 found a HIGH pending-boundary shape-matching
  flaw and a MEDIUM real-loop coverage gap. New pending-boundary regressions ran
  RED with 5 failures/5 passes. The fix proves matching pending block content or
  fails closed; GREEN all 10 passed. A request-view stored-Responses-chain marker
  defect was also caught by RED and corrected without mutating canonical entries.
- The full-loop test was GREEN initially against the already-correct batch slice;
  raising the fixture budget so admission no longer happened caused both tests to
  fail. No claim that those integration tests preceded production changes.
- Revised retention review round 2: PASS, 32 focused tests, no remaining HIGH
  finding. Follow-ups: no age timer or general reread tool for uploads/changed
  files; content-identical pending duplicates do not prove metadata identity.
- Test-audit delta: one STRUCTURE_ONLY profile-absence case. Absence in the saved
  profile is the behavior being asserted. No new MOCK_MIRROR, ALWAYS_TRUE,
  SELF_CONFIRMING or NO_ASSERT findings. Local OCR executable is unavailable.


Provider-boundary tests are deliberately distinct from producer recovery coverage:

- `packages/providers/src/anthropic/anthropic-incident-request-budget.test.ts` verifies direct provider rejection at default and explicit 15 MiB, successful media admission under an explicit larger budget when the full body fits, and rejection when a 128 MiB explicit media budget produces a body over 32,000,000 bytes.
- `packages/providers/src/anthropic/AnthropicEndpointUtils.test.ts` verifies the native default resolves to 15 MiB, third-party resolution, explicit overrides, and the 32,000,000-byte body cap.
- `packages/providers/src/anthropic/anthropic-request-body-guard.test.ts` covers exact body accounting and the native cap.

These provider tests are boundary regressions. The producer incident test is the evidence that normal agent requests retire historical pixels and fit at the strict default. Do not interpret direct-provider rejection as a failing product-level incident regression.

## Superseded work and verification status

Earlier uncommitted work proposed a 32,000,000-byte default native media budget plus one ordinary compression pass. Its design, test expectations, and green checks are superseded by request-view retirement; they are not evidence for the current behavior. The explicit-large-override and strict full-body guard remain in scope. Previous verification and independent-review details are preserved only in earlier working logs, and those reviews apply to the prior design.

## Current focused verification

Fresh isolated runs recorded in `project-plans/.tmp-issue3984/provider-r3.log`:

- Anthropic incident provider regression: 6 passed, 0 failed. Confirms direct default 15 MiB rejection; explicit larger media admission succeeds when the body fits; and explicit 128 MiB media still cannot bypass the 32,000,000-byte body guard.
- `AnthropicEndpointUtils.test.ts`: 28 passed, 0 failed. Native default resolver is 15 MiB and the exact native body cap remains 32,000,000 bytes.
- Anthropic request-body guard: 6 passed, 0 failed.
- Historical retirement incident producer test: 8 passed, 0 failed. Confirms request-view recovery at the original strict 15 MiB budget, notes for retired history, pending newest image, canonical-history/source-pixel preservation, and explicit-zero rejection.

The prior 32,000,000-byte default-media acceptance expectation is superseded and intentionally not retained as a passing provider test. No baseline run was performed against those now-obsolete assertions. The current provider boundary tests validate rejection under the strict default; the actual agent producer incident test separately validates fitting through retirement, avoiding a test that would encode a direct-provider rejection as a product bug.

These focused checks preceded the subsequent broad verification cycles recorded
above. They do not replace complete workspace checks. No commit or push has
been made at this checkpoint.

## PR #3988 review and CI lint remediation (post de64fe1087)

**CI lint failure.** `Lint (Javascript)` failed with exit 2: the scoped run passed
`packages/lsp` (selected because only its ignored test files changed) and ESLint
refused it because every file there is ignored by `eslint.config.js`. The runner
tolerated that only for full-run package groups. Scoped targets that name an
existing `packages/<name>` directory now get `--no-error-on-unmatched-pattern`
too. A target that is not a package on disk (stale or mistyped) still fails
loudly, non-ignored source in a selected package is still linted, and no ignore
was added or broadened. Tests: `scripts/tests/run-lint-partition.test.ts`
(real ESLint over a fixture with an ignored, a clean and a dirty package). The
real repro `LLXPRT_LINT_TARGETS='["packages/lsp"]' bun scripts/run-lint.ts
--max-warnings 0` exits 2 on the old runner and 0 now.

**CodeRabbit threads (all five verified valid and fixed).**

1. `compressionCanRelieve` counted earlier non-image media even when pending
   media alone exceeded the budget. It now sums pending counted bytes and stops
   futile compression only for `RequestMediaByteOverflowError` with positive
   `error.budgetBytes` (the budget the request was rejected under, not the
   configured one). Body-overflow and non-positive-budget paths are unchanged.
2. `PendingMediaBudgetError` message is media-neutral and reports the pending
   media total it computed (not the resolver's first-crossing subtotal).
3. `buildOmissionFeedback` lists at most 20 entries per category plus
   "and N more omitted images not listed", bounds each label to 64 characters,
   and keeps the header count, guidance, and every tool-response block.
4. `RequestMediaByteOverflowError` message says the selected request media "has
   reached at least" the first-crossing subtotal and that later media was not
   counted; images, PDFs and audio all count. No extra materialization.
5. The `image-payload-budget-bytes` registry description now states the 15 MiB
   media default for every provider, the separate 32000000-byte native Anthropic
   body limit, and explicit `0` semantics (tool-batch filter and request-side
   retirement off; resolver rejects encoded media). The docs paragraph matches.

**Review-body follow-ups (outside diff).**

- `ChatSessionFactory.ts:278` reads the image payload budget once per session
  from `Config`'s construction snapshot. Valid but pre-existing at the merge base
  and a cross-package lifecycle change (getter, session and compression
  options); deferred, not part of this fix.
- `mcp-cutover-server-fixture.ts` `releaseHeldUnlessSettled`: declined. Releasing
  after the deadline is deliberate so an implementation that joins the held
  request completes instead of hanging; failing there would turn a slow abort
  into a hang or a different failure.

**Red/green evidence** (scratch, uncommitted, in `.tmp-issue3984/`):
`ci-remediation-{lint,enforcer,resolver,feedback,settings}-{red,green}.log`,
`ci-remediation-lsp-repro-{red,green}.log`, `ci-remediation-scoped-lint.log`.
Limits: the settings description test asserts the registry's user-facing text, and
the lint regression runs real ESLint on a fixture rather than on `packages/lsp`
itself; the `packages/lsp` run is covered by the repro logs above.

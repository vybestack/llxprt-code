# Issue #2760 plan: global fetch and existing HTML conversion

Plan ID: `PLAN-20260826-ISSUE2760`

## Purpose

Remove first-party ownership of `node-fetch` and Cheerio from the three web
tools. Use the standards-based global `fetch` provided by both supported
runtimes, Node >=24 and Bun >=1.3.14. Convert HTML text with the existing
`html-to-text` dependency, preserve Turndown markdown output, and preserve raw
content.

## Accepted behavior

### AC1: Standards-based transport

- GIVEN `direct-web-fetch`, `codesearch`, or `exa-web-search` executes
- WHEN it sends an HTTP request
- THEN production uses the unqualified standards global `fetch`
- AND production contains no `node-fetch` import, fallback, or Bun-specific
  transport branch
- AND existing endpoint, URL, header, JSON-RPC body, key, default, and result
  behavior is preserved.

The supported Bun runtime exposes the same global Fetch API and Web Stream body
surface used by Node 24. No separate Bun implementation is accepted.

### AC2: Existing status, retry, abort, timeout, and byte-budget behavior

- GIVEN `direct-web-fetch` receives any 4xx response
- WHEN the response is handled
- THEN the status is terminal under the accepted direct-fetch retry policy
- AND the rejected response is disposed.

- GIVEN `direct-web-fetch` receives a retryable 5xx response
- WHEN the existing retry policy starts another attempt
- THEN the rejected response body and connection are disposed before the next
  request begins
- AND the existing retry count and delay remain unchanged.

- GIVEN a caller signal is already aborted or aborts in flight
- WHEN any affected tool executes
- THEN transport is canceled and the existing tool error contract is returned.

- GIVEN the configured direct-fetch timeout expires
- WHEN a response remains in flight
- THEN transport is canceled
- AND cancellation is not retried.

- GIVEN a response declares or streams more than its byte budget
- WHEN its body is acquired
- THEN transport is canceled
- AND no partial body is returned
- AND exact-budget bodies still succeed.

The existing limits remain 5 MiB for `direct-web-fetch` and 4 MiB for the two
search tools.

### AC3: Content conversion

- GIVEN `Content-Type` identifies HTML and `format: "text"`
- WHEN `direct-web-fetch` converts the complete bounded response
- THEN it uses `html-to-text`
- AND the output demonstrates HTML structure conversion, entity decoding, and
  omission of script and style content.

- GIVEN HTML and `format: "markdown"`
- WHEN the response is converted
- THEN the existing Turndown options and removal list remain in use.

- GIVEN HTML and `format: "html"`
- WHEN the response is returned
- THEN the exact input HTML is unchanged.

- GIVEN non-HTML content with any requested format
- WHEN the response is returned
- THEN the exact input content is unchanged.

### AC4: First-party dependency removal

- GIVEN source and test scans show no accepted first-party consumer
- WHEN manifests are updated
- THEN `node-fetch` and Cheerio declarations are removed from root,
  `packages/core`, and `packages/tools`
- AND the unused CLI `node-fetch` declaration is removed because the published
  root package must cover every mandatory workspace dependency
- AND `package-lock.json` and `bun.lock` reflect those removals.

### AC5: Packed-base proof

- GIVEN fresh package tarballs from the candidate tree
- WHEN the packed root is installed into an empty directory with lifecycle
  scripts disabled for dependency inspection
- THEN packed source and manifests contain no root/core/tools/CLI import or
  direct edge for `node-fetch` or Cheerio
- AND `npm ls` and `npm explain` evidence covers `node-fetch`, `fetch-blob`,
  `node-domexception`, `cheerio`, `encoding-sniffer`, `whatwg-encoding`, and
  `whatwg-mimetype`
- AND any remaining path is attributed to an external owner rather than hidden
  with an override, resolution, or suppression.

## Inputs and boundaries

| Area | Input or boundary | Required evidence |
| --- | --- | --- |
| Direct success | Local 2xx response | Complete body returned through native fetch |
| Direct request | URL, query, Accept, user agent, language header | Loopback server observes actual request data |
| Search request | JSON-RPC method, tool name, query, limits, key | Loopback server observes actual URL, headers, and body |
| Status | Direct 400 and paced 503 followed by 200 | 400 has one hit; 503 connection closes before retry |
| Abort | Already-aborted and in-flight caller signal | No request for pre-abort; active transport closes in flight |
| Timeout | Delayed or paced direct response | Existing timeout error and one request only |
| Declared size | `Content-Length` above budget | Early rejection and transport cancellation |
| Observed size | Chunked exact budget and budget + 1 byte | Exact success; overflow is atomic and canceled |
| HTML text | Heading, paragraph, entity, script, and style | Real response proves `html-to-text` output |
| HTML markdown | Heading and elements covered by current options | Real response proves existing Turndown output |
| Raw HTML | Distinguishing whitespace and markup | Byte-for-string identity |
| Non-HTML | Text or JSON under all requested formats | Exact identity |
| Empty body | 2xx response with no content | Existing no-content behavior |
| Stream lifecycle | Success, read error, abort, overflow, early reject | Reader lock and abort listener released; cancellation once |
| Packed graph | Fresh tarball install | No first-party direct edge; external paths attributed |

## Test strategy

All accepted HTTP behavior uses real `node:http` loopback servers. Servers
produce statuses, headers, chunks, delays, and disconnect observations. Tests do
not construct expected network `Response` values.

The two tools with fixed Exa origins may install a narrow test-only global-fetch
router. The router may replace only the origin and must call a saved native
`fetch` against the loopback server. The server still supplies every status,
header, body byte, and request observation.

Standards `ReadableStream` instances are allowed only for bounded-reader
lifecycle edges that a loopback server cannot deterministically inject, such as
a stream controller read error. These tests exercise the real acquisition
helper and do not replace HTTP acceptance tests.

Final affected tests contain no `node-fetch` or Cheerio imports, module mocks,
direct-value network stubs, or assertions about mock calls.

### Focused suites

- `packages/tools/src/tools/direct-web-fetch.test.ts`
- `packages/tools/src/tools/direct-web-fetch-real-transport.bun.test.ts`
- `packages/tools/src/tools/codesearch.test.ts`
- `packages/tools/src/tools/codesearch-endpoint.bun.test.ts`
- `packages/tools/src/tools/exa-web-search.test.ts`
- `packages/tools/src/acquisition/bounded-http-response.test.ts`
- `packages/tools/src/acquisition/bounded-http-response-lifecycle.test.ts`

### RED and GREEN sequence

1. Run the real-server tests against unmodified `main` production source and
   retain the natural failures as RED evidence.
2. Use global fetch and adapt the existing bounded HTTP acquisition helper to
   native `Response.body` Web Streams.
3. Run focused transport and lifecycle tests GREEN.
4. Replace Cheerio text extraction with `htmlToText` and run conversion tests
   GREEN.
5. Prove no accepted source consumer remains, remove only the accepted manifest
   declarations, and regenerate both lockfiles.
6. Build fresh tarballs and capture packed-base dependency evidence.

## Implementation constraints

- Reuse `BoundedStreamCollector`; do not create a second body collector.
- Cancel a locked body through its active Web Stream reader and release the
  reader lock on every settlement path.
- Preserve current public types, endpoints, timeout contract, error taxonomy,
  API limits, result limits, and byte budgets. Preserve the accepted per-tool
  retry contract: every direct-fetch 4xx is terminal, retryable 5xx responses
  retain three attempts and 500 ms initial backoff, and the shared retry helper
  remains unchanged for other consumers.
- Do not introduce another acquisition subsystem, public endpoint abstraction,
  transport wrapper, or compatibility fallback.
- Do not change CLI behavior. Removing its unused `node-fetch` declaration is
  permitted only to satisfy the published root package's workspace dependency
  contract.

## Non-goals

- VSCE dependency work tracked by #2754.
- Removal of external transitive copies owned by Google or other dependencies.
- API, token, result, byte-limit, timeout, error-contract, or retry changes
  beyond the accepted direct-fetch all-4xx terminal policy.
- Undici as an HTML parser.
- Overrides, resolutions, suppressions, or vulnerability-policy changes.
- Workflows, quality tools, agent memory, public transport abstractions, or
  unrelated refactors.

## Verification gates

1. Focused suites pass with real transport.
2. `bun scripts/test-audit/scan.ts` adds no `MOCK_MIRROR`, `ALWAYS_TRUE`,
   `SELF_CONFIRMING`, or `NO_ASSERT` finding on changed tests compared with
   clean `main`.
3. Source and manifest scans pass.
4. Fresh packed-base graph evidence passes.
5. Full local cycle passes:
   - `npm run test`
   - `npm run lint`
   - `npm run typecheck`
   - `npm run format`
   - `npm run build`
   - `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`
6. Deepthinker review and no more than two local Open Code Review rounds are
   complete.
7. Every finding is classified as `Blocker-Fix`, `In-scope-Fix`, `Reject`, or
   `Defer`; every `Blocker-Fix` and `In-scope-Fix` item is resolved.
8. Candidate-head CI and CodeRabbit pass, no actionable review thread remains,
   and the PR is conflict-free with correct ancestry.

## Evidence status

### Remediation findings

- `In-scope-Fix`: abort and overflow errors could be replaced by failures from
  `reader.cancel()`, unlocked `body.cancel()`, or request cancellation. Cleanup
  now attempts stream cancellation, request cancellation, reader release, and
  listener removal while preserving the primary abort, overflow, or read error.
- `In-scope-Fix`: deterministic lifecycle cases fabricated `Response` objects
  around synthetic streams. Success, ordinary abort, observed overflow,
  declared overflow, and the abort/overflow race now use native fetch responses
  from loopback HTTP servers. Synthetic streams remain only for injected read
  and cancellation failures and enter through `BoundedFetchResponse` object
  literals.
- `In-scope-Fix`: direct terminal-status coverage used only 400. Native
  loopback coverage now proves that 401, 403, and 429 each make one request,
  dispose the rejected response, cancel the server connection, and expose no
  partial body.
- `In-scope-Fix`: the unreachable `undefined` branch after a non-done Web Stream
  read was removed. The implementation relies on the typed stream invariant.
- `In-scope-Fix`: this evidence section replaces the stale pending status.
- The StepFun inactive-subscription response and the missing Kimi model are
  external verification blockers. They do not indicate code changes for this
  issue.

### TDD and focused verification

- Cancellation authority RED: the initial lifecycle run returned
  `reader cancellation rejected` instead of `AbortError` for already-aborted
  and mid-flight acquisition, returned the same cleanup error instead of
  `HttpBodyTooLargeError` for observed overflow, and returned
  `body cancellation rejected` instead of the declared overflow error. The same
  run exposed a Bun-specific invalid post-abort reader assertion in the native
  declared-overflow case; that assertion was removed because this path acquires
  no reader.
- Read-error authority RED: an injected `cancelRequest()` exception produced
  `request cancellation failed` and left acquisition pending until the command
  timeout instead of returning `stream read failure`.
- Terminal-status mutation RED: with the local terminal-4xx condition removed,
  the 401, 403, and 429 cases each observed three requests instead of one. The
  production condition was restored before GREEN.
- Lifecycle GREEN: 12 tests passed with 37 assertions. Terminal 401, 403, and
  429 GREEN: 3 tests passed with 18 assertions.
- Before OCR remediation, the seven focused suites passed 73 tests with 245
  assertions. OCR remediation raised the result to 74 tests with 249 assertions.
  The final deep-review remediation passes 74 tests with 250 assertions and no
  failures.
- Focused ESLint, tools typecheck, and focused Prettier checks passed.
- `bun scripts/test-audit/scan.ts` scanned 2,715 files with no scanner errors.
  The current affected-test findings file is empty. The clean-main file contains
  one earlier CodeSearch `MOCK_MIRROR` finding, and the comparison removes it, so
  this change adds no `MOCK_MIRROR`, `ALWAYS_TRUE`, `SELF_CONFIRMING`, or
  `NO_ASSERT` finding.

### Open Code Review round 1

- `In-scope-Fix`: duplicated Exa router, server lifecycle, request-body, and key
  storage setup now uses one typed loopback test helper. The same helper removes
  generic server duplication from the two bounded-acquisition suites. Specialized
  pacing and connection-state logic remains local.
- `In-scope-Fix`: the CodeSearch and Exa settlement guards now use named 5,000 ms
  CI timeouts and clear their handles on every settlement path.
- `In-scope-Fix`: `disposeHttpResponseBody` now cancels an unlocked response body
  and invokes request cancellation without allowing either cleanup failure to
  replace the caller's primary status error. Native-fetch loopback RED evidence
  captured the missing body cancellation and cleanup-error replacement; focused
  GREEN passed 2 tests with 5 assertions.
- `In-scope-Fix`: the direct-fetch 4xx comment now identifies omission of the
  `status` property. The endpoint suite now uses static production imports.
- `Reject`: changing `htmlToText(html).trim()` or its default wrapping would
  violate the accepted conversion contract.
- `Reject`: synthetic Content-Length and UTF-8 transport cases are not restored;
  real-server boundary tests cover the supported transport contract.
- `Reject`: the post-read abort guard remains because abort can occur while the
  read is pending. Broad extraction of specialized direct-fetch or Exa pacing
  logic is also rejected because those behaviors differ.
- Evidence is under `tmp/issue2760/ocr-remediation/`. This round did not run the
  full repository suite or an external smoke test.

### Deep review remediation

- `In-scope-Fix`: the two direct-fetch suites duplicated generic loopback
  server registration, URL construction, writer tracking, and lifecycle cleanup.
  Both now use `createLoopbackHarness`; their direct-fetch connection state and
  pacing remain local. This is a test-only refactor with no production behavior
  change.
- `In-scope-Fix`: the main observed CodeSearch request supplied an explicit
  `tokensNum: 4000`, so real transport did not prove the accepted default. The
  request now omits `tokensNum` and the loopback server observes `5000`. The
  settings-cap case continues to cover explicit `4000` input.
- `In-scope-Fix`: `collectRequestBody` settled only on `end` and retained its
  listeners. It now settles once on `end`, `error`, or `aborted`, removes all
  four listeners before settlement, and resolves with buffered content on every
  path so fire-and-forget callers cannot create an unhandled rejection.
- RED evidence: the revised CodeSearch request contract observed the default
  `5000`, but failed because the settled request retained one `data` and one
  `end` listener. GREEN evidence: the seven focused suites passed 74 tests with
  250 assertions. Both direct-fetch suites contributed 21 tests and 90
  assertions.
- Tools typecheck and focused ESLint passed. Focused Prettier formatting was
  applied. The test audit scanned 2,715 files without scanner errors; the seven
  focused suites have no current prohibited-pattern finding, removing the one
  clean-main `MOCK_MIRROR` baseline finding.
- Evidence is under `tmp/issue2760/deep-review-remediation/`. This remediation
  did not rerun packed archives, the full repository test or lint commands, or
  an external model smoke test. Those candidate-wide gates remain pending.

### Final independent review remediation

- `Blocker-Fix`: abort and overflow paths waited for `reader.cancel()` or
  `body.cancel()` before returning the authoritative error. A standards stream
  cancellation algorithm may never settle. Concrete request cancellation now
  starts immediately, stream cancellation is detached best-effort cleanup, the
  reader lock is released without waiting, and the primary error settles
  independently.
- RED evidence: two synthetic standards-stream cases whose cancellation promise
  never settles both remained pending beyond the 100 ms observation boundary.
  These fixtures cover a cancellation failure that loopback transport cannot
  inject deterministically.
- `In-scope-Fix`: the direct connection-refusal test released an ephemeral port
  before using it. A live loopback server now accepts each request and destroys
  the socket before response headers, deterministically proving three attempts
  and the `FETCH_ERROR` result.
- GREEN evidence: the seven affected suites pass 76 tests with 259 assertions.
  Tools typecheck, focused ESLint, focused Prettier, the 2,715-file test audit,
  and `git diff --check` pass. The changed tests have no audit finding.
- `Reject`: suggestions to change `htmlToText(html).trim()`, import production
  byte-budget constants into contract tests, restore synthetic malformed-header
  cases, generalize unused `Request` routing, or combine specialized pacing
  helpers conflict with accepted behavior or weaken test independence.
- `In-scope-Fix`: the final audit filter accidentally copied two unrelated
  settings findings into its affected-test TSV while its summary reported zero.
  The regenerated current file is empty, the retained clean-main file contains
  the one earlier CodeSearch finding, and the comparison proves that the current
  candidate removes it and adds no affected-test finding.
- `In-scope-Fix`: the final request-contract review found incomplete exact-header
  coverage for direct fetch and incomplete no-key query coverage for CodeSearch.
  Native loopback tests now assert all three complete `Accept` values, the full
  User-Agent and Accept-Language values, and the exact no-key query shape.
- `In-scope-Fix`: status-response disposal did not separately prove prompt
  primary-error settlement when stream cancellation rejects or never settles.
  Two synthetic standards-stream tests now cover those cleanup failures without
  fabricating a network `Response`.
- Mutation RED runs failed one direct-fetch request test, one CodeSearch query
  test, and two disposal tests. After restoring production byte for byte, the
  seven affected suites passed 78 tests with 262 assertions. The final 2,715-file
  audit had no current affected-test finding and removed the one clean-main
  CodeSearch finding.

### Local Open Code Review round 2

- The final allowed local round completed over 15 selected issue files with 11
  comments. Each comment was checked against the implementation, accepted
  contracts, repository test rules, and current evidence. No comment was
  accepted as a candidate defect.
- `Reject` 1: `settleWithin` does not create an unhandled rejection after its
  timeout wins. `Promise.race` installs rejection handlers on every input and
  retains them after settlement. Converting a later rejection to
  `{ settled: false }` would also misreport a real rejection as a timeout.
- `Reject` 2: restoring synthetic malformed or unsafe `Content-Length` response
  fixtures conflicts with the native-transport test constraint. Native fetch
  rejects wire-invalid headers before bounded acquisition sees them; real
  missing-length and observed-overflow cases prove the production fallback.
- `Reject` 3: cancellation cleanup failures are intentionally suppressed so they
  cannot replace the authoritative abort, overflow, read, or status error.
  Request and stream cancellation are independent attempts. Adding a logging
  dependency to this low-level helper would change the accepted error contract.
- `Reject` 4: the 100 ms races exercise synthetic cancellation promises that
  deliberately never settle. The production error settles synchronously without
  network I/O. An eventual-settlement assertion without a deadline would hang on
  the exact regression these tests prevent.
- `Reject` 5: direct-fetch 4xx behavior is explicit in `isTerminal4xx`, omits the
  shared retry helper's retryable status property, and uses a fixed non-transient
  message. The error name remains diagnostic. Mutation coverage proves 401,
  403, and 429 each make one request; the same branch covers every 4xx.
- `Reject` 6: the two direct-fetch pacing helpers are not verbatim duplicates.
  Their state and settlement behavior differ because one proves all retry
  attempts stop their writers. Generic server, writer, URL, and cleanup behavior
  is already shared; merging the specialized helpers would blur their contracts.
- `Reject` 7: the exact 5 MiB boundary test intentionally writes one bounded body
  without pacing. Its 5 MiB allocation is the production limit under test and
  has passed repeatedly. Adding server-side pacing or drain handling would test
  a different transport behavior and lengthen the boundary case.
- `Reject` 8: request listener counts directly verify the shared request-body
  collector removes every listener on settlement. This mutation-sensitive
  assertion caught retained listeners during RED and uses the public Node stream
  API rather than an undocumented runtime detail.
- `Reject` 9: the explicit `return` in the cancellation catch is behaviorally
  neutral and documents that a cleanup failure ends the best-effort attempt.
  Replacing it with an empty catch is a style-only change.
- `Reject` 10: `collectRequestBody` intentionally resolves buffered content on
  `end`, `error`, or `aborted` so fire-and-forget drain callers cannot produce an
  unhandled rejection. Contract tests still fail on truncated JSON or an exact
  body mismatch. Rejecting would break the helper's other intentional callers.
- `Reject` 11: teardown closes servers before awaiting tracked writers so a
  forgotten or blocked writer cannot hang cleanup. Tests that assert writer
  behavior call `settleWriters` before teardown. Reversing the order would make
  teardown wait on the transport it is responsible for terminating.
- The round produced no accepted fix. A later independent review accepted one
  additional test-coverage finding, so the focused suite, audit, and packed
  evidence below supersedes the evidence available when this round completed.

### Independent review classification

- `Reject`: a review proposed restoring the shared retry helper's 401, 403, and
  429 retries to direct fetch. That conflicts with AC2's accepted direct-fetch
  contract that every 4xx is terminal. The shared helper remains unchanged for
  other consumers, retryable 5xx behavior retains three attempts and 500 ms
  initial backoff, and native loopback mutation coverage proves 401, 403, and
  429 each make one request and dispose the rejected transport. No candidate
  change is accepted for this finding.
- `In-scope-Fix`: the null-body branch of bounded acquisition lacked direct
  coverage. Bun 1.3.14 exposes a non-null native stream for a real loopback 204,
  while Node 25 exposes `body === null`, so a structural `BoundedFetchResponse`
  with native `Headers` and `body: null` now proves the branch without creating
  a network `Response`, synthetic stream, mock, `any`, or type assertion. The
  seven affected suites pass 79 tests with 265 assertions after this fix.
- `Reject`: a review cited the older `tmp/issue2760/full-test-foreground.log` and
  claimed that this plan listed the wrong full-suite failures. The newer
  `tmp/issue2760/remediation/full-test-final-foreground.log` records the seven
  unchanged Agents failures described below. The plan uses the latest run.
- The final 2,711-file audit reports no finding in the touched tests, so the
  added lifecycle case and null-body guard add no test-audit finding.

### PR review and CI remediation

- The scripts CI shard found that the published root package did not declare the
  CLI workspace's mandatory `node-fetch` dependency. Repository search found no
  CLI source use, so the unused CLI declaration and its lockfile ownership were
  removed rather than restoring the root dependency or weakening the package
  contract. The exact publish-integrity suite now passes 38 tests with 106
  assertions.
- A failing lifecycle test proved that a reader `releaseLock()` failure could
  replace an authoritative abort error. Cancellation now settles the primary
  error before best-effort reader cleanup, while normal successful reader release
  remains strict.
- Accepted review cleanup also aligns a paced server's declared length with its
  emitted bytes, rejects null JSON-RPC `params` in the test type guard, and removes
  an unused terminal-status error name without changing the all-4xx-terminal
  contract.

### Final candidate verification

- After PR remediation, `npm run build`, `npm run typecheck`, `npm run format`,
  `npm run format:check`, `npm run check:lockfile`, and `git diff --check HEAD`
  passed.
- The post-rebase `npm run lint` exited 134 because its lint runner forced ESLint
  to a 12,288 MiB heap and V8 exhausted that heap. A direct run of the same
  full-tree `eslint .` command with a 24,576 MiB heap passed. The package-script
  result is an environment/resource blocker, not a reported lint violation.
- Source and manifest scans found no first-party `node-fetch` or Cheerio import,
  mock, or direct declaration in the root, core, tools, or CLI packages.
- The final remediated root archive contains 4,726 files, is 12,581,097 bytes,
  has an unpacked size of 52,914,985 bytes, and has SHA-1
  `d6dbc1f969fc7034c30618218796fcbfb4053172`. Current and packed hashes match
  for the root, CLI, core, and tools manifests and every changed tools production,
  test, and helper source file.
- The archive installed 505 packages in an empty project with lifecycle scripts
  disabled. Its first-party manifests and source contain no forbidden direct
  declaration or import.
- Packed-install `npm ls` and `npm explain` attribute the remaining
  `node-fetch@3.3.2`, `node-fetch@2.7.0`, `fetch-blob`, and
  `node-domexception` paths to `@google/genai` or `google-auth-library` through
  `gaxios`. Cheerio, `encoding-sniffer`, `whatwg-encoding`, and
  `whatwg-mimetype` are absent.
- The final complete `npm run test` passed after remediation. The seven affected
  tools suites also pass independently: 80 tests with 266 assertions.
- The StepFun smoke failed with HTTP 400, `you have no active step plan
  subscription`. The ollamakimi smoke failed with HTTP 404 because model
  `kimi-k2.7` was not found. Neither external smoke passed.

### Remaining gates

- Every independent-review finding is classified. All accepted findings are
  remediated, stale OCR accounting is corrected above, and the proposal to
  restore 401, 403, and 429 retries is rejected against AC2's accepted contract.
- Both allowed pre-PR local Open Code Review rounds are complete. PR review
  findings have also been classified, and every accepted finding is remediated.
- The implementation is rebased onto `origin/main` at `354957220` and published
  as PR #3370. CI, CodeRabbit, final PR review, and conflict-free status are
  checked through PR automation. Merge requires explicit user approval.

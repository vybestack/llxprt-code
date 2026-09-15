# Issue #3658: openai provider streaming intermittently throws `undefined is not a function` against api.z.ai coding endpoint

Branch: `issue3658`. Labels: ci/cd, Model Support. Milestone 0.12.0. Parent context: #3652.

## Root cause (verified in-repo)

- OpenAI SDK 5.23.2 `ReadableStreamToAsyncIterable` (`node_modules/openai/internal/shims.mjs`)
  short-circuits: `if (stream[Symbol.asyncIterator]) return stream;`.
- Bun 1.3.14 (`.bun-version`) makes `ReadableStream` natively async-iterable, so
  `Stream.fromSSEResponse` → `_iterSSEMessages` iterates the SSE body through
  Bun's runtime-native `ReadableStreamAsyncIterator` — the exact frames in the
  reported stack (`native:1:11` → `ReadableStreamAsyncIterator (native:2:153)`).
- That native path intermittently (~1 in 12–15 live calls) throws
  `TypeError: undefined is not a function` mid-stream with no HTTP status.
- `instantiateClient` (`packages/providers/src/openai/OpenAIClientFactory.ts`)
  installs no custom `fetch`, so nothing stands between the SDK and the native
  iterator today.

Fix: install a `fetch` wrapper on every client built by `instantiateClient`
whose OK-response bodies expose an explicit reader-based JS async iterator we
own. The SDK shim adopts ours because `Symbol.asyncIterator` is present, so SSE
body iteration never enters the runtime-native iterator. Additionally,
`processStreamingChunk` gets one bounded debug record when it skips a
choices-less frame so any residual odd frame shape is diagnosable
(`OpenAIStreamProcessor.ts` L489 early return; usage is already captured
before it, so usage-only final frames work today and must keep working).

Rejected alternatives: frame-shape tolerance alone (parser already tolerates
the hypothesized shapes; cannot fix a native-frame TypeError); classifying the
error as retryable (pinned non-retryable by
`__tests__/LoadBalancingProvider.failover.retryable.test.ts`, and mid-stream
replay violates #3049); changing `.bun-version`/CI pins (out of scope).

## Acceptance criteria

- **AC1 — Wrapper installed, pass-through correctness.**
  `instantiateClient` sets `clientOptions.fetch` to the stream-safe wrapper.
  The wrapper returns the *original Response instance by reference* for
  non-OK responses, responses without a body, and bodies with no
  `Symbol.asyncIterator` (non-Bun runtimes keep the SDK's reader polyfill).
- **AC2 — Owned reader-based iteration.** For OK responses with a natively
  async-iterable body, the wrapped body exposes our own `Symbol.asyncIterator`
  (an explicit `getReader().read()` loop) yielding byte-identical chunks;
  `getReader()` stays usable; iterator `return()` cancels + releases the
  underlying reader (mirrors the SDK polyfill's cancel semantics used by
  `CancelReadableStream`).
- **AC3 — Full Response delegation.** Wrapped response delegates `status`,
  `statusText`, `ok`, `url`, `type`, `redirected`, `headers` (same `Headers`
  instance), `bodyUsed`, `clone()`, `text()`, `json()`, `arrayBuffer()`,
  `blob()`, `formData()` so non-streaming and error parse paths behave
  identically.
- **AC4 — Bounded skip-log, zero behavior change.** `processStreamingChunk`
  emits exactly one debug record at the existing `choice === undefined` early
  return: `{ chunkCount, frameKeys: sorted keys, hasUsage, object? }` — never
  raw frame text. Usage-only frames still populate terminal usage metadata.
- **AC5 — Policy invariance.** No new suppression directives, no ESLint
  severity downgrades, no complexity/size threshold increases, no new
  `ignores:` blocks; `npm run test`, `npm run lint` (+ `lint:ci`,
  `lint:eslint-guard`), `npm run typecheck` all pass.

## Boundary cases

- Non-OK response (SDK error path consumes `text()`) → untouched by reference.
- `body === null`; body lacking `Symbol.asyncIterator` → untouched.
- Usage-only final frame (no `choices`) → usage captured (existing), now logged.
- `choices: []` frame → skipped (existing), now logged.
- SSE `: keep-alive` comment lines → SDK SSE parser handles; no change.
- Mid-stream cancellation → our iterator `return()` cancels the reader.
- `globalThis.fetch` test doubles → wrapper resolves the inner fetch lazily at
  call time.
- No whole-body buffering — chunk consumption stays inline (#1846).

## Tests (test-first, bun:test, colocated)

New `packages/providers/src/openai/openaiStreamFetchSafety.test.ts`:

1. Wrap: OK SSE Response → wrapped `body[Symbol.asyncIterator]` is ours, not
   the native one; for-await yields byte-identical content to `getReader()`.
2. Non-OK → same Response instance (reference equality).
3. `body === null` / no `Symbol.asyncIterator` → original response unchanged.
4. Delegation: `status`/`ok`/`url`, same `Headers` instance; `json()` on a
   wrapped unconsumed JSON response returns the payload.
5. `return()` cancels the underlying stream; subsequent `next()` is done.
6. `wrapped.body.getReader()` returns a working reader.
7. SDK adoption pin: real `new OpenAI({ fetch: wrapper(mockFetch) })` client
   iterating an SSE body with keep-alive comments, `choices: []`, usage-only
   final frame, `data: [DONE]` — decoded chunks + final usage correct, and the
   SDK provably consumed OUR iterator.
8. Lazy fetch resolution: replace `globalThis.fetch` after construction.

Extend `OpenAIClientFactory.test.ts` (`describe('instantiateClient')`):

9. `client._options.fetch` is defined and callable.
10. Existing `defaultHeaders`/`baseURL`/agents assertions unchanged.

Extend `OpenAIStreamProcessor.retention.test.ts` (logger-override harness):

11. `choices: []` + usage-only chunk: no throw, same visible output, skip
    debug record emitted with bounded metadata, usage-only frame still yields
    terminal usage metadata.

Implicit integration coverage (run + cite, no edits):
`OpenAIProvider.emptyResponseRetry.test.ts`, `transportRouting.test.ts`,
`caching.test.ts`, `kimiCacheTransport.test.ts` all stream real `Response`
bodies through the SDK once the wrapper is wired.

## Scope boundaries

- Changes confined to `packages/providers` (openai dir only).
- Do NOT touch: anthropic factory, `openai-responses` (already reader-based at
  `parseResponsesStream.ts` L870), `openai-vercel` (AI SDK path),
  `.bun-version`, CI Bun pins, retry classification.
- No new dependencies; TS + bun:test only; no new JS/vitest files.

## Verification

- `bun scripts/run_bun_tests.ts --workspace providers` (fast loop)
- `npm run test`, `npm run lint`, `npm run lint:ci`, `npm run lint:eslint-guard`
- `npm run typecheck`, `npm run format`, `npm run build`
- Smoke: `bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"`
- Optional CI-evidence (not gating): live zai coding endpoint run of
  `integration-tests replace.test.ts run_shell_command.test.ts`.

## Evidence

- Verification logs: `tmp/issue3658/` (initial round) and `tmp/issue3658/remediation1/` (remediation + full gates), `tmp/issue3658/review/` and `tmp/issue3658/review2/` (reviewer probes).
- Commits: d6ab6e7104 (wrapper + skip-log + tests), 1fdee5b844 (review remediation).
- Related: #3652 (parent), #2450 (retry pin), #1846 (inline consumption),
  #3049 (no mid-stream replay), #584/#764 (continuation path inherits fix),
  #2817 (transport parity suite).

## Review outcome (two rounds, at cap)

Round 1 (deepthinker) REJECT with two findings, both fixed in 1fdee5b844:
- Blocker-Fix — wrapper captured `response.body` once; after `clone()` the
  original served a stale stream (empty reads for string-backed bodies,
  "ReadableStream is locked" for stream-backed, reproduced on Bun 1.3.14).
  Fix: body state served through a swappable `bodySource` (body getter
  re-reads + memoizes per reference); `clone()` tees the current body so
  original and clone each consume their own branch with full bytes.
- In-scope-Fix — skip-log forwarded unvalidated `chunkRecord.object`; a
  nested 100k-char payload produced a ~100kB record. Fix: string-only,
  truncated to 64 chars, non-strings omitted.

Round 2 verdict: APPROVE-WITH-FINDINGS. Fresh reruns: providers 641/641,
lint:ci, lint-eslint-guard, typecheck all pass; recorded full-test/build/
smoke evidence audited (exit 0, live haiku). Deferred findings (documented,
no current consumer; revisit if one appears):
- `clone()` loses `url`/`type`/`redirected` fidelity (Response constructor
  cannot restore them); the OpenAI SDK never clones responses.
- Disturbed-body clone edges diverge from Bun-native behavior (clone after
  partial read throws per WHATWG where Bun silently succeeds; clone after
  full consumption yields empty branches where native throws).
- Rejected: wrapper is not `instanceof Response` — the SDK only
  instanceof-checks on the upload path, which the wrapper never touches.

OCR was not run for this effort (paused until re-enabled); the two-cycle
review requirement was met with the deepthinker and reviewer subagents.

## CodeRabbit follow-up (commit e75c46a59c)

Both inline threads on PR #3684 were fixed (classified In-scope-Fix):
- clone() metadata fidelity: the wrapper now delegates status/statusText/
  ok/url/type/redirected/headers to the original response while clone()
  serves its body from an independent tee branch sharing that metadata
  source, so immutable fields survive cloning. Moves the round-2 defer
  item above to fixed; tests cover url delegation via a real local server.
- Skip-log frameKeys bounding: sorted keys capped at 16 entries, each
  truncated to 64 chars (mirrors the object-tag cap), with regression
  tests for a 30-key frame and a 200-char key.
Also added JSDoc to diff-touched helpers flagged by docstring coverage.
Full cycle green: red 3-fail -> green 52-pass on touched files, providers
641/641, lint, typecheck, format, build, full npm test, live smoke —
all exit 0 (tmp/issue3658/coderabbit1/).

# Issue 2918 implementation plan

## Purpose

Issue 2918 collects the OCR findings left over from PR #2858 (Bun migration of
the core and auth workspaces). It is written as a survey rather than a change
request: twelve numbered findings plus a category of items already fixed, spread
across two workspaces, one production package that the migration never touched,
and one script. Several findings describe files that no longer exist, and
several describe Bun limitations that were asserted in the issue text but never
measured.

This plan converts that survey into accepted behavior. It does three things:
it re-tests every claim against the `issue2918` branch as it stands today, it
accepts only the findings that still describe real gaps in what the tests prove,
and it routes or rejects the rest with the evidence that supports the decision.

The accepted work is deliberately narrow. A small set of test behaviors gain
real assertions, the test runner inventory records the Bun constraints that
tests must live with, and a follow-up issue captures a production concern in
`packages/agents` that does not belong to a test-quality cleanup.

## Current-state evidence

All evidence below was measured on branch `issue2918` with a clean working tree,
using Bun 1.3.14.

### Baselines are green before any change

```
packages/auth: bun test src/proxy/__tests__/proxy-socket-client.test.ts \
                        src/__tests__/oauth-errors.redaction.spec.ts
  -> 27 pass, 0 fail
packages/core: bun test src/utils/shell-parser.test.ts \
                        src/config/liveTrustTransitionLifecycle.test.ts
  -> 45 pass, 0 fail
```

Nothing in this issue is failing CI. What these suites prove is weaker than
what their names claim.

### Bun can drive the shell-parser error path (contradicts finding 1)

Finding 1 asserts that the missing-`Language` error path cannot be tested under
Bun because `vi.resetModules()` is unsupported. The reasoning stops one step
short: the core workspace runner
(`packages/core/run-bun-tests.ts`) already gives every test file its own
`bun test` process, so a process-wide module mock declared in a dedicated file
affects nothing else.

A scratch file placed in `packages/core/src/utils/`, registering
`mock.module('web-tree-sitter', ...)` with a `Parser` export and no `Language`
export, then dynamically importing `shell-parser.js`, produced:

```
(pass) probe > records the missing-Language error [10.99ms]
 1 pass  0 fail  3 expect() calls
```

The probe asserted `initializeParser()` resolves `false`, `isParserAvailable()`
is `false`, and `getInitializationError()?.message` contains
`Language export not found`. The scratch file was removed after the run; the
working tree remained clean.

The production diagnostic it verifies is `packages/core/src/utils/shell-parser.ts`
line 260:

```
'web-tree-sitter Language export not found; expected top-level or default-nested Language.load()'
```

The test that currently stands in its place
(`shell-parser.test.ts`, "should record initialization errors when tree-sitter
exports are missing") asserts `typeof result === 'boolean'` and
`isParserAvailable() === result`. Both hold whatever the production code does.

### Bun can drive the proxy idle timer (contradicts finding 8)

Finding 8 records that the idle-timer tests bypass the timer by calling
`gracefulClose()` directly. The in-file comments explain why: the idle timer is
created with a real `setTimeout` before fake timers are activated, so advancing
fake timers cannot reach it.

The constraint comes from the call order the tests use. Activating fake timers
*before* the client is constructed puts the idle timer on the faked clock. Two
scratch cases confirmed it:

```
(pass) probe > reconnects with a new handshake after the idle timer fires [206.79ms]
(pass) probe > does not fire before the idle deadline [206.37ms]
 2 pass  0 fail
```

The first advanced `IDLE_TIMEOUT_MS + 1`, restored real timers, and observed the
server accept a second handshake. The second advanced `IDLE_TIMEOUT_MS - 1` and
observed no socket close. An earlier probe attempt hung and had to be killed:
it waited on a `Date.now()` deadline while fake timers were still active, and
Bun's fake timers freeze `Date.now()`. That failure is a boundary case the
accepted tests must respect, and it is recorded as such below.

Relevant production shape (`packages/auth/src/proxy/proxy-socket-client.ts`):
`IDLE_TIMEOUT_MS` is 300000, `armIdleTimer()` schedules
`setTimeout(() => this.gracefulClose(), IDLE_TIMEOUT_MS)` and unrefs it.

### The redaction suite's zero-delay configuration is inert or wrong

`packages/auth/src/oauth-errors.ts` computes the retry delay as
`oauthError.retryAfterMs ?? Math.min(baseDelayMs * multiplier^(n-1), maxDelayMs)`,
rounds it, logs `retrying in ${delayMs}ms...`, and sleeps for it.

Three tests in `oauth-errors.redaction.spec.ts` configure
`baseDelayMs: 0, backoffMultiplier: 1, maxDelayMs: 0, jitter: false`:

- "must log a finite numeric delay, not a direct tainted property read"
  (`maxAttempts: 3`, error carries `retryAfterMs: 250`). The zero configuration
  is overridden. Measured duration: **254.76ms**, which is the 250ms sleep. Its
  assertion is `/retrying in \d+ms/`, which passes for any number, including one
  that ignored the provider value entirely.
- The two `GracefulErrorHandler` cases use `maxAttempts: 1`, so the delay
  branch is never reached. Measured durations: 0.62ms and 0.24ms. Their zero
  configuration is inert rather than incorrect.

### One residual `Promise<void>` weak assertion remains

`whenSettled()` is declared `async whenSettled(): Promise<void>`
(`packages/core/src/config/liveTrustTransitionLifecycle.ts` line 168). In its
test file, line 219 asserts `resolves.toBeUndefined()` and line 176 asserts
`resolves.toBeFalsy()` on the same call. The second would also pass on `null`,
`0`, `''`, or `false`.

The successful Bun `fs.access()` resolutions named by finding 5 are separate:
`integration.advanced.test.ts` and `integration.basic.test.ts` intentionally use
`resolves.toBeFalsy()` for those recording checks. No repository-wide claim
about other `toBeFalsy()` uses is needed here.

### Findings that no longer describe the repository

| Claim in the issue | What is there now |
| --- | --- |
| Weak retry-timing tests in `oauth-errors.test.ts` (finding 6; the issue used its former `oauth-errors.spec.ts` name) | The weak tests were replaced under issue #2904 (commit `16088e082`, PR #3110). The renamed suite now has deterministic fake-timer tests for exponential backoff, `maxDelayMs` caps, `retryAfterMs`, and jitter. |
| `config.includeDirectories.test.ts`, `config.initializeBoundary.test.ts` async-factory concern (finding 2) | Both files exist under `packages/core/src/config/`. They pre-import actual values and pass synchronous mock factories, so the old concern is already addressed. |
| `importOriginal()` would break under `test:vitest` (finding 2) | No live `importOriginal()` call remains anywhere in `packages/`; the remaining matches are explanatory comments in core and CLI tests. Vitest was removed entirely by issue #2970, and `npm run lint:no-vitest` prevents its return, so there is no second runner to break. |
| `trackServerSockets` called on every connection (finding 8) | The helper opens with `if (trackedServers.has(srv)) return;`, so the `connection` listener is registered once per server. |
| `config-lsp-integration.test.ts` uses `toBeFalsy()` for absence checks (finding 10) | The relevant absence assertions use `toBeUndefined()`, and no `toBeFalsy()` remains in the file. Other assertion forms remain for other behaviors. |
| `task.ts` calls `heartbeat.stop()` after the closing tag (finding 11) | `task.ts` lines 536-539 read `finally { heartbeat.stop(); emitClosingSubagentTag(); }`. |
| `scripts/ocr-benchmark.mjs` diff-filter, error handling, timeout (finding 12) | The file is `scripts/ocr-benchmark.ts`, and `gitDiffStat` passes `--diff-filter=ACMRTUXB`, which excludes deletions by construction. `--timeout` is validated. `--process-timeout-ms` is configurable, while invalid or missing values default to 3,600,000. The broad error-handling finding is underspecified, so no script change is accepted here. |
| `augment-bun-vi.ts` duplicate `clearAllTimers` and redundant `setSystemTime` (category C) | No file by that name exists in the repository. Tests import `bun:test` directly with no compatibility layer. |
| `skillManager.test.ts` missing `LlxprtExtension` import (category C) | Imported at line 12. |
| `contextManager.test.ts` missing `MemoryLoadResult` import (category C) | Imported at line 15 of `packages/core/src/services/contextManager.test.ts`. |
| `workspaceContext.ts` bare catch (category C) | The silent catch is gone. `addDirectory()` catches validation failures, emits a warning with the directory and error, and skips that directory; listener failures are also logged before notification continues. |

### Findings that still describe the repository accurately

- Finding 3: `vi.clearAllMocks()` in `skillManager.test.ts` (line 55),
  `skillManagerAlias.test.ts` (line 61), `editor.test.ts` (lines 38, 47).
- Finding 4: `keyring-token-store.di.test.ts` uses plain `describe`, with an
  in-file comment at line 198 explaining that per-suite `LockDirTracker.dirs`
  mutations are safe without `describe.sequential`.
- Finding 5: `integration.advanced.test.ts` line 566 and
  `integration.basic.test.ts` line 513 intentionally use `toBeFalsy()` for
  successful Bun `fs.access()` resolutions in those recording tests.
- Finding 9: `as Extract` narrowing appears throughout
  `agentMessageInput.test.ts`, `toolCall.test.ts`, `resumeSession.test.ts`,
  `SessionDiscovery.test.ts`, and `sessionManagement.test.ts`.
- Finding 11, streaming half: `taskStreaming.ts` interpolates `subagentName`
  and `agentId` into `<subagent name="..." id="...">` without escaping (lines 57
  and 62), and replaces `scope.onMessage` (lines 65-73) without restoring the
  previous handler when the task ends.

## Finding classification

Categories: **Blocker-Fix** (must be resolved before other work proceeds),
**In-scope-Fix** (accepted into this issue), **Reject** (not a real gap, or the
premise no longer holds), **Defer** (real but belongs to separate work).

No finding is a Blocker-Fix. Every affected suite passes today, no finding gates
another, and none of them blocks CI.

| # | Finding | Classification | Basis |
| --- | --- | --- | --- |
| 1 | shell-parser missing-export test weakened under Bun | In-scope-Fix | The runtime limitation is disproved by measurement. Per-file process isolation makes the real error path assertable, and the current stand-in passes regardless of production correctness. |
| 2 | Synchronous partial-module mock factories | In-scope-Fix (documentation only) | `config.includeDirectories.test.ts` and `config.initializeBoundary.test.ts` exist, pre-import their actual values, and use synchronous factories, so the old async-factory concern is already addressed. The Bun factory rule belongs in the inventory. The "would break under `test:vitest`" half is rejected because Vitest is gone. |
| 3 | `clearAllMocks` instead of `restoreAllMocks` | In-scope-Fix (documentation only) | Bun's `vi.clearAllMocks()` resets call history while preserving implementations. `skillManager.test.ts` restores baseline implementations in `beforeEach` because per-test overrides persist. The behavior is correct and belongs in the inventory. |
| 4 | `describe.sequential` removal | In-scope-Fix (documentation only) | Accurate and current. The file already explains itself; the inventory should carry the general rule (Bun runs a file's tests sequentially, so the modifier has no equivalent and no purpose). |
| 5 | Successful Bun `fs.access()` resolution assertions | In-scope-Fix (documentation only) | The named recording tests, `integration.advanced.test.ts` and `integration.basic.test.ts`, intentionally retain `resolves.toBeFalsy()` for successful access checks. The inventory records this circumstance-specific use without making a repository-wide claim. |
| 6 | Weak retry-timing tests in `oauth-errors.test.ts` (formerly `oauth-errors.spec.ts`) | Reject | The weak tests were replaced under issue #2904 (commit `16088e082`). Deterministic fake-timer tests now cover exponential backoff, caps, `retryAfterMs`, and jitter. |
| 7 | Redaction suite's zero delay is not zero | In-scope-Fix | Confirmed for the one test that reaches the delay branch: it sleeps 250ms and asserts a pattern that any number satisfies. The two `maxAttempts: 1` cases never reach the branch and are left alone. |
| 8a | `trackServerSockets` listener leak | Reject | Stale. The helper returns early when the server is already tracked. |
| 8b | Idle-timer tests bypassed via `gracefulClose()` | In-scope-Fix | The stated Bun limitation is an artifact of call order, disproved by measurement. Genuine timer-driven tests are available, including the negative boundary. |
| 9 | `as Extract` narrowing instead of `if (result.ok)` | Defer | Mechanical breadth across the `recording` and `llm-types` suites with no change to what any test proves. The assertions on the narrowed values are already behavioral, so converting the narrowing style changes only type-level idiom. Revisit alongside work that already touches those suites. |
| 10 | `toBeFalsy()` for Promise values | In-scope-Fix (partial) | The `liveTrustTransitionLifecycle.test.ts` half is real and single-sited. The `config-lsp-integration.test.ts` half is rejected as stale: its relevant absence assertions use `toBeUndefined()`, and no `toBeFalsy()` remains in the file. |
| 11a | `task.ts` `heartbeat.stop()` after closing tag | Reject | Already ordered stop-then-emit inside the `finally` block. |
| 11b | `taskStreaming.ts` unescaped tag attributes and unrestored `scope.onMessage` | Defer (routed) | Both still hold, both are production concerns in `packages/agents`, and neither was touched by PR #2858. Routed to a new unassigned issue so the production question gets its own review. |
| 12 | `scripts/ocr-benchmark.mjs` findings | Reject | The file is TypeScript, and the diff filter already excludes deletions. `--timeout` is validated; `--process-timeout-ms` is configurable, with invalid or missing values defaulting to 3,600,000. The broad error-handling finding is underspecified, so no script change is accepted here. |
| C | Already fixed in PR #2858 | Reject | Verified. The two missing-import items and the bare-catch item are fixed as described; the `augment-bun-vi.ts` items are moot because the compatibility shim was deleted and tests now import `bun:test` directly. |

## Accepted behavior and evidence

### REQ-2918-001: A missing tree-sitter `Language` export is recorded with its diagnostic

**GIVEN** a `web-tree-sitter` module that exports a usable `Parser` but no
`Language` loader
**WHEN** `initializeParser()` runs
**THEN** it resolves `false`, `getInitializationError()` returns an `Error`
naming the missing `Language` export, and `isParserAvailable()` is `false`.

**GIVEN** the same failed initialization
**WHEN** `parseShellCommand('ls')` is called
**THEN** it returns `null`, so the failure is observable through the parsing API
and not only through the diagnostic getter.

Inputs and boundary cases:

- Mocked module exports `Parser` (a class with a static `init()`), and omits
  `Language` entirely. This is the shape that reaches the guard at
  `shell-parser.ts` line 258 rather than failing earlier at `Parser.init()`.
- `resetParser()` runs before the assertion so the generation counter and any
  cached initialization promise start clean.
- The mock must be registered before `shell-parser.js` is imported. The
  verified shape registers `mock.module` at file scope and performs a dynamic
  `await import('./shell-parser.js')` inside the test.

Evidence:

- Add `packages/core/src/utils/shell-parser.missing-language-export.test.ts`.
  It exists as its own file because Bun's module-mock registry is process-wide
  and the core runner gives each file its own process; putting this mock in
  `shell-parser.test.ts` would deny every other test in that file a working
  parser.
- Assert the error message with `toContain('Language export not found')`, so the
  test fails if the diagnostic is removed or emptied.
- Delete the stand-in test in `shell-parser.test.ts` ("should record
  initialization errors when tree-sitter exports are missing"). It asserts that
  a boolean is a boolean; keeping it alongside a real test would leave a passing
  assertion that cannot fail.
- The mocked module is a third-party dependency, not the component under test.
  The real `shell-parser` code path produces every asserted value.

### REQ-2918-002: The logged retry delay is the delay the handler honors

**GIVEN** a `RetryHandler` configured with `baseDelayMs: 0`,
`backoffMultiplier: 1`, `maxDelayMs: 0`, `jitter: false`, and a retryable
`OAuthError` carrying `retryAfterMs: 25`
**WHEN** a retry is scheduled
**THEN** the debug line reads `retrying in 25ms`, proving the provider-supplied
value overrides the zero configuration rather than being discarded.

**GIVEN** the same handler configuration and a retryable `OAuthError` with no
`retryAfterMs`
**WHEN** a retry is scheduled
**THEN** the debug line reads `retrying in 0ms`, which is where the zero
configuration genuinely applies.

Inputs and boundary cases:

- `maxAttempts: 3` with an operation that fails once and then succeeds, so
  exactly one retry is scheduled and exactly one debug line is produced.
- `retryAfterMs: 25` replaces the current `250`. The value stays non-zero so
  the provider-override path is still exercised, and small so the suite does not
  spend a quarter of a second asleep to prove a logging property.
- The absent-`retryAfterMs` case uses an error type that does not populate
  `retryAfterMs` from the factory. `NETWORK_ERROR` constructed directly without
  the option satisfies this; the assertion of `retrying in 0ms` fails loudly if
  a default creeps in.

Evidence:

- Change only "must log a finite numeric delay, not a direct tainted property
  read" in `oauth-errors.redaction.spec.ts`, and add the absent-`retryAfterMs`
  case beside it.
- Replace `/retrying in \d+ms/` with an exact match on the honored figure.
  Retain the existing `not.toMatch(/retrying in NaN/)` and
  `not.toMatch(/retrying in undefined/)` assertions, which are the CodeQL
  alert 154 guard the test was written for.
- Leave the two `GracefulErrorHandler` cases untouched. They set
  `maxAttempts: 1`, never reach the delay computation, and rewriting them would
  be an unrelated refactor.
- The logger is a local capture object standing in for output; the
  `RetryHandler` under test is real, and the asserted figure is produced by its
  own arithmetic.

### REQ-2918-003: A settled trust transition resolves undefined

**GIVEN** a `LiveTrustTransitionLifecycle` whose failed batch has already been
reported to both concurrent waiters
**WHEN** `whenSettled()` is awaited again
**THEN** it resolves `undefined`.

Inputs and boundary cases:

- The only changed assertion is the third `whenSettled()` in "reports a failed
  batch to concurrent waiters and releases it afterward". The two preceding
  assertions in that test resolve to the transition failure and stay as they
  are.
- `whenSettled()` is declared `Promise<void>`, so `undefined` is the value the
  contract promises. `null`, `0`, and `''` would each be a contract violation
  that `toBeFalsy()` currently accepts.

Evidence:

- Change `resolves.toBeFalsy()` to `resolves.toBeUndefined()` at
  `liveTrustTransitionLifecycle.test.ts` line 176, matching line 219 in the same
  file.
- Nothing else in the file changes. The successful Bun `fs.access()` checks in
  `integration.advanced.test.ts` and `integration.basic.test.ts` intentionally
  retain `resolves.toBeFalsy()` for those recording-test circumstances
  (REQ-2918-005).

### REQ-2918-004: The idle timeout closes the connection on its own timer

**GIVEN** a connected `ProxySocketClient` that has completed one request and has
no work outstanding
**WHEN** the clock advances past `IDLE_TIMEOUT_MS`
**THEN** the server observes the client socket close, and the next request
completes over a new connection with a second handshake.

**GIVEN** the same idle client
**WHEN** the clock advances to one millisecond short of `IDLE_TIMEOUT_MS`
**THEN** the server observes no close, so the test distinguishes the deadline
from any earlier teardown.

Inputs and boundary cases:

- Fake timers are activated **before** `new ProxySocketClient(...)`. The
  idle timer has to be created on the faked clock, and activating fake timers
  afterwards is what forced the current simulation.
- Advance by `IDLE_TIMEOUT_MS + 1` for the positive case and
  `IDLE_TIMEOUT_MS - 1` for the negative case, so the assertion brackets the
  deadline rather than asserting "eventually".
- Real timers must be restored before waiting on socket teardown. Bun's fake
  timers freeze `Date.now()`, and a wall-clock deadline evaluated under them
  never expires. A probe written that way hung until it was killed.
- Timer restoration belongs in `afterEach`, not at the end of the test body. A
  mid-test failure with fake timers still installed would leak the frozen clock
  into cleanup and into the next test.

Evidence:

- Rewrite "triggers gracefulClose after idle timeout" and "sends new handshake
  on reconnection after idle close" in `proxy-socket-client.test.ts` to advance
  the timer instead of calling `client.gracefulClose()`. Both currently prove
  only that `gracefulClose()` works, which other tests in the file already
  cover.
- Add the pre-deadline negative case in the same file. Each idle-boundary test
  completes an ordinary server-answered request before advancing time, so the
  timer under test is the post-request idle-timer re-arm.
- Add `vi.useRealTimers()` to the existing `afterEach`, and remove the in-body
  restoration from "rejects request after 30s timeout" only if it becomes
  redundant. Both measured probe cases used exactly this lifecycle.
- Assertions observe the real `net.Server`: a `close` event on the accepted
  socket, and a handshake counter incremented by the real client's real
  reconnect. No client internals are inspected and no client method is stubbed.
- If the rewritten tests prove flaky under CI concurrency rather than locally,
  the fallback is to restore the `gracefulClose()` simulation and record the
  reason in the inventory alongside the other Bun constraints. The measured
  evidence says this fallback should not be needed; it is stated so the
  implementer does not silently weaken the assertion instead.

### REQ-2918-005: Bun test constraints are recorded where test authors will look

**GIVEN** a developer reading `dev-docs/test-runner-inventory.md`
**WHEN** they encounter one of the Bun-driven patterns that looks like a
weakened test
**THEN** the document states the constraint, the pattern that satisfies it, and
why the obvious Vitest-shaped alternative does not apply.

Content to record, as a new subsection of the inventory:

- **Partial module mocks use synchronous factories.** Bun's `mock.module` does
  not drain microtasks in an async factory, so a partial mock pre-imports the
  actual value and returns it from a synchronous factory.
  `packages/core/src/config/config.includeDirectories.test.ts` and
  `config.initializeBoundary.test.ts` both use this shape; the old
  async-factory concern is already addressed. No live `importOriginal()` calls
  remain in `packages/`; the remaining references are explanatory comments.
- **`vi.clearAllMocks()` resets call history and preserves implementations.**
  Per-test implementation overrides therefore persist. The `beforeEach` in
  `packages/core/src/skills/skillManager.test.ts` restores the baseline
  implementations before each test, while `vi.clearAllMocks()` clears call
  history after each test.
- **There is no `describe.sequential`.** Bun runs a file's tests sequentially by
  default, so per-suite mutable trackers such as
  `keyring-token-store.di.test.ts`'s `LockDirTracker` are race-free with plain
  `describe`.
- **Successful Bun `fs.access()` resolutions use circumstance-specific
  assertions.** The named recording tests,
  `packages/core/src/recording/integration.advanced.test.ts` and
  `integration.basic.test.ts`, intentionally use `resolves.toBeFalsy()` for
  successful access checks. This does not characterize unrelated falsy
  assertions elsewhere in the repository.
- **Module mocks are process-wide, and per-file processes are the isolation
  mechanism.** A mock that must break a shared dependency belongs in its own
  file, as `shell-parser.missing-language-export.test.ts` does. This replaces
  the assumption that `vi.resetModules()` has no substitute.
- **Fake timers must be installed before the code under test schedules its
  timer, and `Date.now()` is frozen while they are installed.** Restore real
  timers before waiting on real I/O.

Evidence: the subsection cites the files above by path so each claim can be
checked, and each constraint is paired with the pattern that satisfies it. The
core row records the current runner discovery count of 394 files and describes
the new isolated shell-parser test without inventing a prior count.

### REQ-2918-006: The agents streaming concerns are tracked as their own work

**GIVEN** the two `taskStreaming.ts` findings that still hold
**WHEN** this issue closes
**THEN** a separate open issue describes them with current line references, and
it is not assigned to anyone.

Issue #3288, "Escape taskStreaming tag attributes and restore scope message
handlers," now tracks this work. It records that `setupTaskStreaming`
interpolates `subagentName` and `agentId` into the opening and closing
`<subagent>` tags without escaping and replaces `scope.onMessage` without
restoring the previous handler. Its acceptance criteria cover quotes,
ampersands, angle brackets, success and failure cleanup, late messages after the
closing tag, and chaining to a pre-existing handler. The issue also records that
the `heartbeat.stop()` ordering finding is already fixed. Issue #3288 is
unassigned and labeled for subagents and code quality.

Evidence: https://github.com/vybestack/llxprt-code/issues/3288

## Routing decisions

| Subject | Destination | Reason |
| --- | --- | --- |
| `taskStreaming.ts` attribute escaping and `scope.onMessage` restoration | Issue #3288, unassigned (REQ-2918-006) | Production behavior in `packages/agents`, untouched by PR #2858, and outside a test-quality cleanup. |
| `task.ts` heartbeat ordering | No route | Already fixed; nothing to hand off. |
| `scripts/ocr-benchmark` findings | No route | The timeout behavior is documented above, and the broad error-handling finding is underspecified. No script change is accepted in this issue. |
| `packages/settings` `resolves.toBeFalsy()` | No route | Not named by any finding in issue 2918. Recorded here so a future reader knows it was seen and left alone. |
| Finding 9 type-assertion cleanup | Deferred in place | Recorded in this plan's classification table. It needs no issue of its own until work touches those suites for another reason. |

## Files in scope

| File | Change |
| --- | --- |
| `packages/core/src/utils/shell-parser.missing-language-export.test.ts` | New. REQ-2918-001. |
| `packages/core/src/utils/shell-parser.test.ts` | Remove the superseded stand-in test. REQ-2918-001. |
| `packages/auth/src/__tests__/oauth-errors.redaction.spec.ts` | Correct one test, add the absent-`retryAfterMs` case. REQ-2918-002. |
| `packages/core/src/config/liveTrustTransitionLifecycle.test.ts` | One assertion. REQ-2918-003. |
| `packages/auth/src/proxy/__tests__/proxy-socket-client.test.ts` | Timer-driven idle tests, negative boundary, `afterEach` timer restoration. REQ-2918-004. |
| `dev-docs/test-runner-inventory.md` | New constraints subsection, refreshed core figure. REQ-2918-005. |
| `project-plans/issue-2918-bun-test-follow-up/plan.md` | This plan, updated with the follow-up issue number. |

## Files and areas out of scope

- Any production source file. The accepted work changes tests and one document.
- `packages/agents/**` and `scripts/**` implementation, including
  `taskStreaming.ts`, `task.ts`, and `ocr-benchmark.ts`.
- The five `as Extract` suites (`agentMessageInput.test.ts`, `toolCall.test.ts`,
  `resumeSession.test.ts`, `SessionDiscovery.test.ts`,
  `sessionManagement.test.ts`).
- `skillManager.test.ts`, `skillManagerAlias.test.ts`, `editor.test.ts`,
  `keyring-token-store.di.test.ts`, `integration.advanced.test.ts`,
  `integration.basic.test.ts`, `config-lsp-integration.test.ts`,
  `config.a.test.ts`, `config.b.test.ts`. These are cited as evidence and
  documented; none is edited.
- `packages/settings/src/profiles/__tests__/ProfileManager.test.ts`.
- Dependencies, lockfiles, CI workflows, lint configuration, quality tooling
  including the test-audit scanner, agent memory files, test runners, Bun test
  discovery, and any package's public exports.
- New shared or public test abstractions. Helpers introduced by this work stay
  file-local.

## Implementation order

Each step is red before green. Where the production code is already correct, red
means the new assertion fails against a deliberately broken copy of the
production behavior, confirmed and then reverted, so the test is known to
discriminate.

1. **REQ-2918-001.** Add the isolated shell-parser file. Confirm it fails when
   the `Language export not found` message is temporarily changed, then restore
   the message. Remove the stand-in test. Run
   `bun test src/utils/shell-parser.missing-language-export.test.ts` and
   `bun test src/utils/shell-parser.test.ts` from `packages/core`.
2. **REQ-2918-002.** Rewrite the tainted-delay assertion to the exact figure and
   add the absent-`retryAfterMs` case. Confirm the exact-figure assertion fails
   when `retryAfterMs` is temporarily ignored in the delay expression, then
   restore it. Run
   `bun test src/__tests__/oauth-errors.redaction.spec.ts` from `packages/auth`
   and confirm the case no longer costs a quarter-second.
3. **REQ-2918-003.** Change the one assertion. Confirm it fails when
   `whenSettled()` is temporarily made to resolve `null`, then restore it. Run
   `bun test src/config/liveTrustTransitionLifecycle.test.ts` from
   `packages/core`.
4. **REQ-2918-004.** Move fake-timer activation ahead of client construction,
   convert both simulated tests to advance the clock, add the pre-deadline
   negative case, and move timer restoration into `afterEach`. Confirm the
   positive case fails when `armIdleTimer()` is temporarily disabled and that
   the negative case fails when the idle timeout is temporarily shortened, then
   restore both. Run
   `bun test src/proxy/__tests__/proxy-socket-client.test.ts` from
   `packages/auth`, repeated a few times to check for order sensitivity.
5. **REQ-2918-005.** Write the inventory subsection, citing the files that
   demonstrate each constraint, and refresh the core row's figure from the
   runner's reported total.
6. **REQ-2918-006.** Verify that routed issue #3288 remains open and unassigned.
7. Run the full local verification cycle, then review the candidate diff and
   classify any review findings with the same four categories used here.

## Local verification and completion gates

Per-file runs during development:

```bash
cd packages/core && bun test src/utils/shell-parser.missing-language-export.test.ts
cd packages/core && bun test src/utils/shell-parser.test.ts
cd packages/core && bun test src/config/liveTrustTransitionLifecycle.test.ts
cd packages/auth && bun test src/__tests__/oauth-errors.redaction.spec.ts
cd packages/auth && bun test src/proxy/__tests__/proxy-socket-client.test.ts
```

Workspace runs before the full cycle, which also confirm the new file is picked
up by discovery and that the inventory figure matches the runner's own total:

```bash
cd packages/core && bun run-bun-tests.ts
cd packages/auth && bun run-bun-tests.ts
```

Full cycle, run before committing, before pushing, and again after every
remediation round:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Targeted guards for what this change touches:

```bash
bun scripts/check-test-file-coverage.ts   # the new test file is claimed by exactly one executor
bun scripts/check-no-vitest.ts            # no Vitest reference reintroduced
bun scripts/check-doc-links.ts            # inventory edits keep links valid
bun scripts/test-audit/scan.ts tmp/scan-branch
```

For the scanner, produce a baseline on `main` in a separate output directory and
diff the two `findings.tsv` files. No new `MOCK_MIRROR`, `ALWAYS_TRUE`,
`SELF_CONFIRMING`, or `NO_ASSERT` finding may appear on a touched file. Removing
the shell-parser stand-in should reduce, not increase, the flag count.

Completion gates:

- [x] Every accepted behavioral requirement has at least one test that fails
      when the production behavior it names is broken, demonstrated and
      reverted.
- [x] No test asserts a tautology, a mock's own configuration, or that a mock
      was called.
- [x] The shell-parser stand-in is gone and its replacement names the real
      diagnostic.
- [x] The redaction suite asserts the exact honored delay in both the
      provider-supplied and configured-zero cases.
- [x] The proxy idle tests advance a timer and bracket the deadline from both
      sides.
- [x] `dev-docs/test-runner-inventory.md` records all six constraints with file
      citations, and its core figure matches the runner's reported total.
- [x] The follow-up issue exists, is unassigned, and its number is recorded in
      this plan.
- [x] Every rejected finding in the classification table has its supporting
      evidence stated.
- [x] No production source file changed; no dependency, workflow, runner,
      discovery rule, or public export changed.
- [x] The full verification cycle passes, including the smoke test.

## Final verification record

Mutation checks ran in a disposable detached worktree, and every temporary
production edit was restored before the worktree was removed:

- Changing the shell-parser diagnostic produced 0 passes and 1 failure because
  the expected `Language export not found` text was absent.
- Ignoring the provider's `retryAfterMs` produced 11 passes and 1 failure. The
  test reported the exact mismatch between the expected 25 ms and observed
  0 ms log lines.
- Returning `null` from `whenSettled()` produced 5 passes and 2 failures at the
  `toBeUndefined()` assertions.
- Disabling post-request idle timer arming made the positive proxy case fail
  because the socket did not close. Shortening the deadline by two milliseconds
  made the negative boundary case fail because the second request used
  handshake 2 instead of handshake 1.

The final isolated-PATH root test run exited 0. It retained Bun and Node through
`/tmp/issue2918-bin` while excluding `/opt/homebrew/bin/rg`; otherwise the
unchanged resolver fallback suite finds the real Homebrew executable before its
mocked paths. The run included 394/394 core files, 43/43 auth files, 579/579
provider files, 376/376 agents files plus 6/6 isolated agents files, 713/713 CLI
files, and every remaining workspace.

`npm run lint`, `npm run typecheck`, `npm run format`, and `npm run build` exited
0. The `stepfun-37` smoke command returned a haiku. Test-file coverage reported
no uncovered or doubly executed files, the no-Vitest and documentation guards
passed, and `git diff --check` was clean. The false-green scanner reported 0
errors and 2,010 findings for both the candidate and clean-HEAD baseline after
sorting; their `findings.tsv` files were identical.

Two local OCR passes covered the five changed test files and both changed
Markdown files. The test review's one low-severity duplication comment is
**Reject**: the two proxy cases preserve separate requirement traces and make
different response-value and handshake-count assertions; extracting their
one-test server setup would add indirection without changing coverage. The
Markdown review produced four comments. Two comments identified the same
`importOriginal()` wording in this plan, one identified the corresponding
inventory wording, and one corrected the shell-parser diagnostic line number.
All four are **In-scope-Fix** and were resolved by describing live calls rather
than all text matches and by citing line 260.

## Known limitations recorded rather than fixed

- Finding 9 remains open by choice. The `as Extract` narrowing is documented
  here as deferred so a later reader can see it was considered.
- The `packages/settings` `resolves.toBeFalsy()` assertion is left in place. It
  falls outside every finding in this issue.
- The `GracefulErrorHandler` redaction cases keep an inert zero-delay
  configuration. It is harmless because those handlers never schedule a retry,
  and changing them would touch tests no finding names.

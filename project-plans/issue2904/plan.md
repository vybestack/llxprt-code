# Issue 2904 implementation plan

## Objective

Resolve the still-valid test-quality findings recorded in issue 2904 without broadening Bun test discovery, changing unrelated runners, or introducing shared/public test abstractions.

## Preflight evidence

- The issue branch starts from current `origin/main` with a clean working tree.
- The current auth runner executes 33 `.test.*` files but omits all 9 `.spec.*` files, including `oauth-errors.spec.ts`.
- A direct Bun run of `oauth-errors.spec.ts` passes 38 tests, but its purported backoff and jitter tests wait on retry-after delays and do not exercise exponential or jitter calculations.
- Direct Bun runs of the five accepted core target suites pass 110 tests before changes.

## Finding classification

| Finding or reviewer suggestion | Classification | Rationale |
| --- | --- | --- |
| OAuth retry tests disable backoff and jitter timing | In-scope-Fix | This is the issue's only medium bug and requires behavioral timing evidence. |
| Folder-trust timeout test drains all timers | In-scope-Fix | Replace broad timer draining with advancement to the known 30-second boundary. |
| Provider-settings no-throw test uses try/catch | In-scope-Fix | Direct awaited calls are simpler, fail naturally, and avoid a broken matcher. |
| OAuth test duplicates the shared retry-handler configuration | In-scope-Fix | Reuse a meaningful shared non-jitter handler for the relevant cases. |
| OAuth jitter handler shadows the shared handler | In-scope-Fix | Give the timing-specific jitter handler a distinct name and configuration. |
| MCP mock uses a broad `Record<string, unknown>` cast | In-scope-Fix | Use the established generic `importOriginal<typeof import(...)>()` form, avoiding a type assertion. |
| Session property tests have inconsistent `numRuns` | Reject | Stale: every current property assertion already specifies `numRuns: 20`. |
| Ripgrep unavailable-package Proxy is duplicated | In-scope-Fix | A file-local helper removes the five identical mock factories without creating a shared abstraction. |
| Session assertions contain unnecessary bare scopes | In-scope-Fix | Remove only the redundant braces; preserve assertion behavior. |
| Auth runner reports a signal exit as a null/-1 exit code | In-scope-Fix | Carry the child signal into the result and emit explicit JUnit failure text. |
| `toolDeclaration.test.ts` has a misplaced fast-check array constraint | Reject | The issue already records this as a verified false positive. |
| Also change the core Bun runner's signal reporting | Reject | The literal finding concerns the auth runner; changing another runner is adjacent scope. |
| Add a shared `expectNoThrowAsync` test utility | Reject | It is an unplanned shared abstraction; direct awaits are sufficient. |
| Repair undefined `itProp` in session tests | Reject | Stale: the current suite imports and uses `it`. |
| Extract broader session result-assertion helpers | Reject | The accepted finding is redundant scopes, not a larger refactor. |
| Add a ripgrep available-package helper too | Reject | The available mocks are not identical, and no accepted change needs the abstraction. |

## Accepted behavior and evidence

### REQ-2904-001: Auth retry timing is real and CI-gated

**GIVEN** a retryable `SERVICE_UNAVAILABLE` OAuth error without `retryAfterMs`, nonzero base delay, multiplier greater than one, and a finite maximum delay
**WHEN** retry attempts are scheduled
**THEN** no attempt occurs immediately before each expected boundary, an attempt occurs at each exact boundary, exponential growth is used, and later delays are capped at `maxDelayMs`.

**GIVEN** the same retryable error and deterministic `Math.random()` values
**WHEN** jitter is enabled
**THEN** observed retry boundaries demonstrate the documented 50%-to-100% delay range rather than only eventual retry count.

**GIVEN** a retryable error with an explicit `retryAfterMs`
**WHEN** a retry is scheduled
**THEN** the retry occurs at that explicit boundary and not one millisecond earlier.

Evidence:

- Rename only the directly related `oauth-errors.spec.ts` to `oauth-errors.test.ts`, because the auth runner already discovers `.test.ts`. Do not broaden discovery to the other eight unrelated spec suites.
- Convert the renamed suite to `bun:test`.
- Use fake timers and attach rejection handlers before advancing time.
- Use `SERVICE_UNAVAILABLE` without retry-after for exponential and jitter tests; factory network errors are unsuitable because they set `retryAfterMs`.
- Retain distinct local jitter configuration only where the behavior requires it; do not add a shared helper module.

### REQ-2904-002: Folder-trust timeout advances only its timer

**GIVEN** hook initialization remains pending during a live folder-trust transition
**WHEN** fake time reaches 30 seconds
**THEN** the transition rejects with the existing timeout error and its abort signal is aborted, without draining unrelated future timers.

Evidence: convert the changed suite to `bun:test`, advance 29,999 ms to establish the pre-boundary state, then one additional millisecond and assert the existing rejection and aborted signal.

### REQ-2904-003: Provider compatibility fails naturally on a thrown getter

**GIVEN** a provider backed by the settings service
**WHEN** its model, API-key, base-URL, and model-parameter getters are awaited
**THEN** the test completes only when every call resolves; a thrown error fails the test directly.

Evidence: convert the changed suite to `bun:test` and directly await the four calls without try/catch or a no-throw helper.

### REQ-2904-004: MCP partial mock retains the module's precise type

**GIVEN** the config test's partial MCP module mock
**WHEN** the original module is imported
**THEN** its known exports remain typed as `typeof import('@vybestack/llxprt-code-mcp')` and the existing config suite remains behaviorally unchanged.

Evidence: convert the changed suite to `bun:test`, use generic `importOriginal<typeof import(...)>()`, and run the full config suite plus type/lint gates. Do not add a type assertion.

### REQ-2904-005: Accepted local test cleanup preserves behavior

**GIVEN** the ripgrep resolver's package-unavailable scenarios
**WHEN** each scenario installs its mock
**THEN** a single file-local helper supplies the same throwing Proxy behavior to the five existing callers.

**GIVEN** the existing session-management result assertions
**WHEN** the redundant bare scopes are removed
**THEN** each existing assertion remains unchanged and all property-test run counts stay at 20.

Evidence: convert both changed suites to `bun:test`, run them in full, and make no helper extraction beyond the identical unavailable-package mock.

### REQ-2904-006: Auth JUnit failures identify process termination

**GIVEN** an auth test child exits because of a signal and has a null numeric exit code
**WHEN** the runner builds its result and JUnit report
**THEN** the result retains the signal and the failure message identifies it, for example `Killed by signal SIGTERM`.

**GIVEN** a numeric nonzero exit, a timeout, or the null-without-signal fallback
**WHEN** JUnit is generated
**THEN** each condition has explicit, stable failure text and numeric exit-code reporting remains intact.

Evidence:

- Add a Bun test for the runner's observable JUnit output before production changes.
- Add only a narrow internal test seam (such as an exported JUnit helper) and `if (import.meta.main)` guard, following the existing script pattern; do not add a package export.
- Carry the standard child-process `exit` signal through `TestResult` and all result construction paths.
- Test signal, numeric exit, timeout, and null-without-signal output. Prefer real exit-event behavior where portable; do not mock child-process interactions merely to satisfy coverage.

## TDD sequence

1. Rename and strengthen the OAuth suite, run it through the auth runner, and confirm its timing boundaries pass against the existing production behavior.
2. Add the auth runner JUnit behavior test and demonstrate RED against current signal-unaware output/import behavior.
3. Add the minimal signal field, exit-event wiring, explicit failure formatting, and import guard; demonstrate GREEN.
4. Make each accepted core test-only refinement and run the complete affected suite immediately after the change.
5. Run all affected auth/core tests together, then the repository's complete verification suite and smoke test.
6. Review only the candidate diff; classify all findings using the same four categories and remediate every Blocker-Fix and In-scope-Fix finding.

## Scope boundaries

- No production retry behavior changes.
- No changes to core/CLI runners, auth discovery patterns, dependencies, workflows, lint configuration, test utilities shared across packages, or public package exports.
- No change to session property-test run counts or unrelated mocks.
- No TUI changes, so tmux verification is not required.
- No optional hardening after the accepted behavior and required gates pass.

## Review remediation (follow-up findings)

### Real child-signal evidence for REQ-2904-006

The initial signal reporting carried synthetic `TestResult` fixtures through `generateJUnit`. To prove the observable behavior end to end, the narrow internal `runTestFile` seam is now exported at the module level (not as a `package.json` export). A `bun:test` case writes a temporary fixture that self-terminates with `SIGTERM`, invokes the real `runTestFile`, and feeds the resulting `TestResult` to `generateJUnit`, asserting `result.signal === 'SIGTERM'`, `result.passed === false`, and `Killed by signal SIGTERM`. It is skipped via `it.skipIf(process.platform === 'win32')` where reliable POSIX signal reporting is unavailable; the exit callback is not faked. The existing synthetic numeric/timeout/null formatting cases are retained. This case fails the moment `runTestFile` stops propagating the child exit signal (verified RED by temporarily coercing the signal to `null`).

### Provider suite rename for core runner discovery

`packages/core/src/integration-tests/provider-settings-integration.spec.ts` is renamed to `provider-settings-integration.test.ts` so the existing core `run-bun-tests.ts` (which discovers only `.test.ts`/`.test.tsx`) includes this suite directly. Only this one spec is renamed; runner discovery is not broadened and no unrelated specs are renamed. The stale in-file `metadata.source` self-reference was updated to match.

### PR OCR cleanup-failure finding

The PR OCR finding that the real-signal test's `finally` cleanup could suppress an earlier behavioral assertion failure is classified **In-scope-Fix**. The concern applies directly to the new behavioral evidence. Instead of swallowing cleanup errors or adding defensive exception aggregation, the generated temporary source is replaced by a committed, non-discoverable auth test fixture. The behavioral test still invokes the real child process and verifies signal propagation, while no fallible cleanup can obscure its assertions.

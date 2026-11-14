# REQ-4101 execution tracker

Branch: `issue4101`; current phase: P02.

Status: P01 and P02 implementation, fixture-size measurement, and corrected full repository verification are complete.

| Phase | State | Verification |
| --- | --- | --- |
| P00 / P00.5 | Complete from the checked-in plan | Issue and integration map were read before implementation. |
| P01 | Implemented and verified | Details in `.completed/P01.md`. |
| P02 | Implemented and verified | Corrected provider behavior, fixture initialization, and full repository verification are recorded below. |
| P03-P05 | Not started | Out of scope for this phase. |

## P02 verification record

- Focused Phase B tests passed: refusal dump behavior across Anthropic streaming, Anthropic JSON, OpenAI Chat streaming/JSON, refusal pairing, non-refusal no-dump, and `on` mode deduplication; Vercel SSE/JSON capture; retention policy; and settings defaults/validation.
- Existing dump/recovery regressions passed: 87 tests across the OpenAI/Anthropic SDK dump, Vercel capture, refusal recovery, and reviewer rewrite suites.
- Fixture measurement: `tmp/verify4101/measure-dump.ts` generated a real Anthropic refusal pair of 105,287 bytes across two files and six parsed SSE events. At that fixture size, the 2 GiB cap holds 20,396 pairs; 34 pairs/day for 14 days uses 50,116,612 bytes (~47.8 MiB). This is fixture-specific and does not guarantee retention under larger prompts or `on` mode traffic. The main plan records this implication.
- `git diff --check`: passed.
- `npm run typecheck`: passed, `rc=0` (`tmp/verify4101/typecheck-P02fix.log`).
- `npm run lint`: passed, `rc=0` (`tmp/verify4101/lint-P02fix.log`).
- `npm run format`: passed, `rc=0` (`tmp/verify4101/format-P02fix.log`).
- `npm run build`: passed, `rc=0` (`tmp/verify4101/build-P02fix.log`).
- `npm run test`: passed, final line `rc=0` in `tmp/verify4101/test-P02fix.log`; `grep -nE 'Native Bun test failed|^FAILED:' tmp/verify4101/test-P02fix.log` returned no matches (grep exit code 1). This supersedes the prior false-green record above. The runner's intentional fixture failures are not included in the suite failure markers.
- Regression causes found: Anthropic throttling bypassed its `sleep` seam and invoked `delay` directly, so tests could not control the wait, and the retry-boundary unit fixture uses `Object.create(StreamProcessor.prototype)` without initializing the new `RefusalDumpPairing` instance member.
- Fix: preserve the provider's spyable sleep seam while moving throttle decision/wait orchestration to `AnthropicRateLimitHandler`; initialize `RefusalDumpPairing` in the prototype-based StreamProcessor test fixture. No assertions or timeout values changed.
- Test-first red output was not independently preserved in this session: the worktree already contained the implementation and passing P02 tests at session start, so this session cannot verify the red run.


## P01 verification record

- After `bun install` linked `packages/agent-core`, the reported type errors were limited to the new endpoint helper. Spreading `requestId` over the endpoint union failed for the `http-error` variant. The type now places the optional request ID on the shared union intersection, without a cast.
- `npm run typecheck`: passed (`tmp/verify4101/typecheck-C.log`).
- `npm run lint`: passed (`tmp/verify4101/lint-D.log`).
- `npm run format`: passed. `git diff --check`: passed (`tmp/verify4101/format-D.log`).
- `npm run build`: passed (`tmp/verify4101/build-C.log`).
- `npm run test`: passed (`tmp/verify4101/test-C.log`), including core 528/528 test files, agents 667/667, CLI 1002/1002, and all remaining workspace test summaries.
- The first post-install test run found the root install did not include the optional `plugins/google-gemini` package dependencies. Installing its declared dependencies with `bun install --cwd plugins/google-gemini --no-save` resolved those startup errors. The install changed no tracked manifest or lockfile.
- The initial endpoint type errors are fixed. Focused refusal integration: 9 passed. Anthropic finish metadata: 15 passed. Recording/replay: 7 passed, with the extended diagnostic payload preserved. Public noninteractive refusal notices: 6 passed, including category and explanation output. Telemetry metrics expectations: 27 passed after adding the new empty category projection.
- Main comparison worktrees were removed after testing. Before optional plugin dependencies were installed, the branch and main both exposed failures related to that absent optional package. After installing it in both worktrees, the same 17 initially failing CLI files on main produced 146 passes and 7 sandbox/CLI lifecycle failures (`tmp/verify4101/main-cli-postdeps.log`). Those cases passed during the final branch full suite. The prior bulk comparison logs are `tmp/verify4101/main-failing-files.log` and `tmp/verify4101/test-main-A.log`; neither partial main run is represented as a complete main-suite result.

## P01 cases still not covered

- Provider-owned details after an AfterModel hook replaces terminal content.
- Abandoned attempts with a request ID after headers, and null before headers.
- Property-based transformations of nullable diagnostic fields.
- A2A notice formatting and null/absent detail handling across all public notice surfaces.

No P02-P05 implementation was performed.

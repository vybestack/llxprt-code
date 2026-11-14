# REQ-4101 execution tracker

Branch: `issue4101`; current phase: P01.

Status: Phase A implementation and required verification are complete. The request-id helper typing and the inexpensive recording/replay and public noninteractive-notice cases are fixed. P02-P05 have not started.

| Phase | State | Verification |
| --- | --- | --- |
| P00 / P00.5 | Complete from the checked-in plan | Issue and integration map were read before implementation. |
| P01 | Implemented and verified | Details in `.completed/P01.md`. |
| P02-P05 | Not started | Out of scope for this task. |

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

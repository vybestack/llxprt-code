# Fix the #3911 follow-up regressions and the failing nightlies

Branch `fix-3911-followups`. All of this ships in one PR, which lists `Fixes #N` for each issue it closes. The goal is for main and the nightly pipelines (Nightly Tests and the scheduled Release) to be green before the agent API work (#3980) starts.

## Rules for every task

- Test first. Write a behavior test that fails on the current code, then fix the code until it passes (dev-docs/RULES.md). Assert real effects through public entry points, with no mock theater.
- Find the cause before fixing a flaky or intermittent test. Compare a passing run with a failing run input by input. Never add retries, lengthen timeouts or weaken assertions to make a test pass.
- Prefer failing fast: fix the real bug instead of adding guards or fallbacks.
- Don't loosen lint rules, line-count guards or required checks.

## Tasks

| Task | Issue | What changes | Test that must fail before the fix |
| --- | --- | --- | --- |
| A1 | #3974 | MCP HTTP and SSE transports use the owner's network transport, including the proxy. | A local recording proxy is set as the session proxy, and an HTTP MCP initialize request is observed passing through it. |
| A2 | #3977 | `--debug`, the debug settings and `/debug` reach every package `DebugLogger`, through one owner of the debug configuration. | After CLI bootstrap with `--debug` naming a provider or core namespace, a `DebugLogger` built the way package code builds it is enabled, and `/debug` toggles it. No fixture configures the singleton. |
| B1 | #3972 | Once disposal starts, every public entry point rejects new work, and accepted work is cancelled or waited for: profile queue, `sessionClient.fetch`, `compress()`, stored-token reads, OAuth fallback paths. | For each path, start dispose while the operation is pending, or call the operation after dispose begins. The test shows the call is rejected or waited for, and that dispose finishes. |
| C1 | #3973 | ConversationFileWriter, the git-stats service and GeminiProvider's environment reads belong to the root that created them. | Two roots with different directories, git workspaces or provider settings, each observed separately. Closing one leaves the other working. |
| D1 | #3975 | Command discovery runs only when its real inputs change. The quit command reads stats when it runs. | The real command processor with a metrics source that emits several times: the loader count does not move, and quit shows the latest stats. |
| D2 | #3970 | Find the cause of the Escape-case hang, or remove the busy-loop input once it is found. | Depends on the cause that is found. |
| D3 | #3971 | The debounce test runs on one clock and controls when initialization and enrichment settle. | The test is deterministic under load (run it repeatedly under CPU stress). |
| E1 | #3969 | The PTY probe kills its pty and waits for it to exit. | No `spawn-helper` with the probe's command line is left after the test. |
| E2 | #3976 | The rollback test observes a real effect of the release, or is removed with a recorded reason. | Mutation check: deleting the cleanup turns the test red. |
| E3 | #3979 | Scanner rules catch the banned shapes under any name, exemptions name real code and carry an issue number, and the scan covers every production package and plugin. Production code the wider scan flags is fixed. | One scanner fixture per gap that passes today and must fail. |
| E4 | #3978 | Delete the batch records containing local paths, fix docs that name deleted APIs, and restore the save_memory eval assertion or record the change and its reason. | Doc-reference check. Eval diff review. |
| N* | (from the diagnosis) | One task per failure cause in the nightly or release pipelines. | Set by the diagnosis in `tmp/fixes/diag/nightly-diagnosis.md`. |

## Verification

The full cycle runs on the integrated branch: `npm run test`, `lint`, `typecheck`, `format`, `build`, and the smoke run `bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"`. After the PR's CI is green, Nightly Tests is dispatched on the branch to confirm the nightly failures are fixed.

## Decision recorded for #3980

The new agent core sits behind a flag in each host until it works, and then the host switches over. All of this ships in 0.12.0. The flag is removed in the PR that makes the switch.

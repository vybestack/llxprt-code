# REQ-4101 execution tracker


## Review round 2

- Invocation retention: Vercel capture and both dump writers receive validated byte/age caps from invocation settings even without attempt identity. Anthropic and OpenAI metadata preserve retention limits separately from correlation. Vercel localhost endpoint tests configure the invocation caps and verify one-byte pruning and expired-singleton age pruning; Agent-level Anthropic/OpenAI tests cover configured retention.
- Public `Agent.generate`: direct calls allocate session-local prompt IDs and attempt indices and use the streaming refusal/success pairing lifecycle. Anthropic and OpenAI behavior tests cover streaming enabled and disabled; the prior null-identity expectation now requires real identity and pairing.
- Singleton dump halves: retention counts and prunes abandoned request-only and response-only files. The documented 10-minute grace protects fresh cross-process files, while epoch-old distinct singletons are eligible. The active-write interleaving test still verifies concurrent publication protection.
- Refusal notices: review-start and rewrite notices carry sanitized category/explanation data; terminal Finished/done values carry the same stop details. Interactive dispatch and real non-interactive `processAgentStream` tests assert the terminal detail output; notice and diagnostic tests cover review surfaces and null handling.
- Survey term evidence: paired term contrasts use the same request-window extraction, tokenizer, and budget, and require comparable dump evidence on both sides. Presentation previews are excluded from analysis. Missing evidence yields an unavailable contrast.
- Recovery attribution: recovery requires a later successful attempt with matching project, session, runtime, and prompt identity from token usage or explicit journal correlation. The real-journal prompt A refusal followed by prompt B success remains unknown for A.
- Focused terminal-notice checks passed: 12 tests across interactive dispatch and non-interactive output, 0 failures. `git diff --check` passed.
- Full `npm run test`: initial `tmp/verify4101/test-R2.log` ended `rc=0`. A later full run, `tmp/verify4101/test-R2b.log`, included the new Vercel cap tests and ended `rc=1` in the scripts shard: two post-close process-group tests in `scripts/tests/bun-test-tree-join.bun.test.ts` hit `EPERM` while the fixture cleanup tried to signal its owned group. The unchanged file passed 3/3 standalone reruns (`19 pass, 0 fail` each; `tmp/verify4101/treejoin-alone-R2.log`). The two new Vercel tests passed in the full run and in 4/4 targeted runs. Final typecheck, lint, format, build, and focused notice checks passed. The required grep on the initial full-run log matched only two `(pass)` retry-runner self-test lines, with no `FAILED:` markers; the later log contains the one isolated native-test failure.
- Both requested `lunahigh` smoke commands passed and returned haikus, including `--dumponerror`.
- Real-log survey headline: 248 attempts in 86 runs, 22 definite and 226 suspected; 0.8% refusal rate after compression (6/791 calls), 2.3% elsewhere (239/10,485), and 0.0% with missing evidence (3/59,486). No terms were more common in the refused window. The run completed with `rc=0` in `tmp/verify4101/survey-R2b.log`.
- Commit: recorded in the task completion report; branch `issue4101`; no push performed.
Branch: `issue4101`; current phase: P05.

Status: P05 implementation and verification completed. See `.completed/P05.md`.
## Review round 1

- HIGH retention path verification: the pruner now `lstat`s the dumps directory, resolves the verified real directory, skips symlink/non-directory targets with a debug record, and rechecks the directory before child deletion. A real symlinked-directory test confirms outside request/response files survive.
- MEDIUM in-flight publication: retention tracks active base IDs, excludes incomplete and active groups, and clears active state only after response publication. A real temporary-directory interleaving test keeps an active request through another pair's prune and then publishes the response.
- MEDIUM per-attempt caps: Anthropic, OpenAI streaming/JSON/error, and OpenAI Vercel dump metadata carry resolved `retentionLimits`. Real Agent-level refusal tests with tiny configured caps verify Anthropic and OpenAI old pairs are pruned from disk.
- MEDIUM direct Agent.generate refusal: Anthropic and OpenAI native refusal capture now runs without attempt context and writes explicit null correlation identity. Both protocols are covered through local refusal endpoints and filesystem assertions.
- MEDIUM OpenAI stream exception: error-mode streaming composes SDK exception capture with outcome capture, and error response dumps retain attempt correlation. A local SSE endpoint test asserts the request/response pair, stream error body, and attempt identity.
- Focused regressions: 61 tests across retention, SDK dump, Anthropic/OpenAI execution, and Agent refusal files passed (`rc=0`).
- Full verification final pass: `npm run typecheck`, `npm run lint`, `npm run format`, `npm run build`, and `npm run test` each recorded `rc=0` in `tmp/verify4101/{typecheck,lint,format,build,test}-R1a.log`.
- The first full test run reported one timing-sensitive unrelated heap-retention assertion (`shellPtyMemory.bun.test.ts`, observed 19 retained `Uint8Array` values against 16). That file passed 3/3 standalone reruns. A subsequent complete workspace run passed: agents 669/669, core 867/867, CLI 1004/1004, plus all remaining workspace suites. `grep -nE 'Native Bun test failed|^FAILED:' tmp/verify4101/test-R1a.log` matched only two `(pass)` retry-runner self-test lines; no `FAILED:` suite marker appeared.
- MEDIUM terminal refusal diagnostics: terminal stop decisions and review stop paths now include available Anthropic category/explanation details. Terminal display removes control characters; null evidence stays null in records and has no invented display value. Local Anthropic behavior tests, interactive notice dispatch, and non-interactive stderr coverage passed.
- MEDIUM compression provenance: `compressed` payloads now persist optional summary-author provider/model and strategy fields; replay continues to accept legacy payloads. `RecordingIntegration` forwards provenance from the compression event. The recording boundary regression passed, and the real dedicated-summarizer audit test checks provider/model on the persisted `compressed` journal payload (5/5 tests passed).
- MEDIUM bounded preview partitioning: previews carry their added/pending origin through shared-budget selection, preventing an omitted oversized entry from shifting pending content into the added list. Regression test reproduced the old failure, then passed after the fix.
- MEDIUM dump pairing and term contrasts: request/response halves merge by base id, preserving request terms and response outcome. Term comparison uses content from the newest message window in each linked request body and applies the same tokenizer. Separate-file dump-index regression passed.
- MEDIUM journal survey correlation: journal readers normalize `prompt_id` and `promptId`, and recovery joins require matching prompt/attempt identity plus the recorded `ai` speaker. The test writes a real journal through `SessionRecordingService` and verifies the normalized join.
- MEDIUM session identity: compression and refusal joins now use exact project/session/runtime identity, so parent and child sessions stay separate. The parent/child regression passed.
- Focused final regression batch: 67 tests across 10 files passed (`rc=0`).
- The first full test cycle reached 10,577 passing tests, then the Agents API-surface declaration guard failed on an obsolete provenance type import. After removing the unused import, the final full verification passed: `npm run typecheck`, `npm run lint`, `npm run format`, `npm run build`, and `npm run test` each recorded `rc=0` in `tmp/verify4101/{typecheck,lint,format,build,test}-R1b.log`.
- The required grep, `grep -nE 'Native Bun test failed|^FAILED:' tmp/verify4101/test-R1b.log`, matched two `(pass)` retry-runner self-test lines only. There were no `FAILED:` suite markers.
- Initial survey snapshot before the legacy-join correction: 247 attempts in 85 runs (21 definite, 226 suspected), with all refusal evidence unmatched. Superseded by the corrected survey results in the issue 4101 correlation regression follow-up below.
- `git diff --check`: passed. Changes remain on branch `issue4101`; no push performed.


## Issue 4101 correlation regression follow-up

- Restored explicit correlation fallback order: exact project/session/runtime identity, a unique `legacy-prompt-prefix` match, then a unique `legacy-timestamp` journal span. Ambiguous cases without one unique journal remain unmatched. Child-runtime calls require that runtime to be present in journal records, preventing parent compression history from crossing runtime boundaries.
- The per-run report labels its join method; the summary counts exact, both legacy methods, and unmatched calls. Fixture tests cover mismatched legacy IDs resolved by prefix, ambiguous prefix resolved by the unique timestamp span, and parent/child isolation.
- Focused scripts regression: `bun test scripts/tests/refusal-survey.test.ts` passed 4/4 tests and 23 assertions. Full `npm run test` passed (`tmp/verify4101/test-R1c.log`, final `rc=0`); the log shows `scripts/tests/refusal-survey.test.ts` and all four tests passing. The failure-marker grep matched only `(pass)` retry-runner self-tests. `npm run typecheck`, `npm run lint`, and `npm run format` passed.
- Survey refresh: 248 attempts in 86 runs (22 definite, 226 suspected). Compression buckets: after-compression 6/788, elsewhere 239/10,423, missing-evidence 3/58,511. Join methods: exact 0, legacy prompt-prefix 12,421, legacy timestamp 218, unmatched 57,083.
- The first two Opus runs among `gone/branch-2` and `stranded/branch-2` are `gone/branch-2` at `2026-11-09T22:06:01.487Z` and `2026-11-09T22:06:05.670Z`; both use `legacy-prompt-prefix` and point to compression at `2026-11-09T18:51:24.355Z`, with 3 and 4 refusal attempts respectively. `stranded/branch-2` at `2026-11-13T22:38:03.500Z` is 0.261 seconds after compression at `22:38:03.239Z` and lands in after-compression.
- Definite refusals by project/model: `projects/uqm` / `claude-opus-5-5` 18; `stranded/branch-1` / `claude-opus-5-5` 1; `T/llxprt-review-BJ3Lui` / `scripted-model` 2; `T/llxprt-refusal-6hmvRd` / `claude-opus-5-5` 1. The three `T/...` entries are test-harness sessions in the real log root, consistent with logs leaked before the harness isolation fix.
- `git diff --check` passed. Branch remains `issue4101`; no push performed.

| Phase | State | Verification |
| --- | --- | --- |
| P00 / P00.5 | Complete from the checked-in plan | Issue and integration map were read before implementation. |
| P01 | Implemented and verified | Details in `.completed/P01.md`. |
| P02 | Implemented and verified | Corrected provider behavior, fixture initialization, and full repository verification are recorded below. |
| P03 | Implemented and verified | Details in `.completed/P03.md`; full verification log: `tmp/verify4101/test-P03.log`. |
| P04 | Implemented and verified | See P04 verification record and `.completed/P04.md`; full suite log: `tmp/verify4101/test-P04c.log`. |
| P05 | Implemented and verified | Offline refusal survey, 60-second compression correlation, bounded tool-response previews, content-word filtering, and isolated refusal harness logs; see `.completed/P05.md` and `tmp/verify4101/test-P05b.log`. |

## P04 verification record

- Added audit-only refusal metadata for partial text, coalesced thinking, unfinished tool input, output tokens, first-byte timing, and context fingerprint. The unfinished tool input remains audit metadata, never an executable tool call.
- Context baseline advances after a committed success and resets on clear/rebind/dispose. Compression provenance comes from the actual summarizer route; structural compression records a null author and its strategy.
- The end-to-end refusal audit behavior test forces real compression through `compression.profile` using a distinct summarizer endpoint, then refuses the next foreground request. It asserts a single compression, timestamp, summarizer provider/model author and unchanged foreground model. This test passed.
- Added coverage for thinking updates coalesced by `streamId`, runtime disposal/rebind baseline unavailability, UTF-8 bounded previews, and null compression author.
- The initial full-suite run exposed outdated StreamProcessor test fixtures and expected original text in the bounded refusal fingerprint. Updated fixtures to initialize the audit owner and refined the journal assertion to distinguish allowed refusal audit previews from rewritten conversation history. Restored the finalization wrapper seam used by existing StreamProcessor tests. No behavior assertions were removed or weakened.
- Focused final P04/regression run: 68 tests across 9 files, `rc=0` (`tmp/verify4101/focused-P04c-final.log`).
- `npm run typecheck`: `rc=0` (`tmp/verify4101/typecheck-P04c.log`).
- `npm run lint`: `rc=0` (`tmp/verify4101/lint-P04c.log`).
- `npm run format`: `rc=0` (`tmp/verify4101/format-P04c.log`).
- `npm run build`: `rc=0` (`tmp/verify4101/build-P04c.log`).
- `npm run test`: `rc=0` (`tmp/verify4101/test-P04c.log`); `grep -nE 'Native Bun test failed|^FAILED:'` found no matches (`grep_rc=1`, expected for no matches).
- `git diff --check`: passed.

## P03 verification record

- Startup mode precedence is code default `off`, user-global `dumpcontext`, `--dumponerror`, then the last explicit `--set dumpcontext=...`; the result is written to the session overlay. CLI session overrides use the same session-scoped writer, and child settings inherit that overlay.
- Added user-level `dumpcontext` and `dumpRetention` settings, generated schema/docs, startup validation/application, diagnostics reporting of effective mode including `off`, and retained inert loading of legacy profile `dumponerror` keys. Removed the dead Config getter/state and active registry entry.
- Focused startup tests cover code/user/flag/`--set` sources, CLI precedence, repeated `--set`, retention propagation, child inheritance, action-mode rejection, and later session override. Registry/profile and ephemeral-setting tests cover removal and legacy compatibility.
- The first `npm run test` run ended with `rc=1`: sandbox test doubles lacked the required `LoadedSettings.user.settings` property after startup began reading only user settings. Updated those fixtures to match the actual loader contract; both sandbox test files then passed (24/24).
- `npm run typecheck`, `npm run lint`, `npm run format`, `npm run build`, and `npm run lint:settings-sync`: passed.
- Final `npm run test`: `rc=0` in `tmp/verify4101/test-P03.log`; `grep -nE 'Native Bun test failed|^FAILED:'` returned no matches (`failure-markers-none`).
- Smoke tests passed: normal `lunahigh` returned a haiku; `--dumponerror --profile-load lunahigh` returned a haiku.
- `git diff --check`: passed. The required test-first red run was not independently captured for this phase; the focused tests passed after implementation and the first full-suite run exposed only the incomplete sandbox fixtures.

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

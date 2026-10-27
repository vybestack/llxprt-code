# Issue 3956: clipboard paste, PRIMARY, and copy shortcuts

## Scope and implementation

The keyboard clipboard text path now calls the same `handleLargePaste` behavior as bracketed terminal paste, so normalization, thresholds, cursor placement, placeholders, pruning, and submit-time expansion remain unified. Image-first clipboard handling is retained. Empty reads remain no-ops; clipboard read errors show safe, actionable feedback without exposing error text or clipboard contents.

Linux middle-button press reads PRIMARY only: Wayland uses `wl-paste --no-newline --primary`; X11 uses `xclip -selection primary -o` or `xsel --primary --output`. Commands are passed as argument arrays, use a 1.5-second timeout, and cap output at 1 MiB. It does not fall back to CLIPBOARD. Missing/unavailable access is reported, empty PRIMARY is ignored. Mouse handling is subscribed only while mouse events are enabled and the prompt is focused, and disabled while embedded shell focus is active. Press-only handling prevents generic release events from causing a duplicate paste. Existing right-release regular clipboard paste is unchanged.

The default QUIT and CLEAR_INPUT Ctrl+C bindings now explicitly require `shift: false`. General matcher behavior is unchanged. Bare Ctrl+C remains supported, and platform copy-selection listeners remain outside these bindings.

## Test-first evidence

- Preserved interrupted clipboard RED/GREEN logs: `project-plans/.tmp-issue3956/clipboard-red.log` and `clipboard-green.log`. Independently reran all 6 clipboard cases successfully, including image-first insertion, empty text, multiline/large placeholder and submit expansion, and safe error feedback.
- `primary-red.log` records the missing-helper RED failure before `primarySelection.ts` existed. Then all 4 PRIMARY backend tests passed for Wayland selection, X11 selection, missing/failing tool reporting, and empty no-fallback behavior.
- `InputPrompt.paste.test.tsx`: 30 passed, 0 failed, including PRIMARY middle press/generic release and inactive/shell-focus behavior plus existing large-paste submission cases. React's test environment emits its existing `act(...)` configuration warnings.
- `keyMatchers.test.ts` and PRIMARY backend tests: 64 passed, 0 failed. Shifted Ctrl+C does not match QUIT/CLEAR_INPUT; bare Ctrl+C still matches both.
- No production behavior is asserted via mocks. Test doubles are limited to clipboard/desktop command infrastructure.

## Documentation

`docs/keyboard-shortcuts.md` now documents app paste semantics, Linux selection readers and required packages, mouse-mode/focus constraints, remote process-environment limits, and copy/cancel chord behavior.

## Verification record

- Focused paste suite: PASS, exact command `PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cli/src/ui/components/InputPrompt.paste.test.tsx` (30 tests).
- PRIMARY and matcher suites: PASS, exact command `PATH="$PWD/node_modules/.bin:$PATH" bun test packages/cli/src/ui/keyMatchers.test.ts packages/cli/src/ui/utils/primarySelection.test.ts` (64 tests).
- Focused production TypeScript check: attempted `PATH="$PWD/node_modules/.bin:$PATH" tsc --noEmit -p packages/cli/tsconfig.noemit.json`; failed on pre-existing/unrelated workspace diagnostics including missing `LocalTokenizationError` exports and `cleanup.overlappingExit.test.ts` Promise/void mismatches. Rerun full typecheck after package build.
- `npm run format -- --ignore-path project-plans/.tmp-issue3956/prettier-ignore`: PASS (exit 0); the temporary ignore explicitly excludes protected `.llxprt/`. Only issue files were changed by formatting.
- `bun scripts/test-audit/scan.ts project-plans/.tmp-issue3956/test-audit`: PASS (exit 0, 3,344 files, 0 scanner errors). Existing findings in the touched test module are at older unrelated tests; none were reported on the new PRIMARY test or key matcher test.
- Full `npm run test`, `npm run lint`, `npm run build`, and full typecheck are still running/pending; outcomes to be appended after completion.
- Requested smoke test attempted twice: `PATH="$PWD/node_modules/.bin:$PATH" bun scripts/start.ts --profile-load luna "write me a haiku and nothing else"`; both exited 1 with exact error `Error: Profile 'luna' not found`. No `luna` profile file exists in this checkout.
- Local OCR is unavailable. No commit, push, PR, or merge will be performed.

## Review remediation, 2026-10-26

### Delivered behavior and contracts

- Pending desktop reads capture prompt ownership. Blur, embedded-shell focus, unmount, and blur/refocus invalidate the captured generation, including late failures. Clipboard image probing also checks ownership before starting the next OS operation.
- Completion uses the latest buffer and caret. Text remains routed through the sanitized atomic paste helper. Images use the latest buffer for path insertion. Overlapping reads preserve both results in completion order at the current caret.
- PRIMARY checks the live mouse-reporting flag at initiation and completion. A mouse-mode generation also rejects a pending read after an off/on cycle. Provider subscription settings continue to gate event delivery.
- `queueErrorMessage` now renders through the prompt view using the existing semantic error color. Rendered error regressions assert visible actionable messages, unchanged prompt text, and absence of private backend sentinels.
- `wl-paste` exit 1 is classified as empty only for the exact trimmed `Nothing is copied` stderr, empty stdout, and no signal/kill indication. Other failures remain generic and redacted. Wayland preference, PRIMARY-only fixed argv, and no fallback to another display server or CLIPBOARD are preserved.
- Real Bun/TypeScript process fixtures exercise UTF8, fixed argv, nonzero exit, output overflow, and a reader that ignores SIGTERM. The latter exposed a real timeout weakness; `SIGKILL` now reliably bounds termination. Tests also verify the child PID is gone.
- Actual stdin dispatch covers SGR middle release, SGR anonymous release, X11 anonymous release, right-release clipboard paste, shifted Ctrl+C, Meta+C, and bare Ctrl+C prompt clearing. Copy tests establish prompt preservation and clear separation; they do not exercise a terminal emulator's native clipboard ownership.
- Existing sanitization and Unicode helper remediation is preserved, including its 16 behavior tests.

### RED/GREEN evidence

All log paths below are relative to `project-plans/.tmp-issue3956/`.

1. `remediation-paste-red.log`: 33 passed, 11 failed before lifecycle/live-mouse/rendered-error remediation. The atomic text helper already passed completion-caret and overlapping-read regressions. An image fixture initially lacked the cleanup stub; this was corrected and its meaningful RED was rerun separately.
2. `remediation-image-red.log`: with the corrected desktop fixture and the stale image-buffer path, expected `@image.png left:typedright`, received `left: @image.png typedright`. Exit 1. Restoring the latest-buffer fix made it pass.
3. `remediation-primary-red.log`: 11 passed, 3 failed. Both injected and actual nonzero no-selection results incorrectly rejected. A SIGTERM-ignoring child returned successfully after about 4.66 seconds instead of failing at the 1.5-second deadline.
4. `remediation-primary-green.log`: 14 passed, 0 failed. Hanging process failed safely at about 1.53 seconds; overflow/nonzero errors stayed redacted and all children were reaped.
5. Final focused command, with `PATH="$PWD/node_modules/.bin:$PATH"`:
   `bun test packages/cli/src/ui/components/InputPrompt.paste.test.tsx packages/cli/src/ui/components/input-prompt-desktop-paste.test.tsx packages/cli/src/ui/components/input-prompt-text-paste.test.ts packages/cli/src/ui/utils/primarySelection.test.ts packages/cli/src/ui/keyMatchers.test.ts packages/cli/src/ui/utils/mouse.test.ts`.
   `remediation-focused-final.log`: **159 passed, 0 failed**, two snapshots. React retains its existing act-environment warnings.

The shared fixture extracted from the existing paste suite avoids duplicated setup and keeps both suites within existing lint size limits. It is named `input-prompt-paste-test-helpers.tsx` to match production build exclusions. The executable fixture is `primary-reader.fixtures.ts` for the same reason. Existing unrelated completion/history test doubles were moved with the fixture; new paste behavior uses the real prompt, key/mouse parsing, buffer, normalization, placeholder tracking, and submit expansion. New OS doubles are confined to clipboard/desktop infrastructure.

### Full verification in this remediation run

Every command uses `PATH="$PWD/node_modules/.bin:$PATH"`.

- The existing full `npm run test` job (`shell_9acdc64a8667`) was inspected and retained instead of spawning a duplicate. Its final outcome will be recorded below. Affected suites were independently rerun after the edits.
- Initial full `npm run lint` (`shell_6768239f1135`): exit 1. Corrected strict-equality/array-style findings, split oversized test setup, and extracted paste hooks to comply with function-size limits. Also changed the provider behavior test's nullable-provider guard to an explicit nullish comparison, resolving its strict-boolean lint failure without changing provider behavior. A fresh full lint run is logged in `remediation-lint.log`.
- `npm run build`: exit 0, `remediation-build.log`, including lazy-MCP coherence verification. This refreshed stale workspace declarations before full typechecking.
- First `npm run typecheck`: exit 1, `remediation-typecheck.log`. The extracted test fixture's original name did not match production build exclusions and pulled agent test support across CLI rootDir. Renaming the helper/fixture to established excluded conventions fixed the build boundary. The 242 generated, untracked declaration siblings from that failed attempt were removed; exact owned paths are recorded in `generated-declarations-cleanup.json`. Full rerun: `remediation-typecheck-final.log`.
- `npm run format`: exit 0, `remediation-format.log`. `.prettierignore` explicitly excludes `.llxprt/` and `.llxprt/**`; no protected files were changed. A final post-rename run is logged in `remediation-format-final.log`.
- Final changed-file ESLint: exit 0, zero warnings, `remediation-scoped-lint-final.log`.
- AST audit: `bun scripts/test-audit/scan.ts project-plans/.tmp-issue3956/audit-remediation`, exit 0, 3,346 files, zero scanner errors. `audit-comparison.txt` normalizes the baseline archive prefix and ignores relocated line numbers. No new MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING, or NO_ASSERT findings in touched suites. Remaining DUP_ASSERT/SNAPSHOT_ONLY/MOCK_ONLY_ORACLE findings are in pre-existing unrelated command-search/Tab cases.
- Requested `bun scripts/start.ts --profile-load luna "write me a haiku and nothing else"`: exit 1, `remediation-smoke-luna.log`, exact error `Error: Profile 'luna' not found`.
- Installed fallback `bun scripts/start.ts --profile-load gpt-luna-high "write me a haiku and nothing else"`: exit 0, `remediation-smoke.log`, returned a three-line haiku after behavioral remediation. No profile files were created or changed.
- Local OCR remains unavailable; independent final review and hosted OCR remain assigned to the foreground agent.
- No commit, push, PR, merge, issue mutation, or `.llxprt` change.

### Final-build and follow-up verification evidence

- Final `npm run build` after all source edits and helper/fixture renames: **exit 0**, `remediation-build-final.log`. CLI production artifact guard passed, VS Code checks/build passed, and lazy-MCP coherence passed. The normal full build cleaned stale dist output from the failed declaration-only attempt. A subsequent ad hoc CLI declaration-only check had raced that full build's dependency cleanup and failed on missing workspace declarations; this is recorded in `remediation-cli-declarations.log` and is not counted as verification success.
- Final installed-profile smoke after that build: **exit 0**, `remediation-smoke-final.log`, a three-line haiku from `gpt-luna-high`. The requested `luna` alias is still absent.
- Final `npm run format`: **exit 0**, `remediation-format-final.log`.
- Final AST scan: **exit 0**, 3,346 files, zero scanner errors, `audit-remediation-final.log`; `audit-comparison-final.txt` confirms zero new prohibited findings on the final touched suites.
- Provider nullish-guard regression: `bun test packages/providers/src/openai-responses/compression-session-headers.behavior.test.ts`, **3 passed, 0 failed**, `remediation-provider-regression.log`.
- The inherited full test run's policy JUnit report recorded one failed isolated file, `destructive-commands.dd-of-credential.test.ts`. Its original detailed stdout is unavailable in the managed task's retained output tail, so the precise original assertion is not established. Focused rerun: **15 passed, 0 failed**, `policy-regression.log`. Entire policy workspace rerun, `npm run test --workspace @vybestack/llxprt-code-policy`: **exit 0, 12/12 isolated files passed**, `remediation-policy-full.log`. The test contains a strict 200 ms performance assertion; this suggests load sensitivity but does not prove the original failure's cause. No policy code or test was changed.
- The fresh full lint invocation encountered ENOENT for the old helper filename because it collected file paths before the rename. That command cannot count as a clean full-command pass. Its remaining partitions continue in `remediation-lint.log`; a stable, whole-CLI partition rerun is `eslint packages/cli --no-error-on-unmatched-pattern`, logged in `remediation-cli-lint.log`.
- Both root `npm run typecheck` attempts failed during their build:types prelude (initial source helper inclusion, then stale declaration artifacts). After the passing final full build, every remaining root typecheck target is being executed explicitly without repeating dist writes: `npm run typecheck --workspaces --if-present`, `tsc --project tsconfig.scripts.json`, and `tsc --project evals/tsconfig.json`. Logs: `remediation-typecheck-workspaces.log`, `remediation-typecheck-scripts.log`, `remediation-typecheck-evals.log`; final exit codes: `remediation-typecheck-coverage.exit`. Do not describe root `npm run typecheck` as passing unless a later invocation actually succeeds.

### Exact source/documentation change inventory

Existing issue files preserved or updated:

- `docs/keyboard-shortcuts.md`
- `packages/cli/src/config/keyBindings.ts`
- `packages/cli/src/ui/components/InputPrompt.paste.test.tsx`
- `packages/cli/src/ui/components/InputPrompt.tsx`
- `packages/cli/src/ui/components/inputPromptHooks.ts`
- `packages/cli/src/ui/components/inputPromptText.ts`
- `packages/cli/src/ui/components/input-prompt-text-paste.test.ts`
- `packages/cli/src/ui/keyMatchers.test.ts`
- `packages/cli/src/ui/utils/primarySelection.ts`
- `packages/cli/src/ui/utils/primarySelection.test.ts`
- `project-plans/issue3956.md`

Additional remediation files:

- `packages/cli/src/ui/components/input-prompt-desktop-paste.test.tsx`
- `packages/cli/src/ui/components/input-prompt-paste-test-helpers.tsx`
- `packages/cli/src/ui/utils/fixtures/primary-reader.fixtures.ts`
- `packages/cli/src/ui/utils/mouse.ts`
- `packages/providers/src/openai-responses/compression-session-headers.behavior.test.ts` (explicit nullish guard only)

Disposable logs, audits, and state remain confined to `project-plans/.tmp-issue3956/` and must not be staged. The foreground-owned audit baseline source is preserved for its planned cleanup. No protected `.llxprt` changes or Git staging/commit/push/PR operations occurred.

### Fallback verification and review, 2026-10-26

- Authentication is available in this fallback run. The installed `gpt-luna-high` profile returned a three-line haiku with exit 0 (`fallback-auth-smoke.log`). No authentication workaround or credential change was attempted.
- Read issue #3956, round-one review, current plan, and the implemented source/test changes. The inherited remediation already addresses latest-caret insertion, overlapping reads, ownership invalidation, live mouse generation checks, rendered safe feedback, and narrowly classified absent Wayland PRIMARY. Preserved the existing TDD changes without duplicating implementation or undoing source edits.
- Independently reran all six affected suites: **159 passed, 0 failed**, two snapshots (`fallback-focused.log`, exit 0). This includes actual reader timeout/overflow/process cleanup and stdin mouse/copy dispatch.
- `git diff --check`: exit 0. Existing final audit comparison records zero new prohibited findings in the touched suites.
- Continued the existing full test job `shell_9acdc64a8667` rather than starting a duplicate. Started a stable full lint invocation (`fallback-lint.log`) because the inherited lint command exited 2 after the helper rename. Serialized fresh root typecheck, format, build, and installed-profile smoke behind the inherited workspace typechecks to avoid concurrent build/declaration writes.
- Final command outcomes will be recorded below after the active jobs complete. No new source edits, `.llxprt` edits, staging, commit, push, PR, merge, or issue mutation in this fallback run.

## Final independent code review

Round two (`architect-uwia46`) found no remaining HIGH or MEDIUM correctness issues. All six first-round findings were checked against the actual production paths and considered resolved. The reviewer independently passed `git diff --check` and inspected the recorded 159-pass focused run, without interfering with running full checks.

The foreground independently reran the helper, PRIMARY-reader, and key-matcher suites: 90 passed, 0 failed, 298 assertions. Desktop compositor integration remains a manual verification limitation. Ctrl+Shift+C safety requires a terminal/wrapper that preserves Shift; legacy identical Ctrl+C encodings cannot be distinguished inside LLxprt.

The disposable archived baseline source was removed after audit comparison; its compact findings reports remain under the issue-owned temporary directory. No `.llxprt` contents were modified.

## Completed verification and full-suite remediation

- Stable root verification completed: `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and installed-profile `gpt-luna-high` smoke each exited 0 (`fallback-*.exit`). The `luna` alias remains unavailable; no profile files were changed.
- Foreground independently reran all six affected suites: 159 passed, 0 failed, two snapshots and 440 assertions (`foreground-focused-final.log`). Final AST audit comparison found zero new prohibited test findings (`foreground-audit-comparison.json`).
- The completed full CLI report contained five failed isolated files. The config boundary guard failed because a new test-only helper was temporarily under UI production source. It was moved to `packages/cli/src/__tests__/input-prompt-paste-test-helpers.tsx`; the boundary guard plus both affected prompt suites passed (62 tests), and scoped lint passed. Remaining old mock-call/partial-Key assertions are being investigated and migrated to behavioral coverage before PR publication.
- The completed agent-workspace report recorded two 30-second property-test timeouts in `config-injection.spec.ts`. An isolated rerun reproduced 4 passing / 2 timing out (`agents-config-injection-rerun.log`). Investigation is delegated separately; this is not dismissed as unrelated or described as a passing full suite.
- No commit or remote branch exists yet. Temporary evidence remains unstaged under the scoped issue directory.

### Agent property-test timeout remediation

The two failures reproduced with unchanged 30-second deadlines. Each fast-check sample initialized an entire real CLI-style workspace, including synchronous host IDE ancestry discovery. The properties vary session ID and inspect adoption identity/provider/model behavior, so repeating host discovery for every sample was unnecessary infrastructure cost.

The test now creates one real caller-owned workspace per property, retains all 100 samples and real `fromConfig`/facade disposal for every sample, and cleans up the workspace afterward. It adds runtime-ID and provider-manager identity assertions. No production behavior, timeout, arbitrary, sample count, or skips changed. Focused root and workspace-preload runs each passed all six tests (812 assertions), with the properties finishing in approximately one second each. The detailed report and red/green logs are retained only in the unstaged issue temporary directory. Full verification is being rerun.

### Remaining CLI regression remediation

All four originally failing CLI files now pass individually: completion 21/21, legacy paste/steering 13/13, main prompt 24/24, global keybindings 17/17. The real-buffer paste suite passes 27/27 with two snapshots. The foreground reproduced these isolated results independently (102 tests total).

- Replaced three threshold tests that asserted internal `setText` calls with real-buffer LF/escaped-LF/CRLF placeholder display and expanded-submission tests.
- Removed a redundant right-click test that mocked mouse dispatch and asserted internal replacement calls; the stronger existing stdin/right-release real-buffer test verifies normalized submitted content.
- Clipboard failure coverage checks actionable redacted feedback instead of expecting backend-error logging; rendered error behavior is additionally covered by the desktop-paste suite.
- Global key tests now construct complete typed key events, including `shift:false`, rather than asserting incomplete objects as `Key`.
- A combined, nonisolated probe exposed module-mock contamination across legacy suites, so its results were discarded. Only its generated snapshot additions were removed. All authoritative reruns use one Bun process per legacy file, matching the canonical CLI runner.
- Final AST scan completed successfully and found zero new prohibited flags against baseline on all touched suites. No production changes were required for these stale-test regressions.

A formatting-check probe raced with cleanup of temporary trace files and reported ENOENT on those owned temporary paths, while stating all matched files followed style. The coordinated root formatting step remains the authoritative final formatting result.

## Final verification progress and bounded ancillary fixes

- Canonical CLI runner completed successfully: **828/828 files; 10,248 passed, zero failed, six skipped, 13 todo**.
- Stable final root lint, typecheck, format, build, and `gpt-luna-high` smoke each exited 0. The earlier lint attempt raced with a temporary runner fixture being removed; the stable root rerun passed without changing lint rules.
- Full root test rerun exposed additional slow property fixtures in the agents workspace, plus policy elapsed-time and MCP cancellation-fixture failures. The aggregate run is not reported as green. Corrected complete workspace reruns and remaining fixture work are tracked separately.
- A profiler identified `unwrapAnsiCQuotes` as 19.6% of self time in the pathological policy case even when there was no ANSI-C quote. A three-line early return for inputs without `$'` avoids rebuilding an unchanged string. Security assertions and the 200 ms regression deadline were retained; the complete policy workspace passed 12/12 files, and independent scoped lint/format plus the 15-test credential suite passed.
- The MCP test fixture intended to ignore cancellation but passed the abort signal into its native loopback fetch and announced entry only after awaiting that fetch. It now establishes the hold before awaiting I/O, removes the abort signal from the deliberately ignoring backend, and fails explicitly if the connection settles before fixture entry/abort. All 72 cancellation assertions remain; the complete MCP workspace passed 53/53 files.
- The tools overflow-cancellation test failed once in the aggregate run; the exact 20-test file passed independently. Its complete workspace rerun is being monitored, and no product defect is asserted from that single failure.
- The completed full root run exited 1: tools 141/142 files, policy 11/12, MCP 52/53, agents 552/556; its CLI stage passed **828/828 files and 10,248 tests** again. Core 502/502 and providers 670/670 passed, as did the remaining workspace reports. This aggregate includes pre-remediation failures and is not represented as a single successful run.
- Corrected complete tools rerun passed **142/142 files**. No tools source change was needed; the observed overflow-cancellation assertion also passed in its isolated 20-test file.
- Remaining agents property remediation explicitly forwards the existing optional `idePort` through the CLI-style test fixture. Non-IDE generated examples opt into a fresh terminal-only port; ordinary fixture defaults and IDE suites retain actual discovery. A new behavioral test failed before forwarding and passed afterward. All generated cases retain fresh real Config/provider/activation/MCP ownership, assertions, sample counts, and deadlines.
- Auth mutation properties reuse one real agent per property with baseline reset/verification rather than rebuilding host integration for each sample. Independent canonical-preload rerun passed **22 tests**. Runtime/settings/mutation focused suites passed **34 tests**. The corrected complete agents rerun has passed all nine previously failing properties; remaining files are still running.
- Later-edits scoped ESLint, Prettier, agents/MCP typechecks, and canonical policy typecheck passed. A mistaken attempt to use a nonexistent policy noemit config was corrected by invoking its actual workspace typecheck script. Final AST scan covered 3,327 files with **zero new prohibited findings** after normalization against the pre-remediation audit.
- Corrected complete agents rerun exited 0: **556/556 files, 5,158 tests, zero failures**, plus **7/7 isolated native Bun files**. All previously failed workspaces now have successful complete reruns. Combined verification is a completed root run with explicitly recorded failures followed by successful corrected workspace reruns, not a single all-green root invocation. No owned test-runner processes remain.

## PR #3957 hosted feedback and remediation

- Initial commit `cbe50f193` pushed and PR https://github.com/vybestack/llxprt-code/pull/3957 created. Initial-head hosted tests all passed, including every shard, Linux E2E docker/no-sandbox, interactive tmux, CodeQL, smoke and runtime plugins.
- CI JavaScript lint exposed the production architectural ratchet omitted from the root lint script: two new full-state hook inputs increased CLI service-bag parameters 553→555 and bundles 775→777. Hooks now accept the active-ownership boolean and explicit paste dependencies. Actual production audit returns to **553/775**, with the guard and baseline unchanged and zero compiler diagnostics. Before/after feature suites and legacy focused suites passed.
- CodeRabbit identified non-Linux middle-click feedback. New dispatched Darwin/Windows tests failed RED with visible Linux access errors; Linux-only PRIMARY gesture dispatch made both pass. The complete desktop suite now passes **28 tests**; Linux behavior tests explicitly scope and restore the platform.
- CodeRabbit identified xclip's unoffered text target. Upstream xclip 0.13 sources verify the exact `Error: target STRING not available` signature for the fixed default-target arguments. Only exit 1, exact trimmed stderr, empty stdout, no signal and no kill classify as empty. Different/extended diagnostics, partial output, timeout and killed subprocesses still fail safely. Two new empty cases failed RED; the complete reader suite passes **27 tests**, including real-process negative cases. Wayland classification and all subprocess bounds remain unchanged.
- Regenerated the shortcut table using `npm run docs:keybindings`, restoring the Basic Controls heading and explicit no-Shift annotations.
- Hosted OCR did not review code: LLM preflight returned 401 Unauthorized (expired/incorrect token), phase llm-preflight, zero tokens. Hosted LLxprt walkthrough posted Review unavailable after pinned local-model startup exited 4. Successful recorder job status does not count as review completion. No authentication, secret, review workflow, or guard changes were made.
- Repeated the complete local verification cycle for this remediation. Final results will be appended after existing jobs finish. The final review test audit scans 3,327 files with **zero new prohibited findings** relative to the pre-review scan.
- Review-remediation cycle finished: root lint, typecheck, format, build, and gpt-luna-high smoke all exited 0. CLI passed **828/828 files, 10,263 tests, zero failures**. Every other workspace passed except agents **553/556**: two Node-export files failed while the concurrent build removed/replaced compiled Core output (explicit ERR_MODULE_NOT_FOUND); after build completion those exact files passed **1 + 3 tests**, unchanged. The third file, fromConfig.behavior, exceeded the runner's 300-second file deadline during concurrent verification; its exact unchanged isolated rerun passed **25 tests in 226.08 seconds**. The root aggregate remains exit 1 and is not described as a single green invocation. Earlier complete agents rerun was 556/556; current-head hosted agents was green before this CLI-only remediation. No deadline/sample weakening or source changes were made for these verification-order failures.

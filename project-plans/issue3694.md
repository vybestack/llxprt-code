# Issue #3694: flat runtime tools and removal of retired bridges

## Implemented scope

Runtime and provider request tools use the existing core `ToolDeclaration[]` contract: ordered declarations with `name`, optional `description`, and required `parametersJsonSchema`. Runtime options, chat configuration, producer output, hooks, diagnostics, provider converters, formatter inputs, MCP/LSP callable declarations, and affected fixtures are flat.

Authoring and discovery retain `FunctionDeclaration` and their existing normalization rules. The tools package remains a leaf package. Gemini groups declarations at its transport boundary. Conversation logging groups declarations only when writing its existing event and JSONL output. Schema values, declaration order, descriptions, and the existing empty-origin presentation are preserved.

The toolset conversion bridge and both duplicate part shapes are removed. The response conversion utility uses the existing tools `ContentPart` contract and continues accepting unknown external inputs. Its tests cover text, thinking, calls, responses, media provenance, malformed/incomplete external parts, limiting, and errors. The orphaned part utility, its dedicated tests, and its barrel export are deleted. The source-read regression guard targets the live response utility and retains all five prohibited Config-pattern assertions. The summarizer implementation is unchanged.

No workspace dependency, configuration metadata, workflow, quality enforcement, or `.llxprt` files were edited. An already-declared Gemini plugin dependency missing locally was previously installed under ignored `tmp/verify3694/plugin-deps` and linked into the plugin's ignored node_modules for independent verification. No further dependency changes were made.

## Empty-tools persistence correction

The remaining logger defect was loss of origin when grouped tools became flat. The original factory and `setTools([])` emitted `[{ functionDeclarations: [] }]`. Streaming and turn selections producing no declarations emitted outer `[]`. Direct filtered/missing requests omitted tools. An enabled streaming selection also converted missing tools into outer `[]` before logging.

These are supported persisted outputs. They do not require a normalization exception or a new grouped runtime contract. The earlier claim that preserving them required a public subsystem or a user behavior decision was mistaken. A request-local logging flag in the existing metadata channel is within the authorized scope.

The correction carries `conversationLogEmptyTools` from the existing stream/turn selection call sites through per-request runtime metadata. Streaming keeps the previous hook correction that preserves missing runtime tools as `undefined`; logging can still emit the historical outer `[]`. Turn selection derives presentation from original tool presence and the existing restriction result. Direct behavior is unchanged.

The existing options normalizer now merges caller runtime metadata into normalized option metadata even when no runtime resolver is injected. Explicit request metadata retains precedence. This was necessary for the real logging wrapper to receive the turn-selection flag. The existing request setup and conversation logging contexts carry the boolean to the writer. The logger emits outer `[]` for a flagged empty request, groups producer-empty declarations, and omits unflagged missing tools. Non-empty declarations keep their existing grouped output.

No grouped declarations travel in runtime metadata. No converter, array tagging, bridge, compatibility alias, or new public generic type was introduced. The flag is not part of hooks v2 or provider HTTP bodies.

### Behavioral proof

Evidence is under `tmp/verify3694`.

| Boundary | Producer-empty | Missing | Mode none | Unmatched allowlist |
| --- | --- | --- | --- | --- |
| Direct conversation event and JSONL | `[{ functionDeclarations: [] }]` | Field omitted | Field omitted | Field omitted |
| Streaming event and JSONL, selection enabled | `[{ functionDeclarations: [] }]` | `[]` | `[]` | `[]` |
| Non-streaming turn event and JSONL | `[{ functionDeclarations: [] }]` | `[]` | `[]` | `[]` |

`chat-session-empty-tools.test.ts` drives actual `ChatSession.setTools`, direct sends, streaming sends, turn sends, the real `LoggingProviderWrapper`, real hook-output decoding, the event constructor, and the filesystem-backed JSONL writer. Only the provider/hook infrastructure and telemetry sink are substituted. It checks event values, JSONL values, JSONL field presence, and absence of logging metadata from BeforeToolSelection, BeforeModel, and AfterModel envelopes.

- `final-empty-tools-red.log`, exit 1: 14 pass and six persistence failures before the production correction. Producer/direct cases and the eight existing hook cases already passed; streaming/turn missing, none, and unmatched cases failed.
- `final-empty-tools-green.log`, exit 0: all 20 hook and persistence cases passed after the correction. Final touched-file verification includes the subsequent additional hook-envelope absence assertions.
- `final-focused.log`, exit 0: 56 tests across empty-origin, allowed-tool-selection, and hook-control files passed together.
- `final-logging-wire.log`, exit 0: 52 tests in the real Gemini client wire file, including two new real-provider checks. For both streaming and non-streaming, requests with the flag absent, true, and false have identical captured HTTP path/body data, with no logging flag serialized. No provider or SDK converter is mocked.
- `remediation-baseline-evidence.log` preserves the original factory, setTools, selection, and logger source. `remediation-baseline-outputs.log` records original logger JSONL outputs for grouped producer-empty, outer selection-empty, and omitted missing tools. These baseline artifacts remain unchanged.

## Other behavioral evidence retained

| Behavior | RED evidence | GREEN evidence |
| --- | --- | --- |
| Flat provider declarations produce OpenAI classic/Vercel/Responses and Anthropic payloads, with schema normalization, description defaults, order, nonmutation, and boolean rejection | `converters-red.log`, exit 1: four pass, eight fail. Real converters skipped flat inputs and did not reject false schemas. | `converters-green.log`, exit 0: 16 pass. Subsequent rejection cases cover false and true. |
| Grouped persisted output and flat Gemini boundary inputs retain schemas and empty/absent behavior | `output-boundaries-red.log`, exit 1 against main production: one pass, three fail. | Boundary suites pass; empty-origin acceptance is now covered by the real-wrapper matrix above. |
| Formatter and tool-selection consumers accept flat declarations | `consumer-red.log`, exit 1: 107 pass, eight fail, one loading error. This does not claim every selected suite loaded. | Individually configured touched tests pass after rebuilding generated declarations. |
| Error diagnostics count declarations and identify recursive JSON references | `error-diagnostics-red.log`, exit 1: expected three declarations but main collected none. | `error-diagnostics-green.log`, exit 0: declaration names, count, and cyclic-schema attribution pass. |
| Governance, emitters, execution, summaries, and shell-host conversion remain unchanged | Existing regression suites retained. | Ten related regression files passed in `related-regressions.json` and `related-tests.log`. |

Initial runtime type/fixture tests alone were insufficient RED, and generated declarations initially prevented some tests from loading. The later behavioral converter tests and production migration supersede those limitations. Bun does not typecheck runtime test files; the explicit typecheck gate is retained.

## Review finding disposition

The review budget is exhausted. No additional review or OCR is run for this correction.

1. **Hook/logger empty parity: Blocker-Fix, resolved.** The eight direct/stream hook cases remain intact. The twelve real-wrapper persistence cases now retain all historical event and JSONL shapes. Actual Gemini HTTP requests are unchanged across empty origins and logging flags.
2. **Schema-source negative fixtures: In-scope-Fix, restored.** Classic OpenAI and Vercel parameterFallback inputs retain conflicting extra `parameters.fromParameters` alongside `parametersJsonSchema.fromJsonSchema`. The Vercel issue1844 rejection input retains a usable extra fallback schema when the primary schema is missing. Tests remain adversarial without widening `ToolDeclaration` or adding runtime fallback behavior.
3. **Numeric or false fileData preservation: Reject.** External `ContentPart.fileData` permits examination of unknown values, but neutral media output requires string mime type and data. Preserving numeric 17/23 or false as output would violate that contract and encode invalid behavior in passing tests. Supported strings, defaults, and provenance remain covered. Broader external schema hardening is outside scope.
4. **Historical diagnostic group counts: Reject; unrelated metric redesign: Defer.** Debug/runtime tool counts now count declarations rather than the former single group. No consumer of runtime `metadata.toolCount` or affected persisted conversation counter was found in `remediation-count-census.log`. Actual declaration payload logging is preserved separately. Restoring an incorrect group count is not required.
5. **Recording timeouts and exact smoke-profile spelling: no remaining behavior decision.** Earlier unchanged recording tests failed under load; the preceding complete run passed all 2,739 file executions with existing retries. Assertions, retry policy, thresholds, and runner timeouts remain unchanged. The user authorized the available Luna-family `lunahigh` profile. Absence of an exactly named `luna` profile is not a blocker, and no profile/configuration edit is needed.

## Verification history

Earlier overlapping tests/builds and later recording timeouts are retained in `test.log`, `test-final.log`, and `test-candidate-*` artifacts. They are not final-tree acceptance evidence. The previous complete serial correction run passed format, lint, typecheck, test, and build; `remediation-test.exit` is zero, with 2,739/2,739 file executions in `remediation-summary.json`. SessionDiscovery passed on the runner's existing retry; resumeSession passed without changes. Independent Gemini checks passed 257 tests, plugin typecheck/build passed, and 52 touched files passed. The previous audit found no new prohibited test patterns.

The current correction's first full lint attempt found an optional-boolean conditional in the new logger code. It was changed to an explicit `=== true`, without suppressions or enforcement edits. That failed attempt is retained in `final-lint.log` and `final-lint.exit`. The next full typecheck found that the new test's `Object.hasOwn` assertion exceeded the agents test project's existing TypeScript library target. It now uses `Object.prototype.hasOwnProperty.call` without changing that target. The failed full attempt is retained in `final-accepted-typecheck.log`; the corrected agents typecheck passes in `final-agents-typecheck.log`, exit zero.

## Final local verification

The detached drivers completed root gates serially, then the authorized `lunahigh` haiku smoke, independent Gemini gates, individually configured touched tests, and main-versus-candidate test audit. All evidence is under `tmp/verify3694`. No test/build overlap was introduced by these drivers. `final-summary.json` records the last complete run; individual gates use `final-last-<stage>.log` and `.exit`.

| Gate | Exit and evidence |
| --- | --- |
| `npm run format` | 0 |
| `npm run lint` | 0, without suppressions or enforcement changes |
| `npm run typecheck` | 0, without changing TypeScript targets |
| `npm run test` | 1; 2,737/2,739 file executions passed. Tools: 138/139; core: 458/459; providers: 645/645; agents: 420/420; CLI: 764/764. Two unchanged failure paths are documented below. |
| `npm run build` | 0, including lazy-MCP build-coherence verification |
| Authorized `lunahigh` haiku smoke | 0; profile loaded, model request completed and returned the haiku below |
| Independent Gemini tests | 0; 259 tests across 23 files, 2,310 expectations |
| Independent Gemini typecheck/build | Both 0 |
| Individually configured touched tests | 0; 52/52 files. Per-file results are in `final-touched-tests.json` and logs under `final-touched-tests/`. |
| Main-versus-candidate test audit | 0; no new MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING, or NO_ASSERT findings on touched tests. Both scans have zero errors. `final-audit-comparison.json` contains counts and findings. |
| Retired-symbol census | 0 acceptance exit; ripgrep exit 1 means no retired identifiers found |
| Protected-path inspection | Empty `final-last-protected-paths.log`; no dependency, workflow, configuration metadata, enforcement, or `.llxprt` edits |
| `git diff --check` | 0 |

The smoke command was `bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"`. The last response was:

```text
Autumn rain whispers
A red leaf drifts through still air
Dusk gathers the hills
```

The census's first broad pattern also matched Vercel's existing `ToolResultPart` import from the third-party `ai` package and its local consumers. That is an SDK boundary type, not a retired local duplicate. The precise retired-identifier census excludes this unrelated SDK name and finds no matches. Both the initial broad matches and final precise results are retained; no source was changed to satisfy the census.

### Remaining full-suite acceptance blocker

Three complete serial runs were retained rather than combining isolated successes into a claimed green full command:

- `final-verified-test.log`, exit 1, 2,738/2,739 files: the unchanged direct-web-fetch overflow test hit its existing 180,000 ms timeout. Main and candidate then each passed all 20 tests with the established preload and budget (`final-web-fetch-main.log` and `final-web-fetch-candidate.log`, both exit 0).
- `final-confirmed-test.log`, exit 1, 2,738/2,739 files: all tools/core tests passed, but unchanged `sandbox-launch-release.test.ts` failed when `process.kill(-groupId, 0)` returned EPERM during the sidecar cleanup probe. Main and candidate then each passed all 12 tests (`final-sandbox-main.log` and `final-sandbox-candidate.log`, both exit 0).
- `final-last-test.log`, exit 1, 2,737/2,739 files: unchanged `ast-edit-3242-memory.bun.test.ts` failed in fixture setup when `git add -A` exceeded its existing spawnSync budget (ETIMEDOUT/SIGTERM), before the memory behavior was measured. Unchanged `local-media-store-locking.test.ts` also failed the slow-publisher child case with `MediaStoreError: Media store admit object and release lock failed`. Providers, agents, CLI and all remaining workspaces passed.

The final isolated comparison reproduced the same fixture Git timeout on archived main (`final-ast-memory-main.log`, exit 1, one pass/one fail). The candidate passed both AST-memory cases (`final-ast-memory-candidate.log`, exit 0). The media-locking suite passed all 15 tests on both main and candidate (`final-media-locking-main.log` and `final-media-locking-candidate.log`, both exit 0). These are real behavior runs, not source-scan substitutes. The comparison archive's main and HEAD identities are retained in `final-baseline-commits.log`.

`final-failure-paths-unchanged.exit` is zero: the cited fixture/test/AST-edit and media-store source paths have no diff from HEAD. Earlier web-fetch and sandbox paths were also checked unchanged. `final-host-friction.log` records read-only host conditions during the last run, including load averages 62.89, 46.36 and 50.44. This supports a load-sensitive explanation for timing failures; it does not establish the cause of the media lock error or turn a failed full command green.

No unrelated source, assertion, memory threshold, runner retry, timeout, configuration, or enforcement rule was modified. The exact logger persistence and Luna smoke blockers are resolved. A green full `npm run test` remains outstanding on the latest tree; the preceding 2,739/2,739 result is historical and is not substituted for this gate.

No commit, push, PR, CI run, additional review, or OCR occurred during this correction. Merge remains unauthorized.

## Checkout delivery verification, October 2, 2026

The complete delivery run resolves the outstanding full-suite gate above. `tmp/verify3694/delivery-summary.json` records 2,739/2,739 file executions and exit zero for every gate. Earlier failed full runs remain historical evidence; isolated passes were not substituted for the complete command.

Root gates ran serially: `npm run format`, `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build`. Each exited zero. The authorized `bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"` exited zero and returned a haiku with profile/model label `[lunahigh:gpt-6-luna]`. Independent Gemini `npm run test`, `npm run typecheck`, and `npm run build` each exited zero; Gemini passed 259 tests across 23 files with 2,310 expectations. The root build verified source and compiled lazy-MCP registry coherence before plugin verification.

Only the established worker overrides were used: `LLXPRT_AUTH_TEST_CONCURRENCY=1`, `LLXPRT_CORE_TEST_CONCURRENCY=1`, `LLXPRT_AGENTS_TEST_CONCURRENCY=1`, and `LLXPRT_CLI_TEST_CONCURRENCY=1`. Their support is recorded in `delivery-concurrency-evidence.log` from the existing runners and `scripts/lib/bun-test-policy.ts`. The shared runner already executes files serially. Discovery, assertions, timeouts, retry budgets, preloads, and enforcement were unchanged. No full-suite retry was needed during delivery. Tools passed 139/139, core 459/459, providers 645/645, agents 420/420, and CLI 764/764.

The exact retired-identifier census and local duplicate-type declaration census found no matches. `git diff --check` passed. `delivery-protected-paths.log` is empty. SHA-256 comparisons against the delivery-start snapshot found no changed non-plan files after formatting and all gates. Existing behavioral RED/GREEN, real event/JSONL/hook and Gemini transport evidence, 52/52 touched-file passes, and the zero-new-findings test audit remain retained without additional reviews or implementation changes.

An SSH fetch of `origin/main` succeeded. The candidate base is `f3839b8810496490f4eaf8513c27e12bd7952809`; fetched `origin/main` is `f2a7ea536b58198ce7387f736047ec24b26b1423`, two commits ahead. The upstream changes and issue changes share no paths (`delivery-ancestry-paths.log`). No merge or rebase was performed, and the combined upstream/candidate tree was not tested. Delivery permits only the issue-scoped local commit after these passing gates. No push, PR, CI run, additional review, or OCR is part of this delivery.

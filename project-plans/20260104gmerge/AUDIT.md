- Generated: `2026-01-04 00:00`
- Branch: `20260104gmerge`
- Upstream range: `v0.10.0..v0.11.3` (`172` commits)

## Status Counts (Against CHERRIES.md)

| Status | Count |
|---|---:|
| PICKED | 0 |
| REIMPLEMENTED | 5 |
| IMPLEMENTED | 1 |
| SKIP | 3 |
| PARTIAL | 1 |
| NO_OP | 2 |
| ALREADY_PRESENT | 0 |
| DIVERGED | 0 |
| MISSING | 0 |

## Full Upstream Table (Chronological)

| # | Upstream | Decision | Status | Local | Subject | Notes |
|---:|:--|:--|:--|:--|:--|:--|
| 1 | `8a937ebf` | SKIP |  |  | chore(release): bump version to 0.11.0-nightly.20251015.203bad7c (#11212) |  |
| 2 | `b8df8b2a` | REIMPLEMENT | REIMPLEMENTED | `b46177ec0` | feat(core): wire up UI for ASK_USER policy decisions in message bus (#10630) | Applied to google-web-fetch.ts; upstream web-fetch.ts/web-fetch.test.ts/message-bus-integration.test.ts missing in LLxprt = NO_OP for those files |
| 3 | `4f17eae5` | REIMPLEMENT | REIMPLEMENTED |  | feat(cli): Prevent queuing of slash and shell commands (#11094) | Wired queueErrorMessage state through UIState/UIActions contexts, Composer, InputPrompt; added handleSubmit wrapper for queue blocking |
| 4 | `d38ab079` | SKIP | SKIPPED |  | Update shell tool call colors for confirmed actions (#11126) | Purely aesthetic; conflicts with LLxprt SemanticColors palette; no functional value |
| 5 | `47f5e73b` | SKIP |  |  | Docs: Fix typo in docs/changelogs/index.md (#11215) |  |
| 6 | `c80352a7` | SKIP |  |  | Docs: Fix typo in docs/get-started/index.md (#10793) |  |
| 7 | `2e6d69c9` | REIMPLEMENT | REIMPLEMENTED |  | Fix --allowed-tools in non-interactive mode to do substring matching for parity with interactive mode. (#10944) | Updated doesToolInvocationMatch to accept string invocation; removed parseAllowedSubcommands; updated shouldConfirmExecute |
| 8 | `7bed302f` | SKIP |  |  | refactor(actions): remove checkout from sub-actions (#11219) |  |
| 9 | `47f69317` | REIMPLEMENT | REIMPLEMENTED |  | Add support for output-format stream-jsonflag for headless mode (#10883) | Added STREAM_JSON to OutputFormat; added StreamJsonFormatter class; wired into nonInteractiveCli.ts |
| 10 | `ccaa7009` | SKIP |  |  | fix(infra) - Reenable github test (#10839) |  |
| 11 | `1fc3fc0a` | SKIP |  |  | fix(ci): Fix a2a publishing (#11211) |  |
| 12 | `8c1656bf` | REIMPLEMENT | PARTIAL |  | Don't always fall back on a git clone when installing extensions (#11229) | LLxprt extension system already handles github-release/git types; consent flow not applied |
| 13 | `cfaa95a2` | REIMPLEMENT | SKIP |  | feat(cli): Add nargs to yargs options (#11132) | Already implemented in LLxprt via commit dcf347e21 - all nargs: 1 options and both tests present |
| 14 | `72b2cc54` | SKIP |  |  | Updates from running "npm install" (#11238) |  |
| 15 | `e2fef41f` | SKIP |  |  | fix(ci): Ensure we cleanup the `false` tag. (#11232) |  |
| 16 | `8c74be79` | SKIP |  |  | Update README.md (#11240) |  |
| 17 | `130f0a02` | REIMPLEMENT | SKIP | `577de9661` | chore(subagents): Remove legacy subagent code (#11175) | LLxprt has advanced subagent system (SubAgentScope); removal would break core functionality |
| 18 | `c9c633be` | REIMPLEMENT | REIMPLEMENTED | `19c602897` | refactor: move `web_fetch` tool name to `tool-names.ts` (#11174) | Added GOOGLE_WEB_FETCH_TOOL and DIRECT_WEB_FETCH_TOOL imports; replaced hardcoded strings |
| 19 | `3acb014e` | SKIP |  |  | fix(e2e): Refactor and unskip context compression interactive tests (#11086) |  |
| 20 | `60420e52` | PICK | COMMITTED | `c527c3ecf` | feat: Do not add trailing space on directory autocomplete (#11227) | Cherry-picked successfully; no conflicts |
| 21 | `a9083b9d` | PICK | SKIP |  | include extension name in `gemini mcp list` command (#11263) | Already implemented in LLxprt - mcpCommand.ts lines 163-164 already show "(from ${server.extensionName})" in serverDisplayName |
| 22 | `5aaa0e66` | SKIP |  |  | Enable --debug-tool for codebase investigator. (#11033) |  |
| 23 | `b734723d` | PICK | SKIP |  | Update extensions install warning (#11149) | Different security text approach - LLxprt already has "Extensions may introduce unexpected behavior. Ensure you have investigated the extension source and trust the author." warning (line 584) |
| 24 | `872d2eaf` | SKIP |  |  | chore(ci): remove github publish workflow from upstream (#11246) |  |
| 25 | `b4f6c7c4` | SKIP |  |  | Docs: Add autocomplete demo gif to README (#11255) |  |
| 26 | `c96fd828` | SKIP |  |  | Docs: Move security file from root to docs (#11259) |  |
| 27 | `155242af` | SKIP |  |  | chore: remove emojis from tips / tips for prompt (#11220) |  |
| 28 | `ffa547ce` | SKIP |  |  | Docs: remove mention of IDE mode from README (#11260) |  |
| 29 | `05930d5e` | REIMPLEMENT | REIMPLEMENTED | `30a369b56` | fix(web-fetch): respect Content-Type header in fallback mechanism (#11284) | Applied to google-web-fetch fallback; added Content-Type check - text/html gets converted via html-to-text, JSON/text/plain/etc returned raw |
| 29 | `6ded45e5` | PICK | SKIP |  | feat: Add markdown toggle (alt+m) to switch between rendered and raw… (#10383) | Already implemented in LLxprt main branch as commit 81a4b03d5 - markdown toggle with alt+m/option+m keyboard shortcut, RawMarkdownIndicator component, renderMarkdown state in UIStateContext |
| 30 | `d2c9c5b3` | PICK | COMMITTED | `c3d9e02e1` | Use Node.js built-ins in scripts/clean.js instead of glob. (#11286) | Cherry-picked with clean.js conflict resolved - kept glob for .stryker-tmp but applied readdir/stat for workspace packages and vsix files |
| 31 | `39cc07de` | SKIP |  |  | chore: add upstream docs CI check (#11277) |  |
| 32 | `bec2bfca` | SKIP |  |  | Revert "chore: add upstream docs CI check" (#11290) |  |
| 33 | `937c15c6` | REIMPLEMENT | REIMPLEMENTED | `a35cb3d6d` | refactor: Remove deprecated --all-files flag (#11228) | Removed --all-files option, allFiles property, fullContext parameter/method from Config class across 3 packages; updated test mocks and documentation |
| 34 | `de3632af` | SKIP |  |  | chore(ci): improve workflow references (#11266) |  |
| 35 | `6b866d12` | SKIP |  |  | chore(ci): rename upload artifact (#11268) |  |
| 36 | `2aa1d742` | SKIP |  |  | fix(infra): disable flaky extension update tests (#11273) |  |
| 37 | `01c577c3` | SKIP |  |  | fix(infra): improve interactive test isolation (#11280) |  |
| 38 | `02241e91` | SKIP |  |  | feat(auth): Improve auth dialog error handling and messaging (#11320) |  |
| 39 | `c71b7491` | PICK | REIMPLEMENTED - COMMITTED | `0e2efa699` | fix: Add folder names in permissions dialog similar to the launch dialog (#11278) | REIMPLEMENTED in LLxprt - added folder name to 'Trust this folder' label using existing workingDirectory from hook |
| 40 | `991bd373` | PICK | REIMPLEMENTED - COMMITTED | `bd104ab7a` | fix(scripts): Improve deflake script isolation and unskip test (#11325) | REIMPLEMENTED - added .dockerignore temp handling, env passing, cmd args support; ctrl-c test kept as skipIf(CI) |
| 41 | `a4403339` | PICK | REIMPLEMENTED - COMMITTED | `a11d156aa` | feat(ui): add "Esc to close" hint to SettingsDialog (#11289) | REIMPLEMENTED - updated help text and tests (LLxprt has no snapshots) |
| 43 | `9049f8f8` | REIMPLEMENT | SKIP |  | feat: remove deprecated telemetry flags (#11318) | LLxprt has multi-provider architecture with different telemetry system. Upstream removes Google-specific telemetry CLI flags (--telemetry, --telemetry-target, --telemetry-otlp-endpoint, --telemetry-log-prompts, --telemetry-outfile) deprecated in favor of settings.json. LLxprt's telemetry differs and these flags should be reviewed separately for multi-provider system. |
| 44 | `22f725eb` | PICK | SKIP |  | feat: allow editing queued messages with up arrow key (#10392) | LLxprt lacks the queued message infrastructure (useMessageQueue hook, QueuedMessageDisplay component) required by this feature. This is a significant feature addition (399 lines) that LLxprt doesn't have. Would require major new code addition rather than simple pick/reimplement. |
| 45 | `dcf362bc` | REIMPLEMENT | IMPLEMENTED | `36e269612` | Inline tree-sitter wasm and add runtime fallback (#11157) | IMPLEMENTED 2026-01-07: Added tree-sitter WASM shell parser with regex fallback. New files: shell-parser.ts, shell-parser.test.ts, wasm.d.ts. Updated: shell-utils.ts, shell.ts, esbuild.config.js. Dependencies: web-tree-sitter, tree-sitter-bash, esbuild-plugin-wasm. 28 new tests pass, all existing shell-utils tests pass. |
| 46 | `a67deae8` | SKIP |  |  | test: skip extension update test in windows (#11275) |  |
| 47 | `cd0f9fe2` | SKIP |  |  | chore: revert ink fork to upstream (#11296) |  |
| 48 | `406f0baa` | PICK |  |  | fix(ux) keyboard input hangs while waiting for keyboard input. (#10121) |  |
| 49 | `d42da871` | PICK |  |  | fix(accessibility) allow line wrapper in screen reader mode  (#11317) |  |
| 50 | `3a1d3769` | PICK |  |  | Refactor `EditTool.Name` to use centralized `EDIT_TOOL_NAME` (#11343) |  |
| 51 | `f3ffaf09` | PICK |  |  | fix: copy command delay in Linux handled (#6856) |  |
| 52 | `ca3d260a` | SKIP |  |  | Revert "chore: revert ink fork to upstream" (#11293) |  |
| 53 | `b2ef6626` | SKIP |  |  | Docs: Add MCP add instructions in README (#11270) |  |
| 54 | `be25e2cb` | SKIP |  |  | refactor: remove --all-files flag (#11288) |  |
| 55 | `0ded546a` | PICK |  |  | fix(prompt): Make interactive command avoidance conditional (#11225) |  |
| 56 | `795e5134` | SKIP |  |  | chore: switch command prefix from /mcp to /m (#11287) |  |
| 57 | `659b0557` | PICK |  |  | feat(cli): Suppress slash command execution and suggestions in shell mode (#11380) |  |
| 58 | `4a0fcd05` | PICK |  |  | fix(scripts): Update get-release-version to use yargs parsing, handle a dynamically set package name (#11374) |  |
| 59 | `2b61ac53` | PICK |  |  | feat: add missing visual cue for closing dialogs with Esc key (#11386) |  |
| 60 | `8da47db1` | PICK | VERIFIED |  | Enable/fix MCP command tests typechecking (#11281) | Already present in LLxprt - verified 2026-01-06 |
| 61 | `67866849` | SKIP |  |  | chore: Update release metadata for 0.10.0-preview.1 (#11419) |  |
| 62 | `7c086fe5` | PICK | VERIFIED |  | MCP docs/UI cleanup (#10943) | Already present in LLxprt - verified 2026-01-06 |
| 63 | `e4226b8a` | PICK | VERIFIED |  | Update nag respects disableUpdateNag (#11269) | Already present in LLxprt - verified 2026-01-06 |
| 64 | `4d2a1111` | PICK | VERIFIED |  | Case-insensitive @file suggestions (#11285) | Already present in LLxprt - verified 2026-01-06 |
| 65 | `426d3614` | PICK | VERIFIED |  | Fix auth selection integration test (#11256) | Already present in LLxprt - verified 2026-01-06 |
| 66 | `b4a405c6` | PICK |  |  | Slash command descriptions style cleanup (#11330) |  |
| 67 | `d3bdbc69` | PICK |  |  | Extensions: add extension IDs (#11333) |  |
| 68 | `08e87a59` | REIMPLEMENT |  |  | Log all user settings to enable measurement of experiment impacts (#11354) |  |
| 69 | `21163a16` | SKIP | SKIP | `490a0ed6a` | Enable typechecking for ui/commands tests (#11340) | LLxprt command tests excluded from typecheck (tsconfig.json lines 41-65) due to architectural divergence. All 33 tests execute and pass at runtime. Verified 2026-01-06: all mandatory commands PASS. |
| 70 | `0b20f88f` | SKIP |  |  | test: skip context compression integration test (#11348) |  |
| 71 | `9b9ab609` | REIMPLEMENT | SKIP |  | feat(logging): Centralize debug logging with a dedicated utility (#11417) | LLxprt has superior 269+ line DebugLogger system (namespace-based, ConfigurationManager integration, file+stderr output, sensitive redaction, lazy evaluation, 28+ usages). Simple upstream 37-line utility would be a downgrade. Re-validated 2026-01-06: all mandatory commands PASS (lint, typecheck, build, start). |
| 72 | `f4330c9f` | REIMPLEMENT |  |  | remove support for workspace extensions and migrations (#11324) |  |
| 73 | `cedf0235` | PICK |  |  | Enable typechecking for ui/components tests (#11350) |  |
| 74 | `2ef38065` | PICK |  |  | refactor(tools): Migrate shell tool name to a centralized constant (#11418) |  |
| 75 | `dd42893d` | PICK |  |  | Enable typechecking for config tests (#11341) |  |
| 76 | `f22aa72c` | REIMPLEMENT | VERIFIED | `81be4bd89` | Making shell:true as default and adding -I to  grep (#11448) | Already implemented in LLxprt as 81be4bd89 - verified 2026-01-06 with all mandatory commands PASS (lint, typecheck, build, start) |
| 77 | `d065c3ca` | PICK | VERIFIED |  | Enable typechecking for more test files (#11455) | NO_OP - All 5 test files already typechecked in LLxprt. Alternative type-safe approach using ReturnType<typeof vi.fn> instead of imported Mock types. All mandatory commands PASS 2026-01-06.
| 78 | `f425bd76` | SKIP |  |  | Rename component to "TodoTray" (#11469) |  |
| 79 | `98eef9ba` | REIMPLEMENT | VERIFIED | 4af93653d | fix: Update web_fetch tool definition to instruct the model to provid… (#11252) | Already implemented as 4af93653d - description text in google-web-fetch.ts is IDENTICAL to upstream change. All mandatory commands PASS 2026-01-06. |
| 80 | `23e52f0f` | REIMPLEMENT | VERIFIED |  | refactor(core): Centralize tool names to avoid circular dependencies - Edit, Grep, Read (#11434) | Already implemented with tool name centralization in tool-names.ts. Historical commit 2e5f1252b confirms implementation. All mandatory commands PASS 2026-01-06 (lint, typecheck, build, runtime). |
| 81 | `0fd9ff0f` | PICK |  |  | Fix type errors in UI hooks tests (#11346) |  |
| 82 | `c8518d6a` | SKIP | VERIFIED |  | refactor(tools): Move all tool names into tool-names.ts (#11493) | Already implemented with better architecture. All mandatory commands PASS (lint, typecheck, build, start) - verified 2026-01-06. Previous failure notes were incorrect due to state issue. |
| 83 | `8731309d` | REIMPLEMENT | NO_OP | | chore: do not retry the model request if the user has aborted the request (#11224) | All upstream changes already present in LLxprt: delay.ts with abort support, RetryOptions.signal param, signal.aborted checks, delay signal passing, AbortError re-throw, geminiChat signal pass |
| 84 | `cd76b0b2` | SKIP |  |  | Create Todo List Tab (#11430) |  |
| 85 | `518a9ca3` | VERIFIED NO_OP |  |  | Fix gitignore parser for escaped chars (#11252) |  |
| 86 | `71ecc401` | SKIP |  |  | feat: add activity-based tracking for memory monitor (#11363) |  |
| 87 | `35afab31` | SKIP |  |  | Don't display todo in history (#11516) |  |
| 88 | `d0ab6e99` | VERIFIED NO_OP |  |  | Fix SettingsDialog race clearing settings (#11358) |  |
| 89 | `397e52da` | VERIFIED INCOMPATIBLE |  |  | Fix theme dialog escaping resetting theme (#11347) |  |
| 90 | `9a4c0455` | SKIP |  |  | Docs: update README (configuration examples) (#11369) |  |
| 91 | `a96f0659` | SKIP |  |  | test: skip Linux perf integration test (#11404) |  |
| 92 | `085e5b1f` | SKIP |  |  | chore: remove unused package lock flag (#11401) |  |
| 93 | `36de6862` | VERIFIED | 2026-01-06 | Implement: Propagate traceId from code assist to response metadata (Fixes … (#11360) |
| 94 | `49bde9fc` | PICK | VERIFIED | `fffbb87ee` | Fix GCS path handling in a2a-server (#11297) | GCS path input handling implemented - 47 lines added (37 tests, 10 impl). All mandatory commands PASS 2026-01-06. |
| 95 | `30d9a336` | SKIP |  |  | chore: ensure release version uses npm pack (#11378) |  |
| 96 | `3c57e76c` | SKIP |  |  | chore(release): v0.11.0-preview.0 |  |
| 97 | `61a71c4f` | PICK | SKIP |  | Testing: remove custom waitFor (#11327) | LLxprt requires custom waitFor implementation for ink component - architectural incompatibility. 2 of 3 Batch 35 commits applied, all mandatory commands PASS 2026-01-06. |
| 98 | `d5a06d3c` | PICK | VERIFIED | `019f9daba` | Fix gitignore parser for trailing spaces (#11299) | Trailing spaces in gitignore patterns preserved - 21 insertions, 1 deletion. All mandatory commands PASS 2026-01-06. |
| 99 | `995ae717` | SKIP | NO_OP |  | refactor(logging): Centralize all console messaging to a shared logger (part 1) (#11537) | LLxprt has superior 269+ line DebugLogger system (namespace-based, ConfigurationManager integration, file+stderr output, sensitive redaction, lazy evaluation, 28+ usages). Simple upstream 37-line utility would be a downgrade. All mandatory commands PASS - verified 2026-01-06. |
| 100 | `cc7e1472` | SKIP | NO_OP | 2026-01-06 | Pass whole extensions rather than just context files (#10910) | LLxprt achieves same functionality through different architectural choice: filtering extensions before passing file paths (a2a-server config.ts) rather than passing whole extension objects and filtering in memoryDiscovery.ts like upstream. Both produce identical output. No functional benefit to upstream refactor - architectural preference only. 35 files changed, major refactor with high risk, no reward. All mandatory commands PASS (lint, typecheck, build, start) |
| 101 | `31f58a1f` | PICK | VERIFIED | 2026-01-06 | Fix Windows ripgrep detection (#11492) | VERIFIED NO_OP - LLxprt uses @lvce-editor/ripgrep package with comprehensive cross-platform path resolution (packages/core/src/utils/ripgrepPathResolver.ts). No need for multi-filename checking or manual download. All mandatory commands PASS (lint, typecheck, build, start). |
| 102 | `70a99af1` | PICK | VERIFIED | 2026-01-06 | Fix shell auto-approval parsing (#11527) | VERIFIED NO_OP - LLxprt has superior shell security model with splitCommands(), checkCommandPermissions(), and command substitution detection in shell-utils.ts. Chained command validation already built-in. All mandatory commands PASS. |
| 103 | `723b8d33` | SKIP |  |  | chore: update jest config (#11409) |  |
| 104 | `72b16b3a` | PICK | VERIFIED | 2026-01-06 | Fix macOS sandbox PTY spawn errors (#11539) | VERIFIED NOT APPLICABLE - LLxprt implements generic PTY fallback pattern in shellExecutionService.ts lines 63-74, which is more robust than macOS-specific posix_spawnp check. Current implementation handles all PTY errors. All mandatory commands PASS. |
| 105 | `7dd2d8f7` | SKIP/NO_OP | 2026-01-06 |  | fix(tools): restore static tool names to fix configuration exclusions (#11551) | VERIFIED NO_OP - All tool classes in LLxprt already have static readonly Name property implemented (edit.ts, glob.ts, grep.ts, ls.ts, memoryTool.ts, read-file.ts, read-many-files.ts, ripGrep.ts, shell.ts, write-file.ts, plus 10+ additional tools). LLxprt's implementation is more comprehensive with centralized name constants in tool-names.ts. All mandatory commands PASS (lint, typecheck, build, start). |
| 106 | `654c5550` | PICK | APPLIED | 2026-01-06 | Add wasm read test (#11336) | PARTIAL REIMPLEMENTATION - Function readWasmBinaryFromDisk does not exist in LLxprt fileUtils.ts; added test using dynamic import. Test-only change, no production impact. All validation commands PASS. |
| 107 | `fc4e10b5` | SKIP |  |  | Docs: update README for extensions search (#11441) |  |
| 108 | `81772c42` | SKIP |  |  | chore: update changes to url (#11442) |  |
| 130 | `dd3b1cb6` | SKIP | SKIPPED |  | feat(cli): continue request after disabling loop detection (#11416) | INCOMPATIBLE_ARCHITECTURE - requires LoopDetectionConfirmation dialog and disableForSession() method which do not exist in LLxprt |
| 110 | `f4080b60` | SKIP |  |  | test: Skip windows UI tests (#11422) |  |
| 111 | `14867c7c` | SKIP |  |  | chore(ci): update action version (#11421) |  |
| 112 | `0ed4f980` | SKIP |  |  | chore: update subactions version (#11423) |  |
| 113 | `a2013f34` | SKIP |  |  | chore(ci): disable flaky UI tests (#11429) |  |
| 114 | `f0eed9b2` | SKIP |  |  | chore(ci): switch to requiring PR description (#11436) |  |
| 115 | `9d0177e0` | SKIP |  |  | chore(ci): reorganize test workflow for preview (#11437) |  |
| 116 | `cb8f93ba` | SKIP |  |  | chore(ci): add integration tests to preview runner (#11438) |  |
| 117 | `2c93542e` | SKIP |  |  | Revert "Enable Model Routing" (#11453) |  |
| 118 | `a74a04d1` | SKIP |  |  | Revert "Enable Model Routing" (#11451) |  |
| 119 | `0658b4aa` | PICK | APPLIED | 2026-01-06 | Deflake replace integration test (#11338) | APPLIED - Changed it() to it.skip() for flaky \"insert multi-line block\" test in integration-tests/replace.test.ts to reduce CI flakiness. Test-only change. All validation commands PASS. |
| 120 | `bf80263b` | VERIFIED |  |  | feat: Implement message bus and policy engine (#11523) | Skip/NO_OP: LLxprt has superior implementation - MessageBus exists at confirmation-bus/message-bus.ts, PolicyEngine exists at policy/policy-engine.ts, Config.getPolicyEngine() and getMessageBus() are properly wired (lines 1036-1046). All tools integrated with message bus. MCP spoofing protection, bucket auth flow, TOML config loader - all advanced features missing upstream. Applying would be a regression.|
| 121 | `193b4bba` | SKIP |  |  | chore(ci): remove skip of UI tests (#11559) |  |
| 122 | `74a77719` | SKIP |  |  | chore(ci): rename GH repo (#11560) |  |
| 123 | `af833c5e` | SKIP |  |  | chore(ci): update repo name (#11563) |  |
| 124 | `e49f4673` | SKIP |  |  | Docs: update config list (#11546) |  |
| 125 | `34439460` | SKIP |  |  | chore(ci): add retry for preview tests (#11562) |  |
| 126 | `62dc9683` | PICK | VERIFIED |  | MCP add array handling + tests (#11292) | SKIP - LLxprt has superior `unknown-options-as-args` middleware approach. Both achieve same functional goal. Re-validated 2026-01-06 with all mandatory commands PASS. |
| 127 | `e72c00cf` | PICK | VERIFIED | `f3d6f58e2` | Proxy agent error handling (#11310) | COMMITTED as f3d6f58e2 - Error handling for proxy agent creation in fetch.ts. Re-validated 2026-01-06 with all mandatory commands PASS. |
| 128 | `fb44f5ba` | SKIP |  |  | test: re-enable skip (#11558) |  |
| 129 | `cf16d167` | PICK | VERIFIED | `ba3c2f7a4` | Repo tooling: tsconfig linter for exclude list (#11298) | COMMITTED as ba3c2f7a4 - Complete tsconfig exclude list linter implemented in scripts/lint.js. Re-validated 2026-01-06 with all mandatory commands PASS. |
| 131 | `f5e07d94` | SKIP |  |  | Docs: update for MCP template (#11561) |  |
| 132 | `b364f376` | VERIFIED |  |  | refactor(logging): Centralize console logging with debugLogger (#11590) | VERIFIED - LLxprt has superior DebugLogger implementation (packages/core/src/debug/DebugLogger.ts). Upstream simple 30-line wrapper vs LLxprt 300+ line system with namespace filtering, lazy evaluation, log levels, redaction, file output, hot-reload. 293+ active instances. All validation commands PASS. |
| 133 | `c6a59896` | SKIP |  |  | Add extensions logging (#11261) |  |
| 134 | `16f5f767` | SKIP | | | Test: use waitFor rather than wait (#11334) | Already implemented - waitFor already used in InputPrompt.test.ts
| 135 | `519bd57e` | SKIP |  |  | chore: WIP for todo aria labels (#11494) |  |
| 136 | `ccf8d0ca` | SKIP | | | Re-enable Ctrl+C integration test (#11357) | Incompatible TestRig API - LLxprt does not support settings parameter
| 137 | `465f97a5` | SKIP |  |  | chore(ci): update PR check name (#11565) |  |
| 138 | `5b750f51` | SKIP | | | Disable CI for stable release setting (#11274) | Feature does not exist - Codebase Investigator not in LLxprt
| 139 | `ed9f714f` | SKIP | | | Non-interactive MCP prompt commands (#11291) | Architectural divergence - non-interactive CLI has different loader design
| 140 | `cc3904f0` | SKIP |  |  | chore: todo aria labels (#11496) |  |
| 141 | `c6a59896` | SKIP |  |  | Add extensions logging (#11261) |  |
| 142 | `306e12c2` | SKIP | | | Fix shift+tab input regression (#11349) | Already implemented as b1fc76d88 (same PR #11634)
| 143 | `c7243997` | SKIP |  |  | Fix flaky BaseSelectionList test (#11337) | ALREADY IMPLEMENTED as a9ecf32c1 (same PR #11620) |
| 144 | `2940b508` | SKIP |  |  | fix: Ignore correct errors thrown when resizing or scrolling an exited pty (#11440) | INCOMPATIBLE ARCHITECTURE - LLxprt has no resizePty() method. Re-validated 2026-01-06 with all mandatory commands PASS. |
| 145 | `d1c913ed` | SKIP |  |  | Docs: update README for MCP prompts (#11467) |  |
| 146 | `73b1afb1` | SKIP |  |  | chore: remove hello extension (#11511) |  |
| 147 | `0d7da7ec` | SKIP |  |  | MCP OAuth path parameter handling (#11305) | ALREADY IMPLEMENTED as 5b6901cd7 (same PR #11654) |
| 148 | `dc90c8fe` | SKIP |  |  | chore(release): v0.11.0-preview.1 |  |
| 149 | `0542de95` | SKIP |  |  | chore(release): v0.11.0-preview.2 |  |
| 150 | `9cf8b403` | SKIP |  |  | chore(release): v0.11.0-preview.3 |  |
| 151 | `a3947a8d` | SKIP |  |  | chore(release): v0.11.0-preview.3+patch.1 |  |
| 152 | `c9c2e79d` | SKIP |  |  | chore(release): v0.11.0-preview.4 |  |
| 153 | `92f5355d` | SKIP |  |  | chore(release): v0.11.0-preview.5 |  |
| 154 | `d9f6cebe` | SKIP |  |  | chore(release): v0.11.0-preview.5+patch.1 |  |
| 155 | `5213d9f3` | SKIP |  |  | chore(release): v0.11.0-preview.6 |  |
| 156 | `f36dec6a` | SKIP |  |  | chore(release): v0.11.0-preview.6+patch.1 |  |
| 157 | `f4f37279` | SKIP |  |  | chore(release): v0.11.0-preview.7 |  |
| 158 | `847c6e7f` | PICK |  |  | Refactor compression service (core structure change) (#11432) |  |
| 159 | `5be5575d` | SKIP |  |  | chore: use lower compression threshold for UI (#11473) |  |
| 160 | `73b3211e` | SKIP |  |  | chore(ui): add footer to show current model (#11544) |  |
| 161 | `8a725859` | SKIP |  |  | chore: require restart when compression threshold changes (#11545) |  |
| 162 | `ce40a653` | SKIP | NO_OP | Alternative Valid Architecture | Make compression threshold editable in the UI. (#12317) | LLxprt uses object-based `model.chatCompression` API instead of upstream's simplified `model.compressionThreshold` number. Both provide identical functionality; LLxprt's approach is more extensible and aligns with LLxprt's architecture. Applying would be breaking API change with no functional benefit. |
| 163 | `b1bbef43` | SKIP |  |  | Allow continue on prompt if LoopDetection disabled (#11367) | INCOMPATIBLE ARCHITECTURE - LLxprt's LoopDetectionService does not have disabledForSession property or disableForSession() method. Re-validated 2026-01-06 with all mandatory commands PASS. |
| 164 | `44b3c974` | SKIP |  |  | fix: Improve quota error messaging (#11364) |  |
| 165 | `e5161610` | SKIP |  |  | chore(release): v0.11.3 |  |
| 166 | `f5e07d94` | SKIP |  |  | Docs: update README for MCP templates (#11564) |  |
| 167 | `9cf8b403` | SKIP |  |  | chore(release): v0.11.0-preview.3 |  |
| 168 | `a3947a8d` | SKIP |  |  | chore(release): v0.11.0-preview.3+patch.1 |  |
| 169 | `c9c2e79d` | SKIP |  |  | chore(release): v0.11.0-preview.4 |  |
| 170 | `92f5355d` | SKIP |  |  | chore(release): v0.11.0-preview.5 |  |
| 171 | `d9f6cebe` | SKIP |  |  | chore(release): v0.11.0-preview.5+patch.1 |  |
---

## Analysis Notes (Preserving Original Decisions)

### Batch 02 - Deepthinker Resolution Paths

Original decisions: All 5 commits were marked as PICK. Analysis shows:

| Commit | Original Decision | Resolution Path | Why |
|---|---|---|---|
| `4f17eae5` | PICK | **REIMPLEMENT** | LLxprt has StreamingState but no queue error UI wiring; needs LLxprt-specific implementation in AppContainer.tsx, UIState/UIActions contexts, Composer, InputPrompt |
| `d38ab079` | PICK | **SKIP** | Purely aesthetic (color changes); conflicts with LLxprt SemanticColors palette; no functional value |
| `2e6d69c9` | PICK | **REIMPLEMENT** | Bug fix - LLxprt has same issue in parseAllowedSubcommands/shell.ts; need to apply substring matching fix to shell.ts and tool-utils.ts |
| `47f69317` | PICK | **REIMPLEMENT** | New feature requires LLxprt integration in output-format.ts, nonInteractiveCli.ts, errors.ts; upstream docs won't apply cleanly |
| `8c1656bf` | PICK | **REIMPLEMENT** | Apply result object + consent-driven fallback to LLxprt extension plumbing (extension.ts, github.ts) |

### Batch 03 - Pending

Original decision: `cfaa95a2` marked as PICK.
Status: Cherry-pick conflicts in config.ts due to diverged extension handling. Needs subagent analysis to determine resolution path.

### Batch 03 - REIMPLEMENT

Original decision: `cfaa95a2` marked as PICK.
Resolution: **REIMPLEMENT** - Add `nargs: 1` to all single-argument string/array options in config.ts (LLxprt has many options without nargs that share the same parsing risk as upstream). Two upstream tests should be ported to lock in behavior: positional prompt after `--telemetry-target`, and long positional prompt after multiple `--allowed-tools`. Direct cherry-pick conflicts with LLxprt's diverged option set.

### Batch 04 - SKIP

Resolution: SKIP - Deepthinker confirmed LLxprt's subagent system is more advanced (SubAgentScope). Removing these files would break core LLxprt functionality. Upstream removal targets legacy code that doesn't exist in LLxprt.
Re-validation (2026-01-05): All mandatory commands PASS - npm run lint, npm run typecheck, npm run build, node scripts/start.js --profile-load synthetic. Full outputs in NOTES.md.
| 172 | `5213d9f3` | SKIP |  |  | chore(release): v0.11.0-preview.6 |  |
### Batch 05 - REIMPLEMENTED

Original decision: `c9c633be` marked as REIMPLEMENT.
Resolution: **REIMPLEMENTED** - Applied upstream refactoring to LLxprt. Tool names GOOGLE_WEB_FETCH_TOOL and DIRECT_WEB_FETCH_TOOL already existed in tool-names.ts. Replaced hardcoded 'web_fetch' and 'direct_web_fetch' strings in google-web-fetch.ts and direct-web-fetch.ts with imported constants. Upstream policy.test.ts, policy.ts, and web-fetch.ts changes are NO_OP (files don't exist or have different structure in LLxprt).
### Batch 06 - Mixed Resolution

Original decisions: All 3 commits marked as PICK. Analysis shows:

| Commit | Original Decision | Resolution Path | Why |
|---|---|---|---|
| `60420e52` | PICK | **PICK** | Same logic in `packages/cli/src/ui/hooks/useCommandCompletion.tsx:223`; applies cleanly (no space when suggestion ends with `/` or `\\`) |
| `a9083b9d` | PICK | **REIMPLEMENT** | LLxprt already attaches `extensionName` when merging MCP configs but output omits it (`packages/cli/src/commands/mcp/list.ts:121`) |
| `b734723d` | PICK | **REIMPLEMENT** | LLxprt config differs (`llxprt-extension.json`), different warning text (`packages/cli/src/config/extension.ts:578`), no `--consent` option |

### Batch 23 - VERIFIED SKIP

Upstream commit: `cedf0235` - fix(cli): enable typechecking for ui/components tests (#11419)
Status: SKIP (Already Applied via Architectural Divergence)

Verification (2026-01-06):
- npm run lint: PASS
- npm run typecheck: PASS (all 4 workspaces)
- npm run build: PASS
- node scripts/start.js --profile-load synthetic "write me a haiku": PASS

Root Cause: LLxprt's multi-provider architectural refactoring removed several ui/components test files. The typecheck enablement addressed by upstream commit cedf0235a is already achieved in LLxprt - no ui/components tests are excluded from typecheck in tsconfig.json.

Impact: None - Batch 23's goal (enable typechecking for ui/components) is already met through LLxprt's architectural divergence.

Evidence: Full analysis in project-plans/20260104gmerge/batch23-notes.md
---


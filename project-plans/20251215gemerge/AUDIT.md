# 20251215gemerge Audit (v0.9.0 → v0.10.0)

- Generated: `2025-12-16 11:04`
- Branch: `20251215gemerge` @ `3096412be`
- Upstream range: `v0.9.0..v0.10.0` (`135` commits)

## Status Counts (Against `CHERRIES.md`)

| Status | Count |
|---|---:|
| PICKED | 37 |
| REIMPLEMENTED | 23 |
| SKIPPED_EXPLICIT | 1 |
| ALREADY_PRESENT | 3 |
| NO_OP | 7 |
| DIVERGED | 1 |
| MISSING | 0 |
| SKIP | 63 |

## Missing Planned Upstream Commits

None - all planned commits addressed.

## Commits Marked NO_OP (Not Applicable to LLxprt)

| # | Upstream | Reason |
|---:|:--|:--|
| 62 | `a5e47c62` | Google-specific TOS; LLxprt has own multi-provider tos-privacy.md |

## Full Upstream Table (Chronological)

| # | Upstream | Decision | Status | Local | Subject | Notes |
|---:|:--|:--|:--|:--|:--|:--|
| 1 | `8cd2ec7c` | SKIP | SKIP |  | [Part 4/6] feat(telemetry): add memory monitor with activity-aware recording and tests (#8122) |  |
| 2 | `5d09ab7e` | SKIP | SKIP |  | chore: refactored test-helper to handle boilerplate for interactive mode (#10322) |  |
| 3 | `8980276b` | PICK | PICKED | `51cdc1993` | Rationalize different Extension typings (#10435) |  |
| 4 | `8ac2c684` | REIMPLEMENT | REIMPLEMENTED | `df79e75a0` | chore: bundle a2a-server (#10265) |  |
| 5 | `8aa73008` | SKIP | SKIP |  | refactor(core): Centralize 'write_todos_list' tool name (#10690) |  |
| 6 | `1af3fef3` | PICK | PICKED | `82b61e2e5` | fix(infra) - Remove auto update from integration tests (#10656) |  |
| 7 | `603ec2b2` | PICK | PICKED | `9728d9e6e` | Add script to deflake integration tests (#10666) |  |
| 8 | `b45bd5ff` | SKIP | SKIP |  | Fix(infra) - Skip file system interactive test since it is currently broken (#10734) |  |
| 9 | `c0552ceb` | SKIP | SKIP |  | feat(core): add telemetry for subagent execution (#10456) |  |
| 10 | `b0b1be0c` | SKIP | SKIP |  | chore(int): skip flaky tests (#10736) |  |
| 11 | `467a305f` | PICK | PICKED | `90bc7aaa2` | chore(shell): Enable interactive shell by default (#10661) |  |
| 12 | `b92e3bca` | PICK | PICKED | `f8b3bb796` | fix(mcp): fix MCP server removal not persisting to settings (#10098) |  |
| 13 | `1962b51d` | PICK | PICKED | `dcf347e21` | fix: ensure positional prompt arguments work with extensions flag (#10077) |  |
| 14 | `f2852056` | PICK | PICKED | `947de9c54` | feat: prevent ansi codes in extension MCP Servers (#10748) |  |
| 15 | `76b1deec` | PICK | PICKED | `8a9b759f4` | fix(core): refresh file contents in smart edit given newer edits from user/external process (#10084) |  |
| 16 | `118aade8` | PICK | PICKED | `24d7d047e` | citations documentation (#10742) |  |
| 17 | `3d106186` | SKIP | SKIP |  | Docs: Add updates to changelog for v0.8.0 (#10732) |  |
| 18 | `8d8a2ab6` | REIMPLEMENT | REIMPLEMENTED | `fd145ce6a` | Fix(doc) - Add section in docs for deflaking (#10750) |  |
| 19 | `741b57ed` | PICK | PICKED | `09c4fad56` | fix(core): Use shell for spawn on Windows (#9995) |  |
| 20 | `56ca62cf` | SKIP | SKIP |  | Pre releases (#10752) |  |
| 21 | `29aabd7b` | SKIP | SKIP |  | Remove 'hello' extension (#10741) |  |
| 22 | `bcbcaeb8` | REIMPLEMENT | NO_OP |  | fix(docs): Update docs/faq.md per Srinanth (#10667) |  |
| 23 | `06920402` | PICK | PICKED | `90e5b9800` | feat(core): Stop context window overflow when sending chat (#10459) |  |
| 24 | `95268b26` | SKIP | SKIP |  | chore(release): bump version to 0.10.0-nightly.20251007.c195a9aa (#10669) |  |
| 25 | `3ea5581a` | SKIP | SKIP |  | chore(int): disable flaky tests (#10771) |  |
| 26 | `3d245752` | SKIP | SKIP |  | refactor(core): Centralize 'write_file' tool name (#10694) |  |
| 27 | `a044c259` | PICK | PICKED | `671f8c413` | fix: Add a message about permissions command on startup in untrusted … (#10755) |  |
| 28 | `0cd490a9` | REIMPLEMENT | REIMPLEMENTED | `40c6f3a83` | feat: support GOOGLE_CLOUD_PROJECT_ID fallback (fixes #2262) (#2725) |  |
| 29 | `a0893801` | SKIP | SKIP |  | cleanup(markdown): Prettier format all markdown @ 80 char width (#10714) |  |
| 30 | `70610c74` | SKIP | SKIP |  | feat(telemetry): Add telemetry for web_fetch fallback attempts (#10749) |  |
| 31 | `b60c8858` | PICK | PICKED | `d46080d5e` | feat(ui): shorten context overflow message when <50% of limit (#10812) |  |
| 32 | `cd354aeb` | PICK | PICKED | `bb8a5b75d` | Fix hooks to avoid unnecessary re-renders (#10820) |  |
| 33 | `bd6bba8d` | REIMPLEMENT | REIMPLEMENTED | `f88ca127d` | fix(doc) - Update doc for deflake command (#10829) |  |
| 34 | `433ca84c` | PICK | PICKED | `5474639b7` | fix(tests): log actual output in validateModelOutput on failure (#10843) |  |
| 35 | `ae02236c` | SKIP | SKIP |  | feat(core): generalize path correction for use across tools (#10612) |  |
| 36 | `6d84d4dc` | PICK | PICKED | `16fc60dcc` | Fix prompt to make it a bit more deterministic (#10848) |  |
| 37 | `a8379d1f` | PICK | PICKED | `b85747c62` | fix(tests): enable and update prompt for MCP add tool test (#10850) |  |
| 38 | `5f96eba5` | PICK | PICKED | `7350855cb` | fix(cli): prevent exit on non-fatal tool errors (#10671) |  |
| 39 | `5e688b81` | REIMPLEMENT | REIMPLEMENTED | `6be2b113c` | Skip should fail safely when old_string is not found test (#10853) |  |
| 40 | `5aab793c` | REIMPLEMENT | NO_OP |  | fix(infra) - Fix interactive system error (#10805) |  |
| 41 | `1f6716f9` | SKIP | SKIP |  | feat(telemetry): add diff stats to tool call metrics (#10819) |  |
| 42 | `0b6c0200` | REIMPLEMENT | REIMPLEMENTED | `a939e3282` | feat(core): Failed Response Retry via Extra Prompt (#10828) |  |
| 43 | `ed37b7c5` | PICK | PICKED | `ae1ff54ca` | fix some isWorkspaceTrusted mocks (#10836) |  |
| 44 | `21062dd3` | PICK | PICKED | `d7109b979` | clean up extension tests (#10857) |  |
| 45 | `d190188a` | SKIP | SKIP |  | Add a joke to usePhraseCycler.ts (#10685) |  |
| 46 | `fda3b543` | SKIP | SKIP |  | chore(int): disable skip on "should trigger chat compression with /co… (#10854) |  |
| 47 | `cce24573` | SKIP | SKIP |  | Fix for race condition in extension install / uninstall logging (#10856) |  |
| 48 | `83075b28` | SKIP | SKIP |  | refactor: make log/event structure clear (#10467) |  |
| 49 | `c82c2c2b` | REIMPLEMENT | REIMPLEMENTED | `c272f45a0` | chore: add a2a server bin (#10592) |  |
| 50 | `558be873` | REIMPLEMENT | REIMPLEMENTED | `a831b6d77` | Re-land bbiggs changes to reduce margin on narrow screens with fixes + full width setting (#10522) |  |
| 51 | `112790cb` | SKIP | SKIP |  | fix(infra) - Create a step to calculate the inputs for the nightly-release (#10825) |  |
| 52 | `65b9e367` | PICK | ALREADY_PRESENT |  | Docs: Fix broken links in architecture.md (#10747) |  |
| 53 | `971eb64e` | PICK | PICKED | `1f0392b9e` | fix(cli) : fixed bug #8310 where /memory refresh will create discrepancies with initial memory load ignoring settings/config for trusted folder and file filters (#10611) |  |
| 54 | `38bc8562` | SKIP | SKIP |  | feat(telemetry): ensure all telemetry includes user email and installation id (#10897) |  |
| 55 | `8dc397c0` | SKIP | SKIP |  | fix(core): set temperature to 1 on retry in sendMessageStream (#10866) |  |
| 56 | `affd3cae` | PICK | ALREADY_PRESENT |  | fix: Prevent garbled input during "Login With Google" OAuth prompt on… (#10888) |  |
| 57 | `249ea559` | PICK | PICKED | `e719277e9` | fix(test): Fix flaky shell command test using date command (#10863) |  |
| 58 | `849cd1f9` | REIMPLEMENT | NO_OP |  | Docs: Fix Flutter extension link in docs/changelogs/index.md (#10797) |  |
| 59 | `32db4ff6` | REIMPLEMENT | NO_OP |  | Disable flakey tests. (#10914) |  |
| 60 | `c6af4eaa` | PICK | PICKED | `3ee0a7a0f` | fix: Usage of folder trust config flags in FileCommandLoader (#10837) |  |
| 61 | `2a7c7166` | SKIP | SKIP |  | Reenable NPM integration tests (#10623) |  |
| 62 | `a5e47c62` | PICK | NO_OP |  | Docs: Update to tos-privacy.md (#10754) | LLxprt has own multi-provider TOS |
| 63 | `0a7ee677` | PICK | PICKED | `c65fe0ac5` | Show notification in screen reader mode (#10900) |  |
| 64 | `ab3804d8` | REIMPLEMENT | REIMPLEMENTED | `cd439bd39` | refactor(core): migrate web search tool to tool-names (#10782) |  |
| 65 | `ae48e964` | SKIP | SKIP |  | feat(ui): add flicker detection and metrics (#10821) |  |
| 66 | `bf0f61e6` | PICK | PICKED | `575978297` | Show final install path in extension consent dialog and fix isWorkspaceTrusted check (#10830) |  |
| 67 | `a6e00d91` | REIMPLEMENT | REIMPLEMENTED | `4cc35bfc2` | Fix rough edges around extension updates (#10926) |  |
| 68 | `a64bb433` | REIMPLEMENT | REIMPLEMENTED | `fbbb01418` | Simplify auth in interactive tests. (#10921) |  |
| 69 | `37678acb` | REIMPLEMENT | REIMPLEMENTED | `0a5bd4748` | Update deployment.md -> installation.md and sidebar links. (#10662) |  |
| 70 | `265d39f3` | PICK | PICKED | `2011efb53` | feat(core): improve shell execution service reliability (#10607) |  |
| 71 | `ead8928c` | PICK | PICKED | `afb2fe645` | Deflake test. (#10932) |  |
| 72 | `cd919346` | PICK | PICKED | `507de4365` | Clean up integration test warnings. (#10931) | Reimplemented env bracket notation |
| 73 | `09ef33ec` | SKIP | SKIP |  | fix(cli): prioritize configured auth over env vars in non-interactive mode (#10935) |  |
| 74 | `5dc7059b` | REIMPLEMENT | REIMPLEMENTED | `5c1d219ea` | Refactor: Introduce InteractiveRun class (#10947) |  |
| 75 | `907e51ac` | SKIP | PICKED | `c55bf13d4` | Code guide command (#10940) | Adapted for LLxprt |
| 76 | `87f175bb` | SKIP | SKIP |  | feat: Support Alt+key combinations (#10767) |  |
| 77 | `cfb71b9d` | SKIP | SKIP |  | chore: wire a2a-server up for publishing (#10627) |  |
| 78 | `c23eb84b` | PICK | PICKED | `575404134` | fix(remove private) from gemini-cli-a2a-server (#11018) |  |
| 79 | `90de8416` | SKIP | SKIP |  | Swap all self-hosted runners to ubuntu-latest per b/451586626 (#11023) |  |
| 80 | `f68f27e7` | SKIP | SKIP |  | Revert "feat: Support Alt+key combinations" (#11025) |  |
| 81 | `28e667bd` | PICK | PICKED | `9bffe26f3` | Give explicit instructions for failure text in json-output.test.ts (#11029) |  |
| 82 | `19c1d734` | REIMPLEMENT | REIMPLEMENTED | `fa962dc44` | add bundle command info to integration test docs (#11034) |  |
| 83 | `7beaa368` | SKIP | SKIP |  | refactor(core): use assertConnected in McpClient discover method (#10989) |  |
| 84 | `518caae6` | REIMPLEMENT | REIMPLEMENTED | `9ab5761d8` | chore: Extract '.gemini' to GEMINI_DIR constant (#10540) |  |
| 85 | `4a5ef4d9` | REIMPLEMENT | REIMPLEMENTED | `10df51916` | fix(infra) - Fix flake for file interactive system (#11019) |  |
| 86 | `a73b8145` | REIMPLEMENT | REIMPLEMENTED | `4407297b6` | Rename expect methods. (#11046) |  |
| 87 | `77162750` | PICK | PICKED | `a90f5745d` | chore(settings): Enable 'useSmartEdit' by default (#11051) |  |
| 88 | `c4bd7594` | REIMPLEMENT | REIMPLEMENTED | `8ae8ee421` | document all settings with showInDialog: true (#11049) |  |
| 89 | `f3424844` | SKIP | SKIP |  | Revert "chore: wire a2a-server up for publishing" (#11064) |  |
| 90 | `20fc7abc` | SKIP | SKIP |  | Docs: Quick fix: Sidebar link. (#11065) |  |
| 91 | `ada179f5` | REIMPLEMENT | REIMPLEMENTED | `9039042ca` | bug(core): Process returned function calls sequentially. (#10659) |  |
| 92 | `dd01af60` | SKIP | SKIP |  | refactor: set max retry attempts to 3 (#11072) |  |
| 93 | `f56a561f` | SKIP | SKIP |  | Fix and unskip flakey integration test in replace.test.ts (#11060) |  |
| 94 | `9185f68e` | SKIP | SKIP |  | Expose Codebase Investigator settings to the user (#10844) |  |
| 95 | `6787d42d` | PICK | PICKED | `f1990f839` | perf(core): optimize Windows IDE process detection from O(N) to O(1) (#11048) |  |
| 96 | `0f8199dd` | SKIP | SKIP |  | fix(site): Fix broken site link (#11079) |  |
| 97 | `a3fe9279` | PICK | PICKED | `6810482c0` | fix(compression): prevent unnecessary summarization when history is too short (#11082) |  |
| 98 | `249a193c` | PICK | PICKED | `51c647321` | Update system instructions for optimizing shell tool commands (#10651) |  |
| 99 | `b2ba67f3` | PICK | PICKED | `462e898d5` | fix: Exit app on pressing esc on trust dialog at launch (#10668) |  |
| 100 | `481ba01c` | SKIP | SKIP |  | chore: resubmit a2a-publishing after rollout (#11100) |  |
| 101 | `1e838393` | SKIP | SKIP |  | Skip flakey tests (#11101) |  |
| 102 | `3ba4ba79` | PICK | ALREADY_PRESENT |  | Remove workflow examples from system instruction  (#10811) |  |
| 103 | `9e8c7676` | PICK | SKIPPED_EXPLICIT | `4755414ab` | fix(cli): record tool calls in non-interactive mode (#10951) |  |
| 104 | `7b06a0be` | PICK | PICKED | `4f067a2e4` | fix(e2e): Use rmSync instead of rm -rf for e2e tests (#11087) |  |
| 105 | `c86ee4cc` | SKIP | SKIP |  | feat: Support Alt+key combinations (#11038) |  |
| 106 | `7c1a9024` | REIMPLEMENT | NO_OP |  | fix(core): add retry logic for specific fetch errors (#11066) |  |
| 107 | `061a89fc` | SKIP | SKIP |  | Disable retries when deflaking integrationt tests (#11118) |  |
| 108 | `92dbdbb9` | SKIP | SKIP |  | Shell approval rework (#11073) |  |
| 109 | `a6720d60` | SKIP | SKIP |  | Make codebase investigator less prone to be triggered for simple searches (#10655) |  |
| 110 | `49b66733` | REIMPLEMENT | NO_OP |  | fix(infra) - Disable CTRL-C test (#11122) |  |
| 111 | `99c7108b` | REIMPLEMENT | REIMPLEMENTED | `e8c441eb3` | fix integration test static errors, and run_shell_command tests to actually be testing what they intend (#11050) | Commit references #27 (should be #707) |
| 112 | `0a3e492e` | SKIP | SKIP |  | Integration test for UI flickers (#11067) |  |
| 113 | `8c78b62b` | SKIP | SKIP |  | fix: set a2a-server publish to --no-tag (#11138) |  |
| 114 | `ef3186d4` | SKIP | SKIP |  | Enable codease investigator by default before the next preview release (#11136) |  |
| 115 | `769fe8b1` | REIMPLEMENT | DIVERGED | `91a30eab1` | Delete unworkable replace test and enabled the rest (#11125) | Commit references #27 (should be #707) |
| 116 | `6f0107e7` | REIMPLEMENT | REIMPLEMENTED | `753597b46` | fix(core): implement robust URL validation in web_fetch tool (#10834) | Commit references #27 (should be #707) |
| 117 | `bd5c158a` | SKIP | SKIP |  | Revert "Shell approval rework" (#11143) |  |
| 118 | `996c9f59` | SKIP | SKIP |  | Revert "fix: handle request retries and model fallback correctly" (#11164) |  |
| 119 | `a2f3339a` | SKIP | SKIP |  | Enable Model Routing (#11154) |  |
| 120 | `dabe161a` | PICK | REIMPLEMENTED | `5cb5c9f77` | Don't accept input until slash commands are loaded (#11162) | Manual reimplement due to architecture divergence |
| 121 | `4f5b3357` | REIMPLEMENT | REIMPLEMENTED | `3096412be` | fix(tests): enable cyclic schema MCP tool test (#10912) | Commit references #27 (should be #707) |
| 122 | `203bad7c` | SKIP | SKIP |  | Docs: Point to extensions gallery from extensions docs in the project (#10763) |  |
| 123 | `984415f6` | SKIP | SKIP |  | feat(ci): Update release to use github env variables. (#11068) |  |
| 124 | `cb1ec755` | SKIP | SKIP |  | fix(ci): Move from self-hosted -> ubuntu-latest (#11205) |  |
| 125 | `0dea3544` | SKIP | SKIP |  | Add a GH Issue template for a website issue that gets tagged appropriately. (#10923) |  |
| 126 | `0e79bd40` | SKIP | SKIP |  | chore(release): v0.10.0-preview.0 |  |
| 127 | `a6311e3c` | SKIP | SKIP |  | fix(patch): cherry-pick 5aaa0e6 to release/v0.10.0-preview.0-pr-11259 to patch version v0.10.0-preview.0 and create version 0.10.0-preview.1 (#11287) |  |
| 128 | `fa1097df` | SKIP | SKIP |  | chore(release): v0.10.0-preview.1 |  |
| 129 | `a1860838` | SKIP | SKIP |  | fix(patch): cherry-pick 0ded546 to release/v0.10.0-preview.1-pr-11225 to patch version v0.10.0-preview.1 and create version 0.10.0-preview.2 (#11415) |  |
| 130 | `076123e3` | SKIP | SKIP |  | chore(release): v0.10.0-preview.2 |  |
| 131 | `f35e2417` | SKIP | SKIP |  | fix(patch): cherry-pick 8aace3a to release/v0.10.0-preview.2-pr-11549 [CONFLICTS] (#11595) |  |
| 132 | `845471ea` | SKIP | SKIP |  | chore(release): v0.10.0-preview.3 |  |
| 133 | `cbb5e393` | SKIP | SKIP |  | fix(patch): cherry-pick 5b750f5 to release/v0.10.0-preview.3-pr-11615 to patch version v0.10.0-preview.3 and create version 0.10.0-preview.4 (#11625) |  |
| 134 | `5d92b507` | SKIP | SKIP |  | chore(release): v0.10.0-preview.4 |  |
| 135 | `5eb56494` | SKIP | SKIP |  | chore(release): v0.10.0 |  |

## Branch-Only Code Commits Not Mapped to a Single Upstream Commit

| Local Commit | Subject |
|:--|:--|
| `1bbdf7879` | fix: config.test.ts settings property paths addresses #707 |
| `5970be2fe` | fix: post-cherry-pick fixes for Batch 03 addresses #707 |
| `eb32bbbe3` | fix: populate argv.query/prompt from positional args and preserve JSON comments addresses #707 |
| `765495e00` | fix(cli): memory refresh respects file filters addresses #707 |
| `4805beda8` | fix: update extension tests for LLxprt isWorkspaceTrusted signature |
| `5f633db10` | fix: remove unused import and format |
| `4d8aa079c` | test: fix test mocks and add fetch retry test case addresses #27 |
| `95431c968` | test: add CI skip for ctrl-c interactive test addresses #27 |

## Known Issues

### Issue Number Discrepancy (#27 vs #707)

Several commits from this merge session reference `#27` instead of `#707`. The code changes are correct; only the commit message issue reference is wrong.

**Affected Commits:**
- `3096412be` - test: add MCP cyclic schema integration test
- `753597b46` - reimplement: robust URL validation in web_fetch
- `91a30eab1` - docs: document divergence from upstream replace test
- `e8c441eb3` - reimplement: test harness yolo option + matchArgs
- `95431c968` - test: add CI skip for ctrl-c interactive test
- `4d8aa079c` - test: fix test mocks and add fetch retry test case

**Impact:** Cosmetic only. Commits won't auto-link to the correct GitHub issue (#707) in the issue history.


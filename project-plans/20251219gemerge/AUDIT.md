- Generated: `2025-12-19 17:45`
- Branch: `20251219gemerge`
- Upstream range: `v0.10.0..v0.11.3` (`172` commits)

## Status Counts (Against CHERRIES.md)

| Status | Count |
|---|---:|
| PICKED | 0 |
| REIMPLEMENTED | 0 |
| SKIP | 0 |
| NO_OP | 0 |
| ALREADY_PRESENT | 0 |
| DIVERGED | 0 |
| MISSING | 0 |

## Full Upstream Table (Chronological)

| # | Upstream | Decision | Status | Local | Subject | Notes |
|---:|:--|:--|:--|:--|:--|:--|
| 1 | `8a937ebf` | SKIP |  |  | chore(release): bump version to 0.11.0-nightly.20251015.203bad7c (#11212) |  |
| 2 | `b8df8b2a` | REIMPLEMENT |  |  | feat(core): wire up UI for ASK_USER policy decisions in message bus (#10630) |  |
| 3 | `4f17eae5` | PICK |  |  | feat(cli): Prevent queuing of slash and shell commands (#11094) |  |
| 4 | `d38ab079` | PICK |  |  | Update shell tool call colors for confirmed actions (#11126) |  |
| 5 | `47f5e73b` | SKIP |  |  | Docs: Fix typo in docs/changelogs/index.md (#11215) |  |
| 6 | `c80352a7` | SKIP |  |  | Docs: Fix typo in docs/get-started/index.md (#10793) |  |
| 7 | `2e6d69c9` | PICK |  |  | Fix --allowed-tools in non-interactive mode to do substring matching for parity with interactive mode. (#10944) |  |
| 8 | `7bed302f` | SKIP |  |  | refactor(actions): remove checkout from sub-actions (#11219) |  |
| 9 | `47f69317` | PICK |  |  | Add support for output-format stream-jsonflag for headless mode (#10883) |  |
| 10 | `ccaa7009` | SKIP |  |  | fix(infra) - Reenable github test (#10839) |  |
| 11 | `1fc3fc0a` | SKIP |  |  | fix(ci): Fix a2a publishing (#11211) |  |
| 12 | `8c1656bf` | PICK |  |  | Don't always fall back on a git clone when installing extensions (#11229) |  |
| 13 | `cfaa95a2` | PICK |  |  | feat(cli): Add nargs to yargs options (#11132) |  |
| 14 | `72b2cc54` | SKIP |  |  | Updates from running "npm install" (#11238) |  |
| 15 | `e2fef41f` | SKIP |  |  | fix(ci): Ensure we cleanup the `false` tag. (#11232) |  |
| 16 | `8c74be79` | SKIP |  |  | Update README.md (#11240) |  |
| 17 | `130f0a02` | REIMPLEMENT |  |  | chore(subagents): Remove legacy subagent code (#11175) |  |
| 18 | `c9c633be` | REIMPLEMENT |  |  | refactor: move `web_fetch` tool name to `tool-names.ts` (#11174) |  |
| 19 | `3acb014e` | SKIP |  |  | fix(e2e): Refactor and unskip context compression interactive tests (#11086) |  |
| 20 | `60420e52` | PICK |  |  | feat: Do not add trailing space on directory autocomplete (#11227) |  |
| 21 | `a9083b9d` | PICK |  |  | include extension name in `gemini mcp list` command (#11263) |  |
| 22 | `5aaa0e66` | SKIP |  |  | (fix): Enable Codebase Investigator for all modes  (#11259) |  |
| 23 | `b734723d` | PICK |  |  | Update extensions install warning (#11149) |  |
| 24 | `872d2eaf` | SKIP |  |  | fix(ci): Make the release-rollback action properly support non-prod envs (#11244) |  |
| 25 | `b4f6c7c4` | SKIP |  |  | Docs: Add changelog v0.9.0 (#11237) |  |
| 26 | `c96fd828` | SKIP |  |  | feat(docs): add initial release confidence document (#11069) |  |
| 27 | `155242af` | SKIP |  |  | feat: Blend educative tips with witty phrases during loading times (fun, subtle learning...) (#10569) |  |
| 28 | `ffa547ce` | SKIP |  |  | fix: Update folder trust docs to mention MCP servers and file command… (#10842) |  |
| 29 | `05930d5e` | REIMPLEMENT |  |  | fix(web-fetch): respect Content-Type header in fallback mechanism (#11284) |  |
| 30 | `6ded45e5` | PICK |  |  | feat: Add markdown toggle (alt+m) to switch between rendered and raw… (#10383) |  |
| 31 | `d2c9c5b3` | PICK |  |  | Use Node.js built-ins in scripts/clean.js instead of glob. (#11286) |  |
| 32 | `39cc07de` | SKIP |  |  | fix(infra) - Remove e2e maintainer label from e2e workflow (#11028) |  |
| 33 | `bec2bfca` | SKIP |  |  | Revert "fix(infra) - Remove e2e maintainer label from e2e workflow" (#11292) |  |
| 34 | `937c15c6` | REIMPLEMENT |  |  | refactor: Remove deprecated --all-files flag (#11228) |  |
| 35 | `de3632af` | SKIP |  |  | fork regulation testing (#11304) |  |
| 36 | `6b866d12` | SKIP |  |  | remove (#11310) |  |
| 37 | `2aa1d742` | SKIP |  |  | fix(test): deflake flicker integration test (#11308) |  |
| 38 | `01c577c3` | SKIP |  |  | Jacob314/safe home dir (#10861) |  |
| 39 | `02241e91` | SKIP |  |  | feat(auth): Improve auth dialog error handling and messaging (#11320) |  |
| 40 | `c71b7491` | PICK |  |  | fix: Add folder names in permissions dialog similar to the launch dialog (#11278) |  |
| 41 | `9a4211b6` | SKIP |  |  | Improve rendering of ToDo lists. (#11315) |  |
| 42 | `991bd373` | PICK |  |  | fix(scripts): Improve deflake script isolation and unskip test (#11325) |  |
| 43 | `a4403339` | PICK |  |  | feat(ui): add "Esc to close" hint to SettingsDialog (#11289) |  |
| 44 | `9049f8f8` | REIMPLEMENT |  |  | feat: remove deprecated telemetry flags (#11318) |  |
| 45 | `22f725eb` | PICK |  |  | feat: allow editing queued messages with up arrow key (#10392) |  |
| 46 | `dcf362bc` | REIMPLEMENT |  |  | Inline tree-sitter wasm and add runtime fallback (#11157) |  |
| 47 | `a67deae8` | SKIP |  |  | Skip failing test. (#11337) |  |
| 48 | `cd0f9fe2` | SKIP |  |  | Update package.json in include git dependency on Ink fork. (#11330) |  |
| 49 | `406f0baa` | PICK |  |  | fix(ux) keyboard input hangs while waiting for keyboard input. (#10121) |  |
| 50 | `d42da871` | PICK |  |  | fix(accessibility) allow line wrapper in screen reader mode  (#11317) |  |
| 51 | `3a1d3769` | PICK |  |  | Refactor `EditTool.Name` to use centralized `EDIT_TOOL_NAME` (#11343) |  |
| 52 | `f3ffaf09` | PICK |  |  | fix: copy command delay in Linux handled (#6856) |  |
| 53 | `ca3d260a` | SKIP |  |  | Revert "Update package.json in include git dependency on Ink fork." (#11365) |  |
| 54 | `b2ef6626` | SKIP |  |  | docs(release): Add information about dev/prod to the release docs. (#11366) |  |
| 55 | `be25e2cb` | SKIP |  |  | feat: Remove deprecated flags (#11338) |  |
| 56 | `0ded546a` | PICK |  |  | fix(prompt): Make interactive command avoidance conditional (#11225) |  |
| 57 | `795e5134` | SKIP |  |  | Remove ctrl-t binding for /mcp commands (#11372) |  |
| 58 | `659b0557` | PICK |  |  | feat(cli): Suppress slash command execution and suggestions in shell … (#11380) |  |
| 59 | `4a0fcd05` | PICK |  |  | fix(scripts): Update get-release-version to use yargs parsing, handle a dynamically set package name (#11374) |  |
| 60 | `2b61ac53` | PICK |  |  | feat: add missing visual cue for closing dialogs with Esc key (#11386) |  |
| 61 | `8da47db1` | PICK |  |  | fix(cli): enable and fix types for MCP command tests (#11385) |  |
| 62 | `67866849` | SKIP |  |  | fix(release): Update create-patch-pr.js to take a package name (#11400) |  |
| 63 | `7c086fe5` | PICK |  |  | Remove MCP Tips and reorganize MCP slash commands (#11387) |  |
| 64 | `e4226b8a` | PICK |  |  | Only check for updates if disableUpdateNag is false (#11405) |  |
| 65 | `4d2a1111` | PICK |  |  | fix: make @file suggestions case-insensitive (#11394) |  |
| 66 | `426d3614` | PICK |  |  | fix: Unset selected auth type in integ test so that the local setting… (#11322) |  |
| 67 | `b4a405c6` | PICK |  |  | Style slash command descriptions consistently (#11395) |  |
| 68 | `d3bdbc69` | PICK |  |  | add extension IDs (#11377) |  |
| 69 | `08e87a59` | REIMPLEMENT |  |  | Log all user settings to enable measurement of experiment impacts (#11354) |  |
| 70 | `21163a16` | PICK |  |  | fix(cli): enable typechecking for ui/commands tests (#11413) |  |
| 71 | `0b20f88f` | SKIP |  |  | fix(infra) - Make file system interactive test check only tool call (#11055) |  |
| 72 | `9b9ab609` | REIMPLEMENT |  |  | feat(logging): Centralize debug logging with a dedicated utility (#11417) |  |
| 73 | `f4330c9f` | REIMPLEMENT |  |  | remove support for workspace extensions and migrations (#11324) |  |
| 74 | `cedf0235` | PICK |  |  | fix(cli): enable typechecking for ui/components tests (#11419) |  |
| 75 | `2ef38065` | PICK |  |  | refactor(tools): Migrate shell tool name to a centralized constant (#11418) |  |
| 76 | `cd76b0b2` | SKIP |  |  | Create Todo List Tab (#11430) |  |
| 77 | `725b3120` | SKIP |  |  | Docs: Fix MCP server link in docs/cli/trusted-folders.md (#11349) |  |
| 78 | `dd42893d` | PICK |  |  | fix(config): Enable type checking for config tests (#11436) |  |
| 79 | `ff31a222` | SKIP |  |  | fix(ci): use standard integration test command on windows (#11437) |  |
| 80 | `aa46eb4f` | SKIP |  |  | feat(release): Support dev/prod for release patch 1 (#11404) |  |
| 81 | `f22aa72c` | REIMPLEMENT |  |  | Making shell:true as default and adding -I to  grep (#11448) |  |
| 82 | `d065c3ca` | PICK |  |  | fix(cli): Enable typechecking for more test files (#11455) |  |
| 83 | `f425bd76` | SKIP |  |  | Rename component to "TodoTray" (#11469) |  |
| 84 | `98eef9ba` | REIMPLEMENT |  |  | fix: Update web_fetch tool definition to instruct the model to provid… (#11252) |  |
| 85 | `23e52f0f` | PICK |  |  | refactor(core): Centralize tool names to avoid circular dependencies - Edit, Grep, Read (#11434) |  |
| 86 | `0fd9ff0f` | PICK |  |  | fix(cli): Fix type errors in UI hooks tests (#11483) |  |
| 87 | `c8518d6a` | REIMPLEMENT |  |  | refactor(tools): Move all tool names into tool-names.ts (#11493) |  |
| 88 | `a788a6df` | SKIP |  |  | Update docs to specifying GEMINI_SYSTEM_MD and GEMINI_WRITE_SYSTEM_MD instructions (#9953) |  |
| 89 | `8731309d` | REIMPLEMENT |  |  | chore: do not retry the model request if the user has aborted the request (#11224) |  |
| 90 | `d52ec522` | SKIP |  |  | fix(infra) - Create an empty file to test trigger workflow for e2e (#11022) |  |
| 91 | `518a9ca3` | PICK |  |  | fix(core): Preserve escaped characters in gitignore patterns (#11171) |  |
| 92 | `71ecc401` | SKIP |  |  | [Part 5/6] feat(telemetry): add activity monitor with event-driven snapshots (#8124) |  |
| 93 | `35afab31` | SKIP |  |  | Don't display todo in history (#11516) |  |
| 94 | `d0ab6e99` | PICK |  |  | fix(SettingsDialog):  race condition in SettingsDialog causing settings to be unexpectedly cleared (#10875) |  |
| 95 | `397e52da` | PICK |  |  | fix(ui): escaping theme dialog no longer resets theme to default (#11323) |  |
| 96 | `9a4c0455` | SKIP |  |  | docs: require bug bash for major launches and clarify roles (#11384) |  |
| 97 | `a96f0659` | SKIP |  |  | skip flaky test (#11526) |  |
| 98 | `085e5b1f` | SKIP |  |  | feat(infra) - Add base files for deflake workflow (#11397) |  |
| 99 | `36de6862` | REIMPLEMENT |  |  | feat: Propagate traceId from code assist to response metadata (Fixes … (#11360) |  |
| 100 | `49bde9fc` | PICK |  |  | fix(core): address GCS path input (#11221) |  |
| 101 | `30d9a336` | SKIP |  |  | Update nightly workflow to create issues for scheduled run failures (#11531) |  |
| 102 | `3c57e76c` | SKIP |  |  | chore/release: bump version to 0.11.0-nightly.20251020.a96f0659 (#11529) |  |
| 103 | `61a71c4f` | PICK |  |  | (fix): remove custom waitFor and use testing-library implementation (#11522) |  |
| 104 | `d5a06d3c` | PICK |  |  | fix(core): Preserve significant trailing spaces in gitignore patterns (#11536) |  |
| 105 | `995ae717` | REIMPLEMENT |  |  | refactor(logging): Centralize all console messaging to a shared logger (part 1) (#11537) |  |
| 106 | `cc7e1472` | REIMPLEMENT |  |  | Pass whole extensions rather than just context files (#10910) |  |
| 107 | `31f58a1f` | PICK |  |  | Fix Windows ripgrep detection (#11492) |  |
| 108 | `70a99af1` | PICK |  |  | Fix shell auto-approval parsing for chained commands (#11527) |  |
| 109 | `723b8d33` | SKIP |  |  | chore: update tests with removed exclude from cli tsconfig (#11540) |  |
| 110 | `72b16b3a` | PICK |  |  | fix(core): Handle PTY spawn errors in macOS sandbox (#11539) |  |
| 111 | `8aace3af` | SKIP |  |  | Disable Routing by default (#11549) |  |
| 112 | `7dd2d8f7` | REIMPLEMENT |  |  | fix(tools): restore static tool names to fix configuration exclusions (#11551) |  |
| 113 | `654c5550` | PICK |  |  | test: add readWasmBinaryFromDisk unit test (#11546) |  |
| 114 | `fc4e10b5` | SKIP |  |  | fix(docs): Broken Images on Themes (#11266) |  |
| 115 | `81772c42` | SKIP |  |  | feat(release): Add `dev` support to patch2 workflow (#11460) |  |
| 116 | `0e7b3951` | SKIP |  |  | Per-Auth Method Feature Flag for Model Routing (#11333) |  |
| 117 | `f4080b60` | SKIP |  |  | skip flaky test  (#11577) |  |
| 118 | `14867c7c` | SKIP |  |  | fix(workflow): Add missing comma in release-patch-0-from-comment.yml (#11588) |  |
| 119 | `0ed4f980` | SKIP |  |  | Pin auth action in eval workflow (#11584) |  |
| 120 | `a2013f34` | SKIP |  |  | Skip delete test since it's flakey (#11591) |  |
| 121 | `f0eed9b2` | SKIP |  |  | Temporarily update nightly release schedule (#11573) |  |
| 122 | `9d0177e0` | SKIP |  |  | Use env variables in workflows (#11585) |  |
| 123 | `cb8f93ba` | SKIP |  |  | Feat(infra) - Make chained e2e workflow run e2e tests (#11521) |  |
| 124 | `2c93542e` | SKIP |  |  | Revert "Per-Auth Method Feature Flag for Model Routing (#11333)" (#11597) |  |
| 125 | `a74a04d1` | SKIP |  |  | Revert "Disable Routing by default (#11549)" (#11594) |  |
| 126 | `0658b4aa` | PICK |  |  | remove another replace flake (#11601) |  |
| 127 | `bf80263b` | REIMPLEMENT |  |  | feat: Implement message bus and policy engine (#11523) |  |
| 128 | `193b4bba` | SKIP |  |  | bump nightly test an hour (#11603) |  |
| 129 | `74a77719` | SKIP |  |  | fix(ci): Default all GHA env variables to 'prod' set (#11572) |  |
| 130 | `af833c5e` | SKIP |  |  | feat(release): Add dev env support to release-3-patch (#11458) |  |
| 131 | `e49f4673` | SKIP |  |  | Docs: Fix broken checkpointing links in docs/cli/configuration.md (#11508) |  |
| 132 | `34439460` | SKIP |  |  | fix(infra) - Fix issues with downloading repo artifact (#11606) |  |
| 133 | `62dc9683` | PICK |  |  | fix: improve `gemini mcp add` option handling for arrays (#11575) |  |
| 134 | `e72c00cf` | PICK |  |  | fix(proxy): Add error handling to proxy agent creation (#11538) |  |
| 135 | `fb44f5ba` | SKIP |  |  | chore: renable test (#11582) |  |
| 136 | `cf16d167` | PICK |  |  | fix(scripts): add tsconfig linter to prevent adding files to the exclude list (#11602) |  |
| 137 | `dd3b1cb6` | REIMPLEMENT |  |  | feat(cli): continue request after disabling loop detection (#11416) |  |
| 138 | `f5e07d94` | SKIP |  |  | fix(infra) - Fix how we download and upload repo names (#11613) |  |
| 139 | `b364f376` | REIMPLEMENT |  |  | refactor(logging): Centralize console logging with debugLogger (#11590) |  |
| 140 | `e9e80b05` | SKIP |  |  | chore/release: bump version to 0.11.0-nightly.20251021.e72c00cf (#11614) |  |
| 141 | `c6a59896` | SKIP |  |  | Add extensions logging (#11261) |  |
| 142 | `16f5f767` | PICK |  |  | chore: use waitFor rather than wait (#11616) |  |
| 143 | `519bd57e` | SKIP |  |  | Apply new style to Todos (#11607) |  |
| 144 | `ccf8d0ca` | PICK |  |  | fix(test): Enable Ctrl+C exit test (#11618) |  |
| 145 | `465f97a5` | SKIP |  |  | fix: Improve patch workflow and update NOTICES.txt (#11623) |  |
| 146 | `5b750f51` | PICK |  |  | fix(config): Disable CI for stable release (#11615) |  |
| 147 | `ed9f714f` | PICK |  |  | feat(cli): Adds the ability to run MCP prompt commands in non-interactive mode (#10194) |  |
| 148 | `cc3904f0` | SKIP |  |  | Add aria labels to Todo list display (#11621) |  |
| 149 | `306e12c2` | PICK |  |  | Fix regression in handling shift+tab resulting in u in the input prompt. (#11634) |  |
| 150 | `c7243997` | PICK |  |  | fix(cli): fix flaky BaseSelectionList test (#11620) |  |
| 151 | `2940b508` | PICK |  |  | fix: Ignore correct errors thrown when resizing or scrolling an exited pty (#11440) |  |
| 152 | `d1c913ed` | SKIP |  |  | Docs: Fix broken telemetry link in docs/cli/configuration.md (#11638) |  |
| 153 | `73b1afb1` | SKIP |  |  | Remove errant console.debug log of config (#11579) |  |
| 154 | `0d7da7ec` | PICK |  |  | fix(mcp): Include path in oauth resource parameter (#11654) |  |
| 155 | `dc90c8fe` | SKIP |  |  | Updates to package-lock.json from running npm install (#11665) |  |
| 156 | `0542de95` | SKIP |  |  | fix(release): Pass args to promoteNightlyVersion (#11666) |  |
| 157 | `9cf8b403` | SKIP |  |  | chore(release): v0.11.0-preview.0 |  |
| 158 | `a3947a8d` | SKIP |  |  | fix(patch): cherry-pick 601a639 to release/v0.11.0-preview.0-pr-11889 to patch version v0.11.0-preview.0 and create version 0.11.0-preview.1 (#12188) |  |
| 159 | `c9c2e79d` | SKIP |  |  | chore(release): v0.11.0-preview.1 |  |
| 160 | `92f5355d` | SKIP |  |  | chore(release): v0.11.0 |  |
| 161 | `d9f6cebe` | SKIP |  |  | fix(patch): cherry-pick ee92db7 to release/v0.11.0-pr-11624 to patch version v0.11.0 and create version 0.11.1 (#12321) |  |
| 162 | `5213d9f3` | SKIP |  |  | chore(release): v0.11.1 |  |
| 163 | `f36dec6a` | SKIP |  |  | fix(patch): cherry-pick 643f2c0 to release/v0.11.1-pr-12300 to patch version v0.11.1 and create version 0.11.2 (#12335) |  |
| 164 | `f4f37279` | SKIP |  |  | chore(release): v0.11.2 |  |
| 165 | `847c6e7f` | PICK |  |  | refactor(core): extract ChatCompressionService from GeminiClient (#12001) |  |
| 166 | `5be5575d` | SKIP |  |  | Change default compression threshold (#12306) |  |
| 167 | `ce40a653` | PICK |  |  | Make compression threshold editable in the UI. (#12317) |  |
| 168 | `73b3211e` | SKIP |  |  | Remove context percentage in footer by default (#12326) |  |
| 169 | `8a725859` | SKIP |  |  | Mark `model.compressionThreshold` as requiring a restart (#12378) |  |
| 170 | `b1bbef43` | PICK |  |  | fix(core): ensure loop detection respects session disable flag (#12347) |  |
| 171 | `44b3c974` | SKIP |  |  | refactor: simplify daily quota error messages |  |
| 172 | `e5161610` | SKIP |  |  | chore(release): v0.11.3 |  |

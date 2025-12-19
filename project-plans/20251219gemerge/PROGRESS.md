Use this checklist to track batch execution progress.

## Current Status

| Field | Value |
|---|---|
| **Last Completed** | — |
| **In Progress** | — |
| **Next Up** | Batch 01 |
| **Progress** | 0/49 (0%) |
| **Last Updated** | 2025-12-19 |

## Preflight
- [ ] On main: `git pull --ff-only`
- [ ] Branch exists: `git checkout -b 20251219gemerge`
- [ ] Upstream remote + tags fetched: `git fetch upstream --tags`
- [ ] Clean worktree before Batch 01: `git status --porcelain` is empty
- [ ] File existence pre-check run (see PLAN.md)

## Batch Checklist

- [ ] Batch 01 — QUICK — REIMPLEMENT — `b8df8b2a` — feat(core): wire up UI for ASK_USER policy decisions in message bus (#10630)
- [ ] Batch 02 — FULL — PICK — `4f17eae5, d38ab079, 2e6d69c9, 47f69317, 8c1656bf` — feat(cli): Prevent queuing of slash and shell commands (#11094) / Update shell tool call colors for confirmed actions (#11126) / Fix --allowed-tools in non-interactive mode to do substring matching for parity with interactive mode. (#10944) / Add support for output-format stream-jsonflag for headless mode (#10883) / Don't always fall back on a git clone when installing extensions (#11229)
- [ ] Batch 03 — QUICK — PICK — `cfaa95a2` — feat(cli): Add nargs to yargs options (#11132)
- [ ] Batch 04 — FULL — REIMPLEMENT — `130f0a02` — chore(subagents): Remove legacy subagent code (#11175)
- [ ] Batch 05 — QUICK — REIMPLEMENT — `c9c633be` — refactor: move `web_fetch` tool name to `tool-names.ts` (#11174)
- [ ] Batch 06 — FULL — PICK — `60420e52, a9083b9d, b734723d` — feat: Do not add trailing space on directory autocomplete (#11227) / include extension name in `gemini mcp list` command (#11263) / Update extensions install warning (#11149)
- [ ] Batch 07 — QUICK — REIMPLEMENT — `05930d5e` — fix(web-fetch): respect Content-Type header in fallback mechanism (#11284)
- [ ] Batch 08 — FULL — PICK — `6ded45e5, d2c9c5b3` — feat: Add markdown toggle (alt+m) to switch between rendered and raw… (#10383) / Use Node.js built-ins in scripts/clean.js instead of glob. (#11286)
- [ ] Batch 09 — QUICK — REIMPLEMENT — `937c15c6` — refactor: Remove deprecated --all-files flag (#11228)
- [ ] Batch 10 — FULL — PICK — `c71b7491, 991bd373, a4403339` — fix: Add folder names in permissions dialog similar to the launch dialog (#11278) / fix(scripts): Improve deflake script isolation and unskip test (#11325) / feat(ui): add "Esc to close" hint to SettingsDialog (#11289)
- [ ] Batch 11 — QUICK — REIMPLEMENT — `9049f8f8` — feat: remove deprecated telemetry flags (#11318)
- [ ] Batch 12 — FULL — PICK — `22f725eb` — feat: allow editing queued messages with up arrow key (#10392)
- [ ] Batch 13 — QUICK — REIMPLEMENT — `dcf362bc` — Inline tree-sitter wasm and add runtime fallback (#11157)
- [ ] Batch 14 — FULL — PICK — `406f0baa, d42da871` — fix(ux) keyboard input hangs while waiting for keyboard input. (#10121) / fix(accessibility) allow line wrapper in screen reader mode  (#11317)
- [ ] Batch 15 — QUICK — PICK — `3a1d3769` — Refactor `EditTool.Name` to use centralized `EDIT_TOOL_NAME` (#11343)
- [ ] Batch 16 — FULL — PICK — `f3ffaf09, 0ded546a, 659b0557, 4a0fcd05, 2b61ac53` — fix: copy command delay in Linux handled (#6856) / fix(prompt): Make interactive command avoidance conditional (#11225) / feat(cli): Suppress slash command execution and suggestions in shell … (#11380) / fix(scripts): Update get-release-version to use yargs parsing, handle a dynamically set package name (#11374) / feat: add missing visual cue for closing dialogs with Esc key (#11386)
- [ ] Batch 17 — QUICK — PICK — `8da47db1, 7c086fe5, e4226b8a, 4d2a1111, 426d3614` — fix(cli): enable and fix types for MCP command tests (#11385) / Remove MCP Tips and reorganize MCP slash commands (#11387) / Only check for updates if disableUpdateNag is false (#11405) / fix: make @file suggestions case-insensitive (#11394) / fix: Unset selected auth type in integ test so that the local setting… (#11322)
- [ ] Batch 18 — FULL — PICK — `b4a405c6, d3bdbc69` — Style slash command descriptions consistently (#11395) / add extension IDs (#11377)
- [ ] Batch 19 — QUICK — REIMPLEMENT — `08e87a59` — Log all user settings to enable measurement of experiment impacts (#11354)
- [ ] Batch 20 — FULL — PICK — `21163a16` — fix(cli): enable typechecking for ui/commands tests (#11413)
- [ ] Batch 21 — QUICK — REIMPLEMENT — `9b9ab609` — feat(logging): Centralize debug logging with a dedicated utility (#11417)
- [ ] Batch 22 — FULL — REIMPLEMENT — `f4330c9f` — remove support for workspace extensions and migrations (#11324)
- [ ] Batch 23 — QUICK — PICK — `cedf0235` — fix(cli): enable typechecking for ui/components tests (#11419)
- [ ] Batch 24 — FULL — PICK — `2ef38065` — refactor(tools): Migrate shell tool name to a centralized constant (#11418)
- [ ] Batch 25 — QUICK — PICK — `dd42893d` — fix(config): Enable type checking for config tests (#11436)
- [ ] Batch 26 — FULL — REIMPLEMENT — `f22aa72c` — Making shell:true as default and adding -I to  grep (#11448)
- [ ] Batch 27 — QUICK — PICK — `d065c3ca` — fix(cli): Enable typechecking for more test files (#11455)
- [ ] Batch 28 — FULL — REIMPLEMENT — `98eef9ba` — fix: Update web_fetch tool definition to instruct the model to provid… (#11252)
- [ ] Batch 29 — QUICK — PICK — `23e52f0f` — refactor(core): Centralize tool names to avoid circular dependencies - Edit, Grep, Read (#11434)
- [ ] Batch 30 — FULL — PICK — `0fd9ff0f` — fix(cli): Fix type errors in UI hooks tests (#11483)
- [ ] Batch 31 — QUICK — REIMPLEMENT — `c8518d6a` — refactor(tools): Move all tool names into tool-names.ts (#11493)
- [ ] Batch 32 — FULL — REIMPLEMENT — `8731309d` — chore: do not retry the model request if the user has aborted the request (#11224)
- [ ] Batch 33 — QUICK — PICK — `518a9ca3, d0ab6e99, 397e52da` — fix(core): Preserve escaped characters in gitignore patterns (#11171) / fix(SettingsDialog):  race condition in SettingsDialog causing settings to be unexpectedly cleared (#10875) / fix(ui): escaping theme dialog no longer resets theme to default (#11323)
- [ ] Batch 34 — FULL — REIMPLEMENT — `36de6862` — feat: Propagate traceId from code assist to response metadata (Fixes … (#11360)
- [ ] Batch 35 — QUICK — PICK — `49bde9fc, 61a71c4f, d5a06d3c` — fix(core): address GCS path input (#11221) / (fix): remove custom waitFor and use testing-library implementation (#11522) / fix(core): Preserve significant trailing spaces in gitignore patterns (#11536)
- [ ] Batch 36 — FULL — REIMPLEMENT — `995ae717` — refactor(logging): Centralize all console messaging to a shared logger (part 1) (#11537)
- [ ] Batch 37 — QUICK — REIMPLEMENT — `cc7e1472` — Pass whole extensions rather than just context files (#10910)
- [ ] Batch 38 — FULL — PICK — `31f58a1f, 70a99af1, 72b16b3a` — Fix Windows ripgrep detection (#11492) / Fix shell auto-approval parsing for chained commands (#11527) / fix(core): Handle PTY spawn errors in macOS sandbox (#11539)
- [ ] Batch 39 — QUICK — REIMPLEMENT — `7dd2d8f7` — fix(tools): restore static tool names to fix configuration exclusions (#11551)
- [ ] Batch 40 — FULL — PICK — `654c5550, 0658b4aa` — test: add readWasmBinaryFromDisk unit test (#11546) / remove another replace flake (#11601)
- [ ] Batch 41 — QUICK — REIMPLEMENT — `bf80263b` — feat: Implement message bus and policy engine (#11523)
- [ ] Batch 42 — FULL — PICK — `62dc9683, e72c00cf, cf16d167` — fix: improve `gemini mcp add` option handling for arrays (#11575) / fix(proxy): Add error handling to proxy agent creation (#11538) / fix(scripts): add tsconfig linter to prevent adding files to the exclude list (#11602)
- [ ] Batch 43 — QUICK — REIMPLEMENT — `dd3b1cb6` — feat(cli): continue request after disabling loop detection (#11416)
- [ ] Batch 44 — FULL — REIMPLEMENT — `b364f376` — refactor(logging): Centralize console logging with debugLogger (#11590)
- [ ] Batch 45 — QUICK — PICK — `16f5f767, ccf8d0ca, 5b750f51, ed9f714f, 306e12c2` — chore: use waitFor rather than wait (#11616) / fix(test): Enable Ctrl+C exit test (#11618) / fix(config): Disable CI for stable release (#11615) / feat(cli): Adds the ability to run MCP prompt commands in non-interactive mode (#10194) / Fix regression in handling shift+tab resulting in u in the input prompt. (#11634)
- [ ] Batch 46 — FULL — PICK — `c7243997, 2940b508, 0d7da7ec` — fix(cli): fix flaky BaseSelectionList test (#11620) / fix: Ignore correct errors thrown when resizing or scrolling an exited pty (#11440) / fix(mcp): Include path in oauth resource parameter (#11654)
- [ ] Batch 47 — QUICK — PICK — `847c6e7f` — refactor(core): extract ChatCompressionService from GeminiClient (#12001)
- [ ] Batch 48 — FULL — PICK — `ce40a653` — Make compression threshold editable in the UI. (#12317)
- [ ] Batch 49 — QUICK — PICK — `b1bbef43` — fix(core): ensure loop detection respects session disable flag (#12347)

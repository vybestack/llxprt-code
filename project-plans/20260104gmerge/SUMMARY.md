# gemini-cli v0.10.0 → v0.11.3: Recommended cherry-picks

Tracking issue: https://github.com/vybestack/llxprt-code/issues/708

Total commits: 172; PICK 62, REIMPLEMENT 21, SKIP 89

## PICK highlights
- 4f17eae5 feat(cli): Prevent queuing of slash and shell commands (#11094)
- d38ab079 Update shell tool call colors for confirmed actions (#11126)
- 2e6d69c9 Fix --allowed-tools in non-interactive mode to do substring matching for parity with interactive mode. (#10944)
- 47f69317 Add support for output-format stream-jsonflag for headless mode (#10883)
- 8c1656bf Don't always fall back on a git clone when installing extensions (#11229)
- cfaa95a2 feat(cli): Add nargs to yargs options (#11132)
- 60420e52 feat: Do not add trailing space on directory autocomplete (#11227)
- a9083b9d include extension name in `gemini mcp list` command (#11263)
- b734723d Update extensions install warning (#11149)
- 6ded45e5 feat: Add markdown toggle (alt+m) to switch between rendered and raw… (#10383)
- d2c9c5b3 Use Node.js built-ins in scripts/clean.js instead of glob. (#11286)
- c71b7491 fix: Add folder names in permissions dialog similar to the launch dialog (#11278)
- 991bd373 fix(scripts): Improve deflake script isolation and unskip test (#11325)
- a4403339 feat(ui): add "Esc to close" hint to SettingsDialog (#11289)
- 22f725eb feat: allow editing queued messages with up arrow key (#10392)
- 406f0baa fix(ux) keyboard input hangs while waiting for keyboard input. (#10121)
- d42da871 fix(accessibility) allow line wrapper in screen reader mode  (#11317)
- 3a1d3769 Refactor `EditTool.Name` to use centralized `EDIT_TOOL_NAME` (#11343)
- f3ffaf09 fix: copy command delay in Linux handled (#6856)
- 0ded546a fix(prompt): Make interactive command avoidance conditional (#11225)

## REIMPLEMENT highlights
- b8df8b2a feat(core): wire up UI for ASK_USER policy decisions in message bus (#10630)
- 130f0a02 chore(subagents): Remove legacy subagent code (#11175)
- c9c633be refactor: move `web_fetch` tool name to `tool-names.ts` (#11174)
- 05930d5e fix(web-fetch): respect Content-Type header in fallback mechanism (#11284)
- 937c15c6 refactor: Remove deprecated --all-files flag (#11228)
- 9049f8f8 feat: remove deprecated telemetry flags (#11318)
- dcf362bc Inline tree-sitter wasm and add runtime fallback (#11157)
- 08e87a59 Log all user settings to enable measurement of experiment impacts (#11354)
- 9b9ab609 feat(logging): Centralize debug logging with a dedicated utility (#11417)
- f4330c9f remove support for workspace extensions and migrations (#11324)
- f22aa72c Making shell:true as default and adding -I to  grep (#11448)
- 98eef9ba fix: Update web_fetch tool definition to instruct the model to provid… (#11252)
- c8518d6a refactor(tools): Move all tool names into tool-names.ts (#11493)
- 8731309d chore: do not retry the model request if the user has aborted the request (#11224)
- 36de6862 feat: Propagate traceId from code assist to response metadata (Fixes … (#11360)
- 995ae717 refactor(logging): Centralize all console messaging to a shared logger (part 1) (#11537)
- cc7e1472 Pass whole extensions rather than just context files (#10910)
- 7dd2d8f7 fix(tools): restore static tool names to fix configuration exclusions (#11551)
- bf80263b feat: Implement message bus and policy engine (#11523)
- dd3b1cb6 feat(cli): continue request after disabling loop detection (#11416)
- b364f376 refactor(logging): Centralize console logging with debugLogger (#11590)

## High-risk items
- Message bus + policy engine changes (bf80263b)
- Tool-name refactors centralize constants (c9c633be, 3a1d3769, 23e52f0f, 2ef38065, c8518d6a)
- Tree-sitter wasm bundling + shell fallback (dcf362bc)
- Logging refactors tied to telemetry divergences (9b9ab609, 995ae717, b364f376)
- A2A traceId propagation and extension context flow (36de6862, cc7e1472)
- Compression service refactor + UI changes (847c6e7f, ce40a653)

## Notes
- Waiting for human review after CHERRIES.md/SUMMARY.md before batching (per runbook).
- Plan folder: project-plans/20260104gmerge/
